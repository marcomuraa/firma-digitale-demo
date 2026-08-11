/**
 * Prove dei tre attacchi.
 *
 * Regola di scrittura di questo file: si registra cio che SUCCEDE, non cio che dovrebbe.
 * Il piano prevedeva che dopo l'attacco 1b pdf.js si rifiutasse di aprire il documento; e falso,
 * misurato, e qui sotto c'e una prova che lo mette nero su bianco invece di nasconderlo. Se un
 * giorno pdf.js diventasse severo, quella prova fallirebbe e ce ne accorgeremmo — che e
 * esattamente il servizio che una prova deve rendere.
 *
 * Le due domande che contano, e a cui rispondono le prove qui sotto:
 *  - l'attacco 1 colpisce davvero byte COPERTI dal /ByteRange? (se no, staremmo simulando)
 *  - l'attacco 2 lascia davvero intatti i byte firmati? (se no, non dimostrerebbe niente)
 *
 * Si esegue con:  node --test src/core/attacks.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { addPlaceholder, digestCovered, injectSignature } from './pades.js'
import { appendIncrementalUpdate, streamLengthReport, tamperDigit, tamperWords, xrefReport } from './attacks.js'
import { fromAscii, toHex } from './bytes.js'
import offsets from '../assets/sample-offsets.json' with { type: 'json' }

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SAMPLE = new Uint8Array(readFileSync(path.join(ROOT, 'src', 'assets', 'sample.pdf')))
const STANDARD_FONTS = pathToFileURL(
  path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep,
).href

const SIGNING_TIME = new Date(Date.UTC(2026, 7, 10, 12, 0, 0))

/** Il documento firmato di partenza. Il CMS e finto: questi attacchi non lo guardano. */
function firmato() {
  const { pdfWithHole, byteRange, contentsStart } = addPlaceholder(SAMPLE, { signingTime: SIGNING_TIME })
  const cms = new Uint8Array(1400).map((_, i) => (i * 37 + 11) & 0xff)
  return { bytes: injectSignature(pdfWithHole, contentsStart, cms), byteRange }
}

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
  const disegni = await page.getOperatorList()
  const result = { numPages: doc.numPages, text, operatori: disegni.fnArray.length }
  await task.destroy()
  return result
}

// ---------------------------------------------------------------------------
// 1a — Falsifica la cifra
// ---------------------------------------------------------------------------

test('tamperDigit cambia un byte solo, e lo cambia dove dice', () => {
  const { bytes: pdf } = firmato()
  const attacco = tamperDigit(pdf)

  assert.equal(attacco.offset, offsets.amount.digitOffset)
  assert.equal(attacco.from, '1')
  assert.equal(attacco.to, '9')
  assert.equal(attacco.bytes.length, pdf.length, 'la lunghezza non deve cambiare')

  const diversi = [...attacco.bytes].reduce((n, b, i) => (b === pdf[i] ? n : n + 1), 0)
  assert.equal(diversi, 1)
  assert.equal(attacco.bytes[attacco.offset], '9'.charCodeAt(0))
  assert.equal(
    fromAscii(attacco.bytes.subarray(offsets.amount.lineStart, offsets.amount.lineEnd)),
    '(9.000 euro (mille euro)) Tj',
    'la difesa antica: cifre e lettere non concordano piu',
  )
})

test("l'attacco 1a cade DENTRO la zona coperta dalla firma", async () => {
  const { bytes: pdf, byteRange } = firmato()
  const [a, b, c, d] = byteRange
  const attacco = tamperDigit(pdf)

  const dentroPrimoIntervallo = attacco.offset >= a && attacco.offset < a + b
  const dentroSecondo = attacco.offset >= c && attacco.offset < c + d
  assert.ok(
    dentroPrimoIntervallo || dentroSecondo,
    'se il byte colpito non fosse firmato, staremmo simulando il fallimento invece di provocarlo',
  )

  const prima = toHex(await digestCovered(pdf, byteRange))
  const dopo = toHex(await digestCovered(attacco.bytes, byteRange))
  assert.notEqual(dopo, prima, "l'impronta deve accorgersi da sola della manomissione")
})

