/**
 * Prove della catena PDF: placeholder, impronta, iniezione.
 *
 * Due livelli, deliberati. Il primo guarda i byte: che l'append sia puro, che il /ByteRange
 * torni, che il buco resti grande quanto e stato promesso. Il secondo apre il risultato con
 * pdf.js — il renderer vero, quello che poi girera nella pagina — in ogni stato del documento,
 * perche un PDF puo essere impeccabile sulla carta e illeggibile in mano a un parser.
 *
 * Il CMS qui e finto, e va benissimo: questo modulo non lo interpreta, lo scrive dentro un buco.
 * La catena crittografica ha le sue prove, altrove.
 *
 * Si esegue con:  node --test src/core/pades.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { addPlaceholder, digestCovered, injectSignature } from './pades.js'
import { fromAscii, indexesOf, toHex } from './bytes.js'
import offsets from '../assets/sample-offsets.json' with { type: 'json' }

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SAMPLE = new Uint8Array(readFileSync(path.join(ROOT, 'src', 'assets', 'sample.pdf')))
const STANDARD_FONTS = pathToFileURL(
  path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep,
).href

/** Data fissa: le prove non devono cambiare esito a seconda dell'ora in cui girano. */
const SIGNING_TIME = new Date(Date.UTC(2026, 7, 10, 12, 0, 0))

/** Un CMS finto ma plausibile per dimensione: qui contano i byte, non il loro significato. */
function fakeCms(length = 1400) {
  return new Uint8Array(length).map((_, i) => (i * 37 + 11) & 0xff)
}

function placeholder(options = {}) {
  return addPlaceholder(SAMPLE, { signingTime: SIGNING_TIME, ...options })
}

/** Apre un PDF con pdf.js e riporta cio che ne esce davvero. */
async function openWithPdfJs(data) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl: STANDARD_FONTS,
    isEvalSupported: false,
    verbosity: 0,
  })
  const doc = await task.promise
  const page = await doc.getPage(1)
  const text = (await page.getTextContent()).items.map((i) => i.str).join(' ')
  const annotations = await page.getAnnotations()
  const result = { numPages: doc.numPages, text, annotations }
  await task.destroy()
  return result
}

// ---------------------------------------------------------------------------
// L'invariante che regge tutto il resto
// ---------------------------------------------------------------------------

test('addPlaceholder e un append puro: il campione resta intatto byte per byte', () => {
  const { pdfWithHole } = placeholder()

  assert.ok(pdfWithHole.length > SAMPLE.length, 'il file deve crescere')
  for (let i = 0; i < SAMPLE.length; i++) {
    assert.equal(
      pdfWithHole[i],
      SAMPLE[i],
      `il byte ${i} e cambiato: qualcuno ha reintrodotto una riscrittura del PDF (pdf-lib?) al ` +
        "posto dell'incremental update appeso a mano",
    )
  }
})

test('gli offset congelati continuano a valere sul PDF con il placeholder', () => {
  const { pdfWithHole } = placeholder()
  assert.equal(pdfWithHole[offsets.amount.digitOffset], 0x31, 'la cifra 1 non e piu al suo posto')
  assert.equal(
    fromAscii(pdfWithHole.subarray(offsets.amount.wordsStart, offsets.amount.wordsEnd)),
    offsets.amount.words,
  )
})

test('il file resta ASCII puro: il dump non si buca', () => {
  const { pdfWithHole } = placeholder()
  const fuoriAscii = [...pdfWithHole].filter((b) => b > 0x7f).length
  assert.equal(fuoriAscii, 0)
})

// ---------------------------------------------------------------------------
// L'aggiornamento appeso
// ---------------------------------------------------------------------------

test("l'incremental update contiene tutto cio che rende la firma riconoscibile", () => {
  const { pdfWithHole } = placeholder()
  const appeso = fromAscii(pdfWithHole.subarray(SAMPLE.length))

  for (const atteso of [
    '/Type /Sig',
    '/Filter /Adobe.PPKLite',
    '/SubFilter /ETSI.CAdES.detached', // e questo che la rende PAdES e non Adobe legacy
    '/ByteRange [',
    '/Contents <',
    '/M (D:',
    '/FT /Sig',
    '/Type /Annot',
    '/Subtype /Widget',
    '/Rect [0 0 0 0]',
    '/AcroForm',
    '/SigFlags 3',
    '/Annots [',
    '/Prev 1026',
    '/Root 1 0 R',
    'startxref',
    '%%EOF',
  ]) {
    assert.ok(appeso.includes(atteso), `manca ${atteso} nell'aggiornamento appeso`)
  }

  // /ID identico a prima: e lo stesso documento, non un altro.
  assert.ok(appeso.includes('/ID [<0A1B2C3D4E5F60718293A4B5C6D7E8F9><0A1B2C3D4E5F60718293A4B5C6D7E8F9>]'))
  // Due %%EOF: quello del campione e quello dell'aggiornamento. E la firma di un incremental update.
  assert.equal(indexesOf(pdfWithHole, '%%EOF').length, 2)
})

