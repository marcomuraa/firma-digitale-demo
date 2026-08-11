/**
 * pades.js — il placeholder PAdES, l'impronta di cio che la firma copre, e l'iniezione del CMS.
 *
 * Tre funzioni, una per ciascun momento della firma dentro un PDF:
 *
 *   addPlaceholder    scava il buco e dichiara quali byte saranno firmati (/ByteRange)
 *   digestCovered     calcola SHA-256 su quei byte, e solo su quelli
 *   injectSignature   scrive il CMS dentro il buco senza spostare un byte
 *
 * La catena crittografica (chiavi, certificato, CMS) non entra qui: questo modulo riceve il CMS
 * gia fatto, come byte, e non sa nemmeno cosa contenga. Il taglio e voluto — cosi la parte PDF
 * si prova con un CMS finto e la parte crypto si prova senza un PDF.
 *
 * PERCHE E SCRITTO A MANO (deciso e misurato, vedi docs/pdf-campione.md sezione 8).
 * pdf-lib — e quindi @signpdf/placeholder-pdf-lib, che ci passa dentro — non appende: rilegge il
 * documento a oggetti e lo riscrive da capo. Misurato sul campione: 1285 -> 6682 byte, prefisso in
 * comune con l'originale 9 byte soli, ricompare /FlateDecode. Ogni offset congelato in
 * sample-offsets.json punterebbe altrove e il PDF "trasparente" smetterebbe di essere trasparente.
 * Un incremental update appeso a mano invece li conserva tutti. Da qui l'invariante di questo file:
 *
 *   ADD PLACEHOLDER E UN APPEND PURO. I primi pdfBytes.length byte del risultato sono identici,
 *   byte per byte, all'originale. Se questa proprieta cade, cade tutta la premessa didattica.
 *
 * Ambiente: gira nel browser. Nessun import di node, nessun Buffer; l'unica dipendenza esterna e
 * WebCrypto attraverso sha256() di bytes.js.
 */

import { ascii, fromAscii, concat, indexOf, indexesOf, lastIndexOf, toHex, sha256 } from './bytes.js'

const LF = 0x0a
const LT = 0x3c // '<'
const GT = 0x3e // '>'

/** Numero massimo di ricalcoli del /ByteRange prima di dichiarare sconfitta (vedi addPlaceholder). */
const MAX_BYTERANGE_PASSES = 8

// ---------------------------------------------------------------------------
// Lettura della struttura esistente
//
// Sono funzioni volutamente minime: leggono quel poco che serve per appendere un aggiornamento
// coerente (dove sta la xref precedente, chi e il catalogo, qual e la pagina) e si fermano.
// Non sono un parser PDF: se il file non e nella forma che il campione garantisce — xref classica,
// nessuna compressione — lanciano un errore che lo dice, invece di indovinare.
// ---------------------------------------------------------------------------

/** Porzione di byte letta come testo, un byte un carattere. I PDF di questa demo sono ASCII. */
function textOf(bytes, start = 0, end = bytes.length) {
  return fromAscii(bytes.subarray(start, end))
}

/** true se il byte e una cifra esadecimale. */
function isHexDigit(byte) {
  return (
    (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x46) || (byte >= 0x61 && byte <= 0x66)
  )
}

/**
 * Fine (esclusa) del dizionario che comincia a `at`, contando le coppie `<<` e `>>` annidate.
 * Le stringhe esadecimali `<...>` hanno una sola parentesi per lato, quindi non confondono il conto.
 */
export function dictEndAt(bytes, at) {
  if (!(bytes[at] === LT && bytes[at + 1] === LT)) {
    throw new Error(`all'offset ${at} non comincia un dizionario "<<"`)
  }
  let depth = 0
  for (let i = at; i < bytes.length - 1; i++) {
    if (bytes[i] === LT && bytes[i + 1] === LT) {
      depth++
      i++
    } else if (bytes[i] === GT && bytes[i + 1] === GT) {
      depth--
      i++
      if (depth === 0) return i + 1
    }
  }
  throw new Error(`il dizionario che comincia a ${at} non viene mai chiuso`)
}

