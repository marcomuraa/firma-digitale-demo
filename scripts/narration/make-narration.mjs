#!/usr/bin/env node
// ---------------------------------------------------------------------------
// make-narration.mjs — la voce della demo: dodici segmenti, uno per passo.
//
// Legge `src/ui/script.it.js` — che NON tocca, i testi non sono di questo script —
// da in pasto a `say` il `testoFonetico` di ogni passo, comprime in Opus, misura, e
// scrive tre prodotti generati:
//
//   scripts/narration/out/<stepId>.{txt,wav,opus}   materiale di lavoro e di ascolto
//   scripts/narration/ascolta.html                  pagina di riascolto, doppio click
//   src/assets/narrazione/segments.js               il modulo che entra nel bundle
//
// USO
//
//   node scripts/narration/make-narration.mjs                     tutto (salta cio che e in pari)
//   node scripts/narration/make-narration.mjs --segmento impronta  un segmento solo
//   node scripts/narration/make-narration.mjs --forza              rifa tutto da capo
//   node scripts/narration/make-narration.mjs --json               rapporto in JSON e nient'altro
//   node scripts/narration/make-narration.mjs --aiuto
//
// LA CATENA, per un segmento
//
//   say -v Alice --file-format=WAVE --data-format=LEI16@22050 -f <id>.txt -o <id>.wav
//   ffmpeg -y -i <id>.wav -c:a libopus -b:a 32k -ac 1 -fflags +bitexact <id>.opus
//
// `-fflags +bitexact` non e un vezzo, e il prezzo della rigenerabilita. Senza, il
// muxer Ogg estrae a sorte il numero di serie del flusso — byte 15..18 del file, piu
// il CRC della pagina a 23..26 — e scrive `encoder=Lavc<versione> libopus` nei tag.
// Due esecuzioni della stessa identica riga producono percio due file diversi a
// parita di audio: misurato, campioni decodificati identici e sha256 dei file
// diversi. Col flag il file e byte-identico a ogni giro e smette di portarsi addosso
// il numero di versione di ffmpeg. Costa sedici byte in meno per segmento.
//
// RIGENERAZIONE INCREMENTALE
//
// Per ogni passo si calcola l'impronta della *ricetta*: il testo fonetico piu tutti i
// parametri della catena, versione di ffmpeg e di macOS comprese. Se l'impronta
// coincide con quella registrata in `out/manifesto.json` e il .opus sul disco e
// ancora quello registrato, il segmento non si rifa. Cambiare una riga di copione
// rigenera quel segmento e nessun altro; aggiornare ffmpeg li rigenera tutti, ed e il
// comportamento voluto: audio cotto da un encoder diverso non deve sopravvivere in
// silenzio dentro il modulo.
//
// NIENTE DATE nei file generati. Una marca temporale renderebbe diverse due
// esecuzioni identiche, cioe esattamente cio che questo script promette di non fare.
// ---------------------------------------------------------------------------

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SCRIPT,
  STEP_IDS,
  MAPPA_FONETICA,
  PAROLE_AL_MINUTO,
  applicaMappaFonetica,
  contaParole,
} from '../../src/ui/script.it.js'
import { COPY } from '../../src/ui/copy.it.js'

const qui = path.dirname(fileURLToPath(import.meta.url))
const radice = path.resolve(qui, '..', '..')
const CARTELLA_OUT = path.join(qui, 'out')
const CARTELLA_MODULO = path.join(radice, 'src', 'assets', 'narrazione')
const FILE_MODULO = path.join(CARTELLA_MODULO, 'segments.js')
const FILE_PAGINA = path.join(qui, 'ascolta.html')
const FILE_MANIFESTO = path.join(CARTELLA_OUT, 'manifesto.json')

// --- La ricetta, in un posto solo --------------------------------------------

/** Voce di sistema decisa in docs/decisioni.md. Il ritmo e il predefinito: nessun `-r`. */
export const VOCE = 'Alice'
/** WAV PCM 16 bit little-endian a 22,05 kHz: banda abbondante per una voce. */
export const FORMATO_DATI = 'LEI16@22050'
/** Opus mono. Sulla sonda: 32 kbps di parlato costano circa 239 kB al minuto. */
export const BITRATE = '32k'
/** Sotto questa media in dB un segmento e considerato muto e la generazione fallisce. */
export const SOGLIA_MUTO_MEDIA = -40
/** ...e sotto questo picco: un file quasi vuoto con dentro un clic non deve passare. */
export const SOGLIA_MUTO_PICCO = -20
/** Oltre questo scarto relativo fra durata reale e stimata il rapporto lo segnala. */
export const SCOSTAMENTO_NOTEVOLE = 0.25
/** Opus vive in un contenitore Ogg. Il browser lo riconosce dal contenuto, non da qui. */
export const MIME = 'audio/ogg'

