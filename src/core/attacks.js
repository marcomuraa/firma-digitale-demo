/**
 * attacks.js — le tre manomissioni del documento firmato.
 *
 *   tamperDigit             1a  un byte, dentro la zona firmata, lunghezza invariata
 *   tamperWords             1b  "mille" -> "novemila": tre byte in piu, e la struttura si rompe
 *   appendIncrementalUpdate  2  niente si tocca, si appende: la firma resta valida, la copertura no
 *
 * Nessuna di queste funzioni simula un fallimento. Modificano davvero i byte del PDF firmato e
 * lasciano che sia la verifica a reagire: se un giorno il controllo della firma smettesse di
 * accorgersene, questi attacchi non lo mascherebbero.
 *
 * MISURA CONTROINTUITIVA, da rispettare quando si scrivono i testi (docs/pdf-campione.md §4):
 * dopo l'attacco 1b il file e strutturalmente rotto — /Length dichiara 650 e i byte sono 653,
 * le voci xref non puntano piu a "N 0 obj" — eppure sia pdf.js sia poppler lo aprono lo stesso
 * e mostrano "1.000 euro (novemila euro)". I renderer ricostruiscono, perdonano, e disegnano.
 * Il codice qui sotto non presuppone nessun rifiuto del renderer: `brokenLength` e `brokenXref`
 * sono CALCOLATI sui byte risultanti, e dicono che il file e incoerente, non che sia illeggibile.
 * La morale onesta e piu forte di quella pianificata: il renderer perdona, la firma no.
 *
 * Gli offset sono quelli congelati in sample-offsets.json. Sono validi su un PDF firmato perche
 * addPlaceholder e un append puro: i primi 1285 byte del file firmato sono ancora il campione.
 *
 * Ambiente: browser. Nessun import di node.
 */

import offsets from '../assets/sample-offsets.json' with { type: 'json' }
import { ascii, fromAscii, concat, indexOf, indexesOf, toHex } from './bytes.js'
import {
  buildIncrementalUpdate,
  dictEndAt,
  findFirstPageNumber,
  findObject,
  pdfLiteral,
  readTrailerInfo,
} from './pades.js'

/** Porzione di byte letta come testo, un byte un carattere. */
function textOf(bytes, start = 0, end = bytes.length) {
  return fromAscii(bytes.subarray(start, end))
}

/** Come si mostra un byte in un messaggio d'errore: valore e, se si vede, carattere. */
function describeByte(byte) {
  const hex = '0x' + toHex(Uint8Array.of(byte))
  return byte >= 0x20 && byte <= 0x7e ? `${hex} ("${String.fromCharCode(byte)}")` : hex
}

// ---------------------------------------------------------------------------
// Perizia sui byte risultanti
//
// Dopo l'attacco 1b non ci si accontenta di dire "e rotto": si misura in che modo. Queste due
// funzioni rileggono il file manomesso come farebbe un perito — /Length contro i byte veri,
// voci xref contro le posizioni vere degli oggetti — e riportano cio che trovano.
// ---------------------------------------------------------------------------

/** Ogni stream del file: quanto dichiara /Length, quanti byte ci sono davvero. */
export function streamLengthReport(bytes) {
  const streams = []
  const lengthAt = indexesOf(bytes, '/Length')
  for (const at of indexesOf(bytes, 'stream')) {
    if (at >= 3 && textOf(bytes, at - 3, at) === 'end') continue // "endstream" non apre niente
    let dataStart = at + 'stream'.length
    if (bytes[dataStart] === 0x0d) dataStart++
    if (bytes[dataStart] === 0x0a) dataStart++
    const endAt = indexOf(bytes, 'endstream', dataStart)
    if (endAt === -1) continue
    let dataEnd = endAt
    if (bytes[dataEnd - 1] === 0x0a) dataEnd--
    if (bytes[dataEnd - 1] === 0x0d) dataEnd--

    let declared = null
    let valueStart = null
    let valueEnd = null
    const keyAt = lengthAt.filter((k) => k < at).pop()
    if (keyAt !== undefined) {
      const m = /^\/Length\s+(\d+)/.exec(textOf(bytes, keyAt, keyAt + 32))
      if (m) {
        declared = Number(m[1])
        valueStart = keyAt + m[0].length - m[1].length
        valueEnd = valueStart + m[1].length // escluso, come tutti gli offset di sample-offsets.json
      }
    }
    streams.push({
      dataStart,
      dataEnd,
      actual: dataEnd - dataStart,
      declared,
      valueStart,
      valueEnd,
      broken: declared !== null && declared !== dataEnd - dataStart,
    })
  }
  return { streams, broken: streams.some((s) => s.broken) }
}

