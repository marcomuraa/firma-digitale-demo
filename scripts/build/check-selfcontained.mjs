#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Controllo di autoconsistenza dei quattro HTML prodotti in dist/.
//
// Esce con codice non zero al primo fallimento. Gira in coda a `npm run build`
// e si puo rilanciare da solo con `npm run build:check`.
//
// Cosa verifica, in ordine:
//   1. dist/ contiene esattamente i quattro file attesi e nient'altro;
//   2. analisi statica: nessun riferimento esterno in HTML, CSS o import;
//   3. prova vera nel browser, un solo avvio di Chrome per file, da cui escono
//      due prove insieme:
//        a. nel DOM compaiono i marcatori che la pagina scrive solo se il suo
//           JavaScript e partito davvero, col valore giusto del flag narrato;
//        b. il registro di rete di Chrome non contiene nessuna richiesta HTTP
//           oltre a quelle che Chrome fa per conto proprio;
//   4. peso di ciascun file.
//
// Il punto 3 e quello che conta: l'analisi statica dice che il file sembra
// autoconsistente, il browser dice che lo e.
//
// Nota sull'analisi statica. I controlli che possono fallire sono solo quelli
// strutturali (attributi, url() nei CSS, import di moduli). Le ricerche di
// stringhe sospette restano AVVISI e non fanno fallire niente: quando entreranno
// nel bundle pdf.js e PKI.js, quelle stringhe compariranno per forza —
// `XMLHttpRequest` nel livello di rete di pdf.js, gli URI di namespace XMP di
// Adobe e del W3C — senza che la pagina chieda mai niente alla rete. Il verdetto
// sulla rete lo da il registro di Chrome, che guarda le richieste vere.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const qui = path.dirname(fileURLToPath(import.meta.url))
const radiceProgetto = path.resolve(qui, '..', '..')
const cartellaDist = path.join(radiceProgetto, 'dist')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** Sentinella esportata da src/entries/narration-placeholder.js. */
const SENTINELLA_NARRAZIONE = 'SEGNAPOSTO_NARRAZIONE_FASE_5B'

/**
 * Host che Chrome contatta per conto suo all'avvio (ora, account, varianti,
 * risorse della nuova scheda), a prescindere dalla pagina aperta. Non sono
 * traffico della demo. Tutto il resto e un fallimento.
 */
const HOST_INTERNI_CHROME = new Set([
  'clients1.google.com',
  'clients2.google.com',
  'clients3.google.com',
  'clients4.google.com',
  'accounts.google.com',
  'www.google.com',
  'www.gstatic.com',
  'clientservices.googleapis.com',
  'update.googleapis.com',
  'safebrowsingohttpgateway.googleapis.com',
  'content-autofill.googleapis.com',
  'optimizationguide-pa.googleapis.com',
])

/**
 * I quattro output attesi, con i marcatori che ciascuno deve esporre nel DOM.
 * `titolo` e quello scritto da src/entries/marcatori.js al boot, non quello
 * statico dell'HTML sorgente: se coincidesse col ripiego non proverebbe niente.
 */
const ATTESI = [
  {
    file: 'protocollo.html',
    direzione: 'protocollo',
    narrato: 'no',
    titolo: 'Firma digitale PAdES — Protocollo — versione muta',
  },
  {
    file: 'protocollo-narrato.html',
    direzione: 'protocollo',
    narrato: 'si',
    titolo: 'Firma digitale PAdES — Protocollo — versione narrata',
  },
  {
    file: 'doppia-esposizione.html',
    direzione: 'doppia-esposizione',
    narrato: 'no',
    titolo: 'Firma digitale PAdES — Doppia esposizione — versione muta',
  },
  {
    file: 'doppia-esposizione-narrata.html',
    direzione: 'doppia-esposizione',
    narrato: 'si',
    titolo: 'Firma digitale PAdES — Doppia esposizione — versione narrata',
  },
]

function fallisci(messaggio) {
  console.error(`  FALLITO: ${messaggio}`)
  // Requisito: uscita non zero al primo fallimento.
  process.exit(1)
}

function ok(messaggio) {
  console.log(`  ok  ${messaggio}`)
}

function avviso(messaggio) {
  console.log(`  avviso  ${messaggio}`)
}

// --- 1. Contenuto di dist/ ---------------------------------------------------