/**
 * Trova la definizione di un oggetto. Se l'oggetto e stato riscritto da un incremental update
 * vince l'ULTIMA definizione, che e esattamente la regola del PDF: l'aggiornamento piu recente
 * sovrascrive. `start` e l'inizio di "N 0 obj", `end` e subito dopo "endobj".
 */
export function findObject(bytes, num) {
  const marker = `${num} 0 obj`
  const hits = indexesOf(bytes, marker).filter((at) => at === 0 || bytes[at - 1] === LF)
  if (hits.length === 0) throw new Error(`oggetto "${marker}" non trovato nel PDF`)
  const start = hits[hits.length - 1]
  const endMarker = indexOf(bytes, 'endobj', start)
  if (endMarker === -1) throw new Error(`oggetto "${marker}": manca la parola chiave "endobj"`)
  return { num, start, end: endMarker + 'endobj'.length }
}

/**
 * Legge dal trailer attivo cio che un incremental update deve conservare: /Size, /Root, /ID,
 * l'eventuale /Info, e l'offset della xref corrente (che diventera il /Prev del nuovo trailer).
 */
export function readTrailerInfo(pdfBytes) {
  const startxrefAt = lastIndexOf(pdfBytes, 'startxref')
  if (startxrefAt === -1) {
    throw new Error('PDF senza "startxref": non e un file che questa demo sappia firmare')
  }
  const startxrefMatch = /^startxref\s+(\d+)/.exec(textOf(pdfBytes, startxrefAt, startxrefAt + 40))
  if (!startxrefMatch) throw new Error('la parola chiave "startxref" non e seguita da un numero')
  const startxrefValue = Number(startxrefMatch[1])

  if (textOf(pdfBytes, startxrefValue, startxrefValue + 4) !== 'xref') {
    throw new Error(
      `"startxref" indica l'offset ${startxrefValue}, dove pero non comincia una tabella "xref": ` +
        'questa demo lavora solo su xref classiche, non su xref a flusso',
    )
  }

  const trailerAt = lastIndexOf(pdfBytes, 'trailer')
  if (trailerAt === -1) throw new Error('PDF senza dizionario "trailer": xref a flusso non supportata')
  const dictStart = indexOf(pdfBytes, '<<', trailerAt)
  if (dictStart === -1) throw new Error('il "trailer" non e seguito da un dizionario')
  const dict = textOf(pdfBytes, dictStart, dictEndAt(pdfBytes, dictStart))

  const size = /\/Size\s+(\d+)/.exec(dict)
  const root = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec(dict)
  const id = /\/ID\s*(\[[^\]]*\])/.exec(dict)
  const info = /\/Info\s+(\d+\s+\d+\s+R)/.exec(dict)
  if (!size) throw new Error('il trailer non dichiara /Size')
  if (!root) throw new Error('il trailer non dichiara /Root')

  return {
    startxrefValue,
    size: Number(size[1]),
    rootNum: Number(root[1]),
    idText: id ? id[1] : null,
    infoText: info ? info[1] : null,
    trailerDict: dict,
  }
}

