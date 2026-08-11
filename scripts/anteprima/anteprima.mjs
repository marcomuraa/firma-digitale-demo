#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Anteprima: costruisce una entry, la apre in Chrome headless da file://, la
// PILOTA e scatta le schermate. E lo strumento con cui chi disegna una pagina
// vede davvero cio che ha fatto, e con cui chi la critica la misura.
//
// Perche esiste, invece di lanciare Chrome a mano:
//
//   1. `npm run build` svuota dist/ e ricostruisce tutti e quattro i file: due
//      agenti che lavorano in parallelo sulle due direzioni si cancellerebbero
//      il lavoro a vicenda. Qui ogni invocazione costruisce UNA entry dentro una
//      cartella propria, passando ENTRY/NARRATED/OUT_DIR a Vite.
//   2. Chrome con --screenshot scrive il PNG e poi NON esce: resta appeso finche
//      qualcuno lo uccide (stessa ragione per cui check-selfcontained.mjs evita
//      execFileSync). Qui si pilota via DevTools Protocol a tempo reale, e alla
//      fine il gruppo di processi viene terminato.
//   3. Una schermata al caricamento non dimostra niente: la demo va PERCORSA.
//      Il copione permette di eseguire i passi e scattare agli stati che contano.
//
// USO
//
//   node scripts/anteprima/anteprima.mjs --entry protocollo --scatti /tmp/mie
//   node scripts/anteprima/anteprima.mjs --file dist/protocollo.html --larghezza 390
//   node scripts/anteprima/anteprima.mjs --entry doppia-esposizione \
//        --copione scripts/anteprima/copioni/demo-intera.json --scatti /tmp/mie
//
// OPZIONI
//
//   --entry <id>        protocollo | doppia-esposizione   (costruisce al volo)
//   --narrato           costruisce la variante narrata
//   --file <percorso>   apre un HTML gia costruito invece di costruirne uno
//   --scatti <cartella> dove finiscono i PNG               (default: temporanea)
//   --copione <file>    JSON con la sequenza di azioni      (vedi sotto)
//   --larghezza <px>    larghezza della finestra            (default 1280)
//   --altezza <px>      altezza della finestra              (default 900)
//   --scala <n>         deviceScaleFactor                   (default 1)
//   --intera            schermata dell'intera pagina, non solo della finestra
//   --attesa <ms>       attesa massima per il caricamento   (default 30000)
//   --dom               stampa anche il DOM finale
//   --json              stampa il rapporto come JSON e nient'altro
//
// IL COPIONE
//
// Un array di azioni. Ogni azione puo avere:
//
//   { "nome": "03-firmato",              // se c'e, scatta e salva <nome>.png
//     "js": "await window.__demo.run('firma')",   // eseguito nella pagina
//     "attendi": 400,                    // ms di attesa dopo il js
//     "aspetta": "document.body.dataset.passoCorrente === 'firma'" }
//                                        // ...oppure aspetta una condizione
//
// Senza copione si scatta una sola volta, a pagina caricata, con nome `carico`.
//
// COSA RIPORTA, sempre: errori di console, eccezioni non gestite, richieste di
// rete tentate, e per ogni scatto il percorso del PNG. Un errore di console non
// fa fallire il comando ma finisce nel rapporto: sta a chi legge deciderlo.
// Codice di uscita diverso da zero solo se la pagina non si e caricata, se il
// build e fallito o se un'azione del copione ha lanciato.
// ---------------------------------------------------------------------------

import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const qui = path.dirname(fileURLToPath(import.meta.url))
const radiceProgetto = path.resolve(qui, '..', '..')
const viteBin = path.join(radiceProgetto, 'node_modules', 'vite', 'bin', 'vite.js')

const ENTRY_VALIDE = new Set(['protocollo', 'doppia-esposizione'])

// --- Argomenti ---------------------------------------------------------------