function controllaContenutoDist() {
  console.log('\n[1/4] Contenuto di dist/')
  if (!fs.existsSync(cartellaDist)) {
    fallisci('dist/ non esiste. Lancia prima "npm run build".')
  }

  const trovati = elencaFile(cartellaDist).sort()
  const attesi = ATTESI.map((v) => v.file).sort()

  const mancanti = attesi.filter((f) => !trovati.includes(f))
  if (mancanti.length > 0) {
    fallisci(`mancano da dist/: ${mancanti.join(', ')}`)
  }

  const inPiu = trovati.filter((f) => !attesi.includes(f))
  if (inPiu.length > 0) {
    fallisci(
      `dist/ contiene file non previsti: ${inPiu.join(', ')}. ` +
        'Un HTML autoconsistente non deve avere file affiancati.',
    )
  }
  ok(`esattamente ${attesi.length} file: ${attesi.join(', ')}`)
}

/** Elenca ricorsivamente i file di una cartella, con percorso relativo. */
function elencaFile(cartella, prefisso = '') {
  const risultato = []
  for (const voce of fs.readdirSync(cartella, { withFileTypes: true })) {
    const relativo = prefisso ? `${prefisso}/${voce.name}` : voce.name
    if (voce.isDirectory()) {
      risultato.push(...elencaFile(path.join(cartella, voce.name), relativo))
    } else {
      risultato.push(relativo)
    }
  }
  return risultato
}

// --- 2. Analisi statica ------------------------------------------------------

/** Schemi ammessi nei valori di href/src: nessuno di questi esce dal file. */
const SCHEMI_INTERNI = ['data:', 'blob:', 'about:', 'javascript:', '#']

