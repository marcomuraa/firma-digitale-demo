/**
 * Vista esadecimale: da byte a ViewModel di una finestra allineata a 16.
 *
 * E la vista piu guardata della demo — i byte dell'importo, il buco /Contents, la coda
 * dell'attacco 2 — quindi qui contano due cose sole: essere veloce e essere prevedibile.
 * Nessun DOM, nessuno stato, nessuna stringa di presentazione: chi disegna riceve numeri e
 * decide da solo i colori. Contratto normativo in docs/contratti-ui.md.
 *
 * Convenzioni condivise con tutto il progetto: offset assoluti dall'inizio del file,
 * `end` sempre ESCLUSIVO.
 *
 * @typedef {'object'|'structure'|'hole'|'tail'|'target'|'changed'} Kind
 * @typedef {{ id: string, start: number, end: number, kind: Kind, label?: string }} Highlight
 */

import { isPrintable, printableChar, toHex } from '../core/bytes.js'

/** Byte per riga. E una costante, non un parametro: il contratto la fissa a 16. */
const BYTES_PER_ROW = 16

/**
 * Il vocabolario chiuso dell'asse 1 — che cosa *sono* quei byte. Stessa tavolozza del righello,
 * meno niente: `covered` NON e un kind ma l'asse 2 (se quei byte sono firmati), e chi lo cerca
 * qui sta facendo la confusione che docs/contratti-ui.md documenta. `target` e `changed` vivono
 * solo nell'esadecimale, ma restano leciti anche altrove: e una sola lista per tutte le viste.
 */
const KINDS = new Set(['object', 'structure', 'hole', 'tail', 'target', 'changed'])

// Tavole precalcolate: una finestra da 512 byte tocca 512 celle, e il rendering la ricostruisce
// a ogni cambio di stato. Le tavole nascono da src/core/bytes.js perche la definizione di
// "stampabile" deve restare una sola in tutto il progetto: se diverge qui, il dump mente.
const HEX_OF_BYTE = new Array(256)
const CHAR_OF_BYTE = new Array(256)
const PRINTABLE_OF_BYTE = new Array(256)
for (let b = 0; b < 256; b++) {
  HEX_OF_BYTE[b] = toHex(new Uint8Array([b]))
  CHAR_OF_BYTE[b] = printableChar(b)
  PRINTABLE_OF_BYTE[b] = isPrintable(b)
}

const EMPTY_BYTES = new Uint8Array(0)

/** Offset -> etichetta della colonna di sinistra: '000007a0'. */
function toOffsetHex(offset) {
  return offset.toString(16).padStart(8, '0')
}

function alignDown(n) {
  return Math.floor(n / BYTES_PER_ROW) * BYTES_PER_ROW
}

function alignUp(n) {
  return Math.ceil(n / BYTES_PER_ROW) * BYTES_PER_ROW
}

/** Numero utilizzabile come offset, oppure `fallback`: la geometria non fa mai lanciare. */
function asInteger(value, fallback) {
  return Number.isFinite(value) ? Math.trunc(value) : fallback
}

/* ------------------------------------------------------------------ validazione */

function fail(code, message) {
  const error = new Error(`buildHexWindow: ${message}`)
  error.code = code
  throw error
}

