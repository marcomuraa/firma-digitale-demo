/**
 * pdf-render.js — il ponte verso pdf.js. Uno solo, per tutto il progetto.
 *
 *   renderPdfToCanvas(bytes, canvas, { scale }) -> Promise<{ ok, pages, annullato, error, avvisi }>
 *
 * Serve a rendere DIMOSTRABILE l'attacco 2: il documento cambia davvero sotto gli occhi di chi
 * guarda. Senza un rendering vero, quel cambiamento andrebbe creduto sulla parola — ed e'
 * esattamente cio' che questa demo non vuole chiedere a nessuno. Per la stessa ragione la sua
 * robustezza vale quanto la sua correttezza: NON LANCIA MAI. Un PDF rotto torna
 * `{ ok: false, error }` con una frase in italiano, e la pagina resta viva.
 *
 * ============================================================================
 * La ricetta, copiata alla lettera da spikes/pdfjs/RECIPE.md sezione 1
 * ============================================================================
 *
 * E' l'unico modo noto che funziona in un HTML singolo aperto da `file://`, verificato in Chrome
 * headless e con finestra vera, con zero richieste di rete. Non improvvisare varianti: le strade
 * scartate sono misurate una per una nella sezione 2 della ricetta.
 *
 *   1. il modulo worker si importa PRIMA di pdf.mjs, cosi' entra nel bundle principale;
 *   2. `globalThis.pdfjsWorker = { WorkerMessageHandler }`: con questa riga pdf.js usa il «fake
 *      worker» sul thread principale. Niente `workerSrc`, niente `workerPort`, niente
 *      `new Worker()`. Trappola 5.1 della ricetta: con `workerPort` impostato pdf.js perde il
 *      ripiego automatico, e un worker rifiutato dal browser lascia una promise appesa PER
 *      SEMPRE — su un proiettore, davanti a una sala, il peggior modo di rompersi;
 *   3. `cMapUrl`, `standardFontDataUrl`, `wasmUrl`, `iccUrl` a `null` (non stringhe vuote:
 *      `getFactoryUrlProp()` pretende lo slash finale e lancia), `useWorkerFetch: false`,
 *      `useSystemFonts: false`, `stopAtErrors: false`;
 *   4. i font base-14 li serve la `BinaryDataFactory` qui sotto, dalla pagina. Senza,
 *      il documento a schermo cambia da una macchina all'altra.
 *
 * pdf.js scrive `Warning: Setting up fake worker.`: e' il comportamento voluto, non un guasto.
 *
 * ============================================================================
 * Gli avvisi, e perche' vengono restituiti
 * ============================================================================
 *
 * Dopo l'attacco 1b il file e' incoerente — /Length dichiara 650 e i byte sono 653, startxref
 * dichiara 1026 e la tabella e' a 1029 — ma pdf.js NON si rifiuta: ricostruisce la tabella
 * scandendo tutto il file e disegna «1.000 euro (novemila euro)» (docs/stato.md punto 2,
 * RECIPE.md sezione 6). Il piano prevedeva un rifiuto che non arriva, quindi qui non c'e' nessun
 * codice che lo aspetti.
 *
 * Cio' che resta, ed e' l'appiglio onesto, e' l'avviso `Indexing all PDF objects`: il lettore ha
 * dovuto RIPARARE il file per aprirlo. `avvisi` lo consegna a chi disegna. Si raccolgono
 * avvolgendo `console.warn` — che e' la funzione che pdf.js 6.2.108 usa per i suoi warning —
 * solo per la durata del rendering, ripristinandola in un `finally`. Gli avvisi continuano ad
 * arrivare anche alla console vera: qui si copiano, non si sequestrano.
 *
 * `console.warn` pero' e' UNA SOLA per tutta la pagina, e con il fake worker pdf.js gira sul
 * thread principale: due rendering sovrapposti non sono distinguibili per provenienza e si
 * copierebbero gli avvisi a vicenda. Misurato: il documento firmato integro, disegnato in
 * parallelo con l'attacco 1b, si prendeva il suo «Indexing all PDF objects» — cioe' «il lettore
 * ha dovuto riparare il file» detto di un documento sano, in una demo sulla falsificazione.
 * Per questo i rendering sono SERIALIZZATI, uno per volta in tutta la pagina
 * (src/ui/coda-disegno.js): finche' non si sovrappongono, gli avvisi raccolti mentre un
 * documento veniva disegnato sono suoi davvero. La demo disegna un documento per volta: la
 * coda non le toglie niente.
 *
 * Ambiente: solo browser (tocca `document` attraverso il canvas che riceve, e importa pdf.js).
 * NON importarlo dai test di node e NON importarlo da src/ui/machine.js: trascinerebbe 1,6 MB
 * di renderer dentro la logica. La parte che si rompe — chi possiede il canvas, e chi disegna
 * per ultimo — sta in src/ui/coda-disegno.js apposta: quella si prova in node, e i suoi test
 * sono in src/ui/coda-disegno.test.mjs.
 */

