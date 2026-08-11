/**
 * Collaudo avversariale — «l attacco 1 e onesto?»
 *
 * Sospetto da verificare: che `tamperDigit` non modifichi davvero un byte coperto dal /ByteRange,
 * o che il fallimento nasca da un controllo scorciatoia (per esempio un confronto con una copia
 * tenuta da parte, o un riconoscimento del byte 0x39) invece che dall impronta ricalcolata.
 *
 * Sei prove, tutte sui byte:
 *
 *   1. l offset colpito cade dentro il primo intervallo del /ByteRange letto DAL FILE
 *   2. il byte cambia davvero, e cambia solo quello
 *   3. l impronta ricalcolata da verify coincide con quella calcolata qui da zero (node:crypto)
 *      e con quella calcolata da openssl: tre implementazioni indipendenti, stesso valore
 *   4. sul file manomesso la FIRMA RSA continua a verificare: cade solo il confronto fra impronte
 *   5. controprova: un byte cambiato nella zona NON firmata lascia il verdetto "valid"
 *      (quindi non c e nessun confronto con una copia dell originale)
 *   6. controprova: rifirmando il documento manomesso con la stessa chiave il verdetto torna
 *      "valid" (quindi non e la cifra 9 a essere riconosciuta, e l impronta che non tornava)
 *
 *   node scripts/collaudo/copertura/onesta-attacco-1.mjs
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { verify } from '../../../src/core/verify.js'
import { tamperDigit } from '../../../src/core/attacks.js'
import { buildSignedData } from '../../../src/core/cms.js'
import { digestCovered, injectSignature } from '../../../src/core/pades.js'
import offsets from '../../../src/assets/sample-offsets.json' with { type: 'json' }
import { OUT, TEMPO, firmaIlCampione, indexOf, salva, sovrascrivi, testo, toHex } from './comune.mjs'

const esiti = []
const dico = (ok, titolo, prova) => {
  esiti.push({ ok, titolo, prova })
  console.log(`${ok ? 'OK  ' : 'NO  '} ${titolo}\n      ${prova}`)
}

const base = await firmaIlCampione()
const { signed, contentsStart, contentsEnd, certDer, privateKey } = base

// Il /ByteRange si rilegge dal file, non si riusa quello della catena.
const brAt = indexOf(signed, '/ByteRange')
const br = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/
  .exec(testo(signed, brAt, brAt + 160))
  .slice(1, 5)
  .map(Number)
const [a, b, c, d] = br

// --- 1. l offset colpito e dentro la zona firmata ---------------------------------------
const off = offsets.amount.digitOffset
dico(
  off >= a && off < a + b,
  'tamperDigit colpisce un byte DENTRO il primo intervallo del /ByteRange',
  `offset ${off}; primo intervallo [${a}, ${a + b}); secondo [${c}, ${c + d}); buco non firmato [${contentsStart}, ${contentsEnd}]`,
)

// --- 2. cambia davvero un byte, e uno solo ----------------------------------------------
const t = tamperDigit(signed)
const manomesso = t.bytes
const diversi = []
for (let i = 0; i < Math.max(signed.length, manomesso.length); i++) {
  if (signed[i] !== manomesso[i]) diversi.push(i)
}
dico(
  diversi.length === 1 && diversi[0] === off && signed[off] === 0x31 && manomesso[off] === 0x39,
  'un byte solo cambia, ed e quello dichiarato',
  `byte diversi: [${diversi}]; ${off}: 0x${toHex(signed.subarray(off, off + 1))} -> 0x${toHex(manomesso.subarray(off, off + 1))}; ` +
    `contesto "${testo(signed, off - 1, off + 23)}" -> "${testo(manomesso, off - 1, off + 23)}"`,
)

// --- 3. tre implementazioni, la stessa impronta ------------------------------------------
const coperti = (pdf) => {
  const out = new Uint8Array(b + d)
  out.set(pdf.subarray(a, a + b), 0)
  out.set(pdf.subarray(c, c + d), b)
  return out
}
const copertiIntegri = coperti(signed)
const copertiManomessi = coperti(manomesso)
salva('coperti-integri.bin', copertiIntegri)
salva('coperti-manomessi.bin', copertiManomessi)

const nodeIntegri = createHash('sha256').update(copertiIntegri).digest('hex')
const nodeManomessi = createHash('sha256').update(copertiManomessi).digest('hex')
const opensslManomessi = execFileSync('openssl', ['dgst', '-sha256', '-r', join(OUT, 'coperti-manomessi.bin')])
  .toString()
  .split(' ')[0]

const vIntegro = await verify(signed)
const vManomesso = await verify(manomesso)

dico(
  vIntegro.digest.expected === nodeIntegri &&
    vIntegro.digest.actual === nodeIntegri &&
    vManomesso.digest.actual === nodeManomessi &&
    nodeManomessi === opensslManomessi,
  'l impronta di verify e quella di node:crypto e quella di openssl coincidono',
  `firmata (dentro il CMS)     ${vIntegro.digest.expected}\n` +
    `      ricalcolata sul manomesso  ${vManomesso.digest.actual}\n` +
    `      node:crypto sul manomesso  ${nodeManomessi}\n` +
    `      openssl sul manomesso      ${opensslManomessi}`,
)

dico(
  vManomesso.verdict === 'invalid' &&
    vManomesso.digest.match === false &&
    vManomesso.digest.expected === vIntegro.digest.expected,
  'il verdetto invalid nasce dal confronto fra impronte, non da altro',
  `verdetto ${vManomesso.verdict}; expected ${vManomesso.digest.expected.slice(0, 16)}... ; actual ${vManomesso.digest.actual.slice(0, 16)}...`,
)

// --- 4. la firma RSA continua a verificare ----------------------------------------------
dico(
  vManomesso.signature.ok === true && vManomesso.coverage.complete === true,
  'sul file manomesso la firma RSA verifica ancora, e la copertura e ancora totale',
  `signature.ok=${vManomesso.signature.ok}, coverage.complete=${vManomesso.coverage.complete}, ` +
    `uncoveredTail=${vManomesso.coverage.uncoveredTail}: nessun controllo a monte ha scartato il file`,
)

// --- 5. controprova: byte cambiato nella zona NON firmata --------------------------------
const fuoriZona = contentsEnd - 4 // dentro il buco /Contents, quattro caratteri prima della chiusura
const inHole = sovrascrivi(signed, fuoriZona, 'abcd')
const vInHole = await verify(inHole)
salva('controprova-byte-non-firmato.pdf', inHole)
dico(
  vInHole.verdict === 'valid',
  'controprova: quattro byte cambiati nella zona non firmata NON fanno cadere il verdetto',
  `offset ${fuoriZona}..${fuoriZona + 3} (dentro il buco [${contentsStart}, ${contentsEnd}]), verdetto ${vInHole.verdict}: ` +
    'verify non confronta il file con una copia, guarda solo gli intervalli dichiarati',
)

// --- 6. controprova: si rifirma il documento manomesso con la stessa chiave --------------
const messageDigest = await digestCovered(manomesso, br)
const { cmsDer } = await buildSignedData({ messageDigest, certDer, privateKey, signingTime: TEMPO })
const rifirmato = injectSignature(
  sovrascrivi(manomesso, contentsStart + 1, '0'.repeat(contentsEnd - contentsStart - 1)),
  contentsStart,
  cmsDer,
)
const vRifirmato = await verify(rifirmato)
salva('controprova-manomesso-e-rifirmato.pdf', rifirmato)
dico(
  vRifirmato.verdict === 'valid' && rifirmato[off] === 0x39,
  'controprova: lo stesso documento manomesso, rifirmato, torna valid',
  `byte ${off} = 0x${toHex(rifirmato.subarray(off, off + 1))} ("9"), verdetto ${vRifirmato.verdict}: ` +
    'non e la cifra 9 a essere riconosciuta, e l impronta che non tornava',
)

writeFileSync(join(OUT, 'onesta-attacco-1.json'), JSON.stringify(esiti, null, 2))
console.log('\n' + (esiti.every((e) => e.ok) ? 'ATTACCO 1 ONESTO' : 'ATTACCO 1 NON ONESTO'))
