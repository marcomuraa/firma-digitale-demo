#!/usr/bin/env node
/**
 * validate-sample-pdf.mjs — collaudo del PDF campione.
 *
 *   npm run pdf:validate
 *
 * Regola di questo file: NON si fida ne' del generatore ne' di sample-offsets.json.
 * Tutto viene ricalcolato dai byte su disco; il JSON degli offset e' un'ipotesi da
 * confutare, non una fonte. Le righe attese del documento sono ricopiate qui sotto
 * apposta: se il generatore cambia testo, il validatore deve accorgersene.
 *
 * Esce con codice 1 al primo controllo fallito.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..', '..');
const PDF_PATH = path.join(PROJECT_ROOT, 'src', 'assets', 'sample.pdf');
const OFFSETS_PATH = path.join(PROJECT_ROOT, 'src', 'assets', 'sample-offsets.json');
const GENERATOR = path.join(HERE, 'make-sample-pdf.mjs');
const RELOCATOR = path.join(HERE, 'relocate-offsets.mjs');
const STANDARD_FONTS = pathToFileURL(
  path.join(PROJECT_ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep,
).href;

const MAX_SIZE = 2560;
const HEX_DUMP_ROW = 16;

/** Righe attese nel testo estratto (copia indipendente della specifica). */
const EXPECTED_LINES = [
  'PROMESSA DI PAGAMENTO',
  'Documento dimostrativo, privo di valore legale.',
  'Io sottoscritto Lorenzo Rossi prometto di pagare',
  'al signor Mario Bianchi la somma di',
  '1.000 euro (mille euro)',
  'entro il giorno 30 settembre 2026.',
  'Roma, 10 agosto 2026',
];
const DISCLAIMER = 'Documento dimostrativo, privo di valore legale.';
const AMOUNT_LINE = '(1.000 euro (mille euro)) Tj';
/** L'attacco 1b, ricopiato qui: il validatore non importa nulla dal generatore. */
const TAMPER_WORDS_FROM = 'mille';
const TAMPER_WORDS_TO = 'novemila';
/** Parametri del placeholder PAdES previsti dal piano, usati nella sezione 11. */
const PLACEHOLDER_OPTIONS = {
  reason: 'Demo didattica di firma digitale',
  contactInfo: 'demo@example.invalid',
  name: 'Lorenzo Rossi',
  location: 'Roma',
  signatureLength: 4096,
  subFilter: 'ETSI.CAdES.detached',
};

// ---------------------------------------------------------------------------
// Infrastruttura di rapporto
// ---------------------------------------------------------------------------

let currentCheck = '';
const notes = [];

function section(title) {
  console.log(`\n== ${title}`);
}
function check(label) {
  currentCheck = label;
}
function pass(detail) {
  console.log(`  [ok]   ${currentCheck}${detail ? ' -- ' + detail : ''}`);
}
function note(text) {
  notes.push(text);
  console.log(`  [nota] ${text}`);
}
function fail(reason) {
  console.error(`  [KO]   ${currentCheck}`);
  console.error(`         ${reason}`);
  console.error('\nCollaudo interrotto al primo fallimento.');
  process.exit(1);
}
function expect(condition, reason) {
  if (!condition) fail(reason);
}
function expectEqual(actual, expected, what) {
  if (actual !== expected) fail(`${what}: atteso ${JSON.stringify(expected)}, trovato ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------------
// Lettura
// ---------------------------------------------------------------------------

const bytes = readFileSync(PDF_PATH);
const text = bytes.toString('latin1');
const frozen = JSON.parse(readFileSync(OFFSETS_PATH, 'utf8'));

console.log('Collaudo del PDF campione');
console.log(`  ${path.relative(PROJECT_ROOT, PDF_PATH)}  (${bytes.length} byte)`);

// ---------------------------------------------------------------------------
// 1. Purezza ASCII
// ---------------------------------------------------------------------------

section('1. Purezza ASCII e fine riga');
check('nessun byte fuori ASCII, nessun CR, nessun byte di controllo diverso da LF');
for (let i = 0; i < bytes.length; i++) {
  const b = bytes[i];
  if (b >= 0x80) fail(`byte 0x${b.toString(16).padStart(2, '0')} all offset ${i} (fuori ASCII)`);
  if (b === 0x0d) fail(`ritorno a capo CR all offset ${i}: la fine riga deve essere solo LF`);
  if (b < 0x20 && b !== 0x0a) fail(`byte di controllo 0x${b.toString(16).padStart(2, '0')} all offset ${i}`);
  if (b === 0x7f) fail(`byte DEL all offset ${i}`);
}
pass(`${bytes.length} byte, tutti stampabili o LF`);

// ---------------------------------------------------------------------------
// 2. Nessuna compressione
// ---------------------------------------------------------------------------

section('2. Assenza di compressione e di strutture opache');
for (const forbidden of ['/Filter', '/ObjStm', '/XRefStm', '/FlateDecode', '/DecodeParms', '/Encrypt', '/Info']) {
  check(`assenza di ${forbidden}`);
  const at = text.indexOf(forbidden);
  if (at !== -1) fail(`${forbidden} trovato all offset ${at}`);
}
check('assenza di compressione');
pass('nessun /Filter, /ObjStm, /XRefStm, /FlateDecode, /DecodeParms, /Encrypt, /Info');

check('intestazione %PDF-1.7 al primo byte');
expect(text.startsWith('%PDF-1.7\n'), 'il file non comincia con "%PDF-1.7" seguito da LF');
pass();

check('il file termina con %%EOF');
expect(text.endsWith('%%EOF\n'), 'il file non termina con "%%EOF" seguito da LF');
pass();

// ---------------------------------------------------------------------------
// 3. pdf.js
// ---------------------------------------------------------------------------

section('3. Primo parser: pdf.js');

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const { OPS } = pdfjs;

/**
 * Codici dei comandi dentro il buffer di percorso di OPS.constructPath.
 * pdf.js non esporta questo enum: lo ricostruiamo qui e ne verifichiamo la
 * coerenza pretendendo che la grammatica consumi il buffer esattamente.
 */
const DRAW_MOVE_TO = 0;
const DRAW_LINE_TO = 1;
const DRAW_CURVE_TO = 2;
const DRAW_ARITY = { [DRAW_MOVE_TO]: 2, [DRAW_LINE_TO]: 2, [DRAW_CURVE_TO]: 6, 3: 0 };

async function openWithPdfJs(data) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl: STANDARD_FONTS,
    isEvalSupported: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  const items = tc.items.map((i) => i.str);
  const ops = await page.getOperatorList();
  const result = { numPages: doc.numPages, items, joined: items.join('\n'), ops };
  await task.destroy();
  return result;
}

check('pdf.js apre il documento');
let pdfjsResult;
try {
  pdfjsResult = await openWithPdfJs(bytes);
} catch (err) {
  fail(`pdf.js ha rifiutato il file: ${err && err.message}`);
}
pass();

check('il documento ha esattamente 1 pagina');
expectEqual(pdfjsResult.numPages, 1, 'numero di pagine');
pass();

check('getTextContent() contiene tutte le righe attese');
for (const line of EXPECTED_LINES) {
  if (!pdfjsResult.joined.includes(line)) {
    fail(`riga mancante nel testo estratto da pdf.js: ${JSON.stringify(line)}`);
  }
}
pass(`${EXPECTED_LINES.length} righe, marcatura compresa`);

check('getOperatorList() contiene un percorso con curve di Bezier e uno stroke');
{
  const { fnArray, argsArray } = pdfjsResult.ops;
  let curves = 0;
  let strokedPaths = 0;
  for (let i = 0; i < fnArray.length; i++) {
    if (fnArray[i] !== OPS.constructPath) continue;
    const [drawOp, buffers] = argsArray[i];
    if (drawOp === OPS.stroke) strokedPaths++;
    for (const buf of buffers) {
      let k = 0;
      while (k < buf.length) {
        const cmd = buf[k];
        const arity = DRAW_ARITY[cmd];
        if (arity === undefined) fail(`comando di percorso sconosciuto (${cmd}) nel buffer di constructPath`);
        if (cmd === DRAW_CURVE_TO) curves++;
        k += 1 + arity;
      }
      if (k !== buf.length) fail('la grammatica del buffer di percorso non consuma il buffer: lettura non affidabile');
    }
  }
  expect(strokedPaths > 0, 'nessun percorso con operatore di stroke: la firma vettoriale non arriva a pdf.js');
  expect(curves > 0, 'nessuna curva di Bezier nei percorsi: la firma non e disegnata con l operatore c');
  pass(`${strokedPaths} percorsi con stroke, ${curves} curve di Bezier`);
}

check('nessuna immagine e nessun XObject nella lista operatori');
{
  const forbiddenOps = ['paintImageXObject', 'paintInlineImageXObject', 'paintJpegXObject', 'paintImageMaskXObject'];
  const present = new Set(pdfjsResult.ops.fnArray);
  for (const name of forbiddenOps) {
    if (OPS[name] !== undefined && present.has(OPS[name])) {
      fail(`operatore ${name} presente: la firma deve essere geometria, non un'immagine`);
    }
  }
  pass('la firma e solo geometria');
}

