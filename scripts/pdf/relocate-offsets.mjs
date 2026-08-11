/**
 * relocate-offsets.mjs — ritrova nel file CORRENTE i punti che sample-offsets.json
 * congela sul campione non firmato.
 *
 * Perche' esiste. Gli offset di `sample-offsets.json` valgono per `sample.pdf` e
 * per nient'altro. Appena il PDF passa da pdf-lib (`pdflibAddPlaceholder`, o anche
 * un semplice `save()`) il file viene RISCRITTO: il prefisso comune col campione e'
 * di 9 byte, e scrivere all'offset congelato 577 significa corrompere una riga a
 * caso. Chi deve modificare o evidenziare byte di un PDF che non e' piu' il
 * campione passa da qui e usa gli offset che questa funzione restituisce.
 *
 * Come funziona. Le ancore di `sample-offsets.json` sono stringhe letterali prese
 * dai DATI del content stream, non dalla sintassi PDF: pdf-lib riscrive dizionari,
 * xref e trailer, ma i byte dello stream li ricopia identici. Ogni ancora compare
 * una volta sola nel file (il validatore lo pretende), quindi ritrovarla e' una
 * ricerca di sottostringa, e i campi relativi in `fields` ricostruiscono il resto.
 *
 * Vincoli di scrittura di questo file, deliberati:
 *  - NESSUN import, nemmeno da node: gira identico in Node e nel browser, e la fase 2
 *    puo' importarlo com'e' oppure copiarlo dentro src/core/ senza toccarlo;
 *  - lavora su Uint8Array, mai su stringhe decodificate: nessuna sorpresa di encoding;
 *  - non lancia eccezioni per un file che non torna: riempie `problems` e mette
 *    `ok: false`. Un attacco che non trova il suo bersaglio deve poterlo DIRE.
 */

/** Converte una stringa ASCII in byte. Le ancore sono ASCII per costruzione. */
export function asciiToBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) throw new Error(`carattere non rappresentabile in un byte: ${JSON.stringify(s[i])}`);
    out[i] = c;
  }
  return out;
}