function controllaRiferimentiEsterni(nomeFile, html) {
  // <script src="...">: qualunque script deve essere inline.
  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) {
    fallisci(`${nomeFile}: trovato <script src=...>, lo script non e inlineato`)
  }

  // <link rel="stylesheet">: qualunque CSS deve stare in <style>.
  if (/<link\b[^>]*\brel\s*=\s*["']?stylesheet/i.test(html)) {
    fallisci(`${nomeFile}: trovato <link rel=stylesheet>, il CSS non e inlineato`)
  }

  // <link rel="modulepreload" | "preload" | "prefetch" | "icon" ...> con href esterno:
  // ricade nel controllo generale sugli attributi qui sotto.

  // Ogni attributo href/src deve puntare dentro il file.
  for (const m of html.matchAll(/\b(href|src|srcset|poster|data)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const attributo = m[1].toLowerCase()
    const valore = (m[3] ?? m[4] ?? '').trim()
    if (valore === '') continue
    if (SCHEMI_INTERNI.some((s) => valore.toLowerCase().startsWith(s))) continue
    fallisci(
      `${nomeFile}: attributo ${attributo}="${accorcia(valore)}" punta fuori dal file ` +
        '(ammessi solo data:, blob:, about:, javascript: e ancore #)',
    )
  }

  // url(...) e @import nei CSS: solo data URI. Il controllo gira solo sui blocchi
  // <style> e sugli attributi style="", non su tutto l'HTML: nel JavaScript
  // minificato `new URL(a,b)` sarebbe un falso positivo.
  for (const css of estraiCss(html)) {
    for (const m of css.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/gi)) {
      const valore = (m[1] ?? m[2] ?? m[3] ?? '').trim()
      if (valore === '' || valore.startsWith('#')) continue
      if (valore.toLowerCase().startsWith('data:')) continue
      fallisci(`${nomeFile}: url(${accorcia(valore)}) nel CSS non e un data URI`)
    }
    for (const m of css.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)) {
      if (!m[1].toLowerCase().startsWith('data:')) {
        fallisci(`${nomeFile}: @import CSS verso "${accorcia(m[1])}"`)
      }
    }
  }

  // Import di moduli verso l'esterno: static import, export ... from, import().
  const importStatico = /(?:^|[;\s}])(?:import|export)\s*(?:[\w${},*\s]+\s*from\s*)?["']([^"']+)["']/g
  for (const m of html.matchAll(importStatico)) {
    if (!m[1].toLowerCase().startsWith('data:')) {
      fallisci(`${nomeFile}: import di modulo esterno "${accorcia(m[1])}"`)
    }
  }
  for (const m of html.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    if (m[1].toLowerCase().startsWith('data:')) continue
    if (dentroUnaStringa(m[1])) {
      avviso(
        `${nomeFile}: "import(${accorcia(m[1])})" e testo sorgente dentro una stringa, non un ` +
          'import di questa pagina. Sul traffico decide il registro di rete al punto 3.',
      )
      continue
    }
    fallisci(`${nomeFile}: import dinamico esterno "${accorcia(m[1])}"`)
  }
  if (/<script\b[^>]*\btype\s*=\s*["']?importmap/i.test(html)) {
    fallisci(`${nomeFile}: presente una importmap, potrebbe risolvere moduli esterni`)
  }

  // --- Da qui in giu solo avvisi: vedi la nota in testa al file. ---
  const ospiti = new Set()
  for (const m of html.matchAll(/https?:\/\/([^\s"'<>()\\]+)/gi)) {
    const ospite = m[1].split('/')[0]
    if (/^(www\.)?w3\.org$/i.test(ospite)) continue
    ospiti.add(ospite)
  }
  if (ospiti.size > 0) {
    avviso(
      `${nomeFile}: URL assoluti presenti nel testo del bundle (nessuno raggiungibile da ` +
        `un attributo): ${[...ospiti].slice(0, 6).join(', ')}${ospiti.size > 6 ? ', …' : ''}`,
    )
  }
  const apiRete = ['XMLHttpRequest', 'new WebSocket', 'EventSource(', 'navigator.sendBeacon']
    .filter((s) => html.includes(s))
  if (apiRete.length > 0) {
    avviso(
      `${nomeFile}: nel bundle compaiono API di rete (${apiRete.join(', ')}). ` +
        'Se non vengono usate non e un problema: lo decide il registro di rete al punto 3.',
    )
  }
}

/** Restituisce i frammenti di CSS presenti nell'HTML: blocchi <style> e attributi style. */
function estraiCss(html) {
  const frammenti = []
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) frammenti.push(m[1])
  for (const m of html.matchAll(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    frammenti.push(m[2] ?? m[3] ?? '')
  }
  return frammenti
}

function accorcia(testo, massimo = 80) {
  return testo.length > massimo ? `${testo.slice(0, massimo)}…` : testo
}

/**
 * Un specificatore di modulo che contiene un segnaposto di template letterale non e un modulo:
 * e testo sorgente che vive DENTRO una stringa di un altro programma. La prova che non e un
 * import di questa pagina non e un'opinione — se lo fosse, Vite avrebbe dovuto risolverlo a
 * tempo di build, e non puo risolvere un percorso che a build time non esiste ancora.
 *
 * Il caso vero, dalla fase 5: pdf.js 6.x porta dentro `PDFWorker._createCDNWrapper`, che
 * costruisce il sorgente di un worker da blob concatenando `await import("<url>");`. Nel bundle
 * minificato quel pezzo compare come `` `await import(\"${e}\");` `` — una stringa, non un import.
 * Con la ricetta di spikes/pdfjs/RECIPE.md quel ramo non viene nemmeno percorso: il fake worker
 * e gia registrato in globalThis.pdfjsWorker e nessun Worker viene mai creato.
 *
 * Resta un avviso e non un silenzio, perche il giorno in cui comparisse un altro
 * `import(<qualcosa di interpolato>)` qualcuno deve vederlo. Il verdetto sul traffico lo da
 * comunque il registro di rete di Chrome al punto 3, che guarda le richieste vere.
 */
function dentroUnaStringa(specificatore) {
  return specificatore.includes('${')
}

// --- 3. Prova nel browser ----------------------------------------------------

/** Argomenti che spengono il piu possibile il traffico che Chrome genera da solo. */
const ARGOMENTI_CHROME = [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--no-pings',
  '--disable-client-side-phishing-detection',
  '--disable-default-apps',
  '--disable-domain-reliability',
  '--disable-breakpad',
  '--disable-component-extensions-with-background-pages',
  '--disable-search-engine-choice-screen',
  '--metrics-recording-only',
  '--no-service-autorun',
  '--variations-server-url=',
  '--variations-insecure-server-url=',
  // Qualunque tentativo di rete finisce su una porta morta: se la pagina
  // dipendesse da una risorsa remota, non la otterrebbe comunque.
  '--proxy-server=http://127.0.0.1:9',
  // Tempo virtuale: lascia completare l'import dinamico della narrazione.
  '--virtual-time-budget=3000',
]

/**
 * Apre il file con Chrome headless e restituisce DOM e registro di rete.
 *
 * Non usa execFileSync di proposito: Chrome lascia vivi dei processi figli che
 * ereditano lo stdio, quindi l'attesa sincrona si blocca a caso anche dopo che
 * il DOM e stato scritto per intero. Qui il DOM si considera completo appena
 * arriva </html>, poi il gruppo di processi viene terminato.
 *
 * @returns {Promise<{ dom: string, netlog: string }>}
 */
function apriNelBrowser(percorsoFile, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const temporanea = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-check-'))
    const profilo = path.join(temporanea, 'profilo')
    const registroRete = path.join(temporanea, 'netlog.json')

    const figlio = spawn(
      CHROME,
      [
        ...ARGOMENTI_CHROME,
        `--user-data-dir=${profilo}`,
        `--log-net-log=${registroRete}`,
        '--dump-dom',
        pathToFileURL(percorsoFile).href,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], detached: true },
    )

    let dom = ''
    let concluso = false

    const concludi = (errore, valore) => {
      if (concluso) return
      concluso = true
      clearTimeout(timer)
      try {
        process.kill(-figlio.pid, 'SIGKILL')
      } catch {
        /* gia uscito */
      }
      if (errore) {
        pulisci(temporanea)
        reject(errore)
        return
      }
      // Il registro viene scritto a blocchi: un attimo di respiro prima di leggerlo.
      setTimeout(() => {
        let netlog = ''
        try {
          netlog = fs.readFileSync(registroRete, 'utf8')
        } catch {
          netlog = ''
        }
        pulisci(temporanea)
        resolve({ dom: valore, netlog })
      }, 500)
    }

    const timer = setTimeout(
      () => concludi(new Error(`Chrome non ha risposto entro ${timeoutMs} ms`)),
      timeoutMs,
    )

    figlio.stdout.setEncoding('utf8')
    figlio.stdout.on('data', (pezzo) => {
      dom += pezzo
      if (/<\/html>\s*$/i.test(dom)) concludi(null, dom)
    })
    figlio.on('error', (e) => concludi(e))
    figlio.on('close', () => {
      if (dom.length > 0) concludi(null, dom)
      else concludi(new Error('Chrome e uscito senza produrre il DOM'))
    })
  })
}

