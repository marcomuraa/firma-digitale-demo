/**
 * Collaudo avversariale — «quanto costa contare le firme?».
 *
 * verify() valuta OGNI dizionario di firma che trova, per intero: ricalcola SHA-256 sui byte
 * coperti, riparsa il CMS, importa la chiave e verifica la firma RSA. Il verdetto complessivo e il
 * peggiore, quindi non c'e scorciatoia: le guarda tutte. Se il conteggio e gonfiabile all'infinito
 * (vedi f01 della raffica), allora il TEMPO lo e altrettanto — e una pagina che si pianta mentre
 * «verifica 1000 firme» e una negazione del servizio costruita apposta.
 *
 * Qui misuro due curve, con performance.now():
 *   1. N firme complete (ognuna copia byteRange e CMS veri): costo per firma ~costante -> lineare.
 *      La domanda del prompt: «dieci firme vere, quanto ci mette?». La estendo fino a far male.
 *   2. M intestazioni `N 0 obj … /ByteRange …` SENZA `endobj`: per ognuna verify cerca `endobj`
 *      scandendo fino alla fine del file. Se il file cresce con M, la scansione e O(M^2): un costo
 *      quadratico che esplode con un file piccolo e cattivo.
 *
 *   node scripts/collaudo/fantasmi/dos.mjs
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { verify } from '../../../src/core/verify.js'
import { firmaIlCampione } from '../copertura/comune.mjs'
import { OUT, ascii, concat, toHex, salvaMio, oggettoFantasma } from './comune-fantasmi.mjs'

const base = await firmaIlCampione()
const { signed, byteRange, cmsDer } = base
const cmsHex = toHex(cmsDer)

/** Mediana di `ripetizioni` misure di verify() su questi byte, in millisecondi. */
async function tempoVerify(bytes, ripetizioni = 5) {
  const misure = []
  for (let i = 0; i < ripetizioni; i++) {
    const t0 = performance.now()
    await verify(bytes)
    misure.push(performance.now() - t0)
  }
  misure.sort((a, b) => a - b)
  return misure[Math.floor(misure.length / 2)]
}

// ---------------------------------------------------------------------------------------
// Curva 1: N firme complete appese. Ognuna scatena SHA-256 + parse ASN.1 + verifica RSA.
// ---------------------------------------------------------------------------------------
function raffica(n) {
  let coda = '\n'
  for (let i = 0; i < n; i++) coda += oggettoFantasma(1000 + i, byteRange, cmsHex)
  return concat(signed, ascii(coda))
}

console.log('CURVA 1 — N firme complete (SHA + ASN.1 + RSA per ognuna)')
console.log('   N     firme   ms        ms/firma   verdetto')
const curva1 = []
for (const n of [0, 1, 5, 10, 25, 50, 100, 200]) {
  const bytes = raffica(n)
  const r = await verify(bytes)
  const ms = await tempoVerify(bytes)
  const perFirma = r.signatures.length ? ms / r.signatures.length : ms
  curva1.push({ n, firme: r.signatures.length, ms: +ms.toFixed(1), msPerFirma: +perFirma.toFixed(2), verdetto: r.verdict })
  console.log(
    `   ${String(n).padStart(4)}  ${String(r.signatures.length).padStart(5)}  ${ms.toFixed(1).padStart(8)}  ` +
      `${perFirma.toFixed(2).padStart(8)}   ${r.verdict}`,
  )
}
// Il file piu pesante lo deposito, cosi il rilievo ha la prova su disco.
salvaMio('dos-200-firme-complete.pdf', raffica(200))

// ---------------------------------------------------------------------------------------
// Curva 2: M intestazioni di oggetto SENZA endobj. Ogni intestazione costringe verify a cercare
// `endobj` (che non c'e) fino a fine file. Il file cresce con M -> scansione quadratica.
// ---------------------------------------------------------------------------------------
function senzaEndobj(m) {
  // niente 'endobj' da nessuna parte: ogni `N 0 obj` fa scandire fino in fondo
  let corpo = '\n'
  for (let i = 0; i < m; i++) corpo += `${2000 + i} 0 obj\n<< /Type /Sig /ByteRange [0 0 0 0] /Contents <aa> >>\n`
  return concat(signed, ascii(corpo))
}

console.log('\nCURVA 2 — M intestazioni "N 0 obj" SENZA endobj (scansione fino a EOF)')
console.log('   M      byte      ms        ms/M^2*1e6   verdetto')
const curva2 = []
for (const m of [100, 200, 400, 800, 1600, 3200, 6400]) {
  const bytes = senzaEndobj(m)
  const r = await verify(bytes)
  const ms = await tempoVerify(bytes, 3)
  const quadratico = (ms / (m * m)) * 1e6 // se e ~costante al crescere di M, il costo e O(M^2)
  curva2.push({ m, byte: bytes.length, ms: +ms.toFixed(1), indiceQuadratico: +quadratico.toFixed(3), verdetto: r.verdict })
  console.log(
    `   ${String(m).padStart(5)}  ${String(bytes.length).padStart(8)}  ${ms.toFixed(1).padStart(8)}  ` +
      `${quadratico.toFixed(3).padStart(10)}   ${r.verdict}`,
  )
}
salvaMio('dos-3200-obj-senza-endobj.pdf', senzaEndobj(3200))

writeFileSync(join(OUT, 'dos.json'), JSON.stringify({ curva1, curva2 }, null, 2))
console.log('\nrapporto:', join(OUT, 'dos.json'))
console.log('Lettura: se in CURVA 1 «ms/firma» e ~costante il costo e LINEARE nel numero di firme;')
console.log('se in CURVA 2 «ms/M^2*1e6» e ~costante il costo e QUADRATICO nella dimensione del file.')