/** Il numero della prima pagina, risolto dal catalogo: /Root -> /Pages -> primo /Kids. */
export function findFirstPageNumber(pdfBytes, rootNum) {
  const catalog = findObject(pdfBytes, rootNum)
  const catalogText = textOf(pdfBytes, catalog.start, catalog.end)
  const pagesRef = /\/Pages\s+(\d+)\s+(\d+)\s+R/.exec(catalogText)
  if (!pagesRef) throw new Error(`il catalogo (oggetto ${rootNum}) non dichiara /Pages`)

  let num = Number(pagesRef[1])
  for (let depth = 0; depth < 8; depth++) {
    const node = findObject(pdfBytes, num)
    const text = textOf(pdfBytes, node.start, node.end)
    if (/\/Type\s*\/Page(?![a-zA-Z])/.test(text)) return num
    const kid = /\/Kids\s*\[\s*(\d+)\s+(\d+)\s+R/.exec(text)
    if (!kid) throw new Error(`l'oggetto ${num} non e ne una pagina ne un nodo con /Kids`)
    num = Number(kid[1])
  }
  throw new Error("albero delle pagine troppo profondo: non e il PDF campione")
}

// ---------------------------------------------------------------------------
// Costruzione di un incremental update
//
// E lo stesso meccanismo per il placeholder della firma e per l'attacco 2: si appendono gli
// oggetti nuovi o riscritti, poi una xref che elenca solo quelli, poi un trailer con /Prev che
// punta alla xref precedente. Il file di prima resta intatto sotto.
// ---------------------------------------------------------------------------

/** Una voce xref e lunga esattamente 20 byte: "nnnnnnnnnn ggggg n \n". Lo standard lo pretende. */
function xrefEntry(offset) {
  return `${String(offset).padStart(10, '0')} 00000 n \n`
}

/** La tabella xref del nuovo aggiornamento, raggruppata in sottosezioni di numeri consecutivi. */
function xrefTable(entries) {
  const sorted = [...entries].sort((a, b) => a.num - b.num)
  let out = 'xref\n'
  let i = 0
  while (i < sorted.length) {
    let j = i + 1
    while (j < sorted.length && sorted[j].num === sorted[j - 1].num + 1) j++
    out += `${sorted[i].num} ${j - i}\n`
    for (let k = i; k < j; k++) out += xrefEntry(sorted[k].offset)
    i = j
  }
  return out
}

/**
 * Appende un incremental update. `objects` e una lista di `{ num, text }`, dove `text` e il corpo
 * completo dell'oggetto, da "N 0 obj" a "endobj".
 *
 * Ritorna il file nuovo piu le misure che servono a chi chiama: da dove comincia la coda appesa,
 * dove sta la nuova xref, e a che offset e finito ogni oggetto.
 */
export function buildIncrementalUpdate(pdfBytes, objects) {
  if (!objects || objects.length === 0) throw new Error('un incremental update senza oggetti non ha senso')
  const info = readTrailerInfo(pdfBytes)
  const appendedFrom = pdfBytes.length

  // Se il file non finisce con un a capo lo aggiungiamo qui, nella parte appesa: l'originale non
  // si tocca comunque. Il campione finisce con "%%EOF\n", quindi di norma non serve.
  let update = pdfBytes[pdfBytes.length - 1] === LF ? '' : '\n'

  const objectOffsets = new Map()
  for (const obj of objects) {
    if (!obj.text.startsWith(`${obj.num} 0 obj`)) {
      throw new Error(`il corpo dell'oggetto ${obj.num} non comincia con "${obj.num} 0 obj"`)
    }
    objectOffsets.set(obj.num, appendedFrom + update.length)
    update += obj.text.endsWith('\n') ? obj.text : obj.text + '\n'
  }

  const xrefAt = appendedFrom + update.length
  update += xrefTable([...objectOffsets].map(([num, offset]) => ({ num, offset })))

  const size = Math.max(info.size, ...objects.map((o) => o.num + 1))
  const parts = [`/Size ${size}`, `/Root ${info.rootNum} 0 R`]
  if (info.infoText) parts.push(`/Info ${info.infoText}`)
  parts.push(`/Prev ${info.startxrefValue}`)
  // /Root e /ID restano identici a prima: e lo stesso documento, non un altro.
  if (info.idText) parts.push(`/ID ${info.idText}`)
  update += `trailer\n<< ${parts.join(' ')} >>\n`
  update += `startxref\n${xrefAt}\n%%EOF\n`

  // ascii() rifiuta qualunque byte fuori dall'ASCII: e il guardiano della leggibilita del dump.
  return { bytes: concat(pdfBytes, ascii(update)), appendedFrom, xrefAt, objectOffsets, size }
}

/**
 * Inserisce voci in fondo a un dizionario, subito prima della sua chiusura.
 * Rispetta la disposizione di chi ha scritto l'oggetto: se il dizionario e su piu righe la voce
 * nuova prende una riga sua, se e su una riga sola resta in linea. Serve alla leggibilita del
 * dump, che in questa demo e materiale didattico e non scarto.
 */
function withDictEntries(objectText, entries) {
  const close = objectText.lastIndexOf('>>')
  if (close === -1) throw new Error('oggetto senza dizionario da estendere')
  const head = objectText.slice(0, close)
  const tail = objectText.slice(close)
  if (head.endsWith('\n')) return `${head}   ${entries}\n${tail}`
  return `${head}${head.endsWith(' ') ? '' : ' '}${entries} ${tail}`
}

/** Data nel formato dei PDF: D:AAAAMMGGhhmmss+00'00'. Sempre in UTC, cosi non dipende dal fuso. */
function pdfDate(date) {
  const pad = (n, width = 2) => String(n).padStart(width, '0')
  return (
    `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}+00'00'`
  )
}

/** Escape di una stringa letterale PDF. Le parentesi bilanciate restano leggibili nel dump. */
export function pdfLiteral(text) {
  let escaped = text.replace(/\\/g, '\\\\')
  let depth = 0
  let balanced = true
  for (const ch of escaped) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth < 0) balanced = false
  }
  if (!balanced || depth !== 0) escaped = escaped.replace(/[()]/g, (ch) => '\\' + ch)
  return `(${escaped})`
}

