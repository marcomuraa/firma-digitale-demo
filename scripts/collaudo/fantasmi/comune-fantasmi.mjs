/**
 * Attrezzi della famiglia «firme fantasma».
 *
 * Il perimetro di scrittura e SOLO questa cartella: non tocco copertura/comune.mjs, quindi non uso
 * ne il suo salva() ne il suo OUT (scrivono fuori dal mio recinto). Definisco qui il MIO out/ e
 * riuso soltanto i mattoni di sola lettura — firmaIlCampione() e le utilita sui byte — piu il
 * motore in src/core/, anch'esso di sola lettura.
 *
 * Un dizionario di firma, per verify(), e qualunque oggetto `N G obj` il cui dizionario di primo
 * livello contenga un `/ByteRange`. Non serve /Type /Sig, non serve che l'/AcroForm lo conosca,
 * non serve che la xref lo dichiari vivo. Tutto cio che costruisco qui sfrutta esattamente questa
 * definizione lessicale: fabbrico oggetti che DICHIARANO di essere firme e guardo chi li conta.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ascii, concat, fromAscii, indexOf, toHex } from '../../../src/core/bytes.js'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const OUT = join(HERE, 'out')
mkdirSync(OUT, { recursive: true })

export { ascii, concat, fromAscii, indexOf, toHex }

/** Scrive nel MIO out/ e restituisce il percorso assoluto (gli strumenti terzi vogliono un file). */
export function salvaMio(nome, bytes) {
  const percorso = join(OUT, nome)
  writeFileSync(percorso, bytes)
  return percorso
}

/**
 * Il testo di un oggetto-firma fantasma: un dizionario con /ByteRange e /Contents e nient'altro
 * che serva. `num` e il numero d'oggetto (scelgo numeri alti per non collidere coi veri 1..7),
 * `byteRange` i quattro numeri, `contentsHex` cio che va nel buco esadecimale.
 *
 * Il dizionario sta tutto su poche righe apposta: cosi la sua fine `>>` la trova `dictEndAt` senza
 * ambiguita, ed e leggibile in un dump se qualcuno lo apre davanti a una sala.
 */
export function oggettoFantasma(num, byteRange, contentsHex, { tipo = '/Type /Sig ' } = {}) {
  return (
    `${num} 0 obj\n` +
    `<< ${tipo}/ByteRange [${byteRange.join(' ')}] /Contents <${contentsHex}> >>\n` +
    'endobj\n'
  )
}

/** Dove apre il buco `<` del /Contents dentro un testo di oggetto, per calcolare gli offset. */
export function offsetContents(testoOggetto) {
  return testoOggetto.indexOf('/Contents <') + '/Contents '.length
}
