import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fromAscii, fromHex, sha256, toHex, concat } from '../../../src/core/bytes.js'

const OUT = new URL('./out/', import.meta.url).pathname
const casi = JSON.parse(readFileSync(join(OUT, 'byterange.json')))

for (const nome of ['22-nul-tra-i-numeri', '23-commento-pdf-nellarray', '24-segno-piu']) {
  const c = casi.find((x) => x.nome === nome)
  const signed = new Uint8Array(readFileSync(join(OUT, `${nome}.pdf`)))
  console.log(`\n=== ${nome} ===`)
  console.log('intervalliFirmati', JSON.stringify(c.intervalliFirmati))
  console.log('pdfsigIntervalli', c.pdfsigIntervalli)
  console.log('contents', c.contentsStart, c.contentsEnd)

  const coperti = concat(...c.intervalliFirmati.map(([o, l]) => signed.subarray(o, o + l)))
  console.log('sha256(coperti da intervalliFirmati) =', toHex(await sha256(coperti)), 'len', coperti.length)

  const hex = fromAscii(signed.subarray(c.contentsStart + 1, c.contentsEnd))
  let der = fromHex(hex)
  let fine = der.length
  while (fine > 0 && der[fine - 1] === 0) fine--
  der = der.subarray(0, fine)
  console.log('cms len', der.length)

  const dir = mkdtempSync(join(tmpdir(), 'dbg-'))
  writeFileSync(join(dir, 'cms.der'), der)
  writeFileSync(join(dir, 'cont.bin'), coperti)
  try {
    const o = execFileSync('openssl', ['cms', '-verify', '-inform', 'DER', '-in', join(dir, 'cms.der'), '-content', join(dir, 'cont.bin'), '-binary', '-noverify', '-out', '/dev/null'], { stdio: ['ignore', 'pipe', 'pipe'] })
    console.log('openssl: OK', String(o))
  } catch (e) {
    console.log('openssl: FAIL', String(e.stderr).split('\n').slice(0, 3).join(' | '))
  }
}