// ---------------------------------------------------------------------------
// 4. Secondo parser indipendente: poppler
// ---------------------------------------------------------------------------

section('4. Secondo parser indipendente: poppler');

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    fail(`${cmd} ha fallito: ${(err.stderr || err.message || '').toString().trim()}`);
  }
}

check('pdftotext -layout estrae tutte le righe attese');
const popplerText = run('pdftotext', ['-layout', PDF_PATH, '-']);
for (const line of EXPECTED_LINES) {
  if (!popplerText.includes(line)) fail(`riga mancante nel testo estratto da poppler: ${JSON.stringify(line)}`);
}
pass('stesso testo di pdf.js, riga dell importo e marcatura comprese');

check('pdfinfo riporta 1 pagina e versione PDF 1.7');
const info = run('pdfinfo', [PDF_PATH]);
const pagesLine = /^Pages:\s+(\d+)$/m.exec(info);
const versionLine = /^PDF version:\s+([\d.]+)$/m.exec(info);
expect(pagesLine, 'pdfinfo non riporta il numero di pagine');
expect(versionLine, 'pdfinfo non riporta la versione PDF');
expectEqual(pagesLine[1], '1', 'pagine secondo pdfinfo');
expectEqual(versionLine[1], '1.7', 'versione PDF secondo pdfinfo');
pass();

// ---------------------------------------------------------------------------
// 5. Esattezza dell'xref, controllata a mano sui byte
//    pdf.js ricostruisce da solo un xref rotto: il controllo 3 non dice nulla qui.
// ---------------------------------------------------------------------------

section('5. Tabella xref verificata byte per byte');

check('la parola chiave xref compare una sola volta');
const xrefStart = text.indexOf('\nxref\n') + 1;
expect(xrefStart > 0, 'parola chiave "xref" non trovata su una riga propria');
expect(text.indexOf('\nxref\n', xrefStart) === -1, 'la parola chiave "xref" compare piu di una volta');
pass(`offset ${xrefStart}`);

check('intestazione della sottosezione xref');
const subHeaderMatch = /^xref\n(\d+) (\d+)\n/.exec(text.slice(xrefStart));
expect(subHeaderMatch, 'intestazione di sottosezione xref illeggibile');
expectEqual(Number(subHeaderMatch[1]), 0, 'primo numero di oggetto della sottosezione');
const declaredCount = Number(subHeaderMatch[2]);
pass(`0 ${declaredCount}`);

check('le voci xref sono lunghe esattamente 20 byte e ben formate');
const entriesStart = xrefStart + subHeaderMatch[0].length;
const parsedEntries = [];
for (let i = 0; i < declaredCount; i++) {
  const raw = text.slice(entriesStart + i * 20, entriesStart + (i + 1) * 20);
  const m = /^(\d{10}) (\d{5}) ([nf]) \n$/.exec(raw);
  if (!m) fail(`voce xref ${i} malformata: ${JSON.stringify(raw)}`);
  parsedEntries.push({ num: i, offset: Number(m[1]), gen: Number(m[2]), type: m[3] });
}
const xrefEnd = entriesStart + declaredCount * 20;
pass(`${declaredCount} voci, da ${entriesStart} a ${xrefEnd}`);

check('la voce 0 e la testa della lista libera');
expectEqual(parsedEntries[0].type, 'f', 'tipo della voce 0');
expectEqual(parsedEntries[0].offset, 0, 'offset della voce 0');
expectEqual(parsedEntries[0].gen, 65535, 'generazione della voce 0');
pass();

check('ogni voce n punta ai byte "<num> 0 obj"');
for (const e of parsedEntries.slice(1)) {
  if (e.type !== 'n') fail(`la voce ${e.num} non e di tipo n`);
  const expectedHead = `${e.num} 0 obj\n`;
  const actual = text.slice(e.offset, e.offset + expectedHead.length);
  if (actual !== expectedHead) {
    fail(
      `la voce ${e.num} dichiara offset ${e.offset}, ma li' ci sono ${JSON.stringify(actual)} ` +
        `invece di ${JSON.stringify(expectedHead)}`,
    );
  }
  const before = e.offset === 0 ? '\n' : text[e.offset - 1];
  if (before !== '\n') fail(`l oggetto ${e.num} non comincia a inizio riga (byte precedente ${JSON.stringify(before)})`);
}
pass(`${parsedEntries.length - 1} oggetti raggiungibili dall xref`);

check('nessun oggetto nel file e assente dall xref');
{
  const declaredOffsets = new Set(parsedEntries.slice(1).map((e) => e.offset));
  const re = /\n(\d+) 0 obj\n/g;
  let m;
  let found = 0;
  while ((m = re.exec(text)) !== null) {
    found++;
    const at = m.index + 1;
    if (!declaredOffsets.has(at)) fail(`l oggetto ${m[1]} all offset ${at} non compare nell xref`);
  }
  expectEqual(found, declaredCount - 1, 'numero di oggetti presenti nel file');
  pass(`${found} oggetti, tutti censiti`);
}

check('/Size nel trailer coincide col numero di voci');
const trailerStart = text.indexOf('trailer\n', xrefEnd);
expect(trailerStart === xrefEnd, `il trailer non segue immediatamente l xref (xref finisce a ${xrefEnd}, trailer a ${trailerStart})`);
const sizeMatch = /\/Size (\d+)/.exec(text.slice(trailerStart));
expect(sizeMatch, '/Size non trovato nel trailer');
expectEqual(Number(sizeMatch[1]), declaredCount, '/Size del trailer');
pass(`/Size ${declaredCount}`);

check('il trailer dichiara /Root e un /ID con due stringhe identiche di 16 byte');
const trailerText = text.slice(trailerStart, text.indexOf('startxref', trailerStart));
expect(/\/Root 1 0 R/.test(trailerText), '/Root 1 0 R non trovato nel trailer');
const idMatch = /\/ID \[<([0-9A-Fa-f]+)><([0-9A-Fa-f]+)>\]/.exec(trailerText);
expect(idMatch, '/ID non trovato o malformato nel trailer');
expectEqual(idMatch[1], idMatch[2], 'le due stringhe di /ID');
expectEqual(idMatch[1].length, 32, 'lunghezza in cifre esadecimali della stringa /ID (16 byte)');
pass(`/ID <${idMatch[1]}>`);