// 1. Il modulo worker entra nel bundle PRINCIPALE, non in un Worker separato.
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs'
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs'
import { creaCodaDiDisegno } from './coda-disegno.js'
import { STANDARD_FONTS } from './standard-fonts.js'

// 2. Con questa riga PDFWorker usa il fake worker: nessun caricamento esterno, nessuna politica
//    del browser da rispettare, nessuna promise che possa restare appesa.
globalThis.pdfjsWorker = { WorkerMessageHandler }

/** Scala predefinita: la stessa dello spike, un foglio A4 diventa 892x1263. */
const SCALA_PREDEFINITA = 1.5

/**
 * Rete di sicurezza sul tempo. Con il fake worker non dovrebbe servire — non c'e' nessun worker
 * che possa essere rifiutato — ma una demo che si ferma in silenzio e' peggio di una demo che
 * dice «non ce l'ho fatta».
 */
const SCADENZA_MS = 15_000

/* ------------------------------------------------------------------ asset inlineati */

function base64ToBytes(base64) {
  const testo = atob(base64)
  const byte = new Uint8Array(testo.length)
  for (let i = 0; i < testo.length; i++) byte[i] = testo.charCodeAt(i)
  return byte
}

/**
 * 3. Gli asset binari arrivano dalla pagina, mai dalla rete.
 *
 * Un font mancante non rompe niente: qui si lancia, pdf.js registra un avviso e ripiega sul
 * serif di sistema (e' il caso `spike-g.html` della ricetta). Le CMap e il wasm non servono:
 * il campione non usa font CID ne immagini JBIG2/JPEG2000.
 */
class InlineBinaryDataFactory {
  async fetch({ kind, filename }) {
    if (kind === 'standardFontDataUrl' && STANDARD_FONTS[filename]) {
      return base64ToBytes(STANDARD_FONTS[filename])
    }
    throw new Error(`asset non inlineato: ${kind}/${filename}`)
  }
}

/* ------------------------------------------------------------------ raccolta degli avvisi */

/**
 * I raccoglitori attivi. Con la coda ce n'e' sempre al massimo uno — ed e' proprio quello che
 * rende `avvisi` attribuibile al documento giusto — ma l'insieme resta: se un giorno qualcuno
 * togliesse la coda, gli avvisi verrebbero copiati in tutti i raccoglitori invece di finire in
 * uno solo a caso, e `console.warn` non resterebbe comunque avvolta per sempre.
 */
const raccoglitori = new Set()
let consoleOriginale = null

/**
 * L'unico avviso che NON finisce in `avvisi`: parla della nostra configurazione, non del
 * documento. pdf.js lo emette una volta sola, quando registra il fake worker, ed e' il
 * comportamento voluto dalla ricetta. Lasciarlo passare significherebbe consegnare a chi
 * disegna un avviso che, letto sul pannello, direbbe una cosa falsa sul PDF.
 * Tutto il resto passa: gli avvisi sul documento sono materiale didattico.
 */
const AVVISI_DI_CONFIGURAZIONE = [/Setting up fake worker/i]

function iniziaARaccogliere(avvisi) {
  raccoglitori.add(avvisi)
  if (consoleOriginale !== null) return
  consoleOriginale = console.warn
  console.warn = (...argomenti) => {
    const testo = argomenti
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : String(a)))
      .join(' ')
    if (!AVVISI_DI_CONFIGURAZIONE.some((schema) => schema.test(testo))) {
      for (const raccolta of raccoglitori) raccolta.push(testo)
    }
    // In console arrivano comunque tutti, esattamente come sarebbero arrivati: qui si
    // copiano, non si sequestrano.
    consoleOriginale(...argomenti)
  }
}

function smettiDiRaccogliere(avvisi) {
  raccoglitori.delete(avvisi)
  if (raccoglitori.size === 0 && consoleOriginale !== null) {
    console.warn = consoleOriginale
    consoleOriginale = null
  }
}

/* ------------------------------------------------------------------ un rendering per volta */

/**
 * La coda: UNA per tutta la pagina. Serializza i rendering e, sincronamente, decide chi
 * possiede quale canvas. pdf.js rifiuta due `render()` sovrapposti sullo stesso canvas, e qui
 * vince il piu' recente — se durante il disegno del documento firmato scatta un attacco, cio'
 * che resta a schermo dev'essere il documento nuovo. Il perche' di ognuna delle due cose sta
 * in src/ui/coda-disegno.js, insieme alle misure che le hanno rese necessarie.
 */