export function argomentiSay(fileTesto, fileWav) {
  return ['-v', VOCE, '--file-format=WAVE', `--data-format=${FORMATO_DATI}`, '-f', fileTesto, '-o', fileWav]
}

export function argomentiFfmpeg(fileWav, fileOpus) {
  return [
    '-y',
    '-loglevel',
    'error',
    '-i',
    fileWav,
    '-c:a',
    'libopus',
    '-b:a',
    BITRATE,
    '-ac',
    '1',
    '-fflags',
    '+bitexact',
    fileOpus,
  ]
}

/**
 * La stringa canonica che descrive *come* un segmento e stato cotto: la sua impronta
 * decide se rifarlo. Tutto cio che puo cambiare l'audio deve comparire qui dentro. Se
 * un ingrediente manca, un cambiamento passa inosservato e il file vecchio sopravvive
 * a un copione che non esiste piu.
 */
export function ricettaDi(stepId, testoFonetico, strumenti) {
  return [
    `passo=${stepId}`,
    `voce=${VOCE}`,
    `formato=${FORMATO_DATI}`,
    `bitrate=${BITRATE}`,
    'canali=1',
    'bitexact=si',
    `ffmpeg=${strumenti.ffmpeg}`,
    `macos=${strumenti.macos}`,
    `testo=${testoFonetico}`,
  ].join('\n')
}

export const impronta = (testo) => createHash('sha256').update(testo, 'utf8').digest('hex')

// --- Lettura dell'uscita degli strumenti --------------------------------------

/**
 * Estrae `mean_volume` e `max_volume` dal blaterare di `ffmpeg -af volumedetect`.
 * `-inf` e il caso che conta: e il silenzio perfetto, cioe il fallimento muto — un
 * file che dura giusto e non dice niente. Torna `null` per un valore assente, cosi
 * chi chiama non confonde «non misurato» con «misurato zero».
 *
 * **Su un solo file ffmpeg stampa piu di un riepilogo.** Misurato su questi .opus:
 * un primo blocco con `n_samples: 0` e nient'altro — l'istanza del filtro creata
 * prima che il decodificatore sappia i parametri dell'audio — e poi quello vero con
 * media e picco. Chi legge la prima occorrenza dichiara muto ogni segmento. Qui si
 * prende l'ultimo valore di ogni campo, e il massimo dei conteggi.
 */
export function analizzaVolumedetect(uscita) {
  const ultimo = (etichetta) => {
    const trovati = [...uscita.matchAll(new RegExp(`${etichetta}:\\s*(-?[\\d.]+|-?inf)\\s*dB`, 'g'))]
    if (!trovati.length) return null
    const valore = trovati[trovati.length - 1][1]
    if (/inf$/.test(valore)) return valore.startsWith('-') ? -Infinity : Infinity
    return Number(valore)
  }
  const conteggi = [...uscita.matchAll(/n_samples:\s*(\d+)/g)].map((trovato) => Number(trovato[1]))
  return {
    media: ultimo('mean_volume'),
    picco: ultimo('max_volume'),
    campioni: conteggi.length ? Math.max(...conteggi) : null,
  }
}

/** Un segmento e muto se non ha campioni, se la media manca o e -inf, o se sta sotto le soglie. */
export function eMuto({ media, picco, campioni }) {
  if (campioni === 0) return true
  if (media === null || media === -Infinity || media < SOGLIA_MUTO_MEDIA) return true
  if (picco === null || picco === -Infinity || picco < SOGLIA_MUTO_PICCO) return true
  return false
}

// --- Processi -----------------------------------------------------------------

function esegui(comando, argomenti) {
  return execFileSync(comando, argomenti, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
  })
}

/** volumedetect scrive su stderr, e ffmpeg esce comunque 0: serve spawnSync, non execFileSync. */
function stderrDi(comando, argomenti) {
  const esito = spawnSync(comando, argomenti, { encoding: 'utf8', timeout: 180_000 })
  if (esito.error) throw esito.error
  if (esito.status !== 0) {
    throw new Error(`${comando} e uscito ${esito.status}: ${(esito.stderr || '').trim()}`)
  }
  return esito.stderr || ''
}

