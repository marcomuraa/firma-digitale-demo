import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verify } from '../../../src/core/verify.js'
import { firmaConByteRange } from './costruttore.mjs'
import { pareri, stampaPareri } from '../comune/terzi.mjs'

const SAMPLE = new Uint8Array(readFileSync(new URL('../../../src/assets/sample.pdf', import.meta.url)))
const OUT = new URL('./out/', import.meta.url).pathname

// Caso di controllo: ByteRange canonico costruito dal MIO costruttore -> deve dare valid.
const canonico = await firmaConByteRange(SAMPLE, {
  numeriDa: (cs, ce, len) => [0, cs, ce + 1, len - (ce + 1)],
})
writeFileSync(join(OUT, 'probe-canonico.pdf'), canonico.signed)
console.log('canonico nums =', JSON.stringify(canonico.nums))
console.log('canonico verify =', (await verify(canonico.signed)).verdict)

// Sei numeri (tre coppie) che coprono davvero tutto.
const sei = await firmaConByteRange(SAMPLE, {
  numeriDa: (cs, ce, len) => [0, 128, 128, cs - 128, ce + 1, len - (ce + 1)],
})
writeFileSync(join(OUT, 'probe-sei.pdf'), sei.signed)
console.log('sei nums =', JSON.stringify(sei.nums))
const rSei = await verify(sei.signed)
console.log('sei verify =', rSei.verdict, rSei.reason)

// NUL al posto degli spazi.
const nul = await firmaConByteRange(SAMPLE, {
  numeriDa: (cs, ce, len) => [0, cs, ce + 1, len - (ce + 1)],
  testoBR: (nums) => nums.join('\x00'),
})
writeFileSync(join(OUT, 'probe-nul.pdf'), nul.signed)
console.log('nul nums =', JSON.stringify(nul.nums))
const rNul = await verify(nul.signed)
console.log('nul verify =', rNul.verdict, rNul.reason)

for (const f of ['probe-canonico.pdf', 'probe-sei.pdf', 'probe-nul.pdf']) {
  console.log(stampaPareri(await pareri(join(OUT, f))))
}