const coda = creaCodaDiDisegno()

/** L'esito di un disegno che una richiesta piu' recente ha superato. Non e' un guasto. */
const SUPERATO =
  'Il disegno e stato annullato perche nel frattempo e stato chiesto di disegnare un altro documento.'

/* ------------------------------------------------------------------ l'unica funzione pubblica */

/**
 * Disegna la pagina 1 del PDF sul canvas ricevuto.
 *
 * Il canvas arriva da fuori e non viene creato qui: chi disegna la pagina decide dove sta, che
 * dimensioni CSS ha e quando esiste. Vengono impostati solo `width` e `height` in pixel, che
 * discendono dal viewport del PDF e dalla scala.
 *
 * @param {Uint8Array} bytes   i byte del documento. Ne viene passata una COPIA a pdf.js, che
 *                             prende possesso di cio' che riceve: i byte del chiamante restano
 *                             intatti e riutilizzabili.
 * @param {HTMLCanvasElement} canvas
 * @param {object} [opzioni]
 * @param {number} [opzioni.scale]     scala del viewport (default 1.5)
 * @param {number} [opzioni.scadenzaMs] tempo massimo complessivo (default 15000)
 * @returns {Promise<{ ok: boolean, pages: number|null, annullato: boolean, error: string|null,
 *                     avvisi: string[] }>}
 *   `ok` false con `error` in italiano quando il documento non si e' potuto disegnare;
 *   `pages` e' il numero di pagine del documento (null se non si e' nemmeno aperto);
 *   `annullato` true quando questo disegno e' stato SUPERATO da una richiesta piu' recente
 *   sullo stesso canvas: `ok` e' false ma non e' successo niente di male, il canvas lo sta
 *   disegnando qualcun altro e chi mostra gli errori faccia finta di niente;
 *   `avvisi` sono gli avvisi che pdf.js ha emesso mentre QUESTO documento veniva disegnato, in
 *   ordine — e sono suoi perche' i rendering sono serializzati, vedi sopra (l'avviso
 *   `Setting up fake worker` non c'e': parla della nostra configurazione, non del PDF).
 *   Dopo l'attacco 1b qui dentro compare `Indexing all PDF objects`, cioe' «il lettore ha
 *   dovuto riparare il file per aprirlo»: e' l'appiglio onesto per raccontare quel passo.
 *
 * Chiamarla due volte di fila senza `await` in mezzo e' lecito, ed e' il caso che conta: la
 * proprieta' del canvas si prende SINCRONAMENTE, prima di qualunque await, quindi la seconda
 * chiamata annulla la prima e sullo schermo resta il documento che si e' chiesto per ultimo.
 */
export function renderPdfToCanvas(bytes, canvas, opzioni = {}) {
  const scale = Number.isFinite(opzioni.scale) && opzioni.scale > 0 ? opzioni.scale : SCALA_PREDEFINITA
  const scadenzaMs =
    Number.isFinite(opzioni.scadenzaMs) && opzioni.scadenzaMs > 0 ? opzioni.scadenzaMs : SCADENZA_MS

  // I due rifiuti che non hanno bisogno ne' della coda ne' di pdf.js. Vengono prima anche
  // perche' senza un canvas non c'e' niente di cui prendere possesso.
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    return Promise.resolve(
      guasto('Non ci sono byte da disegnare: il documento e vuoto o non e stato passato.'),
    )
  }
  if (!canvas || typeof canvas.getContext !== 'function') {
    return Promise.resolve(guasto('Manca il canvas su cui disegnare il documento.'))
  }

  // Da qui in poi si passa dalla coda: la proprieta' del canvas viene presa adesso, dentro
  // prenota(), prima che questa funzione restituisca. E' tutta la riparazione.
  return coda.prenota(canvas, (gettone) => disegna(gettone, bytes, canvas, scale, scadenzaMs))
}

/** Un esito di guasto gia' formato: la forma del risultato e' sempre la stessa. */
function guasto(error) {
  return { ok: false, pages: null, annullato: false, error, avvisi: [] }
}

/**
 * Il disegno vero, chiamato dalla coda quando e' il suo turno.
 *
 * `gettone.annullato` si rilegge dopo ogni await: una richiesta piu' recente sullo stesso
 * canvas puo' arrivare in qualunque momento, e da quel momento in poi disegnare sarebbe
 * peggio che non disegnare — si toccherebbe un canvas che appartiene a un altro documento.
 */
