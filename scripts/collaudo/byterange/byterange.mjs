/**
 * Collaudo avversariale — «Il /ByteRange: numeri che mentono sulla copertura».
 *
 * Il /ByteRange e la dichiarazione di cosa la firma copre, e sta DENTRO i byte firmati: cambiarne
 * i VALORI rompe il digest, e questo lo dimostra gia il collaudo copertura (righe 05, 06, 11, 17).
 * Ma prima del digest c'e la LETTURA di quei numeri, ed e codice: la regexp di readSignatureField
 *
 *     /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/
 *
 * pretende ESATTAMENTE quattro numeri decimali senza segno, separati da `\s` (che in JavaScript
 * NON comprende il byte NUL, benche il PDF lo consideri spazio). E il conto di coverageOf fa
 * aritmetica a virgola mobile su numeri che possono superare 2^53. Qui si attacca LI.
 *
 * Ogni riga e un file vero in out/, firmato con la catena CRITTOGRAFICA della demo (chiave, cert,
 * CMS identici a quelli della pagina): l'unica cosa «diversa» e la forma del /ByteRange. Per ogni
 * file confronto SEMPRE verify(), pdfsig, openssl e pdftotext, e — dove gli strumenti terzi del
 * modulo comune condividono la nostra stessa ipotesi «quattro decimali» e quindi tacciono — rieseguo
 * openssl A MANO sui byte che quel /ByteRange dichiara, per avere comunque il parere della matematica.
 *
 *   node scripts/collaudo/byterange/byterange.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as asn1js from 'asn1js'
import { verify } from '../../../src/core/verify.js'
import { fromHex } from '../../../src/core/bytes.js'
import { pareri, stampaPareri } from '../comune/terzi.mjs'
import { firmaConByteRange, coppieDi, fromAscii, concat } from './costruttore.mjs'

const SAMPLE = new Uint8Array(readFileSync(new URL('../../../src/assets/sample.pdf', import.meta.url)))
const OUT = new URL('./out/', import.meta.url).pathname
const NSS = `sql:${process.env.HOME}/.pki/nssdb`

/* --- openssl «a mano»: quando terzi.mjs tace perche condivide la nostra ipotesi sui numeri ------ */

/**
 * Il CMS grezzo dal buco /Contents [cs..ce]. Il buco e riempito in coda con '0' ASCII, che decodifica
 * a byte 0x00: NON si possono togliere con un taglio ingenuo degli zeri finali, perche l'ultimo byte
 * VERO del CMS puo essere 0x00 (e mangiarlo tronca il DER). Si chiede ad asn1js dove finisce davvero
 * la struttura — `fromBER().offset` — che e la lunghezza esatta del CMS, riempimento escluso.
 */
function cmsDalBuco(bytes, cs, ce) {
  const der = fromHex(fromAscii(bytes.subarray(cs + 1, ce)))
  const parsed = asn1js.fromBER(der)
  const fine = parsed.offset === -1 ? der.length : parsed.offset
  return der.subarray(0, fine)
}

/** I byte coperti da una lista di coppie (offset, lunghezza), concatenati come farebbe un verificatore. */
function bytesCoperti(bytes, coppie) {
  return concat(...coppie.map(([o, l]) => bytes.subarray(o, o + l)))
}

/** Chiede a openssl se quel CMS firma quel contenuto. Ritorna { ok, messaggio, comando }. */
function opensslVerifica(cmsDer, contenuto) {
  const dir = mkdtempSync(join(tmpdir(), 'byterange-openssl-'))
  const cmsPath = join(dir, 'cms.der')
  const contPath = join(dir, 'coperti.bin')
  writeFileSync(cmsPath, cmsDer)
  writeFileSync(contPath, contenuto)
  const args = ['cms', '-verify', '-inform', 'DER', '-in', cmsPath, '-content', contPath, '-binary', '-noverify', '-out', '/dev/null']
  try {
    execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, messaggio: 'Verification successful', comando: 'openssl ' + args.join(' ') }
  } catch (e) {
    return { ok: false, messaggio: String(e.stderr ?? e.message).split('\n')[0], comando: 'openssl ' + args.join(' ') }
  }
}