test('tamperDigit si rifiuta di lavorare su un file che non e il campione', () => {
  const { bytes: pdf } = firmato()
  assert.throws(() => tamperDigit(tamperDigit(pdf).bytes), /doveva esserci la cifra "1"/)
  assert.throws(() => tamperDigit(SAMPLE.subarray(0, 100)), /fuori da questo file/)
})

test('dopo l attacco 1a il documento si apre e si legge ancora: e il punto', async () => {
  const { bytes: pdf } = firmato()
  const reso = await openWithPdfJs(tamperDigit(pdf).bytes)
  assert.equal(reso.numPages, 1)
  assert.ok(reso.text.includes('9.000 euro (mille euro)'))
})

// ---------------------------------------------------------------------------
// 1b — Falsifica anche le lettere
// ---------------------------------------------------------------------------

test('tamperWords allunga il file di tre byte e scrive "novemila"', () => {
  const { bytes: pdf } = firmato()
  const attacco = tamperWords(pdf)

  assert.equal(attacco.offset, offsets.amount.wordsStart)
  assert.equal(attacco.deltaLength, 3)
  assert.equal(attacco.bytes.length, pdf.length + 3)
  assert.equal(
    fromAscii(attacco.bytes.subarray(offsets.amount.lineStart, offsets.amount.lineEnd + 3)),
    '(1.000 euro (novemila euro)) Tj',
  )
  // fino al punto di modifica il file e ancora quello di prima
  assert.deepEqual(attacco.bytes.subarray(0, attacco.offset), pdf.subarray(0, attacco.offset))
})

test('brokenLength e brokenXref sono misurati sui byte, non dichiarati', () => {
  const { bytes: pdf } = firmato()

  // sul documento intatto le stesse misure devono dire "tutto a posto":
  // se dicessero sempre "rotto", non starebbero misurando niente.
  assert.equal(streamLengthReport(pdf).broken, false)
  assert.equal(xrefReport(pdf).broken, false)

  const attacco = tamperWords(pdf)
  assert.equal(attacco.brokenLength, true)
  assert.equal(attacco.brokenXref, true)

  assert.equal(attacco.evidence.length.declared, offsets.contentStream.declaredLength) // 650
  assert.equal(attacco.evidence.length.actual, offsets.contentStream.declaredLength + 3) // 653
  assert.equal(attacco.evidence.length.valueStart, offsets.contentStream.lengthValueStart)
  assert.equal(attacco.evidence.length.valueEnd, offsets.contentStream.lengthValueEnd)

  const voci = attacco.evidence.xref.filter((p) => p.id === 'entry')
  assert.ok(voci.length > 0, 'almeno una voce xref deve puntare a vuoto')
  for (const voce of voci) {
    assert.equal(voce.actualOffset, voce.declaredOffset + 3, 'gli oggetti a valle sono scivolati di tre byte')
  }
  assert.ok(
    attacco.evidence.xref.some((p) => p.id === 'startxref'),
    'anche startxref indica un punto in cui la tabella non c e piu',
  )
})

test('sul campione non firmato 1b riproduce esattamente le previsioni congelate', () => {
  const attacco = tamperWords(SAMPLE)
  const atteso = offsets.attacks.tamperWords

  assert.equal(attacco.deltaLength, atteso.deltaLength)
  assert.equal(attacco.evidence.length.declared, 650)
  assert.equal(attacco.evidence.length.actual, 653)

  const voci = attacco.evidence.xref.filter((p) => p.id === 'entry')
  assert.deepEqual(
    voci.map((v) => v.num),
    atteso.evidence.find((e) => e.id === 'xref').brokenObjects, // [5]
    'solo l oggetto 5 sta dopo il punto di modifica',
  )
  assert.equal(voci[0].declaredOffset, 954)
  assert.equal(voci[0].actualOffset, 957)
})

test('MISURATO: dopo 1b pdf.js apre lo stesso e mostra "novemila"', async () => {
  const { bytes: pdf } = firmato()
  const reso = await openWithPdfJs(tamperWords(pdf).bytes)

  // Il piano prevedeva un rifiuto del renderer. Non arriva: pdf.js ricostruisce l'xref
  // scandendo il file, ignora il /Length sbagliato e disegna la pagina.
  assert.equal(reso.numPages, 1)
  assert.ok(reso.text.includes('1.000 euro (novemila euro)'))
  assert.ok(reso.operatori > 0, 'la pagina viene davvero disegnata, firma autografa compresa')
})