check('startxref punta esattamente alla parola chiave xref');
const startxrefStart = text.indexOf('startxref\n', trailerStart);
expect(startxrefStart !== -1, 'startxref non trovato');
const startxrefMatch = /^startxref\n(\d+)\n/.exec(text.slice(startxrefStart));
expect(startxrefMatch, 'valore di startxref illeggibile');
const startxrefValue = Number(startxrefMatch[1]);
expectEqual(startxrefValue, xrefStart, 'valore di startxref');
expect(text.startsWith('xref\n', startxrefValue), 'startxref non punta alla parola chiave xref');
pass(`startxref ${startxrefValue}`);

// ---------------------------------------------------------------------------
// 6. /Length del content stream
// ---------------------------------------------------------------------------

section('6. /Length del content stream');

/** Ricava dai byte i confini reali del content stream dell'oggetto 4. */
function measureContentStream(buf) {
  const s = buf.toString('latin1');
  const objStart = s.indexOf('\n4 0 obj\n') + 1;
  if (objStart <= 0) return null;
  const lengthMatch = /\/Length (\d+) >>/.exec(s.slice(objStart, objStart + 200));
  if (!lengthMatch) return null;
  const lengthValueStart = objStart + s.slice(objStart).indexOf(lengthMatch[1], lengthMatch.index);
  const streamKeyword = s.indexOf('stream\n', objStart);
  const dataStart = streamKeyword + 'stream\n'.length;
  const endstream = s.indexOf('\nendstream', dataStart);
  if (endstream === -1) return null;
  return {
    objStart,
    declaredLength: Number(lengthMatch[1]),
    lengthValueStart,
    lengthValueEnd: lengthValueStart + lengthMatch[1].length,
    dataStart,
    dataEnd: endstream,
    actualLength: endstream - dataStart,
  };
}

check('il valore di /Length coincide con i byte reali fra stream e endstream');
const cs = measureContentStream(bytes);
expect(cs, 'oggetto 4 o delimitatori stream/endstream non trovati');
expectEqual(cs.actualLength, cs.declaredLength, '/Length dichiarato contro byte reali');
pass(`${cs.declaredLength} byte, da ${cs.dataStart} a ${cs.dataEnd}`);

check('dopo endstream segue endobj');
expect(text.startsWith('\nendstream\nendobj\n', cs.dataEnd), 'la chiusura dell oggetto 4 non e "endstream" seguito da "endobj"');
pass();

// ---------------------------------------------------------------------------
// 7. Riscontro di sample-offsets.json, ricalcolato in modo indipendente
// ---------------------------------------------------------------------------

section('7. Riscontro degli offset congelati');

check('sample-offsets.json ha versione 2 e nome file corretto');
expectEqual(frozen.version, 2, 'version');
expectEqual(frozen.fileName, 'sample.pdf', 'fileName');
pass();

// Il rilievo che ha motivato questa famiglia di controlli: un consumatore che legge
// SOLO sample-offsets.json non aveva modo di sapere che quei numeri valgono per il
// campione non firmato e per nient'altro. Ora il vincolo sta dentro il JSON, e qui si
// pretende che ci resti.
check('appliesTo dichiara l ambito di validita degli offset');
expect(typeof frozen.appliesTo === 'string' && frozen.appliesTo.length >= 40, 'campo appliesTo assente o troppo vago');
expect(
  /pdflibAddPlaceholder/.test(frozen.appliesTo) && /pdf-lib/.test(frozen.appliesTo),
  'appliesTo non nomina l operazione che invalida gli offset (pdflibAddPlaceholder / pdf-lib)',
);
expect(frozen.appliesTo.includes(frozen.sha256.slice(0, 16)), 'appliesTo non riporta il prefisso dello sha256 a cui gli offset si riferiscono');
pass(frozen.appliesTo.slice(0, 72) + '...');

check('scope elenca cosa invalida gli offset, cosa li conserva e come rilocalizzarli');
{
  const sc = frozen.scope;
  expect(sc && typeof sc === 'object', 'campo scope assente');
  for (const key of ['documento', 'validoSe', 'invalidatoDa', 'conservatoDa', 'comeRilocalizzare', 'daRileggereDaiByte']) {
    expect(key in sc, `scope.${key} assente`);
  }
  expect(Array.isArray(sc.invalidatoDa) && sc.invalidatoDa.length >= 2, 'scope.invalidatoDa deve elencare almeno due operazioni');
  expect(
    sc.invalidatoDa.some((s) => /pdflibAddPlaceholder/.test(s)),
    'scope.invalidatoDa non nomina pdflibAddPlaceholder, che e il percorso vero della fase 2',
  );
  expect(sc.invalidatoDa.some((s) => /1b/.test(s)), 'scope.invalidatoDa non nomina l attacco 1b, che allunga il file');
  expect(
    Array.isArray(sc.conservatoDa) && sc.conservatoDa.some((s) => /incremental update/i.test(s)),
    'scope.conservatoDa non dice che un incremental update conserva gli offset',
  );
  expect(/relocate-offsets\.mjs/.test(sc.comeRilocalizzare), 'scope.comeRilocalizzare non indica l implementazione di riferimento');
  expect(existsSync(RELOCATOR), `scope.comeRilocalizzare cita ${path.relative(PROJECT_ROOT, RELOCATOR)}, che non esiste`);
  expect(
    Array.isArray(sc.daRileggereDaiByte) && ['objects', 'sections', 'xref'].every((k) => sc.daRileggereDaiByte.includes(k)),
    'scope.daRileggereDaiByte deve elencare almeno objects, sections e xref: sono i campi che nessuna ancora sa rilocalizzare',
  );
  pass(`${sc.invalidatoDa.length} operazioni invalidanti, ${sc.conservatoDa.length} conservative`);
}

check('fileLength e sha256');
expectEqual(frozen.fileLength, bytes.length, 'fileLength');
expectEqual(frozen.sha256, createHash('sha256').update(bytes).digest('hex'), 'sha256');
pass(`${bytes.length} byte, sha256 ${frozen.sha256.slice(0, 16)}...`);

check('objects[]: start e end di ogni oggetto ricalcolati dai byte');
{
  const expectedObjects = [
    { num: 1, type: 'Catalog' },
    { num: 2, type: 'Pages' },
    { num: 3, type: 'Page' },
    { num: 4, type: 'ContentStream' },
    { num: 5, type: 'Font' },
  ];
  expectEqual(frozen.objects.length, expectedObjects.length, 'numero di oggetti dichiarati');
  for (let i = 0; i < expectedObjects.length; i++) {
    const num = expectedObjects[i].num;
    const declared = frozen.objects[i];
    expectEqual(declared.num, num, `objects[${i}].num`);
    const head = `\n${num} 0 obj\n`;
    const start = text.indexOf(head) + 1;
    expect(start > 0, `oggetto ${num} non trovato nel file`);
    const endobj = text.indexOf('\nendobj\n', start);
    expect(endobj !== -1, `endobj dell oggetto ${num} non trovato`);
    const end = endobj + '\nendobj'.length;
    expectEqual(declared.start, start, `objects[${i}].start (oggetto ${num})`);
    expectEqual(declared.end, end, `objects[${i}].end (oggetto ${num})`);
    expect(typeof declared.label === 'string' && declared.label.length > 0, `objects[${i}].label mancante`);
    expect(text.slice(declared.end - 6, declared.end) === 'endobj', `objects[${i}].end non cade dopo "endobj"`);
  }
  pass('5 oggetti, confini confermati');
}

check('sections[]: identificatori attesi nell ordine giusto');
{
  const expectedIds = ['header', 'obj1', 'obj2', 'obj3', 'obj4', 'obj5', 'xref', 'trailer', 'startxref', 'eof'];
  const actualIds = frozen.sections.map((s) => s.id);
  expectEqual(actualIds.join(','), expectedIds.join(','), 'elenco degli id di sections');
  pass(expectedIds.join(' '));
}

