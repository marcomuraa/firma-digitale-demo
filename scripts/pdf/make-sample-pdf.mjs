#!/usr/bin/env node
/**
 * make-sample-pdf.mjs — genera il PDF campione e il file degli offset congelati.
 *
 *   npm run pdf
 *   node scripts/pdf/make-sample-pdf.mjs --out-dir <cartella>   (usato dal controllo di determinismo)
 *
 * Il file e' scritto a mano byte per byte in build-sample-pdf.mjs: qui c'e' solo
 * l'I/O e il rapporto a schermo.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSamplePdf } from './build-sample-pdf.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..', '..');
const DEFAULT_OUT_DIR = path.join(PROJECT_ROOT, 'src', 'assets');

function parseArgs(argv) {
  let outDir = DEFAULT_OUT_DIR;
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out-dir') outDir = path.resolve(argv[++i]);
    else if (argv[i] === '--quiet') quiet = true;
  }
  return { outDir, quiet };
}

const { outDir, quiet } = parseArgs(process.argv.slice(2));

const { bytes, offsets } = buildSamplePdf();

// Rete di sicurezza a monte della scrittura: se qui qualcosa non torna, il file
// non deve nemmeno arrivare su disco. Il validatore ripete il controllo dai byte.
for (let i = 0; i < bytes.length; i++) {
  const b = bytes[i];
  if (b >= 0x80) throw new Error(`Byte non ASCII 0x${b.toString(16)} all offset ${i}`);
  if (b === 0x0d) throw new Error(`Ritorno a capo CR all offset ${i}`);
  if (b < 0x20 && b !== 0x0a) throw new Error(`Byte di controllo 0x${b.toString(16)} all offset ${i}`);
}
if (offsets.amount.lineStart % 16 !== 0) {
  throw new Error(`La riga dell importo non e allineata: ${offsets.amount.lineStart}`);
}

mkdirSync(outDir, { recursive: true });
const pdfPath = path.join(outDir, 'sample.pdf');
const offsetsPath = path.join(outDir, 'sample-offsets.json');

writeFileSync(pdfPath, bytes);
writeFileSync(offsetsPath, JSON.stringify(offsets, null, 2) + '\n', 'ascii');

if (!quiet) {
  const rel = (p) => path.relative(PROJECT_ROOT, p) || p;
  console.log('PDF campione generato.');
  console.log(`  file            ${rel(pdfPath)}`);
  console.log(`  offset          ${rel(offsetsPath)}`);
  console.log(`  dimensione      ${offsets.fileLength} byte (limite 2560)`);
  console.log(`  sha256          ${offsets.sha256}`);
  console.log(`  /Length dich.   ${offsets.contentStream.declaredLength}`);
  console.log(
    `  riga importo    ${offsets.amount.lineStart} (multiplo di 16: ${offsets.amount.lineStart / 16}), ` +
      `riempimento ${offsets.alignment.padCount} spazi in ${offsets.alignment.iterations} iterazioni`,
  );
  console.log(`  cifra da 1 a 9  offset ${offsets.amount.digitOffset}`);
  console.log(`  parola mille    offset ${offsets.amount.wordsStart}`);
  console.log(`  xref            offset ${offsets.xref.start}`);
}