/* --- Esecuzione di un caso -------------------------------------------------------------------- */

const casi = []

/**
 * Costruisce il file, lo salva, raccoglie i quattro pareri e — se `coppieVere` e dato — anche il
 * parere di openssl rieseguito a mano sui byte dichiarati.
 */
async function caso(nome, descr, costruito, extra = {}) {
  const { signed, nums, contentsStart, contentsEnd, intervalli } = costruito
  const path = join(OUT, `${nome}.pdf`)
  writeFileSync(path, signed)

  const p = await pareri(path)
  const r = await verify(signed)

  // openssl a mano sui byte che QUESTO /ByteRange dichiara (le coppie che il costruttore ha firmato).
  const cms = cmsDalBuco(signed, contentsStart, contentsEnd)
  const coperti = bytesCoperti(signed, intervalli)
  const opensslManuale = opensslVerifica(cms, coperti)

  const riga = {
    nome,
    descr,
    lunghezza: signed.length,
    numeriScritti: nums,
    byteRangeTestuale: extra.byteRangeTestuale ?? null,
    contentsStart,
    contentsEnd,
    intervalliFirmati: intervalli,
    // verify()
    nostroVerdetto: r.verdict,
    nostroReason: r.reason,
    nostroComplete: r.coverage?.complete ?? null,
    nostroGap: r.coverage?.gapMatchesContents ?? null,
    nostroCodaScoperta: r.coverage?.uncoveredTail ?? null,
    nostroByteRangeLetto: r.coverage?.byteRange ?? null,
    nostroDigest: r.digest?.match ?? null,
    nostroFirma: r.signature?.ok ?? null,
    nostreFirme: r.signatures.length,
    // pdfsig
    pdfsigQuante: p.pdfsig.quante,
    pdfsigSintesi: p.pdfsig.sintesi,
    pdfsigCopreTutto: p.pdfsig.copreTutto,
    pdfsigIntervalli: p.pdfsig.intervalli,
    pdfsigValidazione: p.pdfsig.firme.map((f) => f.validazione),
    // openssl (via terzi, che condivide la nostra ipotesi sui numeri)
    opensslTerziSintesi: p.openssl.sintesi,
    // openssl rieseguito a mano sui byte dichiarati
    opensslManualeOk: opensslManuale.ok,
    opensslManualeMsg: opensslManuale.messaggio,
    opensslManualeComando: opensslManuale.comando,
    // lettore
    lettore: p.lettore.importo,
    // divergenze rilevate dal modulo comune
    divergenze: p.divergenze,
    ...extra,
  }
  casi.push(riga)
  console.log(
    `${nome.padEnd(34)} noi=${String(riga.nostroVerdetto).padEnd(8)} ` +
      `pdfsig=${String(riga.pdfsigCopreTutto === true ? 'valid+tot' : riga.pdfsigCopreTutto === false ? 'valid?notot' : '—').padEnd(11)} ` +
      `opensslManuale=${riga.opensslManualeOk ? 'OK' : 'NO'}  reason=${riga.nostroReason ?? ''}`,
  )
  return riga
}

/* ============================================================================================== */
/* 0. Controllo: il /ByteRange canonico dal MIO costruttore. Deve dare valid, o tutto il resto     */
/*    non prova niente.                                                                             */
/* ============================================================================================== */

await caso(
  '20-canonico-di-controllo',
  'Firma canonica costruita dal mio costruttore: prova che il banco di prova e onesto.',
  await firmaConByteRange(SAMPLE, { numeriDa: (cs, ce, len) => [0, cs, ce + 1, len - (ce + 1)] }),
  { byteRangeTestuale: '[0 cs ce+1 d]  (spazi singoli)' },
)