check('sections[] tassella [0, fileLength) senza buchi ne sovrapposizioni');
{
  let cursor = 0;
  for (const s of frozen.sections) {
    if (s.start !== cursor) fail(`la sezione ${s.id} comincia a ${s.start} ma la precedente finisce a ${cursor}`);
    if (s.end <= s.start) fail(`la sezione ${s.id} ha estensione non positiva (${s.start}..${s.end})`);
    cursor = s.end;
  }
  expectEqual(cursor, bytes.length, 'fine dell ultima sezione');
  pass(`${frozen.sections.length} sezioni contigue, da 0 a ${bytes.length}`);
}

check('sections[]: ogni sezione contiene davvero cio che dichiara');
{
  const byId = Object.fromEntries(frozen.sections.map((s) => [s.id, s]));
  expectEqual(text.slice(byId.header.start, byId.header.end), '%PDF-1.7\n', 'contenuto della sezione header');
  for (let n = 1; n <= 5; n++) {
    const s = byId[`obj${n}`];
    const slice = text.slice(s.start, s.end);
    expect(slice.startsWith(`${n} 0 obj\n`), `la sezione obj${n} non comincia con "${n} 0 obj"`);
    expect(slice.endsWith('endobj\n'), `la sezione obj${n} non finisce con "endobj" e un LF`);
  }
  expect(text.slice(byId.xref.start, byId.xref.end).startsWith('xref\n'), 'la sezione xref non comincia con "xref"');
  expectEqual(byId.xref.start, xrefStart, 'sections.xref.start');
  expectEqual(byId.xref.end, xrefEnd, 'sections.xref.end');
  expect(text.slice(byId.trailer.start, byId.trailer.end).startsWith('trailer\n'), 'la sezione trailer non comincia con "trailer"');
  expectEqual(byId.trailer.start, trailerStart, 'sections.trailer.start');
  expect(
    text.slice(byId.startxref.start, byId.startxref.end).startsWith('startxref\n'),
    'la sezione startxref non comincia con "startxref"',
  );
  expectEqual(byId.startxref.start, startxrefStart, 'sections.startxref.start');
  expectEqual(text.slice(byId.eof.start, byId.eof.end), '%%EOF\n', 'contenuto della sezione eof');
  pass();
}

check('contentStream: dataStart, dataEnd, declaredLength e posizione del valore di /Length');
expectEqual(frozen.contentStream.objNum, 4, 'contentStream.objNum');
expectEqual(frozen.contentStream.dataStart, cs.dataStart, 'contentStream.dataStart');
expectEqual(frozen.contentStream.dataEnd, cs.dataEnd, 'contentStream.dataEnd');
expectEqual(frozen.contentStream.declaredLength, cs.declaredLength, 'contentStream.declaredLength');
expectEqual(frozen.contentStream.lengthValueStart, cs.lengthValueStart, 'contentStream.lengthValueStart');
expectEqual(frozen.contentStream.lengthValueEnd, cs.lengthValueEnd, 'contentStream.lengthValueEnd');
expectEqual(
  text.slice(frozen.contentStream.lengthValueStart, frozen.contentStream.lengthValueEnd),
  String(cs.declaredLength),
  'byte del valore di /Length',
);
pass();

check('amount.lineStart e multiplo di 16');
expectEqual(frozen.amount.lineStart % HEX_DUMP_ROW, 0, 'resto di amount.lineStart modulo 16');
pass(`${frozen.amount.lineStart} = 16 * ${frozen.amount.lineStart / HEX_DUMP_ROW}`);

check('amount: la riga dell importo sta dove dichiarato ed e una riga intera');
{
  const a = frozen.amount;
  expectEqual(text.slice(a.lineStart, a.lineEnd), AMOUNT_LINE, 'byte della riga dell importo');
  expectEqual(text[a.lineStart - 1], '\n', 'byte prima di amount.lineStart (deve essere un LF)');
  expectEqual(text[a.lineEnd], '\n', 'byte in amount.lineEnd (deve essere un LF)');
  expect(a.lineStart > cs.dataStart && a.lineEnd < cs.dataEnd, 'la riga dell importo non e dentro il content stream');
  // ricalcolo indipendente: nel file la riga compare una volta sola
  expectEqual(text.indexOf(AMOUNT_LINE), a.lineStart, 'prima occorrenza della riga dell importo');
  expectEqual(text.indexOf(AMOUNT_LINE, a.lineStart + 1), -1, 'la riga dell importo compare piu di una volta');
  pass(`offset ${a.lineStart}..${a.lineEnd}`);
}

check('amount: il byte in digitOffset vale 0x31 e le cifre sono 1.000');
{
  const a = frozen.amount;
  expectEqual(a.digitOffset, a.digitsStart, 'digitOffset deve coincidere con digitsStart');
  expectEqual(bytes[a.digitOffset], 0x31, `byte in digitOffset (0x${bytes[a.digitOffset].toString(16)})`);
  expectEqual(text.slice(a.digitsStart, a.digitsEnd), '1.000', 'byte digitsStart..digitsEnd');
  pass(`digitOffset ${a.digitOffset}`);
}

check('amount: i byte wordsStart..wordsEnd sono mille');
{
  const a = frozen.amount;
  expectEqual(text.slice(a.wordsStart, a.wordsEnd), 'mille', 'byte wordsStart..wordsEnd');
  expect(a.wordsStart > a.digitsEnd && a.wordsEnd <= frozen.amount.lineEnd, 'le lettere non stanno dentro la riga dell importo');
  pass(`wordsStart ${a.wordsStart}`);
}

check('signatureDrawing: intervallo dentro il content stream, con m / c / S e senza immagini');
{
  const d = frozen.signatureDrawing;
  expect(d.start >= cs.dataStart && d.end <= cs.dataEnd, 'il disegno della firma non e dentro il content stream');
  const drawing = text.slice(d.start, d.end);
  expect(/(^|\n)\d[\d .]* m(\n|$)/.test(drawing), 'nessun operatore m (moveto) nel disegno della firma');
  expect((drawing.match(/(^|\n)[\d .]+ c(\n|$)/g) || []).length >= 2, 'meno di due curve di Bezier (operatore c) nel disegno');
  expect(/(^|\n)S(\n|$)/.test(drawing), 'nessun operatore S (stroke) nel disegno della firma');
  expect(!/\bDo\b/.test(drawing) && !/BI\b/.test(drawing), 'il disegno della firma contiene XObject o immagini inline');
  expect(typeof d.label === 'string' && d.label.length > 0, 'signatureDrawing.label mancante');
  pass(`${d.end - d.start} byte di sola geometria`);
}

check('anchors[]: ogni ancora e ASCII, compare una volta sola e sta all offset dichiarato');
{
  expect(Array.isArray(frozen.anchors) && frozen.anchors.length >= 3, 'anchors[] assente o troppo povero');
  const ids = new Set();
  for (const a of frozen.anchors) {
    expect(typeof a.id === 'string' && a.id.length > 0, 'ancora senza id');
    expect(!ids.has(a.id), `ancora duplicata: ${a.id}`);
    ids.add(a.id);
    expect(typeof a.label === 'string' && a.label.length > 0, `anchors.${a.id}.label mancante`);
    expect(typeof a.text === 'string' && a.text.length >= 8, `anchors.${a.id}.text troppo corto per essere univoco`);
    for (let i = 0; i < a.text.length; i++) {
      if (a.text.charCodeAt(i) >= 0x80) fail(`anchors.${a.id}.text contiene un carattere fuori ASCII`);
    }
    const first = text.indexOf(a.text);
    expect(first !== -1, `anchors.${a.id}.text non compare nel file`);
    expectEqual(first, a.start, `anchors.${a.id}.start`);
    expectEqual(text.indexOf(a.text, first + 1), -1, `l ancora ${a.id} compare piu di una volta: non e un riferimento univoco`);
    expectEqual(a.end, a.start + a.text.length, `anchors.${a.id}.end`);
    // Il punto che rende le ancore utili: stanno nei DATI del content stream, che
    // pdf-lib ricopia verbatim. Un'ancora presa dalla sintassi PDF (dizionari, xref)
    // verrebbe riscritta e non ritroverebbe nulla.
    expect(
      a.start >= cs.dataStart && a.end <= cs.dataEnd,
      `l ancora ${a.id} (${a.start}..${a.end}) non sta dentro il content stream (${cs.dataStart}..${cs.dataEnd}): ` +
        'fuori di li non sopravvive a una riscrittura di pdf-lib',
    );
  }
  pass(`${frozen.anchors.length} ancore: ${frozen.anchors.map((a) => a.id).join(', ')}`);
}

