/**
 * Collaudo avversariale — «Dopo %%EOF: byte che non sono un aggiornamento».
 *
 * Tesi da confutare: una volta che il documento e firmato, tutto cio che si aggiunge in coda al
 * file — o si toglie dal confine fra la fine della copertura dichiarata (c+d) e la fine vera —
 * viene onestamente raccontato dal verdetto a tre stati, e non puo mai spacciare per intatto un
 * documento che intatto non e.
 *
 * Il collaudo precedente (copertura/aggira.mjs) aveva gia misurato le code «facili»: un a capo, 64
 * byte nulli, un commento, un incremental update vero, un commento con dentro la stringa /ByteRange.
 * Tutti `extended`. Qui si va oltre, e si cerca il punto in cui il verdetto della firma resta
 * matematicamente perfetto mentre il documento MOSTRATO diventa un altro — perche e li, e non nella
 * matematica, che vive la vera vulnerabilita di una firma PAdES.
 *
 * Ogni riga e un file vero, depositato in out/, giudicato da tre verificatori indipendenti:
 * il nostro verify(), pdfsig (poppler) e openssl. Dove disegnano qualcosa, c e anche il PNG.
 *
 *   node scripts/collaudo/coda/coda.mjs      (rilancia tutta la famiglia da capo)
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { verify } from '../../../src/core/verify.js'
import {
  buildIncrementalUpdate,
  findObject,
  findFirstPageNumber,
  readTrailerInfo,
} from '../../../src/core/pades.js'
import { appendIncrementalUpdate } from '../../../src/core/attacks.js'
import { firmaIlCampione, testo, ascii, concat } from '../copertura/comune.mjs'
import { pareri, stampaPareri } from '../comune/terzi.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'out')
mkdirSync(OUT, { recursive: true })

/* ------------------------------------------------------------------------------------- */
/* Attrezzi locali. NON si usano salva()/OUT di copertura: scriverebbero fuori dal nostro   */
/* perimetro. Qui si scrive solo dentro scripts/collaudo/coda/out.                          */
/* ------------------------------------------------------------------------------------- */

/** Scrive un PDF in out/ e ne rende il percorso assoluto. */
function salva(nome, bytes) {
  const percorso = join(OUT, nome)
  writeFileSync(percorso, bytes)
  return percorso
}