function leggiArgomenti(argv) {
  const opzioni = {
    entry: null,
    narrato: false,
    file: null,
    scatti: null,
    copione: null,
    larghezza: 1280,
    altezza: 900,
    scala: 1,
    intera: false,
    attesa: 30000,
    dom: false,
    json: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const valore = () => {
      const v = argv[++i]
      if (v === undefined) fallisci(`l'opzione ${arg} vuole un valore`)
      return v
    }
    switch (arg) {
      case '--entry': opzioni.entry = valore(); break
      case '--narrato': opzioni.narrato = true; break
      case '--file': opzioni.file = valore(); break
      case '--scatti': opzioni.scatti = valore(); break
      case '--copione': opzioni.copione = valore(); break
      case '--larghezza': opzioni.larghezza = Number(valore()); break
      case '--altezza': opzioni.altezza = Number(valore()); break
      case '--scala': opzioni.scala = Number(valore()); break
      case '--intera': opzioni.intera = true; break
      case '--attesa': opzioni.attesa = Number(valore()); break
      case '--dom': opzioni.dom = true; break
      case '--json': opzioni.json = true; break
      case '--aiuto':
      case '--help': stampaAiuto(); process.exit(0); break
      default: fallisci(`opzione non riconosciuta: ${arg}`)
    }
  }
  if (!opzioni.entry && !opzioni.file) fallisci('serve --entry <id> oppure --file <percorso>')
  if (opzioni.entry && !ENTRY_VALIDE.has(opzioni.entry)) {
    fallisci(`--entry non riconosciuta: "${opzioni.entry}". Ammesse: ${[...ENTRY_VALIDE].join(', ')}`)
  }
  for (const n of ['larghezza', 'altezza', 'scala', 'attesa']) {
    if (!Number.isFinite(opzioni[n]) || opzioni[n] <= 0) fallisci(`--${n} deve essere un numero positivo`)
  }
  return opzioni
}

function stampaAiuto() {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
    .filter((r) => r.startsWith('//')).map((r) => r.replace(/^\/\/ ?/, '')).join('\n'))
}

function fallisci(messaggio) {
  console.error(`anteprima: ${messaggio}`)
  process.exit(2)
}

// --- 1. Il build di una sola entry -------------------------------------------

/** Costruisce una entry dentro una cartella propria. Restituisce il percorso dell'HTML. */
function costruisci(entry, narrato, silenzioso) {
  if (!fs.existsSync(viteBin)) fallisci(`Vite non trovato in ${viteBin}`)
  const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'anteprima-build-'))
  try {
    execFileSync(process.execPath, [viteBin, 'build'], {
      cwd: radiceProgetto,
      stdio: silenzioso ? ['ignore', 'ignore', 'pipe'] : 'inherit',
      env: { ...process.env, ENTRY: entry, NARRATED: narrato ? '1' : '0', OUT_DIR: cartella },
    })
  } catch (e) {
    const dettaglio = e?.stderr ? `\n${e.stderr.toString()}` : ''
    console.error(`anteprima: il build di "${entry}" e fallito.${dettaglio}`)
    process.exit(1)
  }
  const html = path.join(cartella, `${entry}.html`)
  if (!fs.existsSync(html)) fallisci(`il build non ha prodotto ${entry}.html`)
  const affiancati = fs.readdirSync(cartella).filter((f) => f !== `${entry}.html`)
  if (affiancati.length > 0) {
    fallisci(`il build ha prodotto file affiancati (${affiancati.join(', ')}): l'inlining non e completo`)
  }
  return html
}

// --- 2. Il collegamento a Chrome ---------------------------------------------

/** Argomenti che tolgono di mezzo il traffico che Chrome genera per conto suo. */
const ARGOMENTI_CHROME = [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--no-pings',
  '--disable-default-apps',
  '--disable-search-engine-choice-screen',
  '--metrics-recording-only',
  '--disable-breakpad',
  '--proxy-server=http://127.0.0.1:9',
]

