/**
 * build-sample-pdf.mjs — costruzione in memoria del PDF campione "trasparente".
 *
 * Questo modulo NON scrive nulla su disco: espone `buildSamplePdf()`, che restituisce
 * i byte del file e la mappa completa degli offset. Lo usano sia il generatore
 * (make-sample-pdf.mjs) sia l'esperimento pdf-lib (exp-pdflib-roundtrip.mjs).
 *
 * Principi non negoziabili:
 *  - ogni byte del file e' emesso da una stringa letterale di questo file, nessuna libreria;
 *  - ASCII puro (< 0x80), fine riga solo LF, nessuna compressione, nessun /Filter;
 *  - nessun /Info: una data di creazione romperebbe la riproducibilita' byte per byte;
 *  - /ID fisso, cablato qui sotto, per lo stesso motivo.
 *
 * Gli offset prodotti valgono per QUESTO file e basta. Il JSON lo dichiara da se'
 * (campi `appliesTo` e `scope`) e porta con se' le ancore che permettono di
 * ritrovare gli stessi punti in un file riscritto: vedi relocate-offsets.mjs.
 */

import { createHash } from 'node:crypto';

/** /ID del trailer: due stringhe esadecimali IDENTICHE da 16 byte, valore costante. */
const FIXED_ID_HEX = '0A1B2C3D4E5F60718293A4B5C6D7E8F9';

/** Il vincolo di allineamento della riga dell'importo nel dump esadecimale. */
const HEX_DUMP_ROW = 16;

/** Le righe del documento, come devono comparire nel testo estratto. */
export const EXPECTED_TEXT_LINES = [
  'PROMESSA DI PAGAMENTO',
  'Documento dimostrativo, privo di valore legale.',
  'Io sottoscritto Lorenzo Rossi prometto di pagare',
  'al signor Mario Bianchi la somma di',
  '1.000 euro (mille euro)',
  'entro il giorno 30 settembre 2026.',
  'Roma, 10 agosto 2026',
];

/** L'importo come lo legge un umano: e' anche cio' che i renderer estraggono. */
export const AMOUNT_TEXT = '1.000 euro (mille euro)';
/** La riga dell'importo, cosi' come compare nel content stream (senza il LF finale). */
export const AMOUNT_LINE = `(${AMOUNT_TEXT}) Tj`;
export const AMOUNT_DIGITS = '1.000';
export const AMOUNT_WORDS = 'mille';
/** La parola con cui l'attacco 1b sostituisce `mille`: piu' lunga di 3 byte. */
export const TAMPER_WORDS_TO = 'novemila';

// ---------------------------------------------------------------------------
// Content stream
// ---------------------------------------------------------------------------

/**
 * Righe del content stream che precedono la riga dell'importo.
 * Il testo e' in chiaro: nel dump si legge come prosa.
 */
const CONTENT_BEFORE = [
  'BT',
  '/F1 18 Tf',
  '70 762 Td',
  '(PROMESSA DI PAGAMENTO) Tj',
  'ET',
  'BT',
  '/F1 12 Tf',
  '70 734 Td',
  '(Documento dimostrativo, privo di valore legale.) Tj',
  'ET',
  'BT',
  '/F1 12 Tf',
  '70 696 Td',
  '(Io sottoscritto Lorenzo Rossi prometto di pagare) Tj',
  '0 -18 Td',
  '(al signor Mario Bianchi la somma di) Tj',
  'ET',
  'BT',
  '/F1 15 Tf',
  '110 636 Td',
];

/** Righe del content stream fra l'importo e il disegno della firma. */
const CONTENT_AFTER_AMOUNT = [
  'ET',
  'BT',
  '/F1 12 Tf',
  '70 596 Td',
  '(entro il giorno 30 settembre 2026.) Tj',
  'ET',
  'BT',
  '/F1 12 Tf',
  '70 556 Td',
  '(Roma, 10 agosto 2026) Tj',
  'ET',
];

/**
 * Firma autografa: SOLO geometria. moveto (m), curve di Bezier (c), stroke (S).
 * Nessuna immagine, nessun XObject, nessun pattern: nel dump si vede che il
 * ghirigoro e' una manciata di coordinate, non un'immagine scansionata.
 */