check('anchors[].fields ricostruisce esattamente amount e signatureDrawing');
{
  const am = frozen.anchors.find((a) => a.id === 'amountLine');
  expect(am, 'ancora amountLine assente: gli attacchi 1a e 1b non avrebbero un bersaglio rilocalizzabile');
  expectEqual(am.text, AMOUNT_LINE, 'anchors.amountLine.text');
  for (const [field, expected] of [
    ['lineStart', frozen.amount.lineStart],
    ['lineEnd', frozen.amount.lineEnd],
    ['digitsStart', frozen.amount.digitsStart],
    ['digitsEnd', frozen.amount.digitsEnd],
    ['digitOffset', frozen.amount.digitOffset],
    ['wordsStart', frozen.amount.wordsStart],
    ['wordsEnd', frozen.amount.wordsEnd],
  ]) {
    expect(field in am.fields, `anchors.amountLine.fields.${field} assente`);
    expectEqual(am.start + am.fields[field], expected, `anchors.amountLine.start + fields.${field} contro amount.${field}`);
  }
  const sig = frozen.anchors.find((a) => a.id === 'signature');
  expect(sig, 'ancora signature assente');
  expectEqual(sig.start + sig.fields.start, frozen.signatureDrawing.start, 'anchors.signature -> signatureDrawing.start');
  expectEqual(sig.start + sig.fields.end, frozen.signatureDrawing.end, 'anchors.signature -> signatureDrawing.end');
  pass();
}

check('xref: il blocco congelato coincide con quello ricalcolato');
{
  const x = frozen.xref;
  expectEqual(x.start, xrefStart, 'xref.start');
  expectEqual(x.end, xrefEnd, 'xref.end');
  expectEqual(x.entries.length, parsedEntries.length, 'numero di voci xref');
  for (let i = 0; i < parsedEntries.length; i++) {
    expectEqual(x.entries[i].num, parsedEntries[i].num, `xref.entries[${i}].num`);
    expectEqual(x.entries[i].offset, parsedEntries[i].offset, `xref.entries[${i}].offset`);
    expectEqual(x.entries[i].gen, parsedEntries[i].gen, `xref.entries[${i}].gen`);
    expectEqual(x.entries[i].type, parsedEntries[i].type, `xref.entries[${i}].type`);
  }
  expectEqual(x.startxrefValue, startxrefValue, 'xref.startxrefValue');
  expectEqual(text.slice(x.startxrefValueStart, x.startxrefValueEnd), String(startxrefValue), 'byte del valore di startxref');
  pass();
}

check('objects[] e voci xref indicano gli stessi offset');
for (let i = 0; i < frozen.objects.length; i++) {
  expectEqual(frozen.objects[i].start, parsedEntries[i + 1].offset, `objects[${i}].start contro xref.entries[${i + 1}].offset`);
}
pass();

// ---------------------------------------------------------------------------
// 8. L'implementazione di riferimento della rilocalizzazione
// ---------------------------------------------------------------------------

section('8. Rilocalizzazione tramite ancore (relocate-offsets.mjs)');

check('relocate-offsets.mjs si importa e non ha dipendenze');
const { relocateOffsets } = await import(pathToFileURL(RELOCATOR).href);
{
  const src = readFileSync(RELOCATOR, 'utf8');
  const imports = src.match(/^\s*import\s.+$/gm) || [];
  expect(imports.length === 0, `relocate-offsets.mjs importa qualcosa (${imports.join(' | ')}): deve girare identico nel browser`);
  expect(typeof relocateOffsets === 'function', 'relocateOffsets non e esportata');
  pass('nessun import, funzione esportata');
}

check('sul campione intatto la rilocalizzazione conferma gli offset congelati');
{
  const r = relocateOffsets(new Uint8Array(bytes), frozen);
  expect(r.ok, `rilocalizzazione fallita sul campione stesso: ${r.problems.join(' | ')}`);
  expect(r.isPristineSample, 'il campione non e riconosciuto come intatto');
  expect(r.frozenOffsetsHold, 'le ancore non stanno agli offset congelati');
  for (const field of ['lineStart', 'lineEnd', 'digitsStart', 'digitsEnd', 'digitOffset', 'wordsStart', 'wordsEnd']) {
    expectEqual(r.amount[field], frozen.amount[field], `rilocalizzato amount.${field}`);
  }
  expectEqual(r.signatureDrawing.start, frozen.signatureDrawing.start, 'rilocalizzato signatureDrawing.start');
  expectEqual(r.signatureDrawing.end, frozen.signatureDrawing.end, 'rilocalizzato signatureDrawing.end');
  expectEqual(r.contentStream.objNum, frozen.contentStream.objNum, 'rilocalizzato contentStream.objNum');
  expectEqual(r.contentStream.dataStart, cs.dataStart, 'rilocalizzato contentStream.dataStart');
  expectEqual(r.contentStream.dataEnd, cs.dataEnd, 'rilocalizzato contentStream.dataEnd');
  expectEqual(r.contentStream.declaredLength, cs.declaredLength, 'rilocalizzato contentStream.declaredLength');
  expectEqual(r.contentStream.lengthValueStart, cs.lengthValueStart, 'rilocalizzato contentStream.lengthValueStart');
  expect(r.contentStream.lengthConsistent, 'rilocalizzato contentStream.lengthConsistent falso sul campione intatto');
  pass('stessi numeri del JSON, ricavati senza leggerli');
}

check('la rilocalizzazione si accorge quando il documento non e piu il campione');
{
  const mutato = Buffer.from(bytes);
  mutato[frozen.amount.digitOffset] = 0x39; // l attacco 1a distrugge l ancora amountLine
  const r = relocateOffsets(new Uint8Array(mutato), frozen);
  expect(!r.ok, 'la rilocalizzazione dichiara ok su un file in cui l ancora dell importo non esiste piu');
  expect(!r.isPristineSample, 'un file manomesso viene ancora dichiarato campione intatto');
  expect(r.problems.length > 0, 'nessun problema segnalato su un file manomesso');
  // le altre ancore reggono: il content stream resta misurabile per il pannello
  expect(r.contentStream && r.contentStream.lengthConsistent, 'content stream non piu misurabile dopo una modifica a lunghezza invariata');
  pass(`${r.problems.length} problemi dichiarati, content stream ancora misurabile`);
}

// ---------------------------------------------------------------------------
// 9. Simulazione dei due attacchi a valle
// ---------------------------------------------------------------------------

section('9. Simulazione degli attacchi previsti a valle');

check('attacks: il JSON dichiara i due attacchi e li ancora, invece di fidarsi degli offset');
{
  const at = frozen.attacks;
  expect(at && typeof at === 'object', 'campo attacks assente');
  expect(typeof at.applicabiliA === 'string' && /rilocalizza/i.test(at.applicabiliA), 'attacks.applicabiliA non avverte di rilocalizzare su un PDF firmato');
  expectEqual(at.tamperDigit.anchor.id, 'amountLine', 'attacks.tamperDigit.anchor.id');
  expectEqual(at.tamperWords.anchor.id, 'amountLine', 'attacks.tamperWords.anchor.id');
  expect(
    frozen.anchors.some((a) => a.id === at.tamperDigit.anchor.id && at.tamperDigit.anchor.field in a.fields),
    'attacks.tamperDigit.anchor punta a un campo che l ancora non ha',
  );
  pass('entrambi gli attacchi dichiarano l ancora del proprio bersaglio');
}