/** Disegna la prima pagina in PNG con poppler. Serve da PROVA per gli attacchi visivi. */
function disegna(pdfPath, pngBase) {
  try {
    execFileSync('pdftoppm', ['-png', '-r', '100', '-f', '1', '-l', '1', '-singlefile', pdfPath, join(OUT, pngBase)], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return join(OUT, pngBase + '.png')
  } catch {
    return null
  }
}

/** Quante pagine conta pdfinfo (il numero che vede chi apre il file). */
function pagineSecondoLettore(pdfPath) {
  try {
    const out = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const m = /^Pages:\s*(\d+)/m.exec(out)
    return m ? Number(m[1]) : null
  } catch {
    return null
  }
}

/**
 * Esegue un attacco: salva il file, lo fa giudicare dai tre verificatori, stampa la riga e
 * conserva la misura per il rapporto. `extra` porta i numeri specifici dell attacco.
 */
const misure = {}
async function prova(nome, bytes, extra = {}) {
  const percorso = salva(`${nome}.pdf`, bytes)
  const p = await pareri(percorso)
  console.log(stampaPareri(p))
  misure[nome] = { file: percorso, lunghezza: bytes.length, pareri: p, extra }
  return { p, bytes, percorso }
}

/* ------------------------------------------------------------------------------------- */
/* La geometria del campione firmato, rimisurata (non ci si fida del prompt).               */
/* ------------------------------------------------------------------------------------- */

const base = await firmaIlCampione()
const { signed, byteRange, contentsStart, contentsEnd, cmsDer } = base
const [a, b, c, d] = byteRange
const info = readTrailerInfo(signed)
const pageNum = findFirstPageNumber(signed, info.rootNum)
const page = findObject(signed, pageNum)
const pageText = testo(signed, page.start, page.end)
const cat = findObject(signed, info.rootNum)
const catText = testo(signed, cat.start, cat.end)

console.log('=========================================================================')
console.log('firmato            ', signed.length, 'byte')
console.log('/ByteRange         ', JSON.stringify(byteRange), ' -> c+d =', c + d, '(= lunghezza:', c + d === signed.length, ')')
console.log('buco /Contents     ', contentsStart, '..', contentsEnd, `(${contentsEnd - contentsStart + 1} byte)`)
console.log('CMS                ', cmsDer.length, 'byte;  padding libero nel buco:',
  (contentsEnd - (contentsStart + 1 + cmsDer.length * 2)) / 2, 'byte')
console.log('=========================================================================')

// Il riferimento: il documento firmato intatto e la sua immagine.
await prova('00-baseline', signed)
disegna(join(OUT, '00-baseline.pdf'), '00-baseline')

/* ------------------------------------------------------------------------------------- */
/* A. IL PAREGGIO IMPOSSIBILE                                                                */
/*                                                                                          */
/* Pista #1: un incremental update che finisce ESATTAMENTE a c+d, cosi la coda scoperta e   */
/* zero e il verdetto torna `valid`. Qui si prova davvero e si dimostra con i numeri perche  */
/* l aritmetica non lo permette:                                                            */
/*                                                                                          */
/*   valid  <=>  coverage.complete  <=>  c+d === lunghezza  (piu gap e a===0, gia veri).    */
/*   Ma [a b c d] = [0 1663 9857 416] stanno DENTRO il primo intervallo [0,1663): sono byte */
/*   firmati. Riscriverli fa cadere il digest. Quindi c+d e congelato a 10273, e appendere  */
/*   k>0 byte porta lunghezza a 10273+k: la coda scoperta e esattamente k, mai zero.        */
/* ------------------------------------------------------------------------------------- */

// A1: l append piu piccolo utile — l attacco 2 vero. Misura la coda scoperta: e proprio k.
const a1 = appendIncrementalUpdate(signed, { newText: '9.000.000 euro (nove milioni)' }).bytes
await prova('20a-pareggio-append-minimo', a1, {
  k_bytesAppesi: a1.length - signed.length,
  spiegazione: 'append -> lunghezza cresce di k, c+d resta 10273, coda scoperta = k',
})

// A2: la «compensazione» suggerita dalla pista — far crescere il file dal DI DENTRO (il buco,
// che non e firmato) e togliere altrettanto, cosi la lunghezza torna 10273. Si accorcia il buco
// di k caratteri e si appende un incremental update di k byte che ridipinge l importo. La
// lunghezza pareggia, ma il buco accorciato ha trascinato indietro di k la coda firmata
// [9857,10273): i byte che il /ByteRange nomina non sono piu quelli, e il digest crolla.
const codaFinta = appendIncrementalUpdate(signed, { newText: '9.000.000 euro (nove milioni)' }).bytes
const k = codaFinta.length - signed.length
const compensato = concat(
  codaFinta.subarray(0, contentsEnd - k), // il buco perde k caratteri di padding
  codaFinta.subarray(contentsEnd), // ">" e tutta la coda scivolano indietro di k
)
await prova('20b-pareggio-compensato-esatto', compensato, {
  lunghezzaPareggiata: compensato.length,
  cPiuD: c + d,
  kRimosso: k,
  nota: 'lunghezza === c+d al byte, ma togliere k (dispari) caratteri esadecimali dal buco lascia un esadecimale di lunghezza dispari: il /Contents non e piu leggibile',
})

// 20c: la stessa compensazione ma togliendo un numero PARI di caratteri dal buco, cosi il /Contents
// resta esadecimale ben formato e la ">" resta al suo posto. Adesso il fallimento arriva dove deve:
// la coda firmata [9857,10273) e scivolata indietro, i byte non sono piu quelli, e il digest crolla.
const kPari = k % 2 === 0 ? k : k - 1
const compensatoPari = concat(
  codaFinta.subarray(0, contentsEnd - kPari),
  codaFinta.subarray(contentsEnd),
)
await prova('20c-pareggio-compensato-pari', compensatoPari, {
  lunghezza: compensatoPari.length,
  cPiuD: c + d,
  kRimosso: kPari,
  nota: 'buco accorciato di un numero pari: /Contents leggibile, ma la coda firmata si e spostata -> digest atteso != digest reale',
})

/* ------------------------------------------------------------------------------------- */
/* B. IL DOCUMENTO SOPRA IL DOCUMENTO                                                        */
/*                                                                                          */
/* L attacco piu interessante della famiglia: la firma resta matematicamente perfetta, ma   */
/* il documento MOSTRATO diventa un altro. Non si tocca un byte firmato — si appende un      */
/* incremental update che ridipinge la cifra sopra quella vera.                             */
/* ------------------------------------------------------------------------------------- */

// B1: un SECONDO content stream nella pagina. La pagina (obj 3) si riscrive con
// /Contents [4 0 R 8 0 R]: l originale (firmato, intatto) resta, e sopra ci si dipinge un
// rettangolo bianco e la cifra falsa. E contenuto di pagina, quindi ogni renderer lo disegna.
const overlay =
  '1 1 1 rg\n' + // bianco
  '104 628 150 26 re\nf\n' + // rettangolo sopra "1.000 euro (mille euro)"
  '0 0 0 rg\n' + // nero
  'BT\n/F1 15 Tf\n110 636 Td\n(9.000.000 euro) Tj\nET\n'
const overlayObj = `8 0 obj\n<< /Length ${overlay.length} >>\nstream\n${overlay}endstream\nendobj\n`
const pageB1 = pageText.replace(/\/Contents\s+4\s+0\s+R/, '/Contents [4 0 R 8 0 R]')
const b1 = buildIncrementalUpdate(signed, [
  { num: pageNum, text: pageB1 + '\n' },
  { num: 8, text: overlayObj },
]).bytes
await prova('21-numero-ridipinto', b1, { nota: 'secondo content stream: rettangolo bianco + cifra falsa sopra la vera' })
disegna(join(OUT, '21-numero-ridipinto.pdf'), '21-numero-ridipinto')

// B2: la stessa bugia con un ANNOTAZIONE (un FreeText con appearance stream), che e la forma
// classica dell attacco. Alcuni lettori disegnano le annotazioni, altri no: lo si MISURA.
const ap =
  '1 1 1 rg\n0 0 150 26 re\nf\n0 0 0 rg\nBT\n/F1 15 Tf\n6 6 Td\n(9.000.000 euro) Tj\nET\n'
const apObj =
  `9 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 150 26] ` +
  `/Resources << /Font << /F1 5 0 R >> >> /Length ${ap.length} >>\nstream\n${ap}endstream\nendobj\n`
const annotObj =
  `8 0 obj\n<< /Type /Annot /Subtype /FreeText /Rect [104 628 254 654] ` +
  `/F 4 /Contents (9.000.000 euro) /DA (/F1 15 Tf 0 g) /AP << /N 9 0 R >> >>\nendobj\n`
const pageB2 = pageText.replace(/\/Annots\s*\[([^\]]*)\]/, (_m, dentro) => `/Annots [${dentro.trim()} 8 0 R]`)
const b2 = buildIncrementalUpdate(signed, [
  { num: pageNum, text: pageB2 + '\n' },
  { num: 8, text: annotObj },
  { num: 9, text: apObj },
]).bytes
await prova('22-annotazione-sopra-la-cifra', b2, { nota: 'FreeText con /AP: appare solo nei lettori che disegnano le annotazioni' })
disegna(join(OUT, '22-annotazione-sopra-la-cifra.pdf'), '22-annotazione-sopra-la-cifra')