const CONTENT_SIGNATURE = [
  'q',
  '1.1 w',
  '1 J',
  '1 j',
  '0.10 0.13 0.45 RG',
  '78 502 m',
  '86 538 98 550 106 524 c',
  '113 502 103 487 97 501 c',
  '104 529 127 540 143 514 c',
  '157 492 167 525 179 519 c',
  '191 513 195 489 213 513 c',
  'S',
  '84 489 m',
  '130 481 178 495 217 485 c',
  'S',
  'Q',
];

/**
 * Assembla il content stream con `padCount` spazi di riempimento inseriti,
 * su una riga propria, immediatamente PRIMA della riga dell'importo.
 * Gli spazi sono whitespace fra operatori: non alterano il rendering.
 */
function buildContentStream(padCount) {
  const lines = [
    ...CONTENT_BEFORE,
    ' '.repeat(padCount), // riga di riempimento: sposta l'importo fino all'allineamento
    AMOUNT_LINE,
    ...CONTENT_AFTER_AMOUNT,
    ...CONTENT_SIGNATURE,
  ];

  const padIndex = CONTENT_BEFORE.length;
  const amountIndex = padIndex + 1;
  const signatureIndex = amountIndex + 1 + CONTENT_AFTER_AMOUNT.length;

  // offset (dentro il content stream) di inizio di ogni riga
  const lineStarts = [];
  let cursor = 0;
  for (const line of lines) {
    lineStarts.push(cursor);
    cursor += line.length + 1; // +1 per il LF che separa le righe
  }
  const text = lines.join('\n'); // NIENTE LF finale: /Length conta esattamente questi byte

  const signatureStart = lineStarts[signatureIndex];
  const signatureEnd = text.length; // il blocco firma chiude il content stream

  return {
    text,
    amountLineStart: lineStarts[amountIndex],
    amountLineEnd: lineStarts[amountIndex] + AMOUNT_LINE.length,
    signatureStart,
    signatureEnd,
  };
}

// ---------------------------------------------------------------------------
// File PDF
// ---------------------------------------------------------------------------

function xrefEntry(offset, gen, type) {
  return `${String(offset).padStart(10, '0')} ${String(gen).padStart(5, '0')} ${type} \n`;
}