function describe(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.join(', ')}]`
  return String(value)
}

/**
 * Il `kind` di un highlight, verificato contro il vocabolario condiviso. Il `kind` qui e
 * obbligatorio — a differenza di `label`, e a differenza degli `objects` del righello dove puo
 * mancare e vale `object`: nell'esadecimale un highlight senza kind e un highlight senza colore.
 */
function requireKind(highlight, index) {
  if (KINDS.has(highlight.kind)) return
  fail(
    'UNKNOWN_KIND',
    `highlights[${index}] (${describe(highlight.id)}) ha kind ${describe(highlight.kind)}, ` +
      `fuori dal vocabolario condiviso (${[...KINDS].join(', ')}).`,
  )
}

/**
 * Finestra esadecimale centrata su `centerOffset`, larga almeno `span` byte.
 *
 * `bytes: Uint8Array` · `centerOffset: number` · `span: number` (byte desiderati, allargati
 * al multiplo di 16) · `highlights: Highlight[]` con `{ id, start, end, kind, label? }`.
 *
 * La finestra e sempre allineata: `start` e `end` sono multipli di 16 e ogni riga ha
 * esattamente 16 celle, anche a cavallo della fine del file — li `byte === null`.
 * Quando la finestra sfonderebbe un bordo del file viene traslata dentro, non accorciata:
 * chi guarda vede sempre la stessa quantita di contesto, e `truncated` dice se resta del
 * file fuori dai bordi.
 *
 * Funzione pura: stessa entrata, stessa uscita. Lancia solo davanti a un errore di
 * programmazione, cioe un `kind` fuori dal vocabolario (`code: 'UNKNOWN_KIND'`); byte e offset
 * assurdi non fanno mai lanciare.
 *
 * @param {Uint8Array} bytes
 * @param {number} centerOffset
 * @param {number} span
 * @param {Highlight[]} [highlights]
 * @throws {Error & {code: 'UNKNOWN_KIND'}} se un highlight ha un `kind` fuori dal vocabolario
 */
export function buildHexWindow(bytes, centerOffset, span, highlights) {
  const data = bytes && typeof bytes.length === 'number' ? bytes : EMPTY_BYTES
  const fileLength = data.length

  // Larghezza della finestra: almeno una riga, sempre un multiplo di 16.
  const wanted = Math.max(0, asInteger(span, 0))
  const windowSpan = Math.max(BYTES_PER_ROW, alignUp(wanted))

  // Il file finisce al multiplo di 16 successivo: l'ultima riga esiste anche se e parziale.
  const fileEnd = alignUp(fileLength)
  const center = asInteger(centerOffset, 0)

  let start
  let end
  if (windowSpan >= fileEnd) {
    // La finestra chiesta contiene tutto il file: si mostra il file, non il vuoto oltre.
    start = 0
    end = fileEnd
  } else {
    start = alignDown(center - Math.floor(windowSpan / 2))
    if (start < 0) start = 0
    if (start > fileEnd - windowSpan) start = fileEnd - windowSpan
    end = start + windowSpan
  }

  const rows = []
  for (let rowOffset = start; rowOffset < end; rowOffset += BYTES_PER_ROW) {
    const cells = new Array(BYTES_PER_ROW)
    for (let i = 0; i < BYTES_PER_ROW; i++) {
      const offset = rowOffset + i
      if (offset < fileLength) {
        const byte = data[offset]
        cells[i] = {
          offset,
          hex: HEX_OF_BYTE[byte],
          byte,
          char: CHAR_OF_BYTE[byte],
          printable: PRINTABLE_OF_BYTE[byte],
          highlightIds: [],
        }
      } else {
        // Fuori dal file: la cella esiste per tenere l'allineamento, ma non ha un valore.
        cells[i] = {
          offset,
          hex: null,
          byte: null,
          char: null,
          printable: false,
          highlightIds: [],
        }
      }
    }
    rows.push({ offset: rowOffset, offsetHex: toOffsetHex(rowOffset), cells })
  }

  // Highlight: si scartano i degeneri e quelli che non toccano la finestra, gli altri si
  // clampano ai bordi. L'ordine di scansione resta quello di ingresso, perche e l'ordine che
  // finisce dentro `highlightIds` quando due highlight si sovrappongono sulla stessa cella.
  //
  // Perche un `kind` sbagliato lancia e un highlight degenere no — la distinzione non e ovvia,
  // quindi va detta. Sono due sbagli di natura diversa:
  //  - il `kind` e CODICE. Fuori dal vocabolario non esiste colore che gli corrisponda: chi
  //    disegna ha scritto una parola che nessuno sa rendere, e l'unico momento utile per
  //    accorgersene e questo, non a schermo davanti a una cella incolore. Si lancia, con lo
  //    stesso `code: 'UNKNOWN_KIND'` di byte-ruler: due viste, una sola regola.
  //  - un intervallo degenere (lunghezza zero, start > end, elemento assente, `highlights`
  //    proprio non passato) e DATO. Nasce da uno stato legittimo della demo: il buco /Contents
  //    prima che venga aperto, la coda prima che l'attacco 2 scatti. Rifiutarlo obbligherebbe
  //    ogni chiamante a filtrare a monte cio che qui costa una riga. Si ignora in silenzio.
  // Il controllo del `kind` viene prima della geometria, di proposito: un `kind` inventato resta
  // un errore anche su un highlight vuoto o fuori finestra, che altrimenti lo nasconderebbe fino
  // al giorno in cui quell'intervallo diventa visibile.
  const incoming = Array.isArray(highlights) ? highlights : []
  const visible = []
  for (let i = 0; i < incoming.length; i++) {
    const highlight = incoming[i]
    if (!highlight) continue
    requireKind(highlight, i)
    const from = asInteger(highlight.start, NaN)
    const to = asInteger(highlight.end, NaN)
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    if (to <= from) continue // lunghezza zero, oppure start > end: si ignora, non si lancia
    const clampedStart = from < start ? start : from
    const clampedEnd = to > end ? end : to
    if (clampedEnd <= clampedStart) continue // interamente fuori dalla finestra
    visible.push({ ...highlight, start: clampedStart, end: clampedEnd })
  }

  for (let h = 0; h < visible.length; h++) {
    const highlight = visible[h]
    for (let offset = highlight.start; offset < highlight.end; offset++) {
      const index = offset - start
      rows[Math.floor(index / BYTES_PER_ROW)].cells[index % BYTES_PER_ROW].highlightIds.push(
        highlight.id,
      )
    }
  }

  return {
    start,
    end,
    bytesPerRow: BYTES_PER_ROW,
    fileLength,
    rows,
    // Nel ViewModel gli highlight sono ordinati per start: l'ordinamento e stabile, quindi a
    // parita di start resta l'ordine di ingresso.
    highlights: visible.slice().sort((a, b) => a.start - b.start),
    truncated: { before: start > 0, after: end < fileLength },
  }
}