/* ------------------------------------------------------------------------------------- */
/* C. LA FIRMA RINNEGATA DAL CATALOGO                                                        */
/*                                                                                          */
/* Pista: un incremental update che CANCELLA l /AcroForm dal catalogo e le /Annots dalla     */
/* pagina. La firma c e ancora tutta nei byte (obj 6, matematicamente valida), ma il         */
/* documento non la dichiara piu. pdfsig legge l /AcroForm, quindi non la trova; noi          */
/* percorriamo le definizioni di oggetto, quindi si. Divergenza voluta e misurata.           */
/* ------------------------------------------------------------------------------------- */

const catSenzaForm = catText.replace(/\s*\/AcroForm\s*<<[^>]*>>\s*(?=>>)/, ' ')
const pageSenzaAnnots = pageText.replace(/\s*\/Annots\s*\[[^\]]*\]/, '')
const cBytes = buildIncrementalUpdate(signed, [
  { num: info.rootNum, text: catSenzaForm + '\n' },
  { num: pageNum, text: pageSenzaAnnots + '\n' },
]).bytes
await prova('23-firma-rinnegata-dal-catalogo', cBytes, {
  nota: 'catalogo senza /AcroForm e pagina senza /Annots: pdfsig non vede piu la firma, noi si',
})

/* ------------------------------------------------------------------------------------- */
/* D. UN FILE, DUE DOCUMENTI                                                                 */
/*                                                                                          */
/* Pista: un secondo documento COMPLETO appeso dopo %%EOF. Si costruisce un nuovo albero      */
/* (catalogo/pagine/pagina/contenuto, oggetti 9..12) con la sua xref e un trailer il cui      */
/* /Root punta al NUOVO catalogo, SENZA /Prev: la vecchia struttura resta nei byte (e la      */
/* firma con lei) ma e orfana. L ultimo startxref indica la nuova xref, quindi poppler mostra  */
/* il documento B; verify() percorre le definizioni di oggetto e trova ancora la firma del     */
/* documento A. Un file che mostra una cosa a chi lo apre e un altra a chi lo verifica.        */
/* ------------------------------------------------------------------------------------- */

function appendiDocumentoB(pdf) {
  const start = pdf.length
  const contenuto =
    'BT\n/F1 24 Tf\n90 700 Td\n(DOCUMENTO B - nessun debito.) Tj\n' +
    '0 -40 Td\n/F1 18 Tf\n(Pago 0 euro. La firma non copre questa pagina.) Tj\nET\n'
  const oggetti = [
    { num: 9, text: '9 0 obj\n<< /Type /Catalog /Pages 10 0 R >>\nendobj\n' },
    { num: 10, text: '10 0 obj\n<< /Type /Pages /Kids [11 0 R] /Count 1 >>\nendobj\n' },
    {
      num: 11,
      text:
        '11 0 obj\n<< /Type /Page /Parent 10 0 R /MediaBox [0 0 595 842] ' +
        '/Resources << /Font << /F1 5 0 R >> >> /Contents 12 0 R >>\nendobj\n',
    },
    { num: 12, text: `12 0 obj\n<< /Length ${contenuto.length} >>\nstream\n${contenuto}endstream\nendobj\n` },
  ]
  let blocco = pdf[pdf.length - 1] === 0x0a ? '' : '\n'
  const offset = new Map()
  for (const o of oggetti) {
    offset.set(o.num, start + blocco.length)
    blocco += o.text
  }
  const xrefAt = start + blocco.length
  const riga = (n) => `${String(n).padStart(10, '0')} 00000 n \n`
  let xref = 'xref\n0 1\n0000000000 65535 f \n9 4\n'
  for (const o of oggetti) xref += riga(offset.get(o.num))
  blocco += xref
  // /Root NUOVO, niente /Prev: il documento A e orfano ma i suoi byte (firma compresa) restano.
  blocco += 'trailer\n<< /Size 13 /Root 9 0 R >>\n'
  blocco += `startxref\n${xrefAt}\n%%EOF\n`
  return concat(pdf, ascii(blocco))
}