/* ============================================================================================== */
/* 1. LA FORMA DEI NUMERI — attacchi alla regexp di readSignatureField                             */
/* ============================================================================================== */

// 1a. Tre coppie (sei numeri) che coprono DAVVERO tutto: la specifica ammette N coppie, noi no.
await caso(
  '21-tre-coppie-sei-numeri',
  'ByteRange a tre coppie [0 X X cs-X ce+1 d]: copre esattamente gli stessi byte del canonico, ma in tre intervalli.',
  await firmaConByteRange(SAMPLE, {
    numeriDa: (cs, ce, len) => [0, 128, 128, cs - 128, ce + 1, len - (ce + 1)],
  }),
  { byteRangeTestuale: '[0 128 128 (cs-128) (ce+1) d]  — sei numeri, tre intervalli' },
)

// 1b. NUL al posto degli spazi: byte 0x00 e spazio per il PDF, ma non per \s di JavaScript.
await caso(
  '22-nul-tra-i-numeri',
  'Gli spazi fra i numeri sostituiti dal byte NUL (0x00), che il PDF considera spazio ma \\s no.',
  await firmaConByteRange(SAMPLE, {
    numeriDa: (cs, ce, len) => [0, cs, ce + 1, len - (ce + 1)],
    testoBR: (nums) => nums.join('\x00'),
  }),
  { byteRangeTestuale: '[0<NUL>cs<NUL>ce+1<NUL>d]' },
)

// 1c. Un commento PDF `%...\n` in mezzo all'array: legale, inerte, ma \s+ non lo mangia.
await caso(
  '23-commento-pdf-nellarray',
  'Un commento PDF (% ... a capo) infilato fra il secondo e il terzo numero del ByteRange.',
  await firmaConByteRange(SAMPLE, {
    numeriDa: (cs, ce, len) => [0, cs, ce + 1, len - (ce + 1)],
    testoBR: (nums) => `${nums[0]} ${nums[1]} %commento legale qui\n   ${nums[2]} ${nums[3]}`,
  }),
  { byteRangeTestuale: '[0 cs %commento\\n ce+1 d]' },
)

// 1d. Segno + davanti ai numeri: il PDF ammette il segno, la regexp \d+ no.
await caso(
  '24-segno-piu',
  'Ogni numero (tranne lo zero) preceduto da un +, che i numeri PDF ammettono e \\d+ rifiuta.',
  await firmaConByteRange(SAMPLE, {
    numeriDa: (cs, ce, len) => [0, cs, ce + 1, len - (ce + 1)],
    testoBR: (nums) => `${nums[0]} +${nums[1]} +${nums[2]} +${nums[3]}`,
  }),
  { byteRangeTestuale: '[0 +cs +ce+1 +d]' },
)

// 1e. Zeri iniziali: [0 01666 05764 0415]. \d+ li accetta, Number li legge in decimale. Robustezza.
await caso(
  '25-zeri-iniziali',
  'Ogni numero con uno zero iniziale in piu: Number() li legge in decimale, non in ottale.',
  await firmaConByteRange(SAMPLE, {
    numeriDa: (cs, ce, len) => [0, cs, ce + 1, len - (ce + 1)],
    testoBR: (nums) => nums.map((n) => '0' + n).join(' '),
  }),
  { byteRangeTestuale: '[00 0cs 0(ce+1) 0d]' },
)

// 1f. Spazi multipli e a capo fra i numeri: \s+ li mangia. Robustezza.
await caso(
  '26-spazi-multipli-e-acapo',
  'Numeri separati da a capo e piu spazi: \\s+ li tollera, quindi restiamo corretti.',
  await firmaConByteRange(SAMPLE, {
    numeriDa: (cs, ce, len) => [0, cs, ce + 1, len - (ce + 1)],
    testoBR: (nums) => `\n  ${nums[0]}   ${nums[1]}\n  ${nums[2]}   ${nums[3]}\n`,
  }),
  { byteRangeTestuale: '[\\n  0   cs\\n  ce+1   d\\n]' },
)

