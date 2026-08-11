#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Genera src/ui/standard-fonts.js — il font base-14 Times-Roman in base64.
//
//   node scripts/genera/standard-fonts.mjs
//
// Perche esiste. Il PDF campione dichiara /BaseFont /Times-Roman e NON lo
// incorpora. pdf.js, con `useSystemFonts: false`, chiede i dati del font alla
// BinaryDataFactory: se non glieli diamo noi, ripiega sul serif di sistema e il
// documento a schermo cambia da una macchina all'altra. In una demo il cui punto
// e «guarda che il documento e cambiato», un rendering che cambia per conto suo
// e' rumore che si somma al segnale. Vedi spikes/pdfjs/RECIPE.md sezione 3.
//
// Costo misurato: 19.469 byte di sorgente, 25.960 di base64, su un file da
// 1,65 MB. L'1,6 % per un disegno identico ovunque.
//
// Questo script NON viene lanciato dal build: il modulo generato e' un sorgente
// versionato come gli altri. Si rilancia solo se cambia pdfjs-dist o se il PDF
// campione comincia a usare un altro font base-14 (la tabella dei nomi di file
// sta in RECIPE.md sezione 3).
// ---------------------------------------------------------------------------

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const qui = path.dirname(fileURLToPath(import.meta.url))
const radice = path.resolve(qui, '..', '..')

/**
 * I font da inlineare: nome del file come lo chiede pdf.js -> percorso sorgente.
 * Uno solo, perche uno solo ne usa il campione. Aggiungerne un altro significa
 * aggiungere una riga qui e ~26 KB a ciascuno dei quattro HTML.
 */
const FONT = [{ nome: 'FoxitSerif.pfb', usatoDa: '/BaseFont /Times-Roman' }]

const cartellaFont = path.join(radice, 'node_modules', 'pdfjs-dist', 'standard_fonts')
const destinazione = path.join(radice, 'src', 'ui', 'standard-fonts.js')

const voci = []
const righeCommento = []
for (const { nome, usatoDa } of FONT) {
  const percorso = path.join(cartellaFont, nome)
  if (!fs.existsSync(percorso)) {
    console.error(`genera/standard-fonts: manca ${percorso}. pdfjs-dist non e installato?`)
    process.exit(1)
  }
  const byte = fs.readFileSync(percorso)
  const base64 = byte.toString('base64')
  voci.push(`  '${nome}':\n    '${base64}',`)
  righeCommento.push(
    `//   ${nome.padEnd(20)} ${String(byte.length).padStart(6)} byte  ->  ` +
      `${String(base64.length).padStart(6)} in base64   (${usatoDa})`,
  )
}

const contenuto = `// GENERATO da scripts/genera/standard-fonts.mjs — non modificare a mano.
// Rigeneralo con:  node scripts/genera/standard-fonts.mjs
//
// I font base-14 che il PDF campione usa senza incorporarli, in base64.
// Sorgente: node_modules/pdfjs-dist/standard_fonts/
//
${righeCommento.join('\n')}
//
// Li serve a pdf.js la BinaryDataFactory di src/ui/pdf-render.js: senza, pdf.js
// ripiega sul serif di sistema e il documento a schermo cambia da una macchina
// all'altra. Vedi spikes/pdfjs/RECIPE.md sezione 3.

/** @type {Record<string, string>} nome del file come lo chiede pdf.js -> base64 */
export const STANDARD_FONTS = {
${voci.join('\n')}
}
`

fs.writeFileSync(destinazione, contenuto)
console.log(
  `scritto ${path.relative(radice, destinazione)} — ${FONT.length} font, ` +
    `${contenuto.length.toLocaleString('it-IT')} byte`,
)
