#!/usr/bin/env node
/**
 * exp-pdflib-roundtrip.mjs — esperimento, non un controllo.
 *
 *   node scripts/pdf/exp-pdflib-roundtrip.mjs [--json]
 *
 * Domanda: la fase 2 vuole usare @signpdf/placeholder-pdf-lib, che passa da pdf-lib.
 * Ma pdf-lib RISCRIVE il documento invece di appendere un incremental update?
 * Se lo riscrive, la struttura artigianale del campione sparisce e tutti gli offset
 * congelati diventano carta straccia dopo l'inserimento del placeholder.
 *
 * L'esperimento carica sample.pdf con pdf-lib, lo risalva con useObjectStreams:false
 * e misura: nuova lunghezza, prefisso identico, tenuta degli offset congelati,
 * testo ancora in chiaro, comparsa di compressione. Non decide nulla: riporta.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..', '..');
const PDF_PATH = path.join(PROJECT_ROOT, 'src', 'assets', 'sample.pdf');
const OFFSETS_PATH = path.join(PROJECT_ROOT, 'src', 'assets', 'sample-offsets.json');

const asJson = process.argv.includes('--json');

const original = readFileSync(PDF_PATH);
const frozen = JSON.parse(readFileSync(OFFSETS_PATH, 'utf8'));

const doc = await PDFDocument.load(new Uint8Array(original), { updateMetadata: false });
const saved = Buffer.from(await doc.save({ useObjectStreams: false, addDefaultPage: false }));

const originalText = original.toString('latin1');
const savedText = saved.toString('latin1');

// --- prefisso comune -------------------------------------------------------
let commonPrefix = 0;
while (commonPrefix < Math.min(original.length, saved.length) && original[commonPrefix] === saved[commonPrefix]) {
  commonPrefix++;
}

// --- gli offset congelati puntano ancora agli stessi contenuti? -------------
const offsetProbes = [];
function probe(name, start, end) {
  const expected = originalText.slice(start, end);
  const actual = savedText.slice(start, end);
  offsetProbes.push({ name, start, end, expected, holds: expected === actual, foundElsewhereAt: savedText.indexOf(expected) });
}
probe('riga dell importo', frozen.amount.lineStart, frozen.amount.lineEnd);
probe('cifra 1 di 1.000', frozen.amount.digitOffset, frozen.amount.digitOffset + 1);
probe('parola mille', frozen.amount.wordsStart, frozen.amount.wordsEnd);
probe('testa oggetto 4', frozen.objects[3].start, frozen.objects[3].start + 8);
probe('parola chiave xref', frozen.xref.start, frozen.xref.start + 4);

// --- il testo resta in chiaro? ---------------------------------------------
const clearTextLines = frozen.text.lines.map((line) => {
  // nel content stream le righe compaiono come stringhe PDF letterali
  const needle = `(${line})`;
  return { line, presente: savedText.includes(needle) };
});
const clearTextSurvives = clearTextLines.every((l) => l.presente);

// --- compressione ----------------------------------------------------------
const compressionMarkers = ['/Filter', '/FlateDecode', '/ObjStm', '/XRefStm', '/DecodeParms'];
const compressionFound = compressionMarkers.filter((m) => savedText.includes(m));

// --- purezza ASCII ---------------------------------------------------------
let nonAscii = 0;
let crCount = 0;
for (const b of saved) {
  if (b >= 0x80) nonAscii++;
  if (b === 0x0d) crCount++;
}

// --- incremental update o riscrittura? -------------------------------------
const eofCount = (savedText.match(/%%EOF/g) || []).length;
const startxrefCount = (savedText.match(/startxref/g) || []).length;
const hasPrev = /\/Prev\s+\d+/.test(savedText);
const isIncrementalUpdate = commonPrefix >= original.length && eofCount >= 2 && hasPrev;

const verdict = isIncrementalUpdate
  ? 'incremental-update'
  : commonPrefix >= original.length
    ? 'append-senza-prev'
    : 'riscrittura-completa';

// ---------------------------------------------------------------------------
// Seconda misura: il percorso che la fase 2 userebbe davvero, cioe'
// @signpdf/placeholder-pdf-lib, che di pdf-lib e' un cliente.
// ---------------------------------------------------------------------------

async function measurePlaceholder() {
  try {
    const { pdflibAddPlaceholder } = await import('@signpdf/placeholder-pdf-lib');
    const d = await PDFDocument.load(new Uint8Array(original), { updateMetadata: false });
    pdflibAddPlaceholder({
      pdfDoc: d,
      reason: 'Demo didattica',
      contactInfo: 'demo@example.invalid',
      name: 'Lorenzo Rossi',
      location: 'Roma',
      signatureLength: 2048, // meta' dei 4096 byte di /Contents previsti dal piano
      subFilter: 'ETSI.CAdES.detached',
    });
    const out = Buffer.from(await d.save({ useObjectStreams: false }));
    const s = out.toString('latin1');
    let cp = 0;
    while (cp < Math.min(original.length, out.length) && original[cp] === out[cp]) cp++;
    let na = 0;
    for (const b of out) if (b >= 0x80) na++;
    const amountAt = s.indexOf(frozen.amount.line);
    return {
      disponibile: true,
      savedLength: out.length,
      commonPrefixBytes: cp,
      eofCount: (s.match(/%%EOF/g) || []).length,
      hasPrev: /\/Prev\s+\d+/.test(s),
      byteRange: (/\/ByteRange \[[^\]]*\]/.exec(s) || [null])[0],
      subFilterPades: s.includes('/ETSI.CAdES.detached'),
      compressionFound: compressionMarkers.filter((mk) => s.includes(mk)),
      nonAsciiBytes: na,
      amountLineOffset: amountAt,
      amountLineAligned: amountAt >= 0 && amountAt % 16 === 0,
      clearTextSurvives: frozen.text.lines.every((line) => s.includes(`(${line})`)),
    };
  } catch (err) {
    return { disponibile: false, errore: `${err && err.name}: ${err && err.message}` };
  }
}

const placeholder = await measurePlaceholder();

const report = {
  pdflibVersion: JSON.parse(readFileSync(path.join(PROJECT_ROOT, 'node_modules', 'pdf-lib', 'package.json'), 'utf8')).version,
  originalLength: original.length,
  savedLength: saved.length,
  deltaLength: saved.length - original.length,
  originalSha256: createHash('sha256').update(original).digest('hex'),
  savedSha256: createHash('sha256').update(saved).digest('hex'),
  commonPrefixBytes: commonPrefix,
  prefixIdentical: commonPrefix >= original.length,
  frozenOffsetsHold: offsetProbes.every((p) => p.holds),
  offsetProbes,
  clearTextSurvives,
  clearTextLines,
  compressionFound,
  ascii: { nonAsciiBytes: nonAscii, crBytes: crCount, pure: nonAscii === 0 && crCount === 0 },
  eofCount,
  startxrefCount,
  hasPrev,
  verdict,
  signpdfPlaceholder: placeholder,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('Esperimento: round-trip di sample.pdf attraverso pdf-lib');
  console.log(`  pdf-lib                    ${report.pdflibVersion}`);
  console.log(`  lunghezza originale        ${report.originalLength} byte`);
  console.log(`  lunghezza dopo save()      ${report.savedLength} byte (${report.deltaLength >= 0 ? '+' : ''}${report.deltaLength})`);
  console.log(`  prefisso comune            ${report.commonPrefixBytes} byte su ${report.originalLength}`);
  console.log(`  primi N byte identici      ${report.prefixIdentical ? 'SI, il file originale e intatto in testa' : 'NO, pdf-lib riscrive dal byte ' + report.commonPrefixBytes}`);
  console.log(`  offset congelati tengono   ${report.frozenOffsetsHold ? 'SI' : 'NO'}`);
  for (const p of report.offsetProbes) {
    console.log(
      `    - ${p.name.padEnd(24)} offset ${String(p.start).padStart(5)}  ${p.holds ? 'invariato' : 'SPOSTATO'}` +
        (p.holds ? '' : p.foundElsewhereAt >= 0 ? ` (ora a ${p.foundElsewhereAt}, delta ${p.foundElsewhereAt - p.start})` : ' (non piu trovato)'),
    );
  }
  console.log(`  testo ancora in chiaro     ${report.clearTextSurvives ? 'SI' : 'NO'}`);
  console.log(`  compressione comparsa      ${report.compressionFound.length ? report.compressionFound.join(', ') : 'nessuna'}`);
  console.log(`  ASCII puro                 ${report.ascii.pure ? 'SI' : `NO (${report.ascii.nonAsciiBytes} byte fuori ASCII, ${report.ascii.crBytes} CR)`}`);
  console.log(`  %%EOF nel file             ${report.eofCount}   startxref: ${report.startxrefCount}   /Prev: ${report.hasPrev ? 'si' : 'no'}`);
  console.log(`  VERDETTO                   ${report.verdict}`);
  console.log('');
  console.log('Seconda misura: @signpdf/placeholder-pdf-lib (il percorso vero della fase 2)');
  if (!placeholder.disponibile) {
    console.log(`  non misurabile: ${placeholder.errore}`);
  } else {
    console.log(`  lunghezza dopo placeholder ${placeholder.savedLength} byte`);
    console.log(`  prefisso comune            ${placeholder.commonPrefixBytes} byte`);
    console.log(`  %%EOF: ${placeholder.eofCount}   /Prev: ${placeholder.hasPrev ? 'si' : 'no'}   -> ${placeholder.eofCount >= 2 && placeholder.hasPrev ? 'incremental update' : 'RISCRITTURA'}`);
    console.log(`  /ByteRange                 ${placeholder.byteRange || 'assente'}`);
    console.log(`  subFilter PAdES            ${placeholder.subFilterPades ? 'ETSI.CAdES.detached presente' : 'ASSENTE'}`);
    console.log(`  compressione comparsa      ${placeholder.compressionFound.length ? placeholder.compressionFound.join(', ') : 'nessuna'}`);
    console.log(`  byte fuori ASCII           ${placeholder.nonAsciiBytes}`);
    console.log(`  testo ancora in chiaro     ${placeholder.clearTextSurvives ? 'SI' : 'NO'}`);
    console.log(
      `  riga dell importo          offset ${placeholder.amountLineOffset} ` +
        `(${placeholder.amountLineAligned ? 'ancora allineata a 16' : 'NON piu multiplo di 16'})`,
    );
  }
  console.log('');
  if (report.verdict === 'riscrittura-completa') {
    console.log('  Conseguenza per la fase 2: pdf-lib NON appende, riscrive. Il PDF che esce non e piu');
    console.log('  il campione artigianale e gli offset congelati non valgono piu. Il placeholder PAdES');
    console.log('  va quindi o costruito a mano (incremental update artigianale, come l attacco 2), oppure');
    console.log('  gli offset vanno ricalcolati sul file uscito da pdf-lib prima di firmare.');
  }
}