/** Converte byte in stringa latin1 (1 byte = 1 carattere), senza TextDecoder. */
export function bytesToLatin1(bytes, start = 0, end = bytes.length) {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Tutte le posizioni in cui `needle` compare in `hay`. Ricerca ingenua: i file sono piccoli. */
export function findAllBytes(hay, needle, limit = Infinity) {
  const hits = [];
  if (needle.length === 0 || needle.length > hay.length) return hits;
  const last = hay.length - needle.length;
  const first = needle[0];
  outer: for (let i = 0; i <= last; i++) {
    if (hay[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    hits.push(i);
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Ultima occorrenza di `needle` che comincia prima di `before`. -1 se non c'e'. */
function lastIndexBefore(hay, needle, before) {
  const hits = findAllBytes(hay, needle);
  let best = -1;
  for (const h of hits) {
    if (h < before) best = h;
    else break;
  }
  return best;
}

/** Prima occorrenza di `needle` a partire da `from`. -1 se non c'e'. */
function indexFrom(hay, needle, from) {
  for (const h of findAllBytes(hay, needle)) if (h >= from) return h;
  return -1;
}

const KW_STREAM = asciiToBytes('stream\n');
const KW_ENDSTREAM = asciiToBytes('\nendstream');
const KW_OBJ = asciiToBytes(' 0 obj');

/**
 * Risale dal punto `inside` all'oggetto che lo contiene e ne misura il content stream.
 * Restituisce null se la struttura non e' riconoscibile (stream indiretto, /Length
 * per riferimento, delimitatori assenti): in quel caso il chiamante lo sapra'.
 */
function measureEnclosingStream(bytes, inside) {
  const dataStart = lastIndexBefore(bytes, KW_STREAM, inside);
  if (dataStart === -1) return null;
  const streamKeyword = dataStart;
  const dataFrom = streamKeyword + KW_STREAM.length;
  const dataEnd = indexFrom(bytes, KW_ENDSTREAM, inside);
  if (dataEnd === -1) return null;

  // testa dell'oggetto: "<num> 0 obj" piu' vicino prima di "stream"
  const objMark = lastIndexBefore(bytes, KW_OBJ, streamKeyword);
  let objNum = null;
  let objStart = null;
  if (objMark !== -1) {
    let i = objMark;
    while (i > 0 && bytes[i - 1] >= 0x30 && bytes[i - 1] <= 0x39) i--;
    if (i < objMark) {
      objNum = Number(bytesToLatin1(bytes, i, objMark));
      objStart = i;
    }
  }

  // /Length: solo diretto. Se e' un riferimento indiretto lo si dichiara e basta.
  let declaredLength = null;
  let lengthValueStart = null;
  let lengthValueEnd = null;
  let lengthIndirect = false;
  const head = bytesToLatin1(bytes, objStart === null ? streamKeyword : objStart, dataFrom);
  const headBase = objStart === null ? streamKeyword : objStart;
  const m = /\/Length[\s]+(\d+)([\s]+\d+[\s]+R)?/.exec(head);
  if (m) {
    if (m[2]) {
      lengthIndirect = true;
    } else {
      declaredLength = Number(m[1]);
      lengthValueStart = headBase + m.index + m[0].indexOf(m[1]);
      lengthValueEnd = lengthValueStart + m[1].length;
    }
  }

  const actualLength = dataEnd - dataFrom;
  return {
    objNum,
    objStart,
    dataStart: dataFrom,
    dataEnd,
    actualLength,
    declaredLength,
    lengthValueStart,
    lengthValueEnd,
    lengthIndirect,
    lengthConsistent: declaredLength !== null && declaredLength === actualLength,
  };
}

/**
 * Ritrova su `pdfBytes` i punti congelati in `frozen` (il contenuto di
 * sample-offsets.json).
 *
 * Ritorna sempre un oggetto, anche quando fallisce:
 *   {
 *     ok,                 // tutte le ancore trovate una volta sola e byte attesi al loro posto
 *     isPristineSample,   // i byte SONO ancora il campione: gli offset congelati valgono
 *     frozenOffsetsHold,  // le ancore stanno esattamente dove il JSON le congela
 *     anchors: { [id]: { start, end, moved, delta } },
 *     amount: { lineStart, lineEnd, digitsStart, digitsEnd, digitOffset, wordsStart, wordsEnd },
 *     signatureDrawing: { start, end },
 *     contentStream: { objNum, dataStart, dataEnd, declaredLength, actualLength, lengthConsistent, ... },
 *     problems: [ 'testo in italiano', ... ]
 *   }
 */
export function relocateOffsets(pdfBytes, frozen) {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const problems = [];
  const anchors = {};

  if (!frozen || !Array.isArray(frozen.anchors) || frozen.anchors.length === 0) {
    return {
      ok: false,
      isPristineSample: false,
      frozenOffsetsHold: false,
      anchors,
      amount: null,
      signatureDrawing: null,
      contentStream: null,
      problems: ['sample-offsets.json non contiene anchors[]: impossibile rilocalizzare'],
    };
  }

  let allHold = true;
  for (const spec of frozen.anchors) {
    const needle = asciiToBytes(spec.text);
    const hits = findAllBytes(bytes, needle);
    if (hits.length === 0) {
      problems.push(`ancora "${spec.id}" non trovata nei byte correnti`);
      allHold = false;
      continue;
    }
    const ambiguous = hits.length > 1;
    if (ambiguous) {
      // Succede dopo un incremental update che riscrive il content stream (l attacco 2):
      // la vecchia revisione resta nel file, la nuova le sta dietro. In un PDF
      // append-only l occorrenza VALIDA e l ultima, ed e quella che restituiamo -
      // ma `ok` resta false e il problema e dichiarato: chi ci tiene lo legge.
      problems.push(
        `ancora "${spec.id}" trovata ${hits.length} volte (offset ${hits.join(', ')}): ` +
          'il file contiene piu revisioni. Uso l ultima, che in un file append-only e quella attiva.',
      );
    }
    const start = hits[hits.length - 1];
    const moved = start !== spec.start;
    if (moved || ambiguous) allHold = false;
    anchors[spec.id] = {
      start,
      end: start + needle.length,
      moved,
      delta: start - spec.start,
      occurrences: hits.length,
      ambiguous,
      allStarts: hits,
    };
  }

  const amountSpec = frozen.anchors.find((a) => a.id === 'amountLine');
  let amount = null;
  if (amountSpec && anchors.amountLine) {
    const base = anchors.amountLine.start;
    const f = amountSpec.fields || {};
    amount = {
      lineStart: base + (f.lineStart ?? 0),
      lineEnd: base + (f.lineEnd ?? amountSpec.text.length),
      digitsStart: base + f.digitsStart,
      digitsEnd: base + f.digitsEnd,
      digitOffset: base + f.digitOffset,
      wordsStart: base + f.wordsStart,
      wordsEnd: base + f.wordsEnd,
    };
    // controprova sui byte: se qui non c'e' quel che ci deve essere, non e' un offset usabile
    const digits = bytesToLatin1(bytes, amount.digitsStart, amount.digitsEnd);
    if (frozen.amount && digits !== frozen.amount.digits) {
      problems.push(`all offset rilocalizzato ${amount.digitsStart} non c e ${JSON.stringify(frozen.amount.digits)} ma ${JSON.stringify(digits)}`);
    }
    const words = bytesToLatin1(bytes, amount.wordsStart, amount.wordsEnd);
    if (frozen.amount && words !== frozen.amount.words) {
      problems.push(`all offset rilocalizzato ${amount.wordsStart} non c e ${JSON.stringify(frozen.amount.words)} ma ${JSON.stringify(words)}`);
    }
  } else {
    problems.push('ancora "amountLine" assente: gli attacchi 1a e 1b non hanno un bersaglio');
  }

  const sigSpec = frozen.anchors.find((a) => a.id === 'signature');
  let signatureDrawing = null;
  if (sigSpec && anchors.signature) {
    const base = anchors.signature.start;
    const f = sigSpec.fields || {};
    signatureDrawing = { start: base + (f.start ?? 0), end: base + (f.end ?? sigSpec.text.length) };
  }

  // Il content stream si misura a partire da un'ancora QUALSIASI che sia stata
  // ritrovata, non necessariamente dalla riga dell'importo: dopo l'attacco 1b la
  // riga dell'importo non esiste piu', ma il pannello ha ancora bisogno di sapere
  // che /Length dichiara 650 e i byte reali sono 653. La marcatura obbligatoria
  // non e' mai un bersaglio d'attacco, quindi e' l'appiglio piu' stabile.
  const inside = ['disclaimer', 'title', 'amountLine', 'signature']
    .map((id) => anchors[id])
    .find((a) => a !== undefined);
  const contentStream = inside ? measureEnclosingStream(bytes, inside.start) : null;
  if (inside && !contentStream) {
    problems.push('content stream non misurabile: delimitatori stream/endstream assenti attorno alle ancore');
  }

  const isPristineSample = allHold && bytes.length === frozen.fileLength;

  return {
    ok: problems.length === 0,
    isPristineSample,
    frozenOffsetsHold: allHold,
    anchors,
    amount,
    signatureDrawing,
    contentStream,
    problems,
  };
}

export default relocateOffsets;
