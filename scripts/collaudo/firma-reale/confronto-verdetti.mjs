/**
 * Collaudo avversariale — «un motore che verifica solo se stesso?».
 *
 * Fa dire il verdetto al NOSTRO verify.js sulle stesse quattro varianti su cui hanno gia parlato
 * pdfsig e openssl. Se il nostro motore fosse compiacente, qui i verdetti divergerebbero.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { verify } from '../../../src/core/verify.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out')

for (const nome of ['firmato.pdf', 'manomesso-1a.pdf', 'manomesso-coda.pdf', 'manomesso-contents.pdf']) {
  const r = await verify(new Uint8Array(readFileSync(join(OUT, nome))))
  console.log(
    [
      nome.padEnd(24),
      'verdetto=' + r.verdict.padEnd(9),
      'copertura=' + (r.coverage ? (r.coverage.complete ? 'completa' : 'incompleta') : '-'),
      'codaScoperta=' + (r.coverage ? r.coverage.uncoveredTail : '-'),
      'digest=' + (r.digest ? r.digest.match : '-'),
      'firma=' + (r.signature ? r.signature.ok : '-'),
      r.reason ? 'motivo=' + r.reason : '',
    ].join('  '),
  )
}