function versioniStrumenti() {
  const ffmpeg = esegui('ffmpeg', ['-hide_banner', '-version']).split('\n')[0].trim()
  let macos = 'sconosciuto'
  try {
    macos = esegui('sw_vers', ['-productVersion']).trim()
  } catch {
    /* non su macOS: il controllo degli strumenti ha gia protestato per `say` */
  }
  return { ffmpeg, macos }
}

function durataDi(file) {
  const uscita = esegui('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ])
  const durata = Number(uscita.trim())
  if (!Number.isFinite(durata) || durata <= 0) {
    throw new Error(`ffprobe non da una durata utilizzabile per ${path.basename(file)}: «${uscita.trim()}»`)
  }
  return durata
}

function volumeDi(file) {
  return analizzaVolumedetect(
    stderrDi('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']),
  )
}

function controllaStrumenti() {
  const mancanti = []
  let elencoVoci = ''
  try {
    elencoVoci = esegui('say', ['-v', '?'])
  } catch {
    mancanti.push('say')
  }
  for (const comando of ['ffmpeg', 'ffprobe']) {
    try {
      esegui(comando, ['-version'])
    } catch {
      mancanti.push(comando)
    }
  }
  if (mancanti.length) {
    throw new Error(
      `Strumenti mancanti: ${mancanti.join(', ')}. La narrazione si genera su macOS, con ffmpeg installato.`,
    )
  }
  if (!new RegExp(`^${VOCE}\\s`, 'm').test(elencoVoci)) {
    throw new Error(`La voce ${VOCE} non e installata su questa macchina: \`say -v '?'\` non la elenca.`)
  }
}

// --- Generazione e misura di un segmento ---------------------------------------

function percorsiDi(stepId) {
  return {
    testo: path.join(CARTELLA_OUT, `${stepId}.txt`),
    wav: path.join(CARTELLA_OUT, `${stepId}.wav`),
    opus: path.join(CARTELLA_OUT, `${stepId}.opus`),
  }
}

function generaSegmento(stepId, testoFonetico) {
  const file = percorsiDi(stepId)

  // Il file di testo e esattamente `testoFonetico`, senza a capo aggiunto: cosi cio che
  // `say` legge e cio che sta in script.it.js sono la stessa sequenza di byte, e il test
  // puo verificarlo invece di fidarsi.
  fs.writeFileSync(file.testo, testoFonetico, 'utf8')

  try {
    esegui('say', argomentiSay(file.testo, file.wav))
  } catch (errore) {
    throw new Error(`say e fallito sul passo ${stepId}: ${(errore.stderr || errore.message).trim()}`)
  }
  if (!fs.existsSync(file.wav) || fs.statSync(file.wav).size < 1024) {
    throw new Error(`say non ha prodotto un WAV utilizzabile per ${stepId}`)
  }

  fs.rmSync(file.opus, { force: true })
  try {
    esegui('ffmpeg', argomentiFfmpeg(file.wav, file.opus))
  } catch (errore) {
    throw new Error(`ffmpeg e fallito sul passo ${stepId}: ${(errore.stderr || errore.message).trim()}`)
  }
}

function misuraSegmento(stepId, testo, testoFonetico) {
  const file = percorsiDi(stepId)
  const opus = fs.readFileSync(file.opus)
  const base64 = opus.toString('base64')
  const durata = Number(durataDi(file.opus).toFixed(3))
  const durataStimata = SCRIPT[stepId].durataStimata
  const parole = contaParole(testo)

  return {
    stepId,
    durata,
    durataWav: Number(durataDi(file.wav).toFixed(3)),
    durataStimata,
    scarto: Number((durata - durataStimata).toFixed(3)),
    rapporto: durataStimata > 0 ? Number((durata / durataStimata).toFixed(3)) : null,
    parole,
    paroleAlMinuto: Number(((parole / durata) * 60).toFixed(1)),
    byte: opus.length,
    byteWav: fs.statSync(file.wav).size,
    byteBase64: base64.length,
    sha256: createHash('sha256').update(opus).digest('hex'),
    volumeOpus: volumeDi(file.opus),
    volumeWav: volumeDi(file.wav),
    dataUri: `data:${MIME};base64,${base64}`,
    testo,
    testoFonetico,
  }
}

// --- Il modulo generato ---------------------------------------------------------