const dBytes = appendiDocumentoB(signed)
const dueDoc = await prova('24-un-file-due-documenti', dBytes, {
  nota: 'secondo albero completo, /Root nuovo, niente /Prev; l ultimo startxref indica il documento B',
})
disegna(join(OUT, '24-un-file-due-documenti.pdf'), '24-un-file-due-documenti')
misure['24-un-file-due-documenti'].extra.pagineSecondoPdfinfo = pagineSecondoLettore(dueDoc.percorso)
misure['24-un-file-due-documenti'].extra.pagineBaseline = pagineSecondoLettore(join(OUT, '00-baseline.pdf'))

/* ------------------------------------------------------------------------------------- */
/* E. LO STARTXREF BUGIARDO                                                                  */
/*                                                                                          */
/* Pista: byte appesi che NON formano un incremental update valido — una tabella xref         */
/* malformata e uno startxref che punta a un offset che non esiste — eppure poppler li         */
/* ricostruisce e apre il file lo stesso (il renderer perdona). verify() li conta come coda.   */
/* ------------------------------------------------------------------------------------- */

const codaBugiarda =
  '\n% aggiornamento finto\n' +
  'xref\n0 1\n9999999999 65535 f \n' +
  'trailer\n<< /Root 1 0 R /Size 8 >>\n' +
  'startxref\n999999\n%%EOF\n'
const eBytes = concat(signed, ascii(codaBugiarda))
await prova('25-startxref-bugiardo', eBytes, {
  nota: 'xref malformata + startxref a 999999 (oltre la fine): non e un update valido',
  startxrefFinto: 999999,
})

/* ------------------------------------------------------------------------------------- */
/* F. I TRONCAMENTI                                                                          */
/*                                                                                          */
/* Il confine opposto: invece di aggiungere, si TAGLIA. Tre tagli, tre esiti diversi.        */
/* ------------------------------------------------------------------------------------- */

// F1: tagliato in mezzo al buco /Contents. La firma perde meta di se stessa e la ">" che chiude
//     il buco: verify non riesce piu a leggere il /Contents.
const tagliaBuco = Math.floor((contentsStart + contentsEnd) / 2)
await prova('26-troncato-nel-buco', signed.slice(0, tagliaBuco), {
  tagliatoA: tagliaBuco,
  nota: 'il buco /Contents non viene mai chiuso da ">"',
})

// F2: tagliato dopo che il dizionario di firma si e chiuso, ma 100 byte PRIMA di c+d. Il /ByteRange
//     [0 1663 9857 416] resta leggibile e dichiara di coprire fino a 10273, ma il file finisce a
//     10173: il secondo intervallo nomina byte che non ci sono piu.
await prova('27-troncato-prima-di-cpiud', signed.slice(0, signed.length - 100), {
  tagliatoA: signed.length - 100,
  cPiuD: c + d,
  nota: 'dizionario di firma intatto, ma il file finisce prima di c+d: copertura fuori dal file',
})

// F3: preso il documento ESTESO (l attacco 2, `extended`) e ritagliato ESATTAMENTE a c+d. La coda
//     appesa sparisce, la lunghezza torna 10273 === c+d, e il verdetto ritorna `valid`. Il taglio
//     e reversibile perche l append e puro: un troncamento a c+d cancella l estensione.
const estesoDaTagliare = appendIncrementalUpdate(signed).bytes
await prova('28-troncato-a-cpiud', estesoDaTagliare.slice(0, c + d), {
  daLunghezza: estesoDaTagliare.length,
  aLunghezza: c + d,
  nota: 'troncare l esteso a c+d cancella l append e riporta a valid (append puro, taglio reversibile)',
})

/* ------------------------------------------------------------------------------------- */
/* Tabella riassuntiva                                                                       */
/* ------------------------------------------------------------------------------------- */