// ---------------------------------------------------------------------------
// 1. Il placeholder
// ---------------------------------------------------------------------------

/**
 * Appende al PDF l'incremental update che lo rende un documento firmato — tranne la firma, che
 * ancora non c'e e al cui posto resta un buco di `padding` byte.
 *
 * Cosa contiene l'aggiornamento, e perche ogni pezzo serve:
 *
 *   - il dizionario di firma (/Type /Sig): /Filter /Adobe.PPKLite dice chi la sa verificare,
 *     /SubFilter /ETSI.CAdES.detached e cio che la rende PAdES e non Adobe legacy, /ByteRange
 *     dichiara quali byte sono coperti, /Contents e il buco che li conterra, /M la data;
 *   - il campo modulo di firma con la sua annotazione widget (/FT /Sig + /Type /Annot
 *     /Subtype /Widget), invisibile perche /Rect [0 0 0 0]: e cio che lega la firma a una pagina;
 *   - la pagina riscritta con /Annots che punta al widget;
 *   - il catalogo riscritto con /AcroForm << /Fields [...] /SigFlags 3 >>: senza questo un
 *     validatore vero non trova la firma e la considera spazzatura appesa;
 *   - la xref dei soli oggetti toccati e il trailer con /Prev.
 *
 * Il /ByteRange copre [0, contentsStart) e [contentsStart + buco, fine file): il buco fra le
 * parentesi angolari e l'unica parte non firmata, e non puo essere altrimenti — dentro ci va la
 * firma stessa, che non puo firmare se stessa.
 *
 * `contentsStart` e l'offset della parentesi `<` di apertura, e le due parentesi stanno DENTRO il
 * buco: e la convenzione che seguono Adobe, poppler/pdfsig e signpdf, quindi la seguiamo anche noi.
 *
 * I numeri del /ByteRange sono lunghi quanto le loro cifre, e le loro cifre spostano il buco: il
 * calcolo e quindi un punto fisso, non una sottrazione. Si parte da [0 0 0 0] — cioe dal file piu
 * corto possibile — e si ricostruisce finche il /ByteRange scritto coincide con quello misurato.
 * Partendo dal basso la lunghezza puo solo crescere, quindi la successione converge (in pratica in
 * tre passate); se non convergesse, meglio un errore che un /ByteRange che mente.
 */