/** Legge una sezione xref classica a partire da `at`. Ritorna null se li non c'e una tabella. */
function parseXrefSection(bytes, text, at) {
  if (!text.startsWith('xref', at)) return null
  const section = { at, entries: [], prev: null }
  let i = at + 'xref'.length
  for (;;) {
    while (i < text.length && (text[i] === '\n' || text[i] === '\r' || text[i] === ' ')) i++
    if (text.startsWith('trailer', i)) break
    const header = /^(\d+)\s+(\d+)[ \t]*\r?\n/.exec(text.slice(i, i + 48))
    if (!header) return section
    const first = Number(header[1])
    const count = Number(header[2])
    i += header[0].length
    for (let k = 0; k < count; k++) {
      const entry = /^(\d{10}) (\d{5}) ([nf])/.exec(text.slice(i, i + 20))
      if (!entry) return section
      section.entries.push({
        num: first + k,
        offset: Number(entry[1]),
        gen: Number(entry[2]),
        type: entry[3],
      })
      i += 20
    }
  }
  const dictStart = text.indexOf('<<', i)
  if (dictStart !== -1) {
    const dict = text.slice(dictStart, dictEndAt(bytes, dictStart))
    const prev = /\/Prev\s+(\d+)/.exec(dict)
    if (prev) section.prev = Number(prev[1])
  }
  return section
}

/** Dove sta davvero la definizione di "N 0 obj", oppure null. */
function actualObjectOffset(bytes, text, num) {
  const hits = indexesOf(bytes, `${num} 0 obj`).filter((at) => at === 0 || bytes[at - 1] === 0x0a)
  return hits.length ? hits[hits.length - 1] : null
}

/**
 * Perizia sulle xref, in due tempi.
 *
 * Prima i puntatori: `startxref` e la catena dei `/Prev` indicano davvero l inizio di una tabella?
 * Poi le voci: di ogni tabella che nel file c e davvero — ritrovata scandendo i byte, che e
 * esattamente cio che fanno pdf.js e poppler quando la catena si rompe — ogni voce `n` punta
 * davvero a "N 0 obj"?
 *
 * I due tempi sono separati apposta: un `startxref` sbagliato non deve impedire di vedere le voci
 * sbagliate. Un file rotto va descritto per intero, non fino al primo inciampo.
 */
export function xrefReport(bytes) {
  const text = fromAscii(bytes)
  const problems = []
  const sections = []

  const tables = indexesOf(bytes, 'xref').filter(
    (at) => (at === 0 || bytes[at - 1] === 0x0a) && text.startsWith('xref\n', at),
  )
  const nearestTable = (offset) =>
    tables.length
      ? tables.reduce((best, t) => (Math.abs(t - offset) < Math.abs(best - offset) ? t : best))
      : null

  const sxAt = text.lastIndexOf('startxref')
  const m = sxAt === -1 ? null : /^startxref\s+(\d+)/.exec(text.slice(sxAt, sxAt + 40))
  if (!m) {
    problems.push({ id: 'startxref', motivo: 'manca "startxref", oppure non e seguito da un numero' })
  } else if (!text.startsWith('xref\n', Number(m[1]))) {
    problems.push({
      id: 'startxref',
      declared: Number(m[1]),
      actual: nearestTable(Number(m[1])),
      motivo: 'l offset dichiarato da "startxref" non e l inizio di una tabella xref',
    })
  }

  for (const tableAt of tables) {
    const section = parseXrefSection(bytes, text, tableAt)
    if (!section) continue
    sections.push(section)
    if (section.prev !== null && !text.startsWith('xref\n', section.prev)) {
      problems.push({
        id: 'prev',
        table: tableAt,
        declared: section.prev,
        actual: nearestTable(section.prev),
        motivo: 'l offset dichiarato da /Prev non e l inizio di una tabella xref',
      })
    }
    for (const entry of section.entries) {
      if (entry.type !== 'n') continue
      if (!text.startsWith(`${entry.num} ${entry.gen} obj`, entry.offset)) {
        problems.push({
          id: 'entry',
          table: tableAt,
          num: entry.num,
          declaredOffset: entry.offset,
          actualOffset: actualObjectOffset(bytes, text, entry.num),
          motivo: `la voce xref dell oggetto ${entry.num} non punta a "${entry.num} ${entry.gen} obj"`,
        })
      }
    }
  }

  return { broken: problems.length > 0, sections, problems, tables }
}