async function disegna(gettone, bytes, canvas, scale, scadenzaMs) {
  const avvisi = []
  const risultato = { ok: false, pages: null, annullato: false, error: null, avvisi }
  if (gettone.annullato) {
    risultato.annullato = true
    risultato.error = SUPERATO
    return risultato
  }

  let compito = null
  let documento = null
  iniziaARaccogliere(avvisi)
  try {
    compito = pdfjs.getDocument({
      // pdf.js prende possesso dei byte: una copia, sempre.
      data: new Uint8Array(bytes),
      // Devono restare null, non stringhe: vedi trappola 3 della ricetta.
      cMapUrl: null,
      standardFontDataUrl: null,
      wasmUrl: null,
      iccUrl: null,
      useWorkerFetch: false,
      useSystemFonts: false,
      BinaryDataFactory: InlineBinaryDataFactory,
      // Un PDF manomesso deve essere disegnato per quel che si riesce, non rifiutato in blocco.
      stopAtErrors: false,
      // Gli avvisi servono: sono materiale didattico, non rumore da zittire.
      verbosity: 1,
    })
    documento = await conScadenza(compito.promise, scadenzaMs, "l'apertura del documento")
    if (gettone.annullato) return superato(risultato)
    risultato.pages = documento.numPages

    const pagina = await conScadenza(documento.getPage(1), scadenzaMs, 'la lettura della pagina 1')
    if (gettone.annullato) return superato(risultato)

    const viewport = pagina.getViewport({ scale })
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)

    const contesto = canvas.getContext('2d')
    if (!contesto) throw new Error('il canvas non ha restituito un contesto 2d')
    // Un PDF non dichiara il bianco della carta: senza questo, sotto resterebbe il disegno
    // precedente, e dopo un attacco si vedrebbero due documenti sovrapposti.
    contesto.fillStyle = '#ffffff'
    contesto.fillRect(0, 0, canvas.width, canvas.height)

    const disegno = pagina.render({ canvasContext: contesto, viewport })
    // Cosi' una richiesta piu' recente puo' interrompere il disegno a meta' invece di
    // aspettarne la fine: e' il gancio che la coda chiama.
    gettone.annulla = () => disegno.cancel()
    await conScadenza(disegno.promise, scadenzaMs, 'il disegno della pagina')
    if (gettone.annullato) return superato(risultato)

    risultato.ok = true
    return risultato
  } catch (problema) {
    risultato.ok = false
    // Un disegno interrotto perche' ne e' arrivato uno piu' recente non e' un guasto: pdf.js
    // lancia RenderingCancelledException ed e' esattamente cio' che gli abbiamo chiesto.
    if (gettone.annullato) return superato(risultato)
    risultato.error = inItaliano(problema)
    return risultato
  } finally {
    // Il documento aperto tiene memoria: la demo ne apre uno nuovo a ogni attacco. Anche
    // chiudere ha una scadenza: la coda e' una sola, e un `destroy` appeso la fermerebbe tutta.
    try {
      if (compito) await conScadenza(compito.destroy(), scadenzaMs, 'la chiusura del documento')
    } catch {
      /* chiudere non deve poter far fallire un rendering riuscito */
    }
    smettiDiRaccogliere(avvisi)
  }
}

/** Questo disegno e' stato superato da uno piu' recente: si dice, e non si tocca il canvas. */
function superato(risultato) {
  risultato.ok = false
  risultato.annullato = true
  risultato.error = SUPERATO
  return risultato
}

/* ------------------------------------------------------------------ attrezzi */

/** Una promessa che non puo' restare appesa per sempre. */
function conScadenza(promessa, ms, cosa) {
  let orologio = null
  const scadenza = new Promise((_, rifiuta) => {
    orologio = setTimeout(
      () => rifiuta(new Error(`${cosa} non e finita entro ${ms} ms`)),
      ms,
    )
  })
  return Promise.race([promessa, scadenza]).finally(() => clearTimeout(orologio))
}

/**
 * Il guasto, detto in italiano. I nomi delle eccezioni di pdf.js sono stabili e documentati;
 * quando non si riconoscono si riporta il messaggio originale invece di inventare una diagnosi.
 */
function inItaliano(problema) {
  const nome = problema?.name ?? ''
  const messaggio = problema instanceof Error ? problema.message : String(problema)

  if (nome === 'RenderingCancelledException') return SUPERATO
  if (nome === 'InvalidPDFException') {
    return `Questo file non e un PDF che si possa aprire: ${messaggio}`
  }
  if (nome === 'MissingPDFException') {
    return `Il documento non e stato trovato: ${messaggio}`
  }
  if (nome === 'PasswordException') {
    return 'Il documento e protetto da password: questa demo lavora solo su documenti in chiaro.'
  }
  if (nome === 'UnexpectedResponseException') {
    return `Il caricamento del documento e fallito: ${messaggio}`
  }
  return `Il documento non si e potuto disegnare: ${messaggio}`
}