// --- 1a: ribaltamento del byte, lunghezza invariata ------------------------
check('attacco 1a: 1 diventa 9, lunghezza invariata, il documento resta leggibile');
const tampered1a = Buffer.from(bytes);
tampered1a[frozen.amount.digitOffset] = 0x39;
expectEqual(tampered1a.length, bytes.length, 'lunghezza dopo l attacco 1a');
{
  const diff = [];
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== tampered1a[i]) diff.push(i);
  expectEqual(diff.length, 1, 'numero di byte modificati dall attacco 1a');
  expectEqual(diff[0], frozen.amount.digitOffset, 'offset del byte modificato');
}
let after1a;
try {
  after1a = await openWithPdfJs(tampered1a);
} catch (err) {
  fail(`pdf.js non apre piu il documento dopo l attacco 1a: ${err && err.message}`);
}
expect(
  after1a.joined.includes('9.000 euro (mille euro)'),
  `dopo l attacco 1a il testo estratto non contiene "9.000 euro (mille euro)": ${JSON.stringify(after1a.items)}`,
);
{
  const cs1a = measureContentStream(tampered1a);
  expectEqual(cs1a.actualLength, cs1a.declaredLength, '/Length dopo l attacco 1a (deve restare coerente)');
}
{
  // le previsioni del JSON, confrontate con la misura
  const a1 = frozen.attacks.tamperDigit;
  expectEqual(a1.offset, frozen.amount.digitOffset, 'attacks.tamperDigit.offset');
  expectEqual(a1.fromByte, bytes[frozen.amount.digitOffset], 'attacks.tamperDigit.fromByte');
  expectEqual(a1.toByte, 0x39, 'attacks.tamperDigit.toByte');
  expectEqual(a1.deltaLength, tampered1a.length - bytes.length, 'attacks.tamperDigit.deltaLength');
  expectEqual(a1.structureIntact, true, 'attacks.tamperDigit.structureIntact');
  expect(after1a.joined.includes(a1.textAfter), `attacks.tamperDigit.textAfter (${JSON.stringify(a1.textAfter)}) non e cio che pdf.js estrae`);
  expectEqual(a1.renderersOpenAfter, true, 'attacks.tamperDigit.renderersOpenAfter contro la misura appena fatta');
}
pass('incoerenza cifre/lettere visibile, struttura intatta, previsioni del JSON confermate');

// --- 1b: mille -> novemila, +3 byte ----------------------------------------
check('attacco 1b: mille diventa novemila, +3 byte, struttura rotta');
const tampered1bText =
  text.slice(0, frozen.amount.wordsStart) + TAMPER_WORDS_TO + text.slice(frozen.amount.wordsEnd);
const tampered1b = Buffer.from(tampered1bText, 'latin1');
const delta1b = TAMPER_WORDS_TO.length - TAMPER_WORDS_FROM.length;
expectEqual(tampered1b.length, bytes.length + delta1b, 'lunghezza dopo l attacco 1b');
const evidence1b = Object.fromEntries((frozen.attacks.tamperWords.evidence || []).map((e) => [e.id, e]));
{
  const w = frozen.attacks.tamperWords;
  expectEqual(w.start, frozen.amount.wordsStart, 'attacks.tamperWords.start');
  expectEqual(w.end, frozen.amount.wordsEnd, 'attacks.tamperWords.end');
  expectEqual(w.from, TAMPER_WORDS_FROM, 'attacks.tamperWords.from');
  expectEqual(w.to, TAMPER_WORDS_TO, 'attacks.tamperWords.to');
  expectEqual(w.deltaLength, delta1b, 'attacks.tamperWords.deltaLength');

  const cs1b = measureContentStream(tampered1b);
  expect(cs1b, 'content stream non piu individuabile dopo l attacco 1b');
  expectEqual(cs1b.declaredLength, cs.declaredLength, '/Length dichiarato dopo l attacco 1b (non viene riparato)');
  expect(
    cs1b.actualLength !== cs1b.declaredLength,
    `l attacco 1b non ha rotto /Length: dichiarato ${cs1b.declaredLength}, reale ${cs1b.actualLength}`,
  );
  expectEqual(cs1b.actualLength, cs.declaredLength + delta1b, 'byte reali del content stream dopo l attacco 1b');

  // prova 1 di 3: /Length dichiarato contro byte reali
  expect(evidence1b.length, 'attacks.tamperWords.evidence non contiene la prova "length"');
  expectEqual(evidence1b.length.declared, cs1b.declaredLength, 'evidence.length.declared');
  expectEqual(evidence1b.length.actual, cs1b.actualLength, 'evidence.length.actual');
  expectEqual(evidence1b.length.valueStart, cs.lengthValueStart, 'evidence.length.valueStart');
  expectEqual(evidence1b.length.valueEnd, cs.lengthValueEnd, 'evidence.length.valueEnd');

  // prova 2 di 3: gli offset xref successivi al punto di modifica non puntano piu a "N 0 obj"
  const t1b = tampered1b.toString('latin1');
  const broken = [];
  for (const e of parsedEntries.slice(1)) {
    const head = `${e.num} 0 obj\n`;
    if (t1b.slice(e.offset, e.offset + head.length) !== head) broken.push(e.num);
  }
  const shouldBreak = parsedEntries.slice(1).filter((e) => e.offset > frozen.amount.wordsStart).map((e) => e.num);
  expect(shouldBreak.length > 0, 'nessun oggetto segue il punto di modifica: l attacco 1b non dimostrerebbe nulla');
  expectEqual(broken.join(','), shouldBreak.join(','), 'oggetti i cui offset xref sono ora sbagliati');
  expect(evidence1b.xref, 'attacks.tamperWords.evidence non contiene la prova "xref"');
  expectEqual(evidence1b.xref.brokenObjects.join(','), broken.join(','), 'evidence.xref.brokenObjects');
  for (const entry of evidence1b.xref.entries) {
    const dichiarato = parsedEntries.find((e) => e.num === entry.num);
    expectEqual(entry.declaredOffset, dichiarato.offset, `evidence.xref.entries[${entry.num}].declaredOffset`);
    expect(
      t1b.startsWith(`${entry.num} 0 obj\n`, entry.actualOffset),
      `evidence.xref.entries[${entry.num}].actualOffset ${entry.actualOffset} non e dove l oggetto e finito davvero`,
    );
    expect(
      !t1b.startsWith(`${entry.num} 0 obj\n`, entry.declaredOffset),
      `l oggetto ${entry.num} sta ancora all offset dichiarato: l attacco 1b non ha rotto l xref`,
    );
  }

  // prova 3 di 3: startxref punta dove la tabella non e piu
  const xrefReale1b = t1b.lastIndexOf('\nxref\n') + 1;
  expect(evidence1b.startxref, 'attacks.tamperWords.evidence non contiene la prova "startxref"');
  expectEqual(evidence1b.startxref.declared, startxrefValue, 'evidence.startxref.declared');
  expectEqual(evidence1b.startxref.actual, xrefReale1b, 'evidence.startxref.actual');
  expectEqual(evidence1b.startxref.actual, startxrefValue + delta1b, 'evidence.startxref.actual contro lo scostamento atteso');
  expect(
    !t1b.startsWith('xref\n', evidence1b.startxref.declared),
    'startxref punta ancora alla tabella dopo l attacco 1b: la terza prova non regge',
  );
  expectEqual(
    text.slice(evidence1b.startxref.valueStart, evidence1b.startxref.valueEnd),
    String(startxrefValue),
    'byte del valore di startxref indicati da evidence.startxref',
  );

  pass(
    `/Length ${cs1b.declaredLength} contro ${cs1b.actualLength}; xref rotto per gli oggetti ${broken.join(', ')}; ` +
      `startxref ${evidence1b.startxref.declared} contro tabella reale a ${evidence1b.startxref.actual}`,
  );
}