/** Costruisce l'intero file per un dato numero di spazi di riempimento. */
function assemble(padCount) {
  const cs = buildContentStream(padCount);
  const declaredLength = cs.text.length;

  // Emettitore che tiene il conto degli offset assoluti mentre scrive.
  const chunks = [];
  let pos = 0;
  const emit = (s) => {
    const start = pos;
    chunks.push(s);
    pos += s.length;
    return { start, end: pos };
  };

  const header = emit('%PDF-1.7\n');

  const obj1Start = pos;
  emit('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  const obj1End = pos;
  emit('\n');
  const obj1Section = { start: obj1Start, end: pos };

  const obj2Start = pos;
  emit('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
  const obj2End = pos;
  emit('\n');
  const obj2Section = { start: obj2Start, end: pos };

  const obj3Start = pos;
  emit(
    '3 0 obj\n' +
      '<< /Type /Page\n' +
      '   /Parent 2 0 R\n' +
      '   /MediaBox [0 0 595 842]\n' +
      '   /Resources << /Font << /F1 5 0 R >> >>\n' +
      '   /Contents 4 0 R\n' +
      '>>\n' +
      'endobj',
  );
  const obj3End = pos;
  emit('\n');
  const obj3Section = { start: obj3Start, end: pos };

  const obj4Start = pos;
  emit('4 0 obj\n<< /Length ');
  const lengthValue = emit(String(declaredLength));
  emit(' >>\nstream\n');
  const streamData = emit(cs.text);
  emit('\nendstream\nendobj');
  const obj4End = pos;
  emit('\n');
  const obj4Section = { start: obj4Start, end: pos };

  const obj5Start = pos;
  emit('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>\nendobj');
  const obj5End = pos;
  emit('\n');
  const obj5Section = { start: obj5Start, end: pos };

  const objectStarts = [obj1Start, obj2Start, obj3Start, obj4Start, obj5Start];

  const xrefStart = pos;
  emit('xref\n0 6\n');
  emit(xrefEntry(0, 65535, 'f'));
  for (const off of objectStarts) emit(xrefEntry(off, 0, 'n'));
  const xrefSection = { start: xrefStart, end: pos };

  const trailerStart = pos;
  emit(
    'trailer\n' +
      `<< /Size 6 /Root 1 0 R /ID [<${FIXED_ID_HEX}><${FIXED_ID_HEX}>] >>\n`,
  );
  const trailerSection = { start: trailerStart, end: pos };

  const startxrefStart = pos;
  emit('startxref\n');
  const startxrefValue = emit(String(xrefStart));
  emit('\n');
  const startxrefSection = { start: startxrefStart, end: pos };

  const eofStart = pos;
  emit('%%EOF\n');
  const eofSection = { start: eofStart, end: pos };

  const text = chunks.join('');
  const bytes = Buffer.from(text, 'latin1');

  const amountLineStart = streamData.start + cs.amountLineStart;
  const amountLineEnd = streamData.start + cs.amountLineEnd;
  const digitsInLine = AMOUNT_LINE.indexOf(AMOUNT_DIGITS);
  const wordsInLine = AMOUNT_LINE.indexOf(AMOUNT_WORDS);
  const digitsStart = amountLineStart + digitsInLine;
  const wordsStart = amountLineStart + wordsInLine;
  const signatureStart = streamData.start + cs.signatureStart;
  const signatureEnd = streamData.start + cs.signatureEnd;
  const signatureText = cs.text.slice(cs.signatureStart, cs.signatureEnd);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  // --- ancore: come ritrovare questi punti in un file che non e' piu' il campione ---
  // Sono stringhe letterali prese dai DATI del content stream, non dalla sintassi PDF:
  // pdf-lib riscrive la sintassi (dizionari, xref, trailer) ma ricopia i dati dello
  // stream byte per byte, quindi queste stringhe sopravvivono alla riscrittura.
  // Ogni ancora compare UNA VOLTA SOLA nel file: e' il validatore a pretenderlo.
  const anchorSpecs = [
    { id: 'title', label: 'Titolo del documento', text: '(PROMESSA DI PAGAMENTO) Tj', fields: {} },
    {
      id: 'disclaimer',
      label: 'Marcatura "privo di valore legale"',
      text: '(Documento dimostrativo, privo di valore legale.) Tj',
      fields: {},
    },
    {
      id: 'amountLine',
      label: 'Riga dell importo',
      text: AMOUNT_LINE,
      // offset RELATIVI all inizio dell ancora: sommandoli alla posizione trovata
      // si ottengono di nuovo i campi di `amount`, su qualunque file.
      fields: {
        lineStart: 0,
        digitsStart: digitsInLine,
        digitsEnd: digitsInLine + AMOUNT_DIGITS.length,
        digitOffset: digitsInLine,
        wordsStart: wordsInLine,
        wordsEnd: wordsInLine + AMOUNT_WORDS.length,
        lineEnd: AMOUNT_LINE.length,
      },
    },
    {
      id: 'signature',
      label: 'Firma autografa, geometria pura',
      text: signatureText,
      fields: { start: 0, end: signatureText.length },
    },
  ];
  const anchors = anchorSpecs.map((a) => {
    const start = text.indexOf(a.text);
    return { ...a, start, end: start + a.text.length };
  });

  // --- previsioni deterministiche degli attacchi 1a e 1b -----------------------
  // Il generatore le DICHIARA, il validatore le CONFUTA rifacendo i conti sui byte
  // e misurando davvero i renderer. Nessun numero qui sotto e' cablato.
  const wordsEnd = wordsStart + AMOUNT_WORDS.length;
  const deltaWords = TAMPER_WORDS_TO.length - AMOUNT_WORDS.length;
  const objectsAfterWords = objectStarts
    .map((off, i) => ({ num: i + 1, declaredOffset: off }))
    .filter((o) => o.declaredOffset > wordsStart)
    .map((o) => ({ ...o, actualOffset: o.declaredOffset + deltaWords }));

  const offsets = {
    version: 2,
    fileName: 'sample.pdf',
    // Il vincolo viaggia con i dati: chi legge questo file legge subito il suo ambito.
    appliesTo:
      'sample.pdf NON firmato, sha256 ' +
      sha256.slice(0, 16) +
      '... - questi offset NON valgono dopo pdflibAddPlaceholder ne dopo un save() di pdf-lib. Vedi scope.',
    scope: {
      documento: 'sample.pdf come esce da "npm run pdf", prima di qualunque firma',
      validoSe: 'sha256 dei byte in mano identico al campo sha256 di questo file',
      invalidatoDa: [
        'pdflibAddPlaceholder (@signpdf/placeholder-pdf-lib): passa da pdf-lib, che RISCRIVE il documento invece di appenderlo. Il prefisso comune col campione e di 9 byte ("%PDF-1.7\\n"): ogni offset di questo file punta altrove.',
        'PDFDocument.load(...).save() di pdf-lib, anche senza placeholder: stessa riscrittura.',
        'l attacco 1b (attacks.tamperWords): allunga il content stream, restano validi solo gli offset che precedono amount.wordsStart.',
      ],
      conservatoDa: [
        'un incremental update appeso in coda - l attacco 2, e anche un placeholder PAdES costruito a mano: il campione resta identico byte per byte e tutti gli offset di questo file restano validi. Cambiano solo fileLength e la xref attiva, quindi sections non copre piu il file intero.',
      ],
      comeRilocalizzare:
        'cerca nei byte correnti le stringhe letterali di anchors[]: ognuna compare una volta sola e viene ricopiata verbatim anche da pdf-lib. Sommando anchors[].fields agli offset trovati si ricostruiscono i campi di amount e signatureDrawing. Implementazione di riferimento, senza dipendenze e utilizzabile anche nel browser: scripts/pdf/relocate-offsets.mjs',
      daRileggereDaiByte: ['objects', 'sections', 'xref', 'contentStream'],
    },
    fileLength: bytes.length,
    sha256,
    padCount,
    objects: [
      { num: 1, type: 'Catalog', label: 'Catalogo', start: obj1Start, end: obj1End },
      { num: 2, type: 'Pages', label: 'Albero delle pagine', start: obj2Start, end: obj2End },
      { num: 3, type: 'Page', label: 'Pagina', start: obj3Start, end: obj3End },
      { num: 4, type: 'ContentStream', label: 'Contenuto della pagina', start: obj4Start, end: obj4End },
      { num: 5, type: 'Font', label: 'Font Times-Roman', start: obj5Start, end: obj5End },
    ],
    sections: [
      { id: 'header', label: 'Intestazione', start: header.start, end: header.end },
      { id: 'obj1', label: 'Oggetto 1 - Catalogo', ...obj1Section },
      { id: 'obj2', label: 'Oggetto 2 - Albero delle pagine', ...obj2Section },
      { id: 'obj3', label: 'Oggetto 3 - Pagina', ...obj3Section },
      { id: 'obj4', label: 'Oggetto 4 - Contenuto della pagina', ...obj4Section },
      { id: 'obj5', label: 'Oggetto 5 - Font Times-Roman', ...obj5Section },
      { id: 'xref', label: 'Tabella xref', ...xrefSection },
      { id: 'trailer', label: 'Trailer', ...trailerSection },
      { id: 'startxref', label: 'startxref', ...startxrefSection },
      { id: 'eof', label: 'Fine file', ...eofSection },
    ],
    contentStream: {
      objNum: 4,
      dataStart: streamData.start,
      dataEnd: streamData.end,
      declaredLength,
      lengthValueStart: lengthValue.start,
      lengthValueEnd: lengthValue.end,
    },
    amount: {
      lineStart: amountLineStart,
      lineEnd: amountLineEnd,
      digitsStart,
      digitsEnd: digitsStart + AMOUNT_DIGITS.length,
      digitOffset: digitsStart,
      wordsStart,
      wordsEnd: wordsStart + AMOUNT_WORDS.length,
      digits: AMOUNT_DIGITS,
      words: AMOUNT_WORDS,
      line: AMOUNT_LINE,
    },
    signatureDrawing: {
      start: signatureStart,
      end: signatureEnd,
      label: 'Firma autografa, geometria pura',
    },
    anchors,
    attacks: {
      nota:
        'Previsioni deterministiche, ricalcolate dal validatore sui byte. La reazione dei renderer e MISURATA, non assunta: il piano prevedeva che dopo 1b pdf.js rifiutasse il file, ed e falso. Vedi docs/pdf-campione.md sezione 4.',
      applicabiliA:
        'gli offset qui sotto sono quelli del campione non firmato. Su un PDF firmato vanno rilocalizzati con anchors[] (scope.comeRilocalizzare) prima di scrivere un byte.',
      tamperDigit: {
        id: '1a',
        label: 'Falsifica la cifra',
        offset: digitsStart,
        fromByte: AMOUNT_DIGITS.charCodeAt(0),
        toByte: '9'.charCodeAt(0),
        from: '1',
        to: '9',
        anchor: { id: 'amountLine', field: 'digitOffset' },
        deltaLength: 0,
        structureIntact: true,
        textAfter: AMOUNT_TEXT.replace(AMOUNT_DIGITS, '9' + AMOUNT_DIGITS.slice(1)),
        renderersOpenAfter: true,
      },
      tamperWords: {
        id: '1b',
        label: 'Falsifica anche le lettere',
        start: wordsStart,
        end: wordsEnd,
        from: AMOUNT_WORDS,
        to: TAMPER_WORDS_TO,
        anchor: { id: 'amountLine', fieldStart: 'wordsStart', fieldEnd: 'wordsEnd' },
        deltaLength: deltaWords,
        textAfter: AMOUNT_TEXT.replace(AMOUNT_WORDS, TAMPER_WORDS_TO),
        // MISURATO: entrambi i renderer ricostruiscono l xref e disegnano lo stesso.
        // Se un giorno smettessero, il validatore fallisce e questo campo va corretto.
        renderersOpenAfter: true,
        premessaDelPianoSmentita:
          'Il piano diceva "pdf.js si rifiuta di renderizzare". Misurato falso: pdf.js emette un avviso, ricostruisce l xref scandendo il file, ignora il /Length sbagliato e disegna la pagina. Il pannello deve mostrare i tre disallineamenti qui sotto, non aspettare un eccezione che non arriva.',
        evidence: [
          {
            id: 'length',
            label: '/Length dichiarato contro byte reali dello stream',
            declared: declaredLength,
            actual: declaredLength + deltaWords,
            valueStart: lengthValue.start,
            valueEnd: lengthValue.end,
          },
          {
            id: 'xref',
            label: 'voci xref che non puntano piu a "N 0 obj"',
            brokenObjects: objectsAfterWords.map((o) => o.num),
            entries: objectsAfterWords,
          },
          {
            id: 'startxref',
            label: 'startxref contro posizione reale della tabella',
            declared: xrefStart,
            actual: xrefStart + deltaWords,
            valueStart: startxrefValue.start,
            valueEnd: startxrefValue.end,
          },
        ],
      },
    },
    xref: {
      start: xrefStart,
      end: xrefSection.end,
      entries: [
        { num: 0, offset: 0, gen: 65535, type: 'f' },
        ...objectStarts.map((off, i) => ({ num: i + 1, offset: off, gen: 0, type: 'n' })),
      ],
      startxrefValue: xrefStart,
      startxrefValueStart: startxrefValue.start,
      startxrefValueEnd: startxrefValue.end,
    },
    text: {
      lines: EXPECTED_TEXT_LINES,
      disclaimer: 'Documento dimostrativo, privo di valore legale.',
    },
  };

  return { bytes, offsets, text };
}

/**
 * Punto fisso sull'allineamento: genera, misura dove cade la riga dell'importo,
 * aggiunge esattamente gli spazi che mancano, ricalcola /Length e tutti gli offset
 * dell'xref, ripete. Aggiungere spazi puo' far crescere di una cifra il valore di
 * /Length e spostare di nuovo tutto: per questo l'iterazione, non un conto secco.
 * Nessuna costante cablata, solo la larghezza della riga di dump (16).
 */
export function buildSamplePdf() {
  const seen = new Map();
  let pad = 0;
  let iterations = 0;

  for (let i = 0; i < 64; i++) {
    iterations = i + 1;
    const built = assemble(pad);
    const off = built.offsets.amount.lineStart;
    if (off % HEX_DUMP_ROW === 0) {
      // Punto fisso raggiunto: ricostruire con lo stesso pad da byte identici.
      built.offsets.alignment = { row: HEX_DUMP_ROW, padCount: pad, iterations };
      return built;
    }
    if (seen.has(pad)) break; // ciclo: passa alla scansione esaustiva
    seen.set(pad, off);
    pad = (pad + (HEX_DUMP_ROW - (off % HEX_DUMP_ROW))) % HEX_DUMP_ROW;
  }

  // Ripiego deterministico: scansione crescente del riempimento.
  for (let p = 0; p < 256; p++) {
    const built = assemble(p);
    if (built.offsets.amount.lineStart % HEX_DUMP_ROW === 0) {
      built.offsets.alignment = { row: HEX_DUMP_ROW, padCount: p, iterations, fallbackScan: true };
      return built;
    }
  }

  throw new Error('Nessun riempimento allinea la riga dell importo a un multiplo di 16.');
}