test('la nuova xref punta davvero agli oggetti che dichiara', () => {
  const { pdfWithHole } = placeholder()
  const testo = fromAscii(pdfWithHole)
  const tabella = testo.lastIndexOf('\nxref\n') + 1 // non "startxref": la tabella vera

  const sezione = testo.slice(tabella, testo.indexOf('trailer', tabella))
  const righe = sezione.split('\n')
  let attesi = 0
  let corrente = null
  for (const riga of righe) {
    const header = /^(\d+) (\d+)$/.exec(riga)
    if (header) {
      corrente = Number(header[1])
      attesi += Number(header[2])
      continue
    }
    const voce = /^(\d{10}) (\d{5}) n $/.exec(riga)
    if (!voce) continue
    const offset = Number(voce[1])
    assert.ok(
      testo.startsWith(`${corrente} 0 obj`, offset),
      `la voce xref dell'oggetto ${corrente} dichiara ${offset}, dove non comincia "${corrente} 0 obj"`,
    )
    corrente++
  }
  assert.equal(attesi, 4, 'l aggiornamento riscrive catalogo e pagina e aggiunge firma e campo')
})

test("il buco del /Contents e grande quanto il padding chiesto, ne piu ne meno", () => {
  for (const padding of [512, 4096]) {
    const { pdfWithHole, contentsStart } = placeholder({ padding })
    assert.equal(pdfWithHole[contentsStart], '<'.charCodeAt(0))
    const chiusura = fromAscii(pdfWithHole).indexOf('>', contentsStart)
    assert.equal(chiusura - contentsStart - 1, padding * 2, 'due caratteri esadecimali per byte')
  }
})

test('il /ByteRange copre tutto il file tranne il buco', () => {
  const { pdfWithHole, byteRange, contentsStart } = placeholder()
  const [a, b, c, d] = byteRange

  assert.equal(a, 0)
  assert.equal(b, contentsStart, 'il primo intervallo finisce dove comincia il buco')
  assert.equal(c, contentsStart + 4096 * 2 + 2, 'il secondo comincia dopo il buco, parentesi comprese')
  assert.equal(c + d, pdfWithHole.length, 'il secondo intervallo arriva alla fine del file')
  assert.equal(b + d, pdfWithHole.length - (4096 * 2 + 2), 'firmato tutto tranne il buco')
})

test('due chiamate con la stessa data producono gli stessi byte', () => {
  assert.deepEqual(placeholder().pdfWithHole, placeholder().pdfWithHole)
})

test('addPlaceholder si rifiuta di firmare due volte lo stesso documento', () => {
  const { pdfWithHole } = placeholder()
  assert.throws(() => addPlaceholder(pdfWithHole, { signingTime: SIGNING_TIME }), /AcroForm/)
})

// ---------------------------------------------------------------------------
// L'impronta
// ---------------------------------------------------------------------------

test('digestCovered e lo SHA-256 dei due intervalli, e di nient altro', async () => {
  const { pdfWithHole, byteRange } = placeholder()
  const [a, b, c, d] = byteRange

  // Verifica incrociata con un'altra implementazione di SHA-256 (quella di node).
  const atteso = createHash('sha256')
    .update(Buffer.from(pdfWithHole.subarray(a, a + b)))
    .update(Buffer.from(pdfWithHole.subarray(c, c + d)))
    .digest('hex')

  assert.equal(toHex(await digestCovered(pdfWithHole, byteRange)), atteso)
})

test('scrivere nel buco non cambia l impronta: e tutto il senso del buco', async () => {
  const { pdfWithHole, byteRange, contentsStart } = placeholder()
  const prima = await digestCovered(pdfWithHole, byteRange)
  const firmato = injectSignature(pdfWithHole, contentsStart, fakeCms())
  const dopo = await digestCovered(firmato, byteRange)
  assert.deepEqual(prima, dopo)
})