function pulisci(cartella) {
  try {
    fs.rmSync(cartella, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  } catch {
    /* Chrome puo ancora starci scrivendo: e sotto la cartella temporanea, pazienza */
  }
}

async function controllaNelBrowser(atteso, percorsoFile) {
  let esito
  try {
    esito = await apriNelBrowser(percorsoFile)
  } catch (e) {
    fallisci(`${atteso.file}: Chrome headless non ha prodotto il DOM (${e?.message ?? e})`)
    return
  }

  const { dom, netlog } = esito

  const attributi = estraiAttributiBody(dom)
  if (!attributi) {
    fallisci(`${atteso.file}: nessun <body> nel DOM restituito da Chrome`)
    return
  }

  if (attributi['data-boot'] !== 'ok') {
    fallisci(
      `${atteso.file}: manca data-boot="ok" su <body>. Il JavaScript della pagina ` +
        'non e partito nel browser.',
    )
  }
  if (attributi['data-direzione'] !== atteso.direzione) {
    fallisci(
      `${atteso.file}: data-direzione="${attributi['data-direzione']}" invece di "${atteso.direzione}"`,
    )
  }
  if (attributi['data-narrato'] !== atteso.narrato) {
    fallisci(
      `${atteso.file}: data-narrato="${attributi['data-narrato']}" invece di "${atteso.narrato}". ` +
        'Il flag di build __NARRATED__ non corrisponde alla variante.',
    )
  }
  if (attributi['data-asset-inline'] !== 'ok') {
    fallisci(
      `${atteso.file}: data-asset-inline="${attributi['data-asset-inline']}". ` +
        'Un asset importato non e diventato un data URI.',
    )
  }

  const narrazioneMontata = attributi['data-narrazione'] === SENTINELLA_NARRAZIONE
  if (atteso.narrato === 'si' && !narrazioneMontata) {
    fallisci(`${atteso.file}: variante narrata ma il modulo di narrazione non si e montato`)
  }
  if (atteso.narrato === 'no' && attributi['data-narrazione'] !== undefined) {
    fallisci(`${atteso.file}: variante muta ma il modulo di narrazione si e montato`)
  }

  const titolo = estraiTitolo(dom)
  if (titolo !== atteso.titolo) {
    fallisci(`${atteso.file}: <title> nel DOM e "${titolo}" invece di "${atteso.titolo}"`)
  }

  // Registro di rete: nessuna richiesta oltre a quelle di Chrome stesso.
  if (netlog.length === 0) {
    fallisci(
      `${atteso.file}: Chrome non ha scritto il registro di rete, impossibile provare ` +
        'che la pagina non ha chiesto niente alla rete.',
    )
  }
  const ospitiContattati = new Set()
  for (const m of netlog.matchAll(/"url":\s*"(https?:\/\/[^"/]+)/g)) {
    const ospite = m[1].replace(/^https?:\/\//, '').split(':')[0]
    if (!HOST_INTERNI_CHROME.has(ospite)) ospitiContattati.add(ospite)
  }
  if (ospitiContattati.size > 0) {
    fallisci(
      `${atteso.file}: la pagina ha tentato richieste di rete verso ${[...ospitiContattati].join(', ')}`,
    )
  }

  ok(
    `${atteso.file}: avviato nel browser — direzione=${atteso.direzione}, ` +
      `narrato=${atteso.narrato}, titolo corretto, nessuna richiesta di rete`,
  )
}