// ---------------------------------------------------------------------------
// 1a — Falsifica la cifra
// ---------------------------------------------------------------------------

/**
 * Scrive `9` al posto di `1` all'offset congelato: `1.000` diventa `9.000`.
 *
 * Un byte, lunghezza invariata, struttura intatta — e l'attacco cade DENTRO il primo intervallo
 * del /ByteRange, quindi l'impronta cambia per forza. Che ci cada e verificato dal test, non
 * sperato: se l'attacco colpisse un byte non coperto staremmo simulando il fallimento della
 * firma invece di provocarlo, che e esattamente cio che questa demo non vuole fare.
 *
 * Il byte di partenza viene controllato prima di scrivere: se all'offset non c'e piu `1`, il file
 * in mano non e quello per cui gli offset sono stati congelati, e vale la pena dirlo subito.
 */
export function tamperDigit(signedPdf) {
  const offset = offsets.amount.digitOffset
  if (offset >= signedPdf.length) {
    throw new Error(
      `l offset congelato ${offset} e fuori da questo file, lungo ${signedPdf.length} byte: ` +
        'non e il PDF campione',
    )
  }
  if (signedPdf[offset] !== 0x31) {
    throw new Error(
      `all offset ${offset} doveva esserci la cifra "1" (0x31) e invece c e ${describeByte(signedPdf[offset])}: ` +
        'gli offset congelati valgono per il campione e per i file che lo conservano byte per byte ' +
        '(un incremental update appeso), non per un PDF riscritto o gia manomesso',
    )
  }
  const bytes = new Uint8Array(signedPdf)
  bytes[offset] = 0x39
  return { bytes, offset, from: '1', to: '9' }
}

// ---------------------------------------------------------------------------
// 1b — Falsifica anche le lettere
// ---------------------------------------------------------------------------

/**
 * Sostituisce `mille` con `novemila`. Il file cresce di tre byte, e tutto cio che sta piu avanti
 * scivola: /Length dichiara meno di quanto lo stream contenga, le voci xref degli oggetti che
 * seguono non puntano piu a "N 0 obj", `startxref` indica un punto in cui la tabella non c e piu.
 *
 * `brokenLength` e `brokenXref` non sono costanti messe a mano: escono da una rilettura dei byte
 * risultanti. Se un giorno la manomissione smettesse di rompere la struttura, questi due campi
 * diventerebbero `false` da soli, e il pannello direbbe il vero.
 */
export function tamperWords(signedPdf) {
  const start = offsets.amount.wordsStart
  const end = offsets.amount.wordsEnd
  const from = offsets.amount.words
  const to = 'novemila'

  if (end > signedPdf.length) {
    throw new Error(
      `l intervallo congelato ${start}..${end} e fuori da questo file, lungo ${signedPdf.length} byte: ` +
        'non e il PDF campione',
    )
  }
  const found = textOf(signedPdf, start, end)
  if (found !== from) {
    throw new Error(
      `all offset ${start} doveva esserci "${from}" e invece c e "${found}": gli offset congelati ` +
        'valgono per il campione e per i file che lo conservano byte per byte, non per un PDF ' +
        'riscritto o gia manomesso',
    )
  }

  const bytes = concat(signedPdf.subarray(0, start), ascii(to), signedPdf.subarray(end))
  const deltaLength = to.length - from.length

  const lengths = streamLengthReport(bytes)
  const xref = xrefReport(bytes)
  const stream = lengths.streams.find((s) => s.broken) ?? lengths.streams[0] ?? null

  return {
    bytes,
    offset: start,
    deltaLength,
    brokenLength: lengths.broken,
    brokenXref: xref.broken,
    // Materiale per il pannello: i disallineamenti misurati, non annunciati.
    evidence: {
      length: stream
        ? { declared: stream.declared, actual: stream.actual, valueStart: stream.valueStart, valueEnd: stream.valueEnd }
        : null,
      xref: xref.problems,
    },
  }
}