// Qui viveva la premessa sbagliata del piano ("pdf.js si rifiuta di renderizzare").
// La reazione dei renderer si MISURA, e il JSON deve dichiarare cio' che si misura:
// se un domani pdf.js diventasse severo, questo controllo fallisce e costringe ad
// aggiornare attacks.tamperWords.renderersOpenAfter, la documentazione e il pannello.
check('attacco 1b: la reazione misurata dei renderer coincide con quella dichiarata nel JSON');
{
  const atteso = frozen.attacks.tamperWords;
  expect(typeof atteso.renderersOpenAfter === 'boolean', 'attacks.tamperWords.renderersOpenAfter assente');
  expect(
    typeof atteso.premessaDelPianoSmentita === 'string' && atteso.premessaDelPianoSmentita.length > 40,
    'attacks.tamperWords.premessaDelPianoSmentita assente: la premessa del piano va smentita nei dati, non solo a voce',
  );

  let pdfjsApre = false;
  let esitoPdfJs;
  let testoPdfJs = null;
  try {
    const after1b = await openWithPdfJs(tampered1b);
    pdfjsApre = true;
    const paths = after1b.ops.fnArray.filter((f) => f === OPS.constructPath).length;
    testoPdfJs = after1b.items.find((s) => s.includes('euro')) || null;
    esitoPdfJs =
      `pdf.js APRE ancora il documento e lo renderizza: ${after1b.numPages} pagina, ` +
      `${paths} percorsi (la firma vettoriale sopravvive), importo estratto ${JSON.stringify(testoPdfJs)}`;
  } catch (err) {
    esitoPdfJs = `pdf.js RIFIUTA il documento: ${err && err.name}: ${err && err.message}`;
  }
  note(`attacco 1b, pdf.js -- ${esitoPdfJs}`);

  let popplerApre = false;
  let esitoPoppler;
  let testoPoppler = null;
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'sample-pdf-1b-'));
  const tmpPdf = path.join(tmpDir, 'tampered-1b.pdf');
  try {
    writeFileSync(tmpPdf, tampered1b);
    const out = execFileSync('pdftotext', ['-layout', tmpPdf, '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    testoPoppler = (out.split('\n').find((l) => l.includes('euro')) || '').trim() || null;
    popplerApre = testoPoppler !== null;
    esitoPoppler = `poppler estrae ancora il testo, importo ${JSON.stringify(testoPoppler)}`;
  } catch (err) {
    esitoPoppler = `poppler RIFIUTA il documento: ${(err.stderr || err.message || '').toString().trim()}`;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  note(`attacco 1b, poppler -- ${esitoPoppler}`);

  const misurato = pdfjsApre && popplerApre;
  expectEqual(
    atteso.renderersOpenAfter,
    misurato,
    'attacks.tamperWords.renderersOpenAfter contro la misura (aggiornare JSON, docs/pdf-campione.md e il pannello della fase 4)',
  );
  if (misurato) {
    expect(
      testoPdfJs === atteso.textAfter,
      `pdf.js estrae ${JSON.stringify(testoPdfJs)} invece del dichiarato ${JSON.stringify(atteso.textAfter)}`,
    );
    expect(
      testoPoppler === atteso.textAfter,
      `poppler estrae ${JSON.stringify(testoPoppler)} invece del dichiarato ${JSON.stringify(atteso.textAfter)}`,
    );
  }
  pass(`dichiarato renderersOpenAfter=${atteso.renderersOpenAfter}, misurato ${misurato}`);
}

// --- controprova: gli attacchi non toccano nulla su disco -------------------
check('il file su disco non e stato modificato dalle simulazioni');
expectEqual(createHash('sha256').update(readFileSync(PDF_PATH)).digest('hex'), frozen.sha256, 'sha256 del file su disco');
pass();

// ---------------------------------------------------------------------------
// 10. Tenuta degli offset FUORI dal campione
//     Il rilievo era questo: gli offset congelati sono corretti per sample.pdf ma
//     non sopravvivono al placeholder PAdES, e applicarli lo stesso corrompe la riga
//     sbagliata. Qui la trappola viene fatta scattare apposta, ogni volta.
// ---------------------------------------------------------------------------

section('10. Tenuta degli offset fuori dal campione');

check('il percorso vero della fase 2 (pdf-lib + @signpdf/placeholder-pdf-lib) e eseguibile');
let placeholderBytes = null;
try {
  const { PDFDocument } = await import('pdf-lib');
  const { pdflibAddPlaceholder } = await import('@signpdf/placeholder-pdf-lib');
  const doc = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
  pdflibAddPlaceholder({ pdfDoc: doc, ...PLACEHOLDER_OPTIONS });
  placeholderBytes = Buffer.from(await doc.save({ useObjectStreams: false }));
} catch (err) {
  fail(`impossibile costruire il placeholder PAdES: ${err && err.message}`);
}
const placeholderText = placeholderBytes.toString('latin1');
expect(placeholderText.includes('/ETSI.CAdES.detached'), 'il placeholder non e PAdES: subFilter ETSI.CAdES.detached assente');
expect(/\/ByteRange \[/.test(placeholderText), '/ByteRange assente dal placeholder');
pass(`${bytes.length} -> ${placeholderBytes.length} byte, subFilter ETSI.CAdES.detached, /ByteRange presente`);

check('applicare gli offset congelati al file col placeholder colpirebbe la riga sbagliata');
{
  let commonPrefix = 0;
  while (
    commonPrefix < Math.min(bytes.length, placeholderBytes.length) &&
    bytes[commonPrefix] === placeholderBytes[commonPrefix]
  ) {
    commonPrefix++;
  }
  const rigaAncoraLi = placeholderText.slice(frozen.amount.lineStart, frozen.amount.lineEnd) === AMOUNT_LINE;
  if (rigaAncoraLi) {
    note(
      'pdf-lib ha conservato la posizione della riga dell importo: la dichiarazione di scope e piu conservativa ' +
        'del comportamento misurato, il che va bene. Nessun consumatore ne resta danneggiato.',
    );
    pass(`prefisso comune ${commonPrefix} byte, offset congelati ancora validi`);
  } else {
    // Il JSON DEVE dichiarare questa invalidazione: e' l'unico modo perche' un agente
    // che legge solo sample-offsets.json non ci caschi.
    expect(
      /pdflibAddPlaceholder/.test(frozen.appliesTo) || frozen.scope.invalidatoDa.some((s) => /pdflibAddPlaceholder/.test(s)),
      'gli offset congelati non valgono piu dopo il placeholder e il JSON non lo dichiara',
    );
    const colpito = Buffer.from(placeholderBytes);
    colpito[frozen.amount.digitOffset] = 0x39;
    const contesto = colpito.toString('latin1').slice(frozen.amount.digitOffset - 34, frozen.amount.digitOffset + 6);
    note(
      `applicare digitOffset ${frozen.amount.digitOffset} al file col placeholder scrive qui: ` +
        `${JSON.stringify(contesto)} - non sulla riga dell importo`,
    );
    pass(`prefisso comune ${commonPrefix} byte su ${bytes.length}: pdf-lib riscrive, gli offset congelati non valgono`);
  }
}

check('la rilocalizzazione trova i bersagli nel file col placeholder, e l attacco 1a colpisce davvero');
{
  const r = relocateOffsets(new Uint8Array(placeholderBytes), frozen);
  expect(r.ok, `rilocalizzazione fallita sul file col placeholder: ${r.problems.join(' | ')}`);
  expect(!r.isPristineSample, 'il file col placeholder viene scambiato per il campione intatto');
  expectEqual(placeholderText.slice(r.amount.digitsStart, r.amount.digitsEnd), frozen.amount.digits, 'cifre all offset rilocalizzato');
  expectEqual(placeholderText.slice(r.amount.wordsStart, r.amount.wordsEnd), frozen.amount.words, 'lettere all offset rilocalizzato');
  expectEqual(placeholderText.slice(r.amount.lineStart, r.amount.lineEnd), AMOUNT_LINE, 'riga dell importo all offset rilocalizzato');

  // controprova a valle: l'attacco 1a fatto sugli offset rilocalizzati produce
  // "9.000 euro (mille euro)" anche sul PDF che la fase 2 firmera' davvero.
  const colpito = Buffer.from(placeholderBytes);
  colpito[r.amount.digitOffset] = 0x39;
  let after;
  try {
    after = await openWithPdfJs(colpito);
  } catch (err) {
    fail(`pdf.js non apre il file col placeholder dopo l attacco 1a rilocalizzato: ${err && err.message}`);
  }
  expect(
    after.joined.includes(frozen.attacks.tamperDigit.textAfter),
    `dopo l attacco 1a rilocalizzato il testo estratto non contiene ${JSON.stringify(frozen.attacks.tamperDigit.textAfter)}: ` +
      JSON.stringify(after.items),
  );
  expectEqual(colpito.length, placeholderBytes.length, 'lunghezza dopo l attacco 1a rilocalizzato');
  pass(`riga dell importo a ${r.amount.lineStart} (congelata ${frozen.amount.lineStart}), attacco 1a efficace`);
}

// L'altra strada: un incremental update appeso in coda. E' la tecnica dell'attacco 2,
// ed e' anche l'unica che permetterebbe di firmare senza buttare via il campione.
// Se un giorno smettesse di funzionare, la fase 2 deve saperlo prima di scriverci sopra.
check('un incremental update appeso conserva TUTTI gli offset congelati');
{
  const csText = text.slice(cs.dataStart, cs.dataEnd);
  const nuovoCs = csText.replace(AMOUNT_LINE, '(9.000 euro (novemila euro)) Tj');
  expect(nuovoCs !== csText, 'la riga dell importo non e stata sostituita nel content stream della nuova revisione');
  const pad10 = (n) => String(n).padStart(10, '0');
  const objStart = bytes.length;
  const nuovoObj = `4 0 obj\n<< /Length ${nuovoCs.length} >>\nstream\n${nuovoCs}\nendstream\nendobj\n`;
  const nuovoXref = objStart + nuovoObj.length;
  const idMatch2 = /\/ID \[<([0-9A-Fa-f]+)>/.exec(text);
  const coda =
    `xref\n0 1\n${pad10(0)} 65535 f \n4 1\n${pad10(objStart)} 00000 n \n` +
    `trailer\n<< /Size 6 /Root 1 0 R /Prev ${xrefStart} /ID [<${idMatch2[1]}><${idMatch2[1]}>] >>\n` +
    `startxref\n${nuovoXref}\n%%EOF\n`;
  const esteso = Buffer.from(text + nuovoObj + coda, 'latin1');

  expect(esteso.subarray(0, bytes.length).equals(bytes), 'l incremental update non e un append puro: il prefisso e cambiato');
  const s = esteso.toString('latin1');
  for (const o of frozen.objects) {
    expect(s.startsWith(`${o.num} 0 obj\n`, o.start), `dopo l append l oggetto ${o.num} non e piu all offset congelato ${o.start}`);
  }
  expectEqual(s.slice(frozen.amount.lineStart, frozen.amount.lineEnd), AMOUNT_LINE, 'riga dell importo dopo l append');
  expectEqual(s[frozen.amount.digitOffset], '1', 'byte in digitOffset dopo l append');
  expect(s.startsWith('xref\n', frozen.xref.start), 'la prima tabella xref non e piu all offset congelato');

  // ...ma sections non copre piu il file: e' l'unico campo che l append invalida.
  const copertura = frozen.sections[frozen.sections.length - 1].end;
  expect(copertura < esteso.length, 'sections copre ancora tutto il file: l append non ha aggiunto byte?');

  let after;
  try {
    after = await openWithPdfJs(esteso);
  } catch (err) {
    fail(`pdf.js non apre il file esteso con incremental update: ${err && err.message}`);
  }
  expect(
    after.joined.includes('9.000 euro (novemila euro)'),
    `pdf.js non ha ridisegnato la revisione nuova: ${JSON.stringify(after.items)}`,
  );
  note(
    `incremental update: ${bytes.length} -> ${esteso.length} byte, prefisso identico, ogni offset congelato regge, ` +
      `sections copre ${copertura} di ${esteso.length} byte (la coda resta scoperta, come vuole l attacco 2)`,
  );
  pass('append puro, offset congelati intatti, pdf.js ridisegna il testo nuovo');
}

check('il file su disco non e stato modificato da questa sezione');
expectEqual(createHash('sha256').update(readFileSync(PDF_PATH)).digest('hex'), frozen.sha256, 'sha256 del file su disco');
pass();

// ---------------------------------------------------------------------------
// 11. Dimensione
// ---------------------------------------------------------------------------

section('11. Dimensione');
check(`il file sta entro ${MAX_SIZE} byte`);
expect(bytes.length <= MAX_SIZE, `il file pesa ${bytes.length} byte, oltre il limite di ${MAX_SIZE}`);
pass(`${bytes.length} byte (${((bytes.length / MAX_SIZE) * 100).toFixed(0)}% del limite)`);

// ---------------------------------------------------------------------------
// 12. Determinismo
// ---------------------------------------------------------------------------

section('12. Determinismo del generatore');
check('due esecuzioni del generatore producono byte identici');
{
  const tmpA = mkdtempSync(path.join(os.tmpdir(), 'sample-pdf-a-'));
  const tmpB = mkdtempSync(path.join(os.tmpdir(), 'sample-pdf-b-'));
  try {
    for (const dir of [tmpA, tmpB]) {
      execFileSync(process.execPath, [GENERATOR, '--out-dir', dir, '--quiet'], { stdio: ['ignore', 'pipe', 'pipe'] });
    }
    const a = readFileSync(path.join(tmpA, 'sample.pdf'));
    const b = readFileSync(path.join(tmpB, 'sample.pdf'));
    expect(a.equals(b), 'due esecuzioni del generatore danno byte diversi');
    expect(a.equals(bytes), 'il generatore non riproduce il file presente in src/assets: rilanciare "npm run pdf"');
    const ja = readFileSync(path.join(tmpA, 'sample-offsets.json'), 'utf8');
    const jb = readFileSync(path.join(tmpB, 'sample-offsets.json'), 'utf8');
    expect(ja === jb, 'due esecuzioni del generatore danno offset diversi');
    expect(ja === readFileSync(OFFSETS_PATH, 'utf8'), 'sample-offsets.json su disco non corrisponde al generatore');
    pass('byte identici e offset identici, file su disco compreso');
  } finally {
    rmSync(tmpA, { recursive: true, force: true });
    rmSync(tmpB, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

console.log('\n== Riepilogo');
console.log(`  file            ${path.relative(PROJECT_ROOT, PDF_PATH)}`);
console.log(`  dimensione      ${bytes.length} byte`);
console.log(`  sha256          ${frozen.sha256}`);
console.log(`  /Length         ${cs.declaredLength} (dati ${cs.dataStart}..${cs.dataEnd})`);
console.log(`  riga importo    ${frozen.amount.lineStart} (16 * ${frozen.amount.lineStart / 16})`);
console.log(`  cifra 1 -> 9    offset ${frozen.amount.digitOffset}`);
console.log(`  mille           offset ${frozen.amount.wordsStart}..${frozen.amount.wordsEnd}`);
console.log(`  xref            offset ${xrefStart}, startxref ${startxrefValue}`);
if (notes.length) {
  console.log('  note:');
  for (const n of notes) console.log(`    - ${n}`);
}
console.log('\nTutti i controlli superati.');
process.exit(0);