console.log('\n\n=== RIEPILOGO ===')
console.log(['nome'.padEnd(34), 'nostro'.padEnd(9), 'firme', 'pdfsig'.padEnd(28), 'openssl'.padEnd(16), 'lettore'].join(' '))
for (const [nome, m] of Object.entries(misure)) {
  const p = m.pareri
  console.log(
    [
      nome.padEnd(34),
      String(p.nostro.verdetto).padEnd(9),
      `${p.nostro.firme}/${p.pdfsig.quante}`.padEnd(5),
      (p.pdfsig.sintesi ?? '').slice(0, 27).padEnd(28),
      (p.openssl.firme[0]?.sintesi ?? p.openssl.sintesi ?? '').slice(0, 15).padEnd(16),
      (p.lettore.importo ?? (p.lettore.apre ? '(nessun euro)' : 'NON APRE')),
    ].join(' '),
  )
}

// Le divergenze, raccolte in un posto solo.
console.log('\n=== DIVERGENZE ===')
for (const [nome, m] of Object.entries(misure)) {
  for (const div of m.pareri.divergenze) {
    console.log(`${nome}: «${div.su}» nostro=${div.nostro} ${div.pdfsig !== undefined ? 'pdfsig=' + div.pdfsig : 'openssl=' + div.openssl}`)
  }
}

// Dump completo delle misure (per riprodurre ogni numero del rapporto).
writeFileSync(join(OUT, 'misure.json'), JSON.stringify(misure, (k, v) => (k === 'pareri' ? riducibile(v) : v), 2))
console.log('\nmisure complete:', join(OUT, 'misure.json'))

/* ------------------------------------------------------------------------------------- */
/* Il referto: rilievi.json costruito DAI numeri appena misurati, cosi le prose non          */
/* possono mentire sui verdetti. Le parti narrative sono costanti; i verdetti dei tre         */
/* verificatori si leggono da `misure`.                                                       */
/* ------------------------------------------------------------------------------------- */

function esitoNostroDi(k) {
  const p = misure[k].pareri.nostro
  const cop = p.copertura
    ? `copertura ${p.copertura.complete ? 'completa' : 'incompleta'}, coda scoperta ${p.copertura.uncoveredTail} byte, gapMatchesContents=${p.copertura.gapMatchesContents}`
    : 'copertura non calcolata'
  const dig = p.digest ? (p.digest.match === null ? 'digest non calcolato' : `digest ${p.digest.match}`) : 'digest non calcolato'
  return `verdetto=${p.verdetto}; firme=${p.firme}; ${cop}; ${dig}; firma RSA=${p.firma}${p.reason ? `; reason=${p.reason}` : ''}`
}
function esitoPdfsigDi(k) {
  const p = misure[k].pareri.pdfsig
  if (p.quante === 0) return 'nessuna firma rilevata (pdfsig legge l /AcroForm: non trova campi firma)'
  const f = p.firme[0]
  return `${p.quante} firma/e; validazione «${f.validazione}»; ${f.copreTutto === true ? 'Total document signed' : f.copreTutto === false ? 'Not total document signed' : 'copertura non dichiarata'}`
}
function esitoOpensslDi(k) {
  const f = misure[k].pareri.openssl.firme[0]
  if (!f) return 'nessun CMS da verificare'
  if (f.problema) return `non estraibile: ${f.problema}`
  return f.verifica ? 'CMS Verification successful (matematica: torna)' : `CMS NON verificato${f.messaggio ? ` («${f.messaggio}»)` : ''}`
}
function esitoLettoreDi(k) {
  const l = misure[k].pareri.lettore
  return l.apre ? `pdftotext legge: ${JSON.stringify(l.importo)}` : 'pdftotext non apre il file'
}
const divergDi = (k) => misure[k].pareri.divergenze.length > 0