// ---------------------------------------------------------------------------
// 2 — Modifica dopo la firma
// ---------------------------------------------------------------------------

/** La riga dell importo dentro il content stream, in una forma che regge anche dopo l attacco 1a o 1b. */
const AMOUNT_LINE = /\(\s*[\d.]+ euro \([A-Za-z]+ euro\)\s*\)\s*Tj/

/**
 * Appende un incremental update che riscrive il content stream della pagina: stessa pagina, stessi
 * oggetti, stesso disegno della firma autografa — cambia solo la riga dell importo, che diventa
 * `newText`.
 *
 * Il file firmato non viene toccato di un byte: l aggiornamento si aggiunge in coda, con un nuovo
 * oggetto per il content stream, la sua sezione xref e un trailer con /Prev. E per questo che
 * l attacco funziona ed e per questo che e istruttivo: il /ByteRange copre i byte di prima, che
 * sono ancora tutti li e ancora tutti identici, quindi la firma continua a verificare. Cambia solo
 * cio che si vede — pdf.js legge l ultima xref e ridisegna la pagina con l importo nuovo.
 *
 * Il verdetto giusto qui non e "firma non valida": e "firma valida, documento esteso dopo la
 * firma". Chi guarda il documento renderizzato non sta verificando niente.
 */
export function appendIncrementalUpdate(signedPdf, options = {}) {
  const { newText = '1.000.000 euro (un milione di euro)' } = options
  if (typeof newText !== 'string' || newText.length === 0) {
    throw new Error('newText deve essere una stringa non vuota: e il testo che sostituisce l importo')
  }

  const info = readTrailerInfo(signedPdf)
  const pageNum = findFirstPageNumber(signedPdf, info.rootNum)
  const page = findObject(signedPdf, pageNum)
  const contentsRef = /\/Contents\s+(\d+)\s+(\d+)\s+R/.exec(textOf(signedPdf, page.start, page.end))
  if (!contentsRef) {
    throw new Error(`la pagina (oggetto ${pageNum}) non ha un /Contents che punti a un oggetto`)
  }
  const streamNum = Number(contentsRef[1])

  const obj = findObject(signedPdf, streamNum)
  const dictStart = indexOf(signedPdf, '<<', obj.start)
  if (dictStart === -1 || dictStart > obj.end) {
    throw new Error(`l oggetto ${streamNum} non comincia con un dizionario`)
  }
  const dict = textOf(signedPdf, dictStart, dictEndAt(signedPdf, dictStart))
  if (/\/Filter/.test(dict)) {
    throw new Error(
      `il content stream (oggetto ${streamNum}) e compresso: questo attacco lavora sul PDF campione, ` +
        'che per scelta non ha nessun /Filter',
    )
  }

  const streamAt = indexOf(signedPdf, 'stream', dictStart)
  if (streamAt === -1 || streamAt > obj.end) throw new Error(`l oggetto ${streamNum} non contiene uno stream`)
  let dataStart = streamAt + 'stream'.length
  if (signedPdf[dataStart] === 0x0d) dataStart++
  if (signedPdf[dataStart] === 0x0a) dataStart++
  const endAt = indexOf(signedPdf, 'endstream', dataStart)
  if (endAt === -1) throw new Error(`lo stream dell oggetto ${streamNum} non viene chiuso da "endstream"`)
  let dataEnd = endAt
  if (signedPdf[dataEnd - 1] === 0x0a) dataEnd--
  if (signedPdf[dataEnd - 1] === 0x0d) dataEnd--

  const data = textOf(signedPdf, dataStart, dataEnd)
  if (!AMOUNT_LINE.test(data)) {
    throw new Error(
      'nel content stream non si trova la riga dell importo da riscrivere: questo attacco e cucito ' +
        'sul PDF campione',
    )
  }
  const newData = data.replace(AMOUNT_LINE, `${pdfLiteral(newText)} Tj`)

  const newDict = /\/Length\s+\d+/.test(dict)
    ? dict.replace(/\/Length\s+\d+/, `/Length ${newData.length}`)
    : dict.replace(/>>\s*$/, `/Length ${newData.length} >>`)

  const objectText = `${streamNum} 0 obj\n${newDict}\nstream\n${newData}\nendstream\nendobj\n`
  const built = buildIncrementalUpdate(signedPdf, [{ num: streamNum, text: objectText }])

  return { bytes: built.bytes, appendedFrom: built.appendedFrom }
}