test('un /ByteRange incoerente viene rifiutato invece che calcolato a vuoto', async () => {
  const { pdfWithHole, byteRange } = placeholder()
  await assert.rejects(() => digestCovered(pdfWithHole, [0, 10]), /quattro numeri/)
  await assert.rejects(() => digestCovered(pdfWithHole, [0, 10, 5, 10]), /incoerente/)
  await assert.rejects(
    () => digestCovered(pdfWithHole, [0, 10, 20, pdfWithHole.length]),
    /fuori dal file/,
  )
})

// ---------------------------------------------------------------------------
// L'iniezione
// ---------------------------------------------------------------------------

test('injectSignature scrive la firma e non sposta un byte', () => {
  const { pdfWithHole, contentsStart } = placeholder()
  const cms = fakeCms(1400)
  const firmato = injectSignature(pdfWithHole, contentsStart, cms)

  assert.equal(firmato.length, pdfWithHole.length, 'la lunghezza del file non deve cambiare')
  assert.notEqual(firmato, pdfWithHole)
  assert.deepEqual(pdfWithHole, placeholder().pdfWithHole, "l'originale non va modificato sul posto")

  const scritto = fromAscii(firmato.subarray(contentsStart + 1, contentsStart + 1 + cms.length * 2))
  assert.equal(scritto, toHex(cms))

  // il resto del buco e riempito di zeri, fino alla parentesi di chiusura
  const chiusura = fromAscii(firmato).indexOf('>', contentsStart)
  const coda = fromAscii(firmato.subarray(contentsStart + 1 + cms.length * 2, chiusura))
  assert.match(coda, /^0*$/)
  assert.equal(coda.length, (4096 - cms.length) * 2)

  // fuori dal buco non e cambiato niente
  assert.deepEqual(firmato.subarray(0, contentsStart), pdfWithHole.subarray(0, contentsStart))
  assert.deepEqual(firmato.subarray(chiusura), pdfWithHole.subarray(chiusura))
})

test('un CMS piu grande del buco fa fallire la firma, non la tronca', () => {
  const { pdfWithHole, contentsStart } = placeholder({ padding: 512 })
  assert.throws(
    () => injectSignature(pdfWithHole, contentsStart, fakeCms(513)),
    /padding piu grande/,
    'una firma troncata verificherebbe come falsa e la causa vera sarebbe introvabile',
  )
  // al limite esatto invece ci sta
  assert.doesNotThrow(() => injectSignature(pdfWithHole, contentsStart, fakeCms(512)))
})

test('injectSignature rifiuta un contentsStart che non indica il buco', () => {
  const { pdfWithHole, contentsStart } = placeholder()
  assert.throws(() => injectSignature(pdfWithHole, 0, fakeCms(10)), /parentesi angolare/)
  assert.throws(() => injectSignature(pdfWithHole, 10 ** 9, fakeCms(10)), /fuori dal file/)

  const gia = injectSignature(pdfWithHole, contentsStart, fakeCms(200))
  const dizionario = fromAscii(gia).indexOf('<< /Type /Sig')
  assert.throws(() => injectSignature(gia, dizionario, fakeCms(10)), /non esadecimale/)
})

// ---------------------------------------------------------------------------
// Il renderer vero, in ogni stato
// ---------------------------------------------------------------------------

test('pdf.js apre e renderizza il documento in tutti e tre gli stati', async () => {
  const { pdfWithHole, contentsStart } = placeholder()
  const firmato = injectSignature(pdfWithHole, contentsStart, fakeCms())

  for (const [stato, byte] of [
    ['campione', SAMPLE],
    ['con placeholder', pdfWithHole],
    ['firmato', firmato],
  ]) {
    const reso = await openWithPdfJs(byte)
    assert.equal(reso.numPages, 1, `${stato}: pagine`)
    assert.ok(reso.text.includes('PROMESSA DI PAGAMENTO'), `${stato}: titolo`)
    assert.ok(reso.text.includes('1.000 euro (mille euro)'), `${stato}: importo`)
    assert.ok(
      reso.text.includes('Documento dimostrativo, privo di valore legale.'),
      `${stato}: la marcatura obbligatoria deve restare visibile`,
    )
  }
})

test('pdf.js vede il campo di firma sulla pagina', async () => {
  const { pdfWithHole, contentsStart } = placeholder()
  const firmato = injectSignature(pdfWithHole, contentsStart, fakeCms())
  const reso = await openWithPdfJs(firmato)

  assert.equal(reso.annotations.length, 1)
  assert.equal(reso.annotations[0].fieldType, 'Sig')
  assert.equal(reso.annotations[0].fieldName, 'Firma1')
})
