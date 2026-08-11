/**
 * Collaudo avversariale — lente 1: «la firma e reale?»
 *
 * Questo script fa girare la catena VERA (keys -> certificate -> pades -> cms -> pades) e
 * deposita su disco un PDF firmato piu i pezzi che serviranno agli strumenti terzi.
 *
 * Regola del collaudo: cio che finisce su disco viene riestratto DAL PDF, non riusato dalle
 * variabili in memoria. Se il PDF non contiene davvero il CMS, qui si deve rompere.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateKeyPair } from '../../../src/core/keys.js'
import { buildSelfSigned } from '../../../src/core/certificate.js'
import { buildSignedData } from '../../../src/core/cms.js'
import { addPlaceholder, digestCovered, injectSignature } from '../../../src/core/pades.js'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'out')
const SAMPLE = join(here, '../../../src/assets/sample.pdf')

mkdirSync(OUT, { recursive: true })

const sample = new Uint8Array(readFileSync(SAMPLE))

// --- la catena, esattamente come la userebbe la pagina -----------------------------------
const { privateKey, publicKey } = await generateKeyPair()
const signingTime = new Date('2026-08-10T12:00:00Z')
const { certDer, serial, notBefore, notAfter } = await buildSelfSigned({
  publicKey,
  privateKey,
  subjectCN: 'Lorenzo Rossi (demo, non valido legalmente)',
  now: signingTime,
})
const { pdfWithHole, byteRange, contentsStart } = addPlaceholder(sample, { padding: 4096, signingTime })
const messageDigest = await digestCovered(pdfWithHole, byteRange)
const { cmsDer, signedAttrsDer, signature } = await buildSignedData({
  messageDigest,
  certDer,
  privateKey,
  signingTime,
})
const signedPdf = injectSignature(pdfWithHole, contentsStart, cmsDer)

writeFileSync(join(OUT, 'firmato.pdf'), signedPdf)
writeFileSync(join(OUT, 'cert-dalla-catena.der'), certDer)
writeFileSync(join(OUT, 'cms-dalla-catena.der'), cmsDer)
writeFileSync(join(OUT, 'signedattrs-dalla-catena.der'), signedAttrsDer)
writeFileSync(join(OUT, 'signature-dalla-catena.bin'), signature)

// --- da qui in poi si legge SOLO il file su disco, con un parser scritto qui --------------
// Nessun import da src/core/: se il nostro codice mentisse sugli offset, questa parte lo
// scoprirebbe invece di ereditarne l'errore.
const pdf = new Uint8Array(readFileSync(join(OUT, 'firmato.pdf')))
const text = Buffer.from(pdf).toString('latin1')

const brMatch = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text)
if (!brMatch) throw new Error('COLLAUDO: nel PDF non c e nessun /ByteRange')
const br = brMatch.slice(1, 5).map(Number)

const subFilter = /\/SubFilter\s*\/([A-Za-z0-9.\-_]+)/.exec(text)
const filter = /\/Filter\s*\/([A-Za-z0-9.\-_]+)/.exec(text)

// /Contents: la stringa esadecimale fra parentesi angolari.
const contentsAt = text.indexOf('/Contents <')
if (contentsAt === -1) throw new Error('COLLAUDO: nel PDF non c e nessun /Contents <...>')
const open = text.indexOf('<', contentsAt)
const close = text.indexOf('>', open)
const hex = text.slice(open + 1, close)
if (!/^[0-9a-fA-F]*$/.test(hex)) throw new Error('COLLAUDO: il /Contents non e esadecimale puro')
if (hex.length % 2 !== 0) throw new Error('COLLAUDO: cifre esadecimali in numero dispari')
const contentsBytes = Buffer.from(hex, 'hex')

// Gli zeri di riempimento non si tolgono «a occhio»: si legge la lunghezza dichiarata dal DER
// e si prende esattamente quella. Togliere gli 0x00 finali romperebbe un DER che finisce per 0.
function derTotalLength(buf) {
  if (buf.length < 2) throw new Error('COLLAUDO: /Contents troppo corto per essere DER')
  const first = buf[1]
  if (first < 0x80) return 2 + first
  const n = first & 0x7f
  if (n === 0 || n > 4) throw new Error('COLLAUDO: lunghezza DER indefinita o assurda')
  let len = 0
  for (let i = 0; i < n; i++) len = len * 256 + buf[2 + i]
  return 2 + n + len
}
const derLen = derTotalLength(contentsBytes)
const cmsFromPdf = contentsBytes.subarray(0, derLen)
const padding = contentsBytes.subarray(derLen)

writeFileSync(join(OUT, 'cms-dal-pdf.der'), cmsFromPdf)

// I byte coperti, ricostruiti dal /ByteRange letto nel file.
const covered = Buffer.concat([
  Buffer.from(pdf.subarray(br[0], br[0] + br[1])),
  Buffer.from(pdf.subarray(br[2], br[2] + br[3])),
])
writeFileSync(join(OUT, 'covered.bin'), covered)

const report = {
  fileLength: pdf.length,
  sampleLength: sample.length,
  prefissoIdenticoAlCampione: Buffer.from(pdf.subarray(0, sample.length)).equals(Buffer.from(sample)),
  byteRangeNelFile: br,
  byteRangeDallaCatena: byteRange,
  copertura: {
    primoIntervallo: [br[0], br[0] + br[1]],
    buco: [br[0] + br[1], br[2]],
    secondoIntervallo: [br[2], br[2] + br[3]],
    coperturaTotale: br[0] + br[1] + br[3],
    codaScoperta: pdf.length - (br[2] + br[3]),
  },
  contentsStart,
  bucoIniziaCon: text.slice(br[0] + br[1], br[0] + br[1] + 1),
  bucoFinisceCon: text.slice(br[2] - 1, br[2]),
  filter: filter && filter[1],
  subFilter: subFilter && subFilter[1],
  hexChars: hex.length,
  cmsBytes: cmsFromPdf.length,
  padByteNonNulli: padding.reduce((n, b) => n + (b === 0 ? 0 : 1), 0),
  cmsDalPdfUgualeAQuelloDellaCatena: cmsFromPdf.equals(Buffer.from(cmsDer)),
  coveredBytes: covered.length,
  cert: { serial, notBefore: notBefore.toISOString(), notAfter: notAfter.toISOString() },
  signingTime: signingTime.toISOString(),
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