const chiaveJs = (id) => (/^[A-Za-z_$][\w$]*$/.test(id) ? id : `'${id}'`)

export function costruisciModulo(misure) {
  const totale = riassumi(misure)
  const righe = [
    '// GENERATO da scripts/narration/make-narration.mjs — non modificare a mano.',
    '//',
    '// Rigenera tutto:    node scripts/narration/make-narration.mjs --forza',
    '// Un segmento solo:  node scripts/narration/make-narration.mjs --segmento <stepId>',
    '//',
    '// I testi sono i `testoFonetico` di src/ui/script.it.js, detti da `say -v Alice` di',
    '// macOS e compressi in Opus mono a 32 kbps. Una modifica fatta a mano qui sparisce',
    '// alla prima rigenerazione, e nel frattempo mente su cosa si sente davvero.',
    '//',
    `//   segmenti      ${misure.length}`,
    `//   durata totale ${formattaDurata(totale.durata)} (${virgola(totale.durata)} s)`,
    `//   opus          ${formattaByte(totale.byte)}`,
    `//   in base64     ${formattaByte(totale.byteBase64)} — ed e questo che pesa nel bundle`,
    '',
    '/**',
    ' * Un segmento di voce per ognuno dei dodici passi, nell ordine della demo.',
    ' *',
    ' *   dataUri  Opus in contenitore Ogg, pronto per `new Audio(dataUri)`',
    ' *   durata   secondi misurati sul file, non stimati dal conteggio parole',
    ' *   byte     dimensione del .opus; la stringa base64 e un terzo piu lunga',
    ' *',
    ' * Chi fa avanzare la demo usa `onended`, non `durata`: la durata serve ai',
    ' * sottotitoli e ai conti, non alla sincronia.',
    ' */',
    'export const SEGMENTS = {',
  ]

  for (const misura of misure) {
    righe.push(`  ${chiaveJs(misura.stepId)}: {`)
    righe.push(`    durata: ${misura.durata},`)
    righe.push(`    byte: ${misura.byte},`)
    righe.push('    dataUri:')
    righe.push(`      '${misura.dataUri}',`)
    righe.push('  },')
  }

  righe.push('}')
  righe.push('')
  return righe.join('\n')
}

// --- La pagina di ascolto --------------------------------------------------------

const scappa = (testo) =>
  String(testo).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Il testo a schermo e quello ortografico, ma in due punti la voce riceve altro.
 * Nasconderlo renderebbe la pagina una bugia comoda: le due parole si marcano, con
 * accanto cio che si sente davvero.
 */
export function segnaFonetica(testo, mappa) {
  const presenti = mappa.filter(([aSchermo]) => testo.includes(aSchermo))
  let html = ''
  let resto = testo
  while (resto.length) {
    let primo = null
    for (const [aSchermo, pronunciato] of presenti) {
      const dove = resto.indexOf(aSchermo)
      if (dove !== -1 && (primo === null || dove < primo.dove)) primo = { dove, aSchermo, pronunciato }
    }
    if (!primo) return html + scappa(resto)
    html += scappa(resto.slice(0, primo.dove))
    html +=
      `<b class="detto">${scappa(primo.aSchermo)}` +
      `<span class="pron">detto «${scappa(primo.pronunciato)}»</span></b>`
    resto = resto.slice(primo.dove + primo.aSchermo.length)
  }
  return html
}

/** Numeri all'italiana: virgola decimale e segno meno vero, non il trattino. */
const virgola = (numero, cifre = 1) => Number(numero).toFixed(cifre).replace('.', ',').replace('-', '−')

function formattaDurata(secondi) {
  const minuti = Math.floor(secondi / 60)
  return `${minuti}′ ${virgola(secondi - minuti * 60).padStart(4, '0')}″`
}

function formattaByte(byte) {
  if (byte < 1024) return `${byte} B`
  if (byte < 1024 * 1024) return `${virgola(byte / 1024)} kB`
  return `${virgola(byte / (1024 * 1024), 2)} MB`
}

