/**
 * Collaudo avversariale — le varianti manomesse.
 *
 * Nessuna importa src/core/attacks.js: le manomissioni sono fatte qui, sui byte, con un editor
 * ingenuo. Se gli strumenti terzi continuassero a dire «Signature is Valid» su queste varianti,
 * la firma non starebbe proteggendo niente.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out')
const pdf = readFileSync(join(OUT, 'firmato.pdf'))
const text = pdf.toString('latin1')

const br = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text).slice(1, 5).map(Number)

// --- 1a: la cifra dell'importo, dentro il primo intervallo coperto -----------------------
const digitAt = 577
if (pdf[digitAt] !== 0x31) throw new Error(`all'offset ${digitAt} non c e il byte '1'`)
if (!(digitAt >= br[0] && digitAt < br[0] + br[1])) throw new Error('offset 577 fuori dal /ByteRange')
const a1 = Buffer.from(pdf)
a1[digitAt] = 0x39
writeFileSync(join(OUT, 'manomesso-1a.pdf'), a1)

// --- coda appesa dopo la firma: byte fuori dal /ByteRange --------------------------------
const coda = Buffer.concat([pdf, Buffer.from('\n% coda appesa dopo la firma, fuori dal /ByteRange\n', 'latin1')])
writeFileSync(join(OUT, 'manomesso-coda.pdf'), coda)

// --- un byte dentro il /Contents: la firma stessa corrotta -------------------------------
const contentsAt = text.indexOf('/Contents <') + '/Contents <'.length
const a3 = Buffer.from(pdf)
a3[contentsAt + 20] = a3[contentsAt + 20] === 0x61 ? 0x62 : 0x61 // 'a' <-> 'b'
writeFileSync(join(OUT, 'manomesso-contents.pdf'), a3)

console.log(
  JSON.stringify(
    {
      byteRange: br,
      offsetCifra: digitAt,
      dentroIlPrimoIntervallo: digitAt >= br[0] && digitAt < br[0] + br[1],
      lunghezze: { originale: pdf.length, a1: a1.length, coda: coda.length, contents: a3.length },
    },
    null,
    2,
  ),
)