const rilievi = [
  {
    nome: 'Il numero ridipinto',
    idea:
      'Appendo un incremental update che aggiunge un SECONDO content stream alla pagina: un rettangolo bianco sopra "1.000 euro" e la cifra falsa "9.000.000 euro" disegnata al suo posto. Non tocco un byte firmato; la firma resta matematicamente perfetta.',
    eseguito: 'node scripts/collaudo/coda/coda.mjs  (artefatto: out/21-numero-ridipinto.pdf, immagine out/21-numero-ridipinto.png)',
    artefatto: 'scripts/collaudo/coda/out/21-numero-ridipinto.pdf',
    esitoNostro: esitoNostroDi('21-numero-ridipinto'),
    esitoPdfsig: esitoPdfsigDi('21-numero-ridipinto'),
    esitoOpenssl: esitoOpensslDi('21-numero-ridipinto'),
    esitoLettore:
      'pdftoppm DISEGNA "9.000.000 euro" (vedi PNG); pdftotext legge invece sia "9.000.000" sia il vero "1.000 euro (mille euro)" (il rettangolo bianco nasconde l originale solo all occhio, non nel livello testo)',
    numeri: `firmato 10273 byte; dopo l overlay ${misure['21-numero-ridipinto'].lunghezza} byte; /ByteRange [0 1663 9857 416] invariato; coda scoperta 495 byte; digest e firma RSA tornano`,
    riuscito: true,
    divergenza: divergDi('21-numero-ridipinto'),
    dimostra:
      'Una firma "valida" (openssl e pdfsig lo confermano) non garantisce cio che vedi: il documento mostrato puo essere ridipinto dopo la firma. Solo la copertura (il nostro extended) rivela che il file e cresciuto.',
    gravita: 'grave',
  },
  {
    nome: 'L annotazione sopra la cifra',
    idea:
      'La stessa bugia, ma con un annotazione (FreeText con appearance stream /AP) invece di un content stream: e la forma "classica" dell attacco alle firme PAdES. Verifico se poppler la disegna.',
    eseguito: 'node scripts/collaudo/coda/coda.mjs  (artefatto: out/22-annotazione-sopra-la-cifra.pdf, immagine .png)',
    artefatto: 'scripts/collaudo/coda/out/22-annotazione-sopra-la-cifra.pdf',
    esitoNostro: esitoNostroDi('22-annotazione-sopra-la-cifra'),
    esitoPdfsig: esitoPdfsigDi('22-annotazione-sopra-la-cifra'),
    esitoOpenssl: esitoOpensslDi('22-annotazione-sopra-la-cifra'),
    esitoLettore: 'pdftoppm (poppler) DISEGNA l annotazione: si legge "9.000.000 euro" sopra la cifra vera; pdftotext estrae entrambe',
    numeri: `dopo l update ${misure['22-annotazione-sopra-la-cifra'].lunghezza} byte; annotazione FreeText obj 8 + form XObject obj 9; coda scoperta 742 byte; digest e firma RSA tornano`,
    riuscito: true,
    divergenza: divergDi('22-annotazione-sopra-la-cifra'),
    dimostra:
      'Anche un annotazione appesa dopo la firma altera cio che il lettore vede senza toccare i byte firmati: firma perfetta, documento mostrato falso. E confermato che poppler disegna l overlay.',
    gravita: 'minore',
  },
  {
    nome: 'Un file, due documenti',
    idea:
      'Dopo %%EOF appendo un secondo albero completo (catalogo/pagine/pagina oggetti 9..12) con una sua xref e un trailer il cui /Root punta al NUOVO catalogo, senza /Prev. L ultimo startxref indica il documento B; il documento A (con la firma) resta nei byte ma orfano.',
    eseguito: 'node scripts/collaudo/coda/coda.mjs  (artefatto: out/24-un-file-due-documenti.pdf, immagine .png)',
    artefatto: 'scripts/collaudo/coda/out/24-un-file-due-documenti.pdf',
    esitoNostro: esitoNostroDi('24-un-file-due-documenti'),
    esitoPdfsig: esitoPdfsigDi('24-un-file-due-documenti'),
    esitoOpenssl: esitoOpensslDi('24-un-file-due-documenti'),
    esitoLettore:
      'pdfinfo conta 1 pagina (quella del documento B); pdftotext legge "Pago 0 euro. La firma non copre questa pagina."; pdftoppm disegna la pagina del documento B (vedi PNG). Il documento A (1.000 euro, firmato) e invisibile a chi apre il file.',
    numeri: `${misure['24-un-file-due-documenti'].lunghezza} byte; oggetti 9..12 appesi; nuova xref con /Root 9 0 R e SENZA /Prev; coda scoperta 590 byte; firma del documento A ancora valida (digest+RSA tornano)`,
    riuscito: true,
    divergenza: divergDi('24-un-file-due-documenti'),
    dimostra:
      'Lo stesso file e due documenti: chi lo apre vede B (nessun debito), chi verifica la matematica del CMS vede la firma di A. openssl dice "verification successful", pdfsig non trova nessuna firma. Un file puo mentire a seconda di chi lo guarda.',
    gravita: 'grave',
  },
  {
    nome: 'La firma rinnegata dal catalogo',
    idea:
      'Appendo un incremental update che toglie /AcroForm dal catalogo e /Annots dalla pagina. La firma (obj 6) e ancora tutta nei byte ed e valida, ma il documento non la dichiara piu. pdfsig legge l /AcroForm, quindi non la trova; noi percorriamo le definizioni di oggetto, quindi si.',
    eseguito: 'node scripts/collaudo/coda/coda.mjs  (artefatto: out/23-firma-rinnegata-dal-catalogo.pdf)',
    artefatto: 'scripts/collaudo/coda/out/23-firma-rinnegata-dal-catalogo.pdf',
    esitoNostro: esitoNostroDi('23-firma-rinnegata-dal-catalogo'),
    esitoPdfsig: esitoPdfsigDi('23-firma-rinnegata-dal-catalogo'),
    esitoOpenssl: esitoOpensslDi('23-firma-rinnegata-dal-catalogo'),
    esitoLettore: esitoLettoreDi('23-firma-rinnegata-dal-catalogo') + ' (il documento resta visivamente identico)',
    numeri: `${misure['23-firma-rinnegata-dal-catalogo'].lunghezza} byte; catalogo riscritto senza /AcroForm, pagina senza /Annots; coda scoperta 383 byte; firma ancora valida (digest+RSA tornano)`,
    riuscito: true,
    divergenza: divergDi('23-firma-rinnegata-dal-catalogo'),
    dimostra:
      'Si puo far sparire una firma agli occhi degli strumenti che si fidano dell /AcroForm (pdfsig: "nessuna firma") lasciandola valida nei byte. La divergenza col nostro conteggio e voluta e va nella direzione prudente: cio che nel file dichiara di essere una firma va guardato.',
    gravita: 'grave',
  },
  {
    nome: 'Il pareggio impossibile',
    idea:
      'Pista #1: un incremental update che finisca ESATTAMENTE a c+d, cosi la coda scoperta e zero e il verdetto torna valid. Provo davvero, in due modi, e misuro perche l aritmetica non lo consente.',
    eseguito:
      'node scripts/collaudo/coda/coda.mjs  (artefatti: out/20a-pareggio-append-minimo.pdf, out/20b-pareggio-compensato-esatto.pdf, out/20c-pareggio-compensato-pari.pdf)',
    artefatto: 'scripts/collaudo/coda/out/20b-pareggio-compensato-esatto.pdf',
    esitoNostro: `20a: ${esitoNostroDi('20a-pareggio-append-minimo')} || 20b: ${esitoNostroDi('20b-pareggio-compensato-esatto')} || 20c: ${esitoNostroDi('20c-pareggio-compensato-pari')}`,
    esitoPdfsig: `20a: ${esitoPdfsigDi('20a-pareggio-append-minimo')} || 20b: ${esitoPdfsigDi('20b-pareggio-compensato-esatto')} || 20c: ${esitoPdfsigDi('20c-pareggio-compensato-pari')}`,
    esitoOpenssl: `20a: ${esitoOpensslDi('20a-pareggio-append-minimo')} || 20b: ${esitoOpensslDi('20b-pareggio-compensato-esatto')} || 20c: ${esitoOpensslDi('20c-pareggio-compensato-pari')}`,
    esitoLettore: 'in tutti e tre pdftotext mostra "9.000.000 euro (nove milioni)": il documento e gia manomesso, resta solo da capire se la firma se ne accorge (si)',
    numeri:
      'c+d = 9857+416 = 10273 = lunghezza del firmato. 20a: append minimo -> lunghezza 11152, coda scoperta = 879 byte (mai zero). 20b: tolgo 879 (dispari) caratteri dal buco -> lunghezza esatta 10273 ma /Contents di lunghezza dispari, illeggibile. 20c: tolgo 878 (pari) -> lunghezza 10274, /Contents leggibile ma la coda firmata [9857,10273) e scivolata di 878: digest atteso != reale.',
    riuscito: false,
    divergenza: divergDi('20b-pareggio-compensato-esatto'),
    dimostra:
      'Non esiste un append che torni valid: [a b c d] sono byte firmati, quindi c+d e congelato; qualunque cosa aggiungi lascia coda scoperta > 0, e comprimere il buco non firmato per pareggiare la lunghezza sposta i byte firmati e fa crollare il digest. (In 20b pdfsig dichiara "Total document signed" perche i numeri del /ByteRange coprono l intero file, ma il digest non torna: entrambi rifiutano.) Il controllo della copertura non si aggira.',
    gravita: 'nota',
  },
  {
    nome: 'Lo startxref bugiardo',
    idea:
      'Appendo byte che NON sono un aggiornamento valido: una tabella xref malformata e uno startxref che punta a 999999 (oltre la fine del file). Voglio vedere se il renderer si rifiuta (no) e cosa dice il verdetto.',
    eseguito: 'node scripts/collaudo/coda/coda.mjs  (artefatto: out/25-startxref-bugiardo.pdf)',
    artefatto: 'scripts/collaudo/coda/out/25-startxref-bugiardo.pdf',
    esitoNostro: esitoNostroDi('25-startxref-bugiardo'),
    esitoPdfsig: esitoPdfsigDi('25-startxref-bugiardo'),
    esitoOpenssl: esitoOpensslDi('25-startxref-bugiardo'),
    esitoLettore: esitoLettoreDi('25-startxref-bugiardo') + ' (poppler ricostruisce la struttura e apre il file lo stesso)',
    numeri: `${misure['25-startxref-bugiardo'].lunghezza} byte; startxref appeso = 999999 (il file e lungo ${misure['25-startxref-bugiardo'].lunghezza}); coda scoperta 109 byte`,
    riuscito: false,
    divergenza: divergDi('25-startxref-bugiardo'),
    dimostra:
      'Il renderer perdona anche una coda che non e un aggiornamento valido (ricostruisce gli oggetti), ma la firma no: verify la conta come coda scoperta e resta extended. Vedere il documento aperto non e verificarlo.',
    gravita: 'nota',
  },
  {
    nome: 'Il buco spezzato',
    idea:
      'Troncamento: taglio il file a meta del buco /Contents. Meta della firma e la ">" che chiude il buco spariscono.',
    eseguito: 'node scripts/collaudo/coda/coda.mjs  (artefatto: out/26-troncato-nel-buco.pdf)',
    artefatto: 'scripts/collaudo/coda/out/26-troncato-nel-buco.pdf',
    esitoNostro: esitoNostroDi('26-troncato-nel-buco'),
    esitoPdfsig: esitoPdfsigDi('26-troncato-nel-buco'),
    esitoOpenssl: esitoOpensslDi('26-troncato-nel-buco'),
    esitoLettore: esitoLettoreDi('26-troncato-nel-buco') + ' (poppler ricostruisce e mostra ancora 1.000 euro)',
    numeri: `tagliato a offset ${Math.floor((contentsStart + contentsEnd) / 2)} (dentro il buco 1663..9856); dizionario di firma mai chiuso, quindi verify non lo riconosce nemmeno: reason=nessuna-firma`,
    riuscito: false,
    divergenza: divergDi('26-troncato-nel-buco'),
    dimostra: 'Tagliare dentro il buco distrugge il dizionario di firma: verify dice invalid/nessuna-firma. Il controllo regge.',
    gravita: 'nota',
  },
  {
    nome: 'La coda amputata',
    idea:
      'Troncamento fine: taglio 100 byte PRIMA di c+d, ma dopo che il dizionario di firma si e chiuso. Il /ByteRange resta leggibile e dichiara di coprire fino a 10273, ma il file finisce a 10173.',
    eseguito: 'node scripts/collaudo/coda/coda.mjs  (artefatto: out/27-troncato-prima-di-cpiud.pdf)',
    artefatto: 'scripts/collaudo/coda/out/27-troncato-prima-di-cpiud.pdf',
    esitoNostro: esitoNostroDi('27-troncato-prima-di-cpiud'),
    esitoPdfsig: esitoPdfsigDi('27-troncato-prima-di-cpiud'),
    esitoOpenssl: esitoOpensslDi('27-troncato-prima-di-cpiud'),
    esitoLettore: esitoLettoreDi('27-troncato-prima-di-cpiud'),
    numeri: `tagliato a ${misure['27-troncato-prima-di-cpiud'].lunghezza} byte; /ByteRange dichiara c+d=10273; il secondo intervallo [9857,10273) nomina byte oltre la fine: reason=copertura-fuori-dal-file`,
    riuscito: false,
    divergenza: divergDi('27-troncato-prima-di-cpiud'),
    dimostra:
      'Se il file e piu corto di quanto il /ByteRange dichiara, verify lo becca (copertura-fuori-dal-file, invalid). pdfsig, col trailer troncato, non trova piu la firma: un altra divergenza dove noi siamo piu severi.',
    gravita: 'minore',
  },
  {
    nome: 'Il taglio reversibile a c+d',
    idea:
      'Prendo il documento ESTESO (l attacco 2, extended) e lo taglio ESATTAMENTE a c+d = 10273. La coda appesa sparisce e la lunghezza torna a coincidere con c+d.',
    eseguito: 'node scripts/collaudo/coda/coda.mjs  (artefatto: out/28-troncato-a-cpiud.pdf)',
    artefatto: 'scripts/collaudo/coda/out/28-troncato-a-cpiud.pdf',
    esitoNostro: esitoNostroDi('28-troncato-a-cpiud'),
    esitoPdfsig: esitoPdfsigDi('28-troncato-a-cpiud'),
    esitoOpenssl: esitoOpensslDi('28-troncato-a-cpiud'),
    esitoLettore: esitoLettoreDi('28-troncato-a-cpiud'),
    numeri: `l esteso e 11152 byte; tagliato a c+d=10273 ridiventa identico al firmato intatto (append puro): verdetto valid`,
    riuscito: false,
    divergenza: divergDi('28-troncato-a-cpiud'),
    dimostra:
      'Il controllo della coda e una pura uguaglianza di lunghezza (c+d === fileLength): togliere l append riporta a valid. Non e un attacco, e la controprova che extended dipende solo dai byte in piu, non da un difetto.',
    gravita: 'nota',
  },
]

writeFileSync(join(OUT, 'rilievi.json'), JSON.stringify(rilievi, null, 2))
console.log('rilievi:', join(OUT, 'rilievi.json'), `(${rilievi.length} rilievi)`)

/** Riduce l oggetto pareri a cio che sta comodo in un JSON (via i buffer e i testi lunghissimi). */
function riducibile(p) {
  return {
    nostro: { verdetto: p.nostro.verdetto, firme: p.nostro.firme, reason: p.nostro.reason, copertura: p.nostro.copertura, digest: p.nostro.digest, firma: p.nostro.firma, perFirma: p.nostro.perFirma },
    pdfsig: { quante: p.pdfsig.quante, sintesi: p.pdfsig.sintesi, firme: p.pdfsig.firme, intervalli: p.pdfsig.intervalli },
    openssl: { sintesi: p.openssl.sintesi, firme: p.openssl.firme.map((f) => ({ index: f.index, verifica: f.verifica, messaggio: f.messaggio, byteRange: f.byteRange })) },
    lettore: { apre: p.lettore.apre, importo: p.lettore.importo, righe: p.lettore.righe },
    divergenze: p.divergenze,
  }
}

export { misure }
