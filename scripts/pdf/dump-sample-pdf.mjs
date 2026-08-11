#!/usr/bin/env node
/**
 * dump-sample-pdf.mjs — dump esadecimale/ASCII annotato del PDF campione.
 *
 *   node scripts/pdf/dump-sample-pdf.mjs
 *
 * Stampa il file a 16 byte per riga, con un'intestazione per ogni sezione dichiarata
 * in sample-offsets.json e un marcatore sulle righe interessanti (importo, firma).
 * Serve per la documentazione e per controllare a occhio quel che il validatore
 * controlla a macchina.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const bytes = readFileSync(path.join(ROOT, 'src', 'assets', 'sample.pdf'));
const off = JSON.parse(readFileSync(path.join(ROOT, 'src', 'assets', 'sample-offsets.json'), 'utf8'));

const ROW = 16;
const sectionAt = new Map(off.sections.map((s) => [s.start, s]));

/** Righe da segnalare con una freccia a destra. */
const marks = [
  { start: off.amount.lineStart, end: off.amount.lineEnd, text: 'riga dell importo (multiplo di 16)' },
  { start: off.signatureDrawing.start, end: off.signatureDrawing.end, text: 'firma autografa: sola geometria' },
];

function ascii(b) {
  return b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
}

const out = [];
for (let base = 0; base < bytes.length; base += ROW) {
  for (let i = base; i < Math.min(base + ROW, bytes.length); i++) {
    const s = sectionAt.get(i);
    if (s) {
      out.push(
        `\n---- ${s.id.padEnd(9)} ${String(s.start).padStart(4)}..${String(s.end).padEnd(4)} ` +
          `(riga 0x${(s.start - (s.start % ROW)).toString(16).padStart(4, '0')}, colonna ${s.start % ROW})  ${s.label}`,
      );
    }
  }
  const slice = bytes.subarray(base, base + ROW);
  const hex = [...slice].map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(ROW * 3 - 1, ' ');
  const chars = [...slice].map(ascii).join('');
  let tag = '';
  for (const m of marks) {
    if (m.start >= base && m.start < base + ROW) tag = `   <-- ${m.text}`;
  }
  out.push(`${String(base).padStart(4, ' ')}  ${base.toString(16).padStart(4, '0')}  ${hex}  |${chars}|${tag}`);
}

console.log(`sample.pdf — ${off.fileLength} byte — sha256 ${off.sha256}`);
console.log('dec    hex   byte                                              ascii');
console.log(out.join('\n'));