export function addPlaceholder(pdfBytes, options = {}) {
  const {
    padding = 4096,
    fieldName = 'Firma1',
    signingTime = new Date(),
  } = options

  if (!Number.isInteger(padding) || padding < 64) {
    throw new Error(`padding deve essere un intero di almeno 64 byte, ricevuto ${padding}`)
  }

  const info = readTrailerInfo(pdfBytes)
  const catalogNum = info.rootNum
  const pageNum = findFirstPageNumber(pdfBytes, catalogNum)
  const sigNum = info.size
  const fieldNum = info.size + 1

  const catalog = findObject(pdfBytes, catalogNum)
  const catalogText = textOf(pdfBytes, catalog.start, catalog.end)
  if (/\/AcroForm/.test(catalogText)) {
    throw new Error(
      `il catalogo (oggetto ${catalogNum}) ha gia un /AcroForm: questo placeholder sa creare il ` +
        'modulo di firma, non fondersi con uno esistente',
    )
  }
  const page = findObject(pdfBytes, pageNum)
  const pageText = textOf(pdfBytes, page.start, page.end)
  if (/\/Annots/.test(pageText)) {
    throw new Error(
      `la pagina (oggetto ${pageNum}) ha gia delle /Annots: questo placeholder sa aggiungere la sua ` +
        'annotazione a una pagina che non ne ha',
    )
  }

  const holeLength = padding * 2 + 2 // le due parentesi angolari stanno dentro il buco
  const contentsHead = '/Contents '
  const date = pdfDate(signingTime)

  const buildOnce = (byteRange) => {
    const sigText =
      `${sigNum} 0 obj\n` +
      '<< /Type /Sig\n' +
      '   /Filter /Adobe.PPKLite\n' +
      '   /SubFilter /ETSI.CAdES.detached\n' +
      `   /ByteRange [${byteRange.join(' ')}]\n` +
      `   ${contentsHead}<${'0'.repeat(padding * 2)}>\n` +
      `   /M (${date})\n` +
      '>>\n' +
      'endobj\n'

    const fieldText =
      `${fieldNum} 0 obj\n` +
      '<< /Type /Annot\n' +
      '   /Subtype /Widget\n' +
      '   /FT /Sig\n' +
      `   /T ${pdfLiteral(fieldName)}\n` +
      '   /Rect [0 0 0 0]\n' +
      '   /F 132\n' +
      `   /P ${pageNum} 0 R\n` +
      `   /V ${sigNum} 0 R\n` +
      '>>\n' +
      'endobj\n'

    const objects = [
      {
        num: catalogNum,
        text: withDictEntries(catalogText, `/AcroForm << /Fields [${fieldNum} 0 R] /SigFlags 3 >>`) + '\n',
      },
      { num: pageNum, text: withDictEntries(pageText, `/Annots [${fieldNum} 0 R]`) + '\n' },
      { num: sigNum, text: sigText },
      { num: fieldNum, text: fieldText },
    ]

    const built = buildIncrementalUpdate(pdfBytes, objects)
    const contentsStart =
      built.objectOffsets.get(sigNum) + sigText.indexOf(contentsHead) + contentsHead.length
    if (built.bytes[contentsStart] !== LT) {
      throw new Error('errore interno: il buco /Contents non e finito dove il calcolo lo aspettava')
    }
    return { bytes: built.bytes, contentsStart }
  }

  let byteRange = [0, 0, 0, 0]
  for (let pass = 0; pass < MAX_BYTERANGE_PASSES; pass++) {
    const { bytes, contentsStart } = buildOnce(byteRange)
    const measured = [
      0,
      contentsStart,
      contentsStart + holeLength,
      bytes.length - (contentsStart + holeLength),
    ]
    if (measured.every((n, i) => n === byteRange[i])) {
      return { pdfWithHole: bytes, byteRange: measured, contentsStart }
    }
    byteRange = measured
  }
  throw new Error(
    `il /ByteRange non si stabilizza in ${MAX_BYTERANGE_PASSES} passate: e un difetto del generatore ` +
      'del placeholder, non del PDF',
  )
}

// ---------------------------------------------------------------------------
// 2. L'impronta di cio che la firma copre
// ---------------------------------------------------------------------------

