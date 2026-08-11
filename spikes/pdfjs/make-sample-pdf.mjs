// Genera un PDF di prova minimale (ASCII puro, Times-Roman NON incorporato)
// e lo esporta come modulo base64 per il bundle dello spike.
// Uso: node spikes/pdfjs/make-sample-pdf.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// --- content stream: solo testo Times-Roman + una linea vettoriale ------------
// La banda di testo sta in alto (y 700..790), la linea vettoriale in basso (y ~120):
// cosi lo spike puo contare separatamente i pixel dei glifi e quelli della grafica.
const contentLines = [
  'BT',
  '/F1 20 Tf',
  '72 760 Td',
  '(SPIKE PDFJS TIMES ROMAN) Tj',
  '0 -28 Td',
  '/F1 14 Tf',
  '(Importo di prova: 1.000 euro \\(mille euro\\)) Tj',
  'ET',
  '2 w',
  '72 130 m',
  '150 170 l',
  '230 110 l',
  '300 160 l',
  'S',
];
const content = contentLines.join('\n') + '\n';

// --- oggetti ------------------------------------------------------------------
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
    + '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>',
];

let pdf = '%PDF-1.7\n';
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});

const startxref = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += '0000000000 65535 f \n';
for (const off of offsets) {
  pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
pdf += `startxref\n${startxref}\n%%EOF\n`;

const bytes = Buffer.from(pdf, 'latin1');
mkdirSync(join(here, 'src'), { recursive: true });
writeFileSync(join(here, 'sample.pdf'), bytes);
writeFileSync(
  join(here, 'src', 'sample-pdf.js'),
  '// GENERATO da make-sample-pdf.mjs — non modificare a mano.\n'
    + `export const SAMPLE_PDF_B64 = '${bytes.toString('base64')}';\n`
    + `export const SAMPLE_PDF_LENGTH = ${bytes.length};\n`,
);

console.log(`sample.pdf: ${bytes.length} byte, xref a ${startxref}`);
console.log(`offset oggetti: ${offsets.join(', ')}`);