export function costruisciPagina(misure) {
  const totale = riassumi(misure)

  const sezioni = misure
    .map((misura, indice) => {
      const copia = COPY[misura.stepId] || {}
      const segno = misura.scarto >= 0 ? '+' : '−'
      return `
  <section class="segmento" id="${scappa(misura.stepId)}">
    <h2>
      <span class="numero">${String(indice + 1).padStart(2, '0')}</span>
      ${scappa(copia.titolo || misura.stepId)}
      <code>${scappa(misura.stepId)}</code>
    </h2>
    <p class="meta">
      <b>${virgola(misura.durata)} s</b> · stima ${misura.durataStimata} s
      (${segno}${virgola(Math.abs(misura.scarto))} s) · ${misura.parole} parole a
      ${virgola(misura.paroleAlMinuto)} al minuto · ${formattaByte(misura.byte)} ·
      volume medio ${virgola(misura.volumeOpus.media)} dB
    </p>
    <audio controls preload="metadata" src="out/${scappa(misura.stepId)}.opus">
      Il tuo browser non riproduce l’audio: apri direttamente <code>out/${scappa(misura.stepId)}.opus</code>.
    </audio>
    <p class="letto">${segnaFonetica(misura.testo, MAPPA_FONETICA)}</p>
  </section>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Narrazione — i dodici segmenti</title>
<style>
  :root {
    --carta:      #f4f2ec;
    --carta-alta: #fffefb;
    --inchiostro: #1b2430;
    --tenue:      #5d6673;
    --filo:       #d6d2c6;
    --timbro:     #2b3a8f;
    --evidenza:   #fdf6d8;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --carta:      #14181e;
      --carta-alta: #1c222a;
      --inchiostro: #e6e3db;
      --tenue:      #9aa3b0;
      --filo:       #333c48;
      --timbro:     #93a6ff;
      --evidenza:   #2c2a1c;
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    padding: 2.5rem 1.25rem 5rem;
    background: var(--carta);
    color: var(--inchiostro);
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  main { max-width: 46rem; margin: 0 auto; }

  header { border-bottom: 2px solid var(--inchiostro); padding-bottom: 1.5rem; margin-bottom: 2rem; }
  .occhiello {
    font-size: .75rem; letter-spacing: .14em; text-transform: uppercase;
    color: var(--tenue); margin: 0 0 .6rem;
  }
  h1 { font-size: 1.5rem; line-height: 1.25; margin: 0 0 1.2rem; font-weight: 600; }
  .conto {
    margin: 0; padding: 1rem 1.25rem;
    background: var(--evidenza); border-left: 4px solid var(--timbro);
    font-size: 1.05rem; line-height: 1.55;
  }
  header p.nota { color: var(--tenue); font-size: .95rem; margin: 1.2rem 0 0; }

  .segmento {
    background: var(--carta-alta);
    border: 1px solid var(--filo);
    border-radius: 4px;
    padding: 1.15rem 1.4rem 1.35rem;
    margin-bottom: 1.25rem;
  }
  .segmento h2 {
    font-size: 1.05rem; margin: 0; font-weight: 600;
    display: flex; flex-wrap: wrap; align-items: baseline; gap: .55rem;
  }
  .numero {
    font-size: .7rem; letter-spacing: .08em;
    color: #fffefb; background: var(--timbro);
    padding: .2rem .45rem; border-radius: 3px; font-weight: 700;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) { .numero { color: #14181e; } }
  .segmento h2 code { color: var(--tenue); font-weight: 400; font-size: .8rem; }
  .meta { color: var(--tenue); font-size: .82rem; margin: .5rem 0 .9rem; }
  .meta b { color: var(--inchiostro); }
  audio { width: 100%; display: block; margin-bottom: .9rem; }
  .letto {
    margin: 0; padding: .9rem 1rem;
    border-left: 3px solid var(--filo);
    color: var(--tenue); font-size: .92rem; line-height: 1.75;
  }
  .detto { color: var(--inchiostro); font-weight: 600; }
  .pron { font-weight: 400; font-size: .78em; color: var(--timbro); margin-left: .3em; white-space: nowrap; }

  .coda { border-top: 1px solid var(--filo); margin-top: 2.5rem; padding-top: 1.5rem; }
  .coda h2 { font-size: 1rem; margin: 0 0 .7rem; }
  .coda p { color: var(--tenue); font-size: .9rem; margin: 0 0 .7rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .88em; }
</style>
</head>
<body>
<main>

  <header>
    <p class="occhiello">Demo firma digitale — la voce della narrazione</p>
    <h1>I dodici segmenti, in ordine. Il copione intero senza costruire la demo.</h1>
    <p class="conto">
      <b>${formattaDurata(totale.durata)}</b> di parlato in ${misure.length} segmenti,
      ${formattaByte(totale.byte)} in Opus mono a 32 kbps.
      La stima a ${PAROLE_AL_MINUTO} parole al minuto diceva ${formattaDurata(totale.durataStimata)}.
    </p>
    <p class="nota">
      Voce <code>say -v Alice</code> di macOS, ritmo predefinito. Sotto ogni lettore c’è il testo
      <b>come si legge a schermo</b>; le due sole parole che alla voce arrivano scritte diversamente
      sono marcate con la pronuncia accanto. Se una frase suona storta si corregge in
      <code>src/ui/script.it.js</code>, e si rigenera quel segmento soltanto.
    </p>
    <p class="nota">
      Pagina <b>generata</b> da <code>scripts/narration/make-narration.mjs</code>: modificarla a mano
      non serve, si riscrive da sé. Nessuna risorsa esterna e nessuno script — i lettori puntano ai
      file dentro <code>out/</code>, qui accanto, quindi la cartella si sposta tutta intera o non si
      sposta.
    </p>
  </header>
${sezioni}

  <section class="coda">
    <h2>Come si rigenera</h2>
    <p>Tutto da capo: <code>node scripts/narration/make-narration.mjs --forza</code></p>
    <p>Un segmento solo: <code>node scripts/narration/make-narration.mjs --segmento &lt;stepId&gt;</code></p>
    <p>
      Senza opzioni rifà solo ciò che è cambiato, e riscrive comunque questa pagina e
      <code>src/assets/narrazione/segments.js</code>, il modulo che entra nelle due varianti narrate
      della demo.
    </p>
  </section>

</main>
</body>
</html>
`
}

// --- Manifesto -------------------------------------------------------------------

function leggiManifesto() {
  try {
    return JSON.parse(fs.readFileSync(FILE_MANIFESTO, 'utf8'))
  } catch {
    return { segmenti: {} }
  }
}

/** Il manifesto e un prodotto generato come gli altri: nessuna data, ordine fisso. */
function scriviManifesto(misure, strumenti) {
  const segmenti = {}
  for (const misura of misure) {
    segmenti[misura.stepId] = {
      impronta: misura.impronta,
      sha256: misura.sha256,
      durata: misura.durata,
      durataStimata: misura.durataStimata,
      byte: misura.byte,
      byteBase64: misura.byteBase64,
      parole: misura.parole,
      paroleAlMinuto: misura.paroleAlMinuto,
      mediaDb: misura.volumeOpus.media,
      piccoDb: misura.volumeOpus.picco,
      mediaDbWav: misura.volumeWav.media,
    }
  }
  fs.writeFileSync(
    FILE_MANIFESTO,
    JSON.stringify({ voce: VOCE, formatoDati: FORMATO_DATI, bitrate: BITRATE, bitexact: true, strumenti, segmenti }, null, 2) +
      '\n',
    'utf8',
  )
}

// --- Argomenti --------------------------------------------------------------------

export function leggiArgomenti(argv) {
  const opzioni = { segmenti: [], forza: false, json: false, aiuto: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--aiuto' || arg === '-h' || arg === '--help') opzioni.aiuto = true
    else if (arg === '--forza') opzioni.forza = true
    else if (arg === '--json') opzioni.json = true
    else if (arg === '--segmento') {
      const id = argv[++i]
      if (!id) throw new Error('--segmento vuole uno stepId')
      opzioni.segmenti.push(id)
    } else throw new Error(`Opzione sconosciuta: ${arg}`)
  }
  const sconosciuti = opzioni.segmenti.filter((id) => !STEP_IDS.includes(id))
  if (sconosciuti.length) {
    throw new Error(`Passi che non esistono: ${sconosciuti.join(', ')}\nI dodici sono: ${STEP_IDS.join(' ')}`)
  }
  return opzioni
}

const AIUTO = `
make-narration.mjs — genera i dodici segmenti di voce della demo.

  node scripts/narration/make-narration.mjs                      tutto, saltando cio che e in pari
  node scripts/narration/make-narration.mjs --segmento impronta   un passo solo
  node scripts/narration/make-narration.mjs --forza                rifa tutto da capo
  node scripts/narration/make-narration.mjs --json                 rapporto in JSON

Prodotti:
  scripts/narration/out/<stepId>.{txt,wav,opus}   materiale di lavoro
  scripts/narration/out/manifesto.json            impronte e misure, servono al giro dopo
  scripts/narration/ascolta.html                  pagina di ascolto (doppio click)
  src/assets/narrazione/segments.js               il modulo che entra nel bundle

I dodici passi: ${STEP_IDS.join(' ')}

Serve macOS (la voce Alice di \`say\`) e ffmpeg con libopus. I testi arrivano da
src/ui/script.it.js e questo script non li tocca: se una frase e sbagliata, si
corregge la, non qui.
`

// --- Il giro principale -------------------------------------------------------------

function riassumi(misure) {
  return {
    durata: Number(misure.reduce((somma, m) => somma + m.durata, 0).toFixed(3)),
    durataStimata: misure.reduce((somma, m) => somma + m.durataStimata, 0),
    byte: misure.reduce((somma, m) => somma + m.byte, 0),
    byteBase64: misure.reduce((somma, m) => somma + m.byteBase64, 0),
    parole: misure.reduce((somma, m) => somma + m.parole, 0),
  }
}

/**
 * Rilievi sul copione. Questo script non possiede `src/ui/script.it.js`: se qualcosa
 * non torna lo dice e tira dritto, non lo corregge.
 */
function rilieviSulCopione(misure) {
  const rilievi = []
  for (const misura of misure) {
    const atteso = applicaMappaFonetica(misura.testo)
    if (atteso !== misura.testoFonetico) {
      rilievi.push(
        `${misura.stepId}: testoFonetico non e testo passato per la mappa fonetica — ` +
          'la voce dice qualcosa che a schermo non si legge.',
      )
    }
    if (misura.durataStimata > 0 && Math.abs(misura.scarto) / misura.durataStimata > SCOSTAMENTO_NOTEVOLE) {
      rilievi.push(
        `${misura.stepId}: durata reale ${misura.durata.toFixed(2)} s contro ${misura.durataStimata} s stimati ` +
          `(${((misura.rapporto - 1) * 100).toFixed(0)}%).`,
      )
    }
  }
  return rilievi
}

function principale(argv) {
  let opzioni
  try {
    opzioni = leggiArgomenti(argv)
  } catch (errore) {
    console.error(errore.message)
    return 2
  }
  if (opzioni.aiuto) {
    console.log(AIUTO.trim())
    return 0
  }

  controllaStrumenti()
  const strumenti = versioniStrumenti()

  fs.mkdirSync(CARTELLA_OUT, { recursive: true })
  fs.mkdirSync(CARTELLA_MODULO, { recursive: true })

  const manifestoVecchio = leggiManifesto()
  const richiesti = opzioni.segmenti.length ? new Set(opzioni.segmenti) : new Set(STEP_IDS)

  const misure = []
  const mancanti = []
  const rifatti = []
  const riusati = []

  for (const stepId of STEP_IDS) {
    const segmento = SCRIPT[stepId]
    if (!segmento) throw new Error(`script.it.js non ha un segmento per il passo ${stepId}`)

    const fileOpus = percorsiDi(stepId).opus
    const improntaOra = impronta(ricettaDi(stepId, segmento.testoFonetico, strumenti))
    const registrato = manifestoVecchio.segmenti?.[stepId]
    const inPari =
      !opzioni.forza &&
      registrato?.impronta === improntaOra &&
      fs.existsSync(fileOpus) &&
      createHash('sha256').update(fs.readFileSync(fileOpus)).digest('hex') === registrato.sha256

    if (richiesti.has(stepId) && !inPari) {
      generaSegmento(stepId, segmento.testoFonetico)
      rifatti.push(stepId)
    } else if (!fs.existsSync(fileOpus)) {
      // Non richiesto e nemmeno presente: il modulo non si puo scrivere a meta.
      mancanti.push(stepId)
      continue
    } else {
      riusati.push(stepId)
    }

    const misura = misuraSegmento(stepId, segmento.testo, segmento.testoFonetico)
    misura.impronta = improntaOra
    misura.muto = eMuto(misura.volumeOpus)
    misure.push(misura)
  }

  const muti = misure.filter((m) => m.muto).map((m) => m.stepId)
  scriviManifesto(misure, strumenti)

  const completo = misure.length === STEP_IDS.length && muti.length === 0
  if (completo) {
    fs.writeFileSync(FILE_MODULO, costruisciModulo(misure), 'utf8')
    fs.writeFileSync(FILE_PAGINA, costruisciPagina(misure), 'utf8')
  }

  const totale = riassumi(misure)
  const rapporto = {
    rifatti,
    riusati,
    mancanti,
    muti,
    scritti: completo ? [path.relative(radice, FILE_MODULO), path.relative(radice, FILE_PAGINA)] : [],
    strumenti,
    rilievi: rilieviSulCopione(misure),
    totale: {
      ...totale,
      byteModulo: completo ? fs.statSync(FILE_MODULO).size : null,
      kBAlMinuto: totale.durata > 0 ? Number(((totale.byte / 1024 / totale.durata) * 60).toFixed(1)) : null,
    },
    segmenti: misure.map((m) => ({
      stepId: m.stepId,
      durata: m.durata,
      durataStimata: m.durataStimata,
      scarto: m.scarto,
      rapporto: m.rapporto,
      parole: m.parole,
      paroleAlMinuto: m.paroleAlMinuto,
      byte: m.byte,
      byteBase64: m.byteBase64,
      mediaDb: m.volumeOpus.media,
      piccoDb: m.volumeOpus.picco,
      mediaDbWav: m.volumeWav.media,
      sha256: m.sha256,
      muto: m.muto,
    })),
  }

  if (opzioni.json) console.log(JSON.stringify(rapporto, null, 2))
  else stampaRapporto(rapporto)

  return muti.length || mancanti.length ? 1 : 0
}

function stampaRapporto(rapporto) {
  const larghezze = [17, 7, 6, 7, 7, 7, 8, 9]
  const riga = (celle) =>
    celle
      .map((cella, i) => (i === 0 ? String(cella).padEnd(larghezze[i]) : String(cella).padStart(larghezze[i])))
      .join(' ')
  const filo = '─'.repeat(larghezze.reduce((somma, l) => somma + l + 1, -1))

  console.log(`Narrazione — ${rapporto.segmenti.length} segmenti, voce ${VOCE}, Opus mono ${BITRATE}.\n`)
  console.log(riga(['passo', 'reale', 'stima', 'scarto', 'parole', 'p/min', 'byte', 'media dB']))
  console.log(filo)
  for (const s of rapporto.segmenti) {
    console.log(
      riga([
        s.stepId,
        virgola(s.durata, 2),
        s.durataStimata,
        (s.scarto >= 0 ? '+' : '') + virgola(s.scarto, 2),
        s.parole,
        virgola(s.paroleAlMinuto),
        s.byte,
        virgola(s.mediaDb),
      ]) + (s.muto ? '   ← MUTO' : ''),
    )
  }
  const t = rapporto.totale
  const scartoTotale = t.durata - t.durataStimata
  console.log(filo)
  console.log(
    riga([
      'totale',
      virgola(t.durata, 2),
      t.durataStimata,
      (scartoTotale >= 0 ? '+' : '') + virgola(scartoTotale, 2),
      t.parole,
      virgola((t.parole / t.durata) * 60),
      t.byte,
      '',
    ]),
  )
  console.log()
  console.log(`  durata totale   ${formattaDurata(t.durata)}   (stima: ${formattaDurata(t.durataStimata)})`)
  console.log(`  opus            ${formattaByte(t.byte)}`)
  console.log(`  in base64       ${formattaByte(t.byteBase64)}`)
  console.log(`  kB al minuto    ${virgola(t.kBAlMinuto)}   (misurato dalla sonda: 239)`)
  if (t.byteModulo !== null) console.log(`  segments.js     ${formattaByte(t.byteModulo)}`)
  console.log()
  console.log(`  rifatti   ${rapporto.rifatti.length ? rapporto.rifatti.join(' ') : '(nessuno)'}`)
  console.log(`  riusati   ${rapporto.riusati.length ? rapporto.riusati.join(' ') : '(nessuno)'}`)
  if (rapporto.mancanti.length) console.log(`  MANCANTI  ${rapporto.mancanti.join(' ')}`)
  if (rapporto.muti.length) console.log(`  MUTI      ${rapporto.muti.join(' ')}`)
  if (rapporto.scritti.length) for (const file of rapporto.scritti) console.log(`  scritto   ${file}`)
  else console.log('\n  Il modulo NON e stato scritto: servono tutti e dodici i segmenti, e non muti.')
  if (rapporto.rilievi.length) {
    console.log('\n  Rilievi sul copione (non corretti qui: script.it.js non e di questo script)')
    for (const rilievo of rapporto.rilievi) console.log(`    · ${rilievo}`)
  }
}

if (import.meta.main) {
  try {
    process.exit(principale(process.argv.slice(2)))
  } catch (errore) {
    console.error(errore.message)
    process.exit(1)
  }
}