/** Controlla che un /ByteRange sia sensato per questi byte, e lo restituisce come numeri. */
function checkByteRange(bytes, byteRange) {
  if (!Array.isArray(byteRange) || byteRange.length !== 4) {
    throw new Error('il /ByteRange deve essere un array di quattro numeri [a b c d]')
  }
  const [a, b, c, d] = byteRange
  for (const n of byteRange) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`/ByteRange non valido: ${JSON.stringify(byteRange)}`)
  }
  if (a + b > c) throw new Error(`/ByteRange incoerente: il primo intervallo finisce a ${a + b}, dopo l'inizio del secondo (${c})`)
  if (c + d > bytes.length) {
    throw new Error(
      `/ByteRange fuori dal file: il secondo intervallo finisce a ${c + d} ma il file e lungo ${bytes.length} byte`,
    )
  }
  return [a, b, c, d]
}

/**
 * SHA-256 sulla concatenazione dei due intervalli del /ByteRange. Il buco del /Contents non entra
 * nel calcolo: e escluso per costruzione, ed e questo che permette di scrivere la firma dentro il
 * documento senza invalidarla.
 *
 * Nota per chi verifica: `c + d` puo essere minore della lunghezza del file. Non e un errore, e
 * l'attacco 2 — una coda appesa dopo la firma. Chi vuole saperlo confronta le due misure; qui non
 * si giudica, si calcola.
 */
export async function digestCovered(pdfWithHole, byteRange) {
  const [a, b, c, d] = checkByteRange(pdfWithHole, byteRange)
  return sha256(concat(pdfWithHole.subarray(a, a + b), pdfWithHole.subarray(c, c + d)))
}

// ---------------------------------------------------------------------------
// 3. L'iniezione della firma
// ---------------------------------------------------------------------------

/**
 * Scrive il CMS in esadecimale dentro il buco del /Contents e riempie il resto di zeri.
 * La lunghezza del file non cambia di un solo byte: se cambiasse, il /ByteRange gia scritto — e
 * gia firmato — comincerebbe a mentire.
 *
 * Se il CMS non ci sta, questa funzione lancia invece di troncare. Una firma troncata verrebbe
 * verificata come falsa, e la causa vera (il padding troppo stretto) sarebbe introvabile.
 */
export function injectSignature(pdfWithHole, contentsStart, cmsDer) {
  if (!Number.isInteger(contentsStart) || contentsStart < 0 || contentsStart >= pdfWithHole.length) {
    throw new Error(`contentsStart ${contentsStart} e fuori dal file (${pdfWithHole.length} byte)`)
  }
  if (pdfWithHole[contentsStart] !== LT) {
    throw new Error(
      `all'offset ${contentsStart} non c'e la parentesi angolare che apre il /Contents, ma ` +
        `0x${toHex(pdfWithHole.subarray(contentsStart, contentsStart + 1))}`,
    )
  }
  const close = indexOf(pdfWithHole, '>', contentsStart)
  if (close === -1) throw new Error('il buco del /Contents non viene mai chiuso da ">"')

  const capacity = close - contentsStart - 1
  if (capacity % 2 !== 0) {
    throw new Error(`il buco del /Contents ha ${capacity} caratteri esadecimali, che sono dispari`)
  }
  for (let i = contentsStart + 1; i < close; i++) {
    if (!isHexDigit(pdfWithHole[i])) {
      throw new Error(
        `il buco del /Contents contiene un carattere non esadecimale all'offset ${i}: ` +
          'questo PDF e gia stato firmato, oppure contentsStart non e quello giusto',
      )
    }
  }

  const hex = toHex(cmsDer)
  if (hex.length > capacity) {
    throw new Error(
      `la firma CMS occupa ${cmsDer.length} byte ma il buco /Contents ne accetta al massimo ` +
        `${capacity / 2}: rigenera il placeholder con un padding piu grande, non tronco la firma`,
    )
  }

  const out = new Uint8Array(pdfWithHole)
  out.set(ascii(hex), contentsStart + 1)
  for (let i = contentsStart + 1 + hex.length; i < close; i++) out[i] = 0x30 // '0'
  return out
}