// 1g. Numeri negativi: \d+ li rifiuta. Fail-closed. (Il costruttore firma la copertura VERA
//     positiva; solo il TESTO del terzo numero e negato, per isolare il motivo del rifiuto.)
await caso(
  '27-numero-negativo',
  'Il terzo numero scritto negativo: la firma sotto e vera, ma il testo mente e noi lo rifiutiamo.',
  await firmaConByteRange(SAMPLE, {
    numeriDa: (cs, ce, len) => [0, cs, ce + 1, len - (ce + 1)],
    testoBR: (nums) => `${nums[0]} ${nums[1]} -${nums[2]} ${nums[3]}`,
    // La copertura firmata resta quella vera e positiva.
    intervalli: (nums) => coppieDi(nums),
  }),
  { byteRangeTestuale: '[0 cs -(ce+1) d]' },
)

// 1h. Numero oltre 2^53: dove l'aritmetica di JavaScript smette di essere esatta. Il quarto numero
//     e scritto nel file come la stringa dispari "9007199254740993"; Number() la arrotonda a ...992
//     (imprecisione), e la somma c+d sfora il file, tanto che uncoveredTail underflowa a 0.
const ENORME_STR = '9007199254740993' // dispari: Number lo legge come ...992
await caso(
  '28-numero-oltre-2alla53',
  `Il quarto numero e la stringa ${ENORME_STR} (> 2^53): Number() la arrotonda, e coverageOf sfora il file facendo crollare uncoveredTail a 0.`,
  await firmaConByteRange(SAMPLE, {
    // Per il punto fisso serve un valore: uso quello arrotondato, ma nel FILE scrivo la stringa dispari.
    numeriDa: (cs, ce, _len) => [0, cs, ce + 1, Number(ENORME_STR)],
    testoBR: (nums) => `${nums[0]} ${nums[1]} ${nums[2]} ${ENORME_STR}`,
    // La firma copre la coda VERA; subarray taglia da solo al fondo del file.
    intervalli: (nums) => [[0, nums[1]], [nums[2], 1 << 30]],
  }),
  { byteRangeTestuale: `[0 cs ce+1 ${ENORME_STR}]`, valoreScrittoNelFile: ENORME_STR, valoreLettoDaJs: Number(ENORME_STR) },
)

/* ============================================================================================== */
/* 2. LA GEOMETRIA DEGLI INTERVALLI — attacchi al conto di coverageOf / checkByteRange             */
/* ============================================================================================== */

// 2a. Intervalli sovrapposti: a+b > c. checkByteRange lancia -> noi invalid. Ma il CMS e firmato
//     su ESATTAMENTE i byte doppi che openssl ricalcolerebbe, quindi openssl verifica. Divergenza.
await caso(
  '29-intervalli-sovrapposti',
  'Secondo intervallo che comincia PRIMA della fine del primo (a+b>c): noi lo rifiutiamo, openssl no.',
  await firmaConByteRange(SAMPLE, {
    // [0 cs (cs-300) 300]: il secondo intervallo [cs-300, cs) sta dentro il primo. a+b=cs > c=cs-300.
    numeriDa: (cs, _ce, _len) => [0, cs, cs - 300, 300],
    // Firmo esattamente cio che openssl concatenerebbe: [0,cs) ++ [cs-300, cs). I 300 byte contati due volte.
    intervalli: (nums) => [[nums[0], nums[1]], [nums[2], nums[3]]],
  }),
  { byteRangeTestuale: '[0 cs (cs-300) 300]  — sovrapposto' },
)