test('tamperWords si rifiuta di lavorare su un file gia manomesso', () => {
  const { bytes: pdf } = firmato()
  assert.throws(() => tamperWords(tamperWords(pdf).bytes), /doveva esserci "mille"/)
})

// ---------------------------------------------------------------------------
// 2 — Modifica dopo la firma
// ---------------------------------------------------------------------------

test('appendIncrementalUpdate non tocca un byte di quelli firmati', () => {
  const { bytes: pdf } = firmato()
  const attacco = appendIncrementalUpdate(pdf, { newText: '1.000.000 euro (un milione di euro)' })

  assert.equal(attacco.appendedFrom, pdf.length)
  assert.ok(attacco.bytes.length > pdf.length)
  assert.deepEqual(attacco.bytes.subarray(0, pdf.length), pdf, 'il documento firmato resta identico')
  assert.equal([...attacco.bytes].filter((b) => b > 0x7f).length, 0, 'la coda resta ASCII')
})

test('la firma resta valida e la copertura no: e il verdetto a tre stati', async () => {
  const { bytes: pdf, byteRange } = firmato()
  const attacco = appendIncrementalUpdate(pdf, { newText: '1.000.000 euro (un milione di euro)' })

  const prima = toHex(await digestCovered(pdf, byteRange))
  const dopo = toHex(await digestCovered(attacco.bytes, byteRange))
  assert.equal(dopo, prima, 'i byte coperti non sono cambiati, quindi la firma verifica ancora')

  const coperti = byteRange[2] + byteRange[3]
  assert.equal(coperti, pdf.length)
  assert.ok(coperti < attacco.bytes.length, 'ma il file adesso continua oltre la fine del /ByteRange')
  assert.equal(attacco.bytes.length - coperti, attacco.bytes.length - attacco.appendedFrom)
})

test("la coda appesa e un incremental update valido, non spazzatura", () => {
  const { bytes: pdf } = firmato()
  const attacco = appendIncrementalUpdate(pdf, { newText: '1.000.000 euro (un milione di euro)' })
  const coda = fromAscii(attacco.bytes.subarray(attacco.appendedFrom))

  assert.ok(coda.includes('4 0 obj'), 'riscrive il content stream della pagina')
  assert.ok(/\/Prev \d+/.test(coda), 'il trailer incatena la xref precedente')
  assert.ok(coda.includes('/Root 1 0 R'))
  assert.ok(coda.trimEnd().endsWith('%%EOF'))

  // e soprattutto: la struttura del file risultante regge alla stessa perizia degli attacchi 1
  assert.equal(streamLengthReport(attacco.bytes).broken, false, '/Length coerente con i byte veri')
  assert.equal(xrefReport(attacco.bytes).broken, false, 'ogni voce xref punta al suo oggetto')
})

test('MISURATO: pdf.js ridisegna il documento con il testo nuovo', async () => {
  const { bytes: pdf } = firmato()
  const attacco = appendIncrementalUpdate(pdf, { newText: '1.000.000 euro (un milione di euro)' })
  const reso = await openWithPdfJs(attacco.bytes)

  assert.equal(reso.numPages, 1)
  assert.ok(reso.text.includes('1.000.000 euro (un milione di euro)'), 'il nuovo importo si vede')
  assert.ok(!reso.text.includes('1.000 euro (mille euro)'), 'il vecchio importo non si vede piu')
  assert.ok(
    reso.text.includes('Documento dimostrativo, privo di valore legale.'),
    'il resto della pagina resta al suo posto: e la stessa pagina, con una riga diversa',
  )
})

test('newText finisce nel documento cosi come e stato scritto', async () => {
  const { bytes: pdf } = firmato()
  // parentesi sbilanciate: vanno protette, altrimenti romperebbero la sintassi del PDF
  const attacco = appendIncrementalUpdate(pdf, { newText: 'importo :-) senza chiusura (' })
  const reso = await openWithPdfJs(attacco.bytes)
  assert.ok(reso.text.includes('importo :-) senza chiusura ('))
  assert.equal(xrefReport(attacco.bytes).broken, false)
})

test('appendIncrementalUpdate rifiuta un newText vuoto', () => {
  const { bytes: pdf } = firmato()
  assert.throws(() => appendIncrementalUpdate(pdf, { newText: '' }), /stringa non vuota/)
})