async function apriChrome({ larghezza, altezza, scala }) {
  const profilo = fs.mkdtempSync(path.join(os.tmpdir(), 'anteprima-chrome-'))
  const figlio = spawn(
    CHROME,
    [
      ...ARGOMENTI_CHROME,
      `--window-size=${larghezza},${altezza}`,
      `--force-device-scale-factor=${scala}`,
      '--remote-debugging-port=0',
      `--user-data-dir=${profilo}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: true },
  )

  const ws = await new Promise((risolvi, rifiuta) => {
    let buffer = ''
    const scadenza = setTimeout(
      () => rifiuta(new Error('Chrome non ha aperto la porta di debug entro 25 s')),
      25000,
    )
    figlio.stderr.setEncoding('utf8')
    figlio.stderr.on('data', (pezzo) => {
      buffer += pezzo
      const trovato = buffer.match(/DevTools listening on (ws:\S+)/)
      if (trovato) { clearTimeout(scadenza); risolvi(trovato[1]) }
    })
    figlio.on('error', (e) => { clearTimeout(scadenza); rifiuta(e) })
    figlio.on('close', () => { clearTimeout(scadenza); rifiuta(new Error('Chrome e uscito subito')) })
  })

  return {
    ws,
    chiudi() {
      try { process.kill(-figlio.pid, 'SIGKILL') } catch { /* gia uscito */ }
      try { fs.rmSync(profilo, { recursive: true, force: true, maxRetries: 5 }) } catch { /* pazienza */ }
    },
  }
}

/** Un canale DevTools: invia comandi, raccoglie eventi. */
async function collega(urlWebSocket) {
  const socket = new WebSocket(urlWebSocket)
  await new Promise((risolvi, rifiuta) => {
    socket.addEventListener('open', risolvi, { once: true })
    socket.addEventListener('error', () => rifiuta(new Error('WebSocket verso Chrome rifiutata')), { once: true })
  })

  let sequenza = 0
  const attese = new Map()
  const ascoltatori = []

  socket.addEventListener('message', (evento) => {
    const messaggio = JSON.parse(evento.data)
    if (messaggio.id && attese.has(messaggio.id)) {
      const { risolvi, rifiuta } = attese.get(messaggio.id)
      attese.delete(messaggio.id)
      if (messaggio.error) rifiuta(new Error(JSON.stringify(messaggio.error)))
      else risolvi(messaggio.result)
    } else if (messaggio.method) {
      for (const ascoltatore of ascoltatori) ascoltatore(messaggio)
    }
  })

  return {
    invia(metodo, parametri = {}, sessione) {
      const id = ++sequenza
      return new Promise((risolvi, rifiuta) => {
        attese.set(id, { risolvi, rifiuta })
        socket.send(JSON.stringify({ id, method: metodo, params: parametri, sessionId: sessione }))
      })
    },
    ascolta(fn) { ascoltatori.push(fn) },
  }
}

// --- 3. Il giro vero ----------------------------------------------------------

async function principale() {
  const opzioni = leggiArgomenti(process.argv.slice(2))
  const silenzioso = opzioni.json

  const html = opzioni.file
    ? path.resolve(radiceProgetto, opzioni.file)
    : costruisci(opzioni.entry, opzioni.narrato, silenzioso)
  if (!fs.existsSync(html)) fallisci(`file inesistente: ${html}`)

  const cartellaScatti = opzioni.scatti
    ? path.resolve(radiceProgetto, opzioni.scatti)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'anteprima-scatti-'))
  fs.mkdirSync(cartellaScatti, { recursive: true })

  const copione = opzioni.copione
    ? JSON.parse(fs.readFileSync(path.resolve(radiceProgetto, opzioni.copione), 'utf8'))
    : [{ nome: 'carico' }]
  if (!Array.isArray(copione)) fallisci('il copione deve essere un array di azioni')

  const rapporto = {
    html,
    byte: fs.statSync(html).size,
    finestra: { larghezza: opzioni.larghezza, altezza: opzioni.altezza, scala: opzioni.scala },
    scatti: [],
    console: [],
    eccezioni: [],
    rete: [],
    azioni: [],
    dom: null,
  }

  const chrome = await apriChrome(opzioni)
  let uscita = 0
  try {
    const canale = await collega(chrome.ws)
    const { targetId } = await canale.invia('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await canale.invia('Target.attachToTarget', { targetId, flatten: true })
    const invia = (metodo, parametri) => canale.invia(metodo, parametri, sessionId)

    canale.ascolta((messaggio) => {
      if (messaggio.sessionId !== sessionId) return
      const p = messaggio.params ?? {}
      if (messaggio.method === 'Runtime.consoleAPICalled') {
        if (p.type === 'error' || p.type === 'warning') {
          rapporto.console.push({
            tipo: p.type,
            testo: (p.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 400),
          })
        }
      } else if (messaggio.method === 'Runtime.exceptionThrown') {
        const d = p.exceptionDetails ?? {}
        rapporto.eccezioni.push({
          testo: (d.exception?.description ?? d.text ?? 'eccezione').slice(0, 600),
          riga: d.lineNumber,
        })
      } else if (messaggio.method === 'Log.entryAdded') {
        if (p.entry?.level === 'error') {
          rapporto.console.push({ tipo: 'log', testo: String(p.entry.text ?? '').slice(0, 400) })
        }
      } else if (messaggio.method === 'Network.requestWillBeSent') {
        const url = p.request?.url ?? ''
        if (!url.startsWith('file:') && !url.startsWith('data:') && !url.startsWith('blob:')) {
          rapporto.rete.push(url.slice(0, 200))
        }
      }
    })

    await invia('Network.enable')
    await invia('Runtime.enable')
    await invia('Log.enable')
    await invia('Page.enable')
    await invia('Emulation.setDeviceMetricsOverride', {
      width: opzioni.larghezza,
      height: opzioni.altezza,
      deviceScaleFactor: opzioni.scala,
      mobile: false,
    })

    const caricata = attendiEvento(canale, sessionId, 'Page.loadEventFired', opzioni.attesa)
    await invia('Page.navigate', { url: pathToFileURL(html).href })
    await caricata

    // La pagina puo continuare a lavorare dopo `load` (pdf.js, generazione chiavi):
    // un respiro prima del primo scatto evita di fotografare una pagina a meta.
    await pausa(700)

    for (const [indice, azione] of copione.entries()) {
      const etichetta = azione.nome ?? `azione-${indice + 1}`
      const esito = { azione: etichetta, ok: true }
      try {
        if (azione.js) {
          const risultato = await invia('Runtime.evaluate', {
            expression: `(async () => { ${azione.js} })()`,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true,
          })
          if (risultato.exceptionDetails) {
            throw new Error(
              risultato.exceptionDetails.exception?.description ??
                risultato.exceptionDetails.text ?? 'errore nel js del copione',
            )
          }
          if (risultato.result?.value !== undefined) esito.valore = risultato.result.value
        }
        if (azione.aspetta) {
          await aspettaCondizione(invia, azione.aspetta, azione.scadenza ?? 15000)
        }
        await pausa(azione.attendi ?? 250)
        if (azione.nome) {
          const percorso = path.join(cartellaScatti, `${azione.nome}.png`)
          await scatta(invia, percorso, opzioni.intera)
          rapporto.scatti.push(percorso)
          esito.scatto = percorso
        }
      } catch (e) {
        esito.ok = false
        esito.errore = e?.message ?? String(e)
        uscita = 1
      }
      rapporto.azioni.push(esito)
      if (!esito.ok) break
    }

    if (opzioni.dom) {
      const r = await invia('Runtime.evaluate', {
        expression: 'document.documentElement.outerHTML',
        returnByValue: true,
      })
      rapporto.dom = r.result?.value ?? null
    }
  } catch (e) {
    rapporto.errore = e?.message ?? String(e)
    uscita = 1
  } finally {
    chrome.chiudi()
  }

  if (opzioni.json) {
    console.log(JSON.stringify(rapporto, null, 2))
  } else {
    stampaRapporto(rapporto, opzioni)
  }
  process.exit(uscita)
}

function pausa(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function attendiEvento(canale, sessionId, metodo, timeoutMs) {
  return new Promise((risolvi, rifiuta) => {
    const scadenza = setTimeout(
      () => rifiuta(new Error(`la pagina non ha emesso ${metodo} entro ${timeoutMs} ms`)),
      timeoutMs,
    )
    canale.ascolta((messaggio) => {
      if (messaggio.method === metodo && messaggio.sessionId === sessionId) {
        clearTimeout(scadenza)
        risolvi()
      }
    })
  })
}

async function aspettaCondizione(invia, espressione, timeoutMs) {
  const scadenza = Date.now() + timeoutMs
  let ultimo = null
  while (Date.now() < scadenza) {
    const r = await invia('Runtime.evaluate', {
      expression: `(() => { try { return !!(${espressione}) } catch (e) { return 'errore: ' + e.message } })()`,
      returnByValue: true,
    })
    ultimo = r.result?.value
    if (ultimo === true) return
    await pausa(150)
  }
  throw new Error(`condizione mai soddisfatta entro ${timeoutMs} ms: ${espressione} (ultimo valore: ${ultimo})`)
}

async function scatta(invia, percorso, intera) {
  const parametri = { format: 'png' }
  if (intera) {
    const { cssContentSize } = await invia('Page.getLayoutMetrics')
    parametri.captureBeyondViewport = true
    parametri.clip = {
      x: 0,
      y: 0,
      width: Math.ceil(cssContentSize.width),
      height: Math.ceil(cssContentSize.height),
      scale: 1,
    }
  }
  const { data } = await invia('Page.captureScreenshot', parametri)
  fs.writeFileSync(percorso, Buffer.from(data, 'base64'))
}

function stampaRapporto(rapporto, opzioni) {
  console.log(`\nfile      ${rapporto.html}`)
  console.log(`peso      ${rapporto.byte.toLocaleString('it-IT')} byte`)
  console.log(`finestra  ${opzioni.larghezza}x${opzioni.altezza} @${opzioni.scala}x${opzioni.intera ? ' (pagina intera)' : ''}`)

  console.log('\nazioni')
  for (const a of rapporto.azioni) {
    const segno = a.ok ? 'ok  ' : 'KO  '
    console.log(`  ${segno}${a.azione}${a.scatto ? `  ->  ${a.scatto}` : ''}`)
    if (a.valore !== undefined) console.log(`        valore: ${JSON.stringify(a.valore).slice(0, 300)}`)
    if (a.errore) console.log(`        errore: ${a.errore}`)
  }

  console.log(`\nconsole   ${rapporto.console.length} fra errori e avvisi`)
  for (const c of rapporto.console.slice(0, 15)) console.log(`  [${c.tipo}] ${c.testo}`)
  console.log(`eccezioni ${rapporto.eccezioni.length}`)
  for (const e of rapporto.eccezioni.slice(0, 10)) console.log(`  ${e.testo}`)
  console.log(`rete      ${rapporto.rete.length} richieste fuori da file:/data:/blob:`)
  for (const u of rapporto.rete.slice(0, 10)) console.log(`  ${u}`)
  if (rapporto.errore) console.log(`\nERRORE    ${rapporto.errore}`)
  if (rapporto.dom) console.log(`\n--- DOM ---\n${rapporto.dom}`)
}

await principale()