// 2b. a != 0: il primo intervallo non parte da zero. L'intestazione %PDF non e firmata -> extended.
await caso(
  '30-primo-intervallo-non-da-zero',
  'ByteRange che parte da 64 invece che da 0: i primi 64 byte (intestazione %PDF) non sono firmati.',
  await firmaConByteRange(SAMPLE, {
    numeriDa: (cs, ce, len) => [64, cs - 64, ce + 1, len - (ce + 1)],
  }),
  { byteRangeTestuale: '[64 (cs-64) (ce+1) d]  — salta i primi 64 byte' },
)

// 2c. d = 0: secondo intervallo di lunghezza zero. Tutto cio che segue il buco resta non firmato.
await caso(
  '31-secondo-intervallo-lunghezza-zero',
  'ByteRange con d=0: la firma copre solo la testa, e tutta la coda dopo il buco resta scoperta.',
  await firmaConByteRange(SAMPLE, {
    numeriDa: (cs, ce, _len) => [0, cs, ce + 1, 0],
    intervalli: (nums) => [[nums[0], nums[1]]], // solo il primo intervallo
  }),
  { byteRangeTestuale: '[0 cs ce+1 0]  — coda a lunghezza zero' },
)

/* ============================================================================================== */
/* 3. DUE /ByteRange NELLO STESSO DIZIONARIO — quale vince per noi, quale per pdfsig                */
/* ============================================================================================== */

// 3a. Il primo e vero, il secondo e [0 0 0 0]. La regexp prende il PRIMO -> noi valid.
await caso(
  '32-doppio-byterange-vero-primo',
  'Due /ByteRange nello stesso dizionario: prima quello vero, poi [0 0 0 0]. Noi leggiamo il primo.',
  await firmaConByteRange(SAMPLE, {
    numeriDa: (cs, ce, len) => [0, cs, ce + 1, len - (ce + 1)],
    testoBR: (nums) => `${nums.join(' ')}] /ByteRange [0 0 0 0`,
    intervalli: (nums) => coppieDi(nums),
  }),
  { byteRangeTestuale: '[vero] /ByteRange [0 0 0 0]' },
)

// 3b. Il primo e [0 0 0 0], il secondo e vero. La regexp prende il PRIMO -> noi invalid (digest su
//     zero byte). Se pdfsig legge il SECONDO, verifica: divergenza.
await caso(
  '33-doppio-byterange-finto-primo',
  'Due /ByteRange: prima [0 0 0 0], poi quello vero. Noi leggiamo il primo e falliamo il digest.',
  await firmaConByteRange(SAMPLE, {
    numeriDa: (cs, ce, len) => [0, cs, ce + 1, len - (ce + 1)],
    testoBR: (nums) => `0 0 0 0] /ByteRange [${nums.join(' ')}`,
    intervalli: (nums) => coppieDi(nums),
  }),
  { byteRangeTestuale: '[0 0 0 0] /ByteRange [vero]' },
)

/* --- Tabella e rapporto ----------------------------------------------------------------------- */

console.log('\nRapporto completo in out/byterange.json\n')
writeFileSync(join(OUT, 'byterange.json'), JSON.stringify(casi, null, 2))

// Divergenze da segnalare, in chiaro.
console.log('DIVERGENZE MISURATE:')
for (const c of casi) {
  const noiValid = c.nostroVerdetto === 'valid'
  const pdfsigValid = c.pdfsigCopreTutto === true
  const opensslValid = c.opensslManualeOk
  if (noiValid !== pdfsigValid || noiValid !== opensslValid) {
    console.log(
      `  ${c.nome}: noi=${c.nostroVerdetto}(${c.nostroReason ?? '-'})  ` +
        `pdfsig=${c.pdfsigCopreTutto === true ? 'valida+copre-tutto' : c.pdfsigCopreTutto === false ? 'valida?non-copre' : c.pdfsigValidazione.join('|') || 'non-verifica'}  ` +
        `opensslManuale=${c.opensslManualeOk ? 'VERIFICA' : 'no'}`,
    )
  }
}