function estraiAttributiBody(dom) {
  const m = dom.match(/<body\b([^>]*)>/i)
  if (!m) return null
  const attributi = {}
  for (const a of m[1].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    attributi[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? ''
  }
  return attributi
}

function estraiTitolo(dom) {
  const m = dom.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? decodificaEntita(m[1].trim()) : null
}

function decodificaEntita(testo) {
  return testo
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
}

// --- Esecuzione --------------------------------------------------------------

async function principale() {
  controllaContenutoDist()

  console.log('\n[2/4] Analisi statica dei riferimenti')
  for (const atteso of ATTESI) {
    const html = fs.readFileSync(path.join(cartellaDist, atteso.file), 'utf8')
    controllaRiferimentiEsterni(atteso.file, html)

    // La narrazione deve entrare solo dove serve. Nelle varianti mute il ramo
    // `if (__NARRATED__)` va eliminato dal tree-shaking: se la sentinella
    // comparisse comunque, driver e blob audio peserebbero anche sui file muti.
    const contieneNarrazione = html.includes(SENTINELLA_NARRAZIONE)
    if (atteso.narrato === 'si' && !contieneNarrazione) {
      fallisci(`${atteso.file}: variante narrata ma il modulo di narrazione non e nel bundle`)
    }
    if (atteso.narrato === 'no' && contieneNarrazione) {
      fallisci(
        `${atteso.file}: variante muta ma il modulo di narrazione e finito nel bundle. ` +
          'Il ramo if (__NARRATED__) non e stato eliminato.',
      )
    }
    ok(
      `${atteso.file}: nessun riferimento esterno, narrazione ` +
        `${atteso.narrato === 'si' ? 'presente' : 'assente'}`,
    )
  }

  console.log('\n[3/4] Prova nel browser (Chrome headless, file://, rete su porta morta)')
  if (!fs.existsSync(CHROME)) {
    console.error(
      `  FALLITO: Chrome non trovato in ${CHROME}. La prova nel browser non e stata eseguita, ` +
        'quindi non e dimostrato che le pagine si avviino da file://.',
    )
    process.exit(1)
  }
  for (const atteso of ATTESI) {
    await controllaNelBrowser(atteso, path.join(cartellaDist, atteso.file))
  }

  console.log('\n[4/4] Peso dei file')
  let totale = 0
  for (const atteso of ATTESI) {
    const byte = fs.statSync(path.join(cartellaDist, atteso.file)).size
    totale += byte
    console.log(
      `  ${atteso.file.padEnd(34)} ${byte.toLocaleString('it-IT').padStart(12)} byte` +
        `  (${(byte / 1024).toFixed(1)} KB)`,
    )
  }
  console.log(
    `  ${'TOTALE'.padEnd(34)} ${totale.toLocaleString('it-IT').padStart(12)} byte` +
      `  (${(totale / 1024).toFixed(1)} KB)`,
  )

  console.log('\nControllo superato: i quattro file sono autoconsistenti e si avviano da file://.')
}

await principale()
process.exit(0)
