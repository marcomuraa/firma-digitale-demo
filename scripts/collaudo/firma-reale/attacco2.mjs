/**
 * Collaudo avversariale — l'attacco 2 vero, quello di attacks.js, piu due code «nude» costruite
 * qui a mano. Serve a confrontare il verdetto del nostro motore con quello di pdfsig sullo stesso
 * file: e il caso in cui la demo promette il verdetto intermedio, ed e quindi il caso in cui una
 * divergenza fra noi e un terzo si vedrebbe in pubblico.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { appendIncrementalUpdate } from '../../../src/core/attacks.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out')
const firmato = new Uint8Array(readFileSync(join(OUT, 'firmato.pdf')))

// 1. l'attacco 2 come lo fara la pagina, con il testo di default
const reale = appendIncrementalUpdate(firmato)
writeFileSync(join(OUT, 'attacco2-reale.pdf'), reale.bytes)

// 2. l'attacco 2 con un testo che contiene la stringa "/ByteRange"
const conEsca = appendIncrementalUpdate(firmato, { newText: '1 euro /ByteRange [0 0 0 0]' })
writeFileSync(join(OUT, 'attacco2-con-esca.pdf'), conEsca.bytes)

// 3. coda nuda innocua, senza nessuna parola chiave
const neutra = Buffer.concat([Buffer.from(firmato), Buffer.from('\n% coda innocua\n', 'latin1')])
writeFileSync(join(OUT, 'coda-neutra.pdf'), neutra)

console.log(
  JSON.stringify(
    {
      reale: { lunghezza: reale.bytes.length, appesoDa: reale.appendedFrom },
      conEsca: { lunghezza: conEsca.bytes.length, appesoDa: conEsca.appendedFrom },
      neutra: { lunghezza: neutra.length },
    },
    null,
    2,
  ),
)
