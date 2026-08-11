#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Genera src/ui/sample-pdf.js — i byte del PDF campione in base64.
//
//   node scripts/genera/sample-pdf.mjs
//
// Perche esiste. src/ui/machine.js deve funzionare in due ambienti che non hanno
// niente in comune sul modo di leggere un file:
//
//   - nel browser non esiste `fs`, e l'unico modo di avere i byte del campione
//     dentro un HTML autoconsistente e' averli gia' dentro il sorgente;
//   - in node (i test della macchina girano senza DOM) non esiste l'import
//     `?url` di Vite, che nel browser trasformerebbe sample.pdf in un data URI.
//
// Un modulo di testo con il base64 e' l'unica forma che i due ambienti leggono
// allo stesso modo. Costo: 1.716 caratteri, cioe' +988 byte rispetto ai 1285
// del file (la penale del base64 la pagano solo gli asset binari, vedi
// spikes/pdfjs/RECIPE.md sezione 4).
//
// Lo sha256 viene scritto nel modulo e ricontrollato da un test
// (src/ui/machine.test.mjs) contro il campo `sha256` di sample-offsets.json:
// se qualcuno rigenera il campione senza rigenerare questo file, o viceversa,
// il test si spegne prima che un offset congelato cominci a puntare altrove.
//
// Questo script NON viene lanciato dal build. Si rilancia dopo `npm run pdf`.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const qui = path.dirname(fileURLToPath(import.meta.url))
const radice = path.resolve(qui, '..', '..')

const sorgente = path.join(radice, 'src', 'assets', 'sample.pdf')
const offsetsJson = path.join(radice, 'src', 'assets', 'sample-offsets.json')
const destinazione = path.join(radice, 'src', 'ui', 'sample-pdf.js')

if (!fs.existsSync(sorgente)) {
  console.error(`genera/sample-pdf: manca ${sorgente}. Lancia prima "npm run pdf".`)
  process.exit(1)
}

const byte = fs.readFileSync(sorgente)
const sha256 = crypto.createHash('sha256').update(byte).digest('hex')
const base64 = byte.toString('base64')

// Il confronto con gli offset congelati si fa qui, non solo nel test: generare un
// modulo che gia' si sa disallineato sarebbe scrivere una bugia sul disco.
const offsets = JSON.parse(fs.readFileSync(offsetsJson, 'utf8'))
if (offsets.sha256 !== sha256) {
  console.error(
    `genera/sample-pdf: sample.pdf ha sha256 ${sha256}, ma sample-offsets.json dichiara ` +
      `${offsets.sha256}. Gli offset congelati non valgono per questi byte: rigenera prima ` +
      'gli offset ("npm run pdf"), poi questo modulo.',
  )
  process.exit(1)
}
if (offsets.fileLength !== byte.length) {
  console.error(
    `genera/sample-pdf: sample.pdf e' lungo ${byte.length} byte, sample-offsets.json ne ` +
      `dichiara ${offsets.fileLength}.`,
  )
  process.exit(1)
}

// Il base64 va a capo ogni 96 caratteri: una riga sola da 1.716 caratteri rende
// illeggibile qualunque diff, e la concatenazione la fa il motore a tempo di
// parsing, non a ogni chiamata.
const RIGA = 96
const righe = []
for (let i = 0; i < base64.length; i += RIGA) righe.push(base64.slice(i, i + RIGA))

const contenuto = `// GENERATO da scripts/genera/sample-pdf.mjs — non modificare a mano.
// Rigeneralo con:  node scripts/genera/sample-pdf.mjs
//
// I byte del PDF campione, in base64. Sorgente: src/assets/sample.pdf
//   ${byte.length} byte · sha256 ${sha256}
//
// Serve perche' src/ui/machine.js gira in due ambienti: nel browser non c'e' \`fs\`,
// in node non c'e' l'import \`?url\` di Vite. Un modulo di testo li accontenta
// entrambi. Gli offset congelati di src/assets/sample-offsets.json valgono per
// QUESTI byte: se lo sha256 qui sopra e quello del JSON divergono, ogni offset
// punta altrove — ed e' esattamente cio' che un test controlla.

/** I byte del campione, in base64. */
export const SAMPLE_PDF_B64 =
${righe.map((r) => `  '${r}'`).join(' +\n')}

/** Lunghezza in byte del campione decodificato. */
export const SAMPLE_PDF_LENGTH = ${byte.length}

/** SHA-256 dei byte decodificati, in esadecimale minuscolo. */
export const SAMPLE_PDF_SHA256 = '${sha256}'

/**
 * I byte del campione, decodificati.
 *
 * Restituisce ogni volta un array NUOVO: chi lo riceve puo' scriverci sopra —
 * e pdf.js, per esempio, prende possesso dei byte che gli si passano — senza
 * che la copia successiva ne risenta.
 *
 * \`atob\` esiste sia nel browser sia in node (>= 16): e' l'unica funzione di
 * decodifica che i due ambienti condividono senza adattatori.
 *
 * @returns {Uint8Array} ${byte.length} byte
 */
export function samplePdfBytes() {
  const testo = atob(SAMPLE_PDF_B64)
  const byte = new Uint8Array(testo.length)
  for (let i = 0; i < testo.length; i++) byte[i] = testo.charCodeAt(i)
  return byte
}
`

fs.writeFileSync(destinazione, contenuto)
console.log(
  `scritto ${path.relative(radice, destinazione)} — ${byte.length} byte di PDF, ` +
    `${base64.length} di base64, sha256 ${sha256.slice(0, 16)}…`,
)
