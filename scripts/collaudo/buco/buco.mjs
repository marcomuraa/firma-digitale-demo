/**
 * Collaudo avversariale — «il buco /Contents: 2717 byte legittimamente non firmati».
 *
 * Il /Contents di una firma PAdES e per costruzione ESCLUSO dalla firma: sono i byte in cui la
 * firma stessa vive, e nessuno puo firmarli. Nel campione, dopo il CMS avanzano 5434 caratteri
 * esadecimali di padding — 2717 byte che il verdetto `valid` non guarda mai. Il collaudo
 * precedente ha gia dimostrato che li dentro si scrive quello che si vuole (07) e che chiudere il
 * buco in anticipo diverge da pdfsig (09). Qui si SPINGE quella leva fino al fondo e si misura
 * ogni gradino: quanto ci sta davvero, cosa ci si nasconde, chi vede cosa.
 *
 *   node scripts/collaudo/buco/buco.mjs
 *
 * Ogni riga e un file vero in out/, verificato da verify.js senza informazioni privilegiate, e
 * confrontato con pdfsig, openssl e pdftotext tramite il tre-a-confronto di ../comune/terzi.mjs.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateKeyPair } from '../../../src/core/keys.js'
import { buildSelfSigned } from '../../../src/core/certificate.js'
import { buildSignedData } from '../../../src/core/cms.js'
import { addPlaceholder, digestCovered, injectSignature } from '../../../src/core/pades.js'
import { equals, fromHex, sha256 } from '../../../src/core/bytes.js'
import { verify, extractSignature } from '../../../src/core/verify.js'
import { buildAsn1Tree } from '../../../src/views/asn1-view.js'

import { pareri } from '../comune/terzi.mjs'
import {
  firmaIlCampione,
  SAMPLE,
  TEMPO,
  ascii,
  concat,
  fromAscii,
  indexOf,
  sovrascrivi,
  toHex,
} from '../copertura/comune.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'out')

/** Scrive nel MIO out/, mai in quello della copertura (che e di un altra sessione). */
function salva(nome, bytes) {
  const file = join(OUT, nome)
  writeFileSync(file, bytes)
  return file
}

/* ------------------------------------------------------------------------------------- */
/* Il campione firmato, vero, da cui si misura tutto                                       */
/* ------------------------------------------------------------------------------------- */

const base = await firmaIlCampione()
const { signed, byteRange, contentsStart, contentsEnd, cmsDer } = base
const padStart = contentsStart + 1 + cmsDer.length * 2 // primo carattere hex di padding libero
const paddingHexChars = contentsEnd - padStart
const maxByteLiberi = Math.floor(paddingHexChars / 2)

console.log('=== geometria misurata del campione ===')
console.log('signed.length      ', signed.length)
console.log('/ByteRange         ', JSON.stringify(byteRange))
console.log('buco /Contents     ', contentsStart, '..', contentsEnd, `(${contentsEnd - contentsStart + 1} byte)`)
console.log('CMS                ', cmsDer.length, 'byte =', cmsDer.length * 2, 'hex')
console.log('padStart (offset)  ', padStart)
console.log('padding libero     ', paddingHexChars, 'hex =', maxByteLiberi, 'byte NON firmati')
console.log()

/* ------------------------------------------------------------------------------------- */
/* Attrezzi                                                                                */
/* ------------------------------------------------------------------------------------- */

const rilievi = []

/**
 * Verifica un file con verify() E con i tre strumenti terzi, stampa il confronto e archivia le
 * misure. `atteso` e cio che ci si aspetta da verify(): serve solo a far saltare all occhio le
 * sorprese, non cambia niente.
 */
async function misura(nome, bytes, atteso, extra = {}) {
  const file = salva(`${nome}.pdf`, bytes)
  const r = await verify(bytes)
  const p = await pareri(file) // pdfsig + openssl + pdftotext, riproducibili a mano
  const riga = {
    nome,
    file,
    lunghezza: bytes.length,
    atteso,
    nostro: {
      verdetto: r.verdict,
      reason: r.reason,
      complete: r.coverage?.complete ?? null,
      gapMatchesContents: r.coverage?.gapMatchesContents ?? null,
      codaScoperta: r.coverage?.uncoveredTail ?? null,
      digest: r.digest?.match ?? null,
      firma: r.signature?.ok ?? null,
      firme: r.signatures.length,
      cn: r.identity?.subjectCN ?? null,
    },
    pdfsig: { sintesi: p.pdfsig.sintesi, quante: p.pdfsig.quante, copreTutto: p.pdfsig.copreTutto },
    openssl: { sintesi: p.openssl.sintesi },
    lettore: { importo: p.lettore.importo, apre: p.lettore.apre },
    divergenze: p.divergenze,
    ...extra,
  }
  rilievi.push(riga)
  const spia = r.verdict === atteso ? '' : `  <<< DIVERSO DA ATTESO (${atteso})`
  console.log(
    `[${nome}]`.padEnd(40),
    `nostro=${r.verdict}`.padEnd(18),
    `pdfsig=${p.pdfsig.sintesi}`.padEnd(34),
    `openssl=${p.openssl.sintesi}`.padEnd(24),
    spia,
  )
  if (p.divergenze.length) {
    for (const d of p.divergenze) console.log('     DIVERGE su', JSON.stringify(d))
  }
  return { r, p, riga }
}

/** Incornicia un carico cosi da poterlo riestrarre dal file firmato senza indovinare la lunghezza. */
const MAGIC = ascii('NELBUCO\0') // 8 byte
function incornicia(payload) {
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, payload.length, false)
  return concat(MAGIC, len, payload)
}

/** Riestrae il carico incorniciato da un file firmato su disco, usando solo l API pubblica. */
function estraiDalBuco(fileBytes) {
  const sig = extractSignature(fileBytes) // ci dice dove sta il CMS: da li in poi e padding
  const ps = sig.contentsStart + 1 + sig.cmsDer.length * 2
  const padHex = fromAscii(fileBytes.subarray(ps, sig.contentsEnd))
  const framed = fromHex(padHex)
  const magico = equals(framed.subarray(0, MAGIC.length), MAGIC)
  if (!magico) return { magico: false }
  const len = new DataView(framed.buffer, framed.byteOffset + MAGIC.length, 4).getUint32(0, false)
  return { magico: true, payload: framed.slice(MAGIC.length + 4, MAGIC.length + 4 + len), padStart: ps }
}

/** Firma il campione con un padding a scelta: serve un buco piu grande per i carichi grossi. */
async function firmaConPadding(padding) {
  const pair = await generateKeyPair()
  const cert = await buildSelfSigned({ ...pair, subjectCN: 'Lorenzo Rossi', now: TEMPO })
  const { pdfWithHole, byteRange: br, contentsStart: cs } = addPlaceholder(SAMPLE, {
    padding,
    signingTime: TEMPO,
  })
  const md = await digestCovered(pdfWithHole, br)
  const { cmsDer: cms } = await buildSignedData({
    messageDigest: md,
    certDer: cert.certDer,
    privateKey: pair.privateKey,
    signingTime: TEMPO,
  })
  const s = injectSignature(pdfWithHole, cs, cms)
  return { signed: s, byteRange: br, contentsStart: cs, contentsEnd: indexOf(s, '>', cs), cmsDer: cms }
}

/** Un CMS SignedData completo e valido, firmato dall aggressore su un digest qualunque. */
async function cmsDellAggressore(testoFinto, cn = 'Eve Attaccante') {
  const pair = await generateKeyPair()
  const cert = await buildSelfSigned({ ...pair, subjectCN: cn, now: TEMPO })
  const md = await sha256(ascii(testoFinto))
  const { cmsDer: cms } = await buildSignedData({
    messageDigest: md,
    certDer: cert.certDer,
    privateKey: pair.privateKey,
    signingTime: TEMPO,
  })
  return cms
}

/* ------------------------------------------------------------------------------------- */
/* 0. Il controllo: il campione intatto                                                    */
/* ------------------------------------------------------------------------------------- */

await misura('00-campione-intatto', signed, 'valid')

/* ------------------------------------------------------------------------------------- */
/* 1. Il massimo esatto, al byte. Riempio TUTTO il padding e metto una spia sull ultimo.   */
/*    Se la spia sopravvive e il file resta valid, allora quei byte sono davvero tutti      */
/*    scrivibili senza che il verdetto se ne accorga.                                       */
/* ------------------------------------------------------------------------------------- */
{
  const carico = new Uint8Array(maxByteLiberi)
  for (let i = 0; i < carico.length; i++) carico[i] = 0x41 + (i % 26) // 'A'..'Z' ripetute
  carico[carico.length - 1] = 0x7e // '~' come spia sull ultimissimo byte libero
  const bytes = sovrascrivi(signed, padStart, toHex(carico))
  const { riga } = await misura('01-massimo-esatto', bytes, 'valid', {
    byteRiempiti: maxByteLiberi,
    spiaUltimoByte: '0x7e (~) a offset hex ' + (contentsEnd - 2),
  })
  // Rileggo dal file e verifico che la spia sia proprio l ultimo byte prima del '>'.
  const riletto = new Uint8Array(readFileSync(riga.file))
  const ultimoHex = fromAscii(riletto.subarray(contentsEnd - 2, contentsEnd))
  console.log('     ultimo byte libero riletto:', ultimoHex, '(atteso 7e)')
}

/* ------------------------------------------------------------------------------------- */
/* 2. Un intero PDF dentro il PDF firmato. Nascondo sample.pdf per intero nel buco, resto   */
/*    valid, e lo RIESTRAGGO dal file firmato dimostrando che e byte-identico e che si apre. */
/* ------------------------------------------------------------------------------------- */
{
  const framed = incornicia(SAMPLE) // 8+4+1285 = 1297 byte -> 2594 hex, ci stanno in 5434
  const bytes = sovrascrivi(signed, padStart, toHex(framed))
  const { riga } = await misura('02-pdf-nel-pdf', bytes, 'valid', {
    payloadByte: SAMPLE.length,
    incorniciatoByte: framed.length,
  })
  // Estrazione dal file su disco, con la sola API pubblica (extractSignature).
  const rilett = new Uint8Array(readFileSync(riga.file))
  const est = estraiDalBuco(rilett)
  const identico = est.magico && equals(est.payload, SAMPLE)
  const fileEstratto = salva('02-estratto-sample.pdf', est.payload)
  const pt = execFileSync('pdftotext', ['-layout', fileEstratto, '-'], { encoding: 'utf8' })
  const importoEstratto = pt.split('\n').map((r) => r.trim()).find((r) => /euro/i.test(r)) ?? null
  riga.estrazione = { identicoAllOriginale: identico, byte: est.payload?.length ?? null, fileEstratto, importoEstratto }
  console.log('     estratto identico a sample.pdf:', identico, '| pdftotext estratto ->', importoEstratto)
}

/* ------------------------------------------------------------------------------------- */
/* 3. Un ESEGUIBILE dentro il PDF firmato. Serve un buco piu grande: rifirmo con padding    */
/*    ampio, nascondo un vero Mach-O (/usr/bin/true), resto valid, lo riestraggo e chiedo a  */
/*    `file` che cos e. Non lo eseguo: basta dimostrare che ci sta ed esce byte-identico.    */
/* ------------------------------------------------------------------------------------- */
{
  const exe = new Uint8Array(readFileSync('/usr/bin/true')) // Mach-O eseguibile di sistema
  const big = await firmaConPadding(100000) // buco da ~200 kB
  const psBig = big.contentsStart + 1 + big.cmsDer.length * 2
  const framed = incornicia(exe)
  const bytes = sovrascrivi(big.signed, psBig, toHex(framed))
  const { riga } = await misura('03-eseguibile-nel-buco', bytes, 'valid', {
    eseguibileByte: exe.length,
    paddingUsato: 100000,
  })
  const rilett = new Uint8Array(readFileSync(riga.file))
  const est = estraiDalBuco(rilett)
  const identico = est.magico && equals(est.payload, exe)
  const fileEstratto = salva('03-estratto-true', est.payload)
  const tipo = execFileSync('file', ['-b', fileEstratto], { encoding: 'utf8' }).trim()
  riga.estrazione = { identicoAllOriginale: identico, byte: est.payload?.length ?? null, fileEstratto, tipoSecondoFile: tipo }
  console.log('     eseguibile estratto identico:', identico, '| file ->', tipo)
}

/* ------------------------------------------------------------------------------------- */
/* 4. Il CMS gemello. Il nostro readCms taglia a `parsed.offset`: cosa c e DOPO la prima    */
/*    struttura non lo guarda nessuno. Accodo un SECONDO CMS valido, dell aggressore, dentro */
/*    lo stesso /Contents. Chi lo vede? Confronto il nostro albero ASN.1 con openssl asn1parse.*/
/* ------------------------------------------------------------------------------------- */
{
  const cms2 = await cmsDellAggressore('bonifico fantasma da un milione di euro', 'Eve Attaccante')
  const gemello = concat(cmsDer, cms2) // CMS vero || CMS aggressore, in fila
  if (gemello.length * 2 > paddingHexChars + cmsDer.length * 2) throw new Error('i due CMS non ci stanno')
  const bytes = sovrascrivi(signed, contentsStart + 1, toHex(gemello))
  const { r, riga } = await misura('04-cms-gemello', bytes, 'valid', {
    cms1Byte: cmsDer.length,
    cms2Byte: cms2.length,
  })

  // Cosa estrae la nostra API: solo il primo CMS.
  const sig = extractSignature(bytes)
  riga.nostroCmsEstratto = { byte: sig.cmsDer.length, uguoleAlPrimo: equals(sig.cmsDer, cmsDer) }

  // Cosa mostra il nostro albero ASN.1 (asn1-view) sull INTERO contenuto del buco: si ferma al 1o.
  const dentroBuco = fromHex(fromAscii(bytes.subarray(contentsStart + 1, contentsEnd)))
  const tree = buildAsn1Tree(dentroBuco)
  const fineAlbero = tree.ok ? tree.root.offset + tree.root.length : null
  riga.nostroAlbero = {
    ok: tree.ok,
    fineRadice: fineAlbero,
    byteTotali: tree.totalLength,
    byteDopoLaRadice: tree.ok ? tree.totalLength - fineAlbero : null,
    figliDiPrimoLivello: tree.ok ? tree.root.children.length : null,
  }

  // Cosa vede openssl asn1parse sugli STESSI byte: quante SEQUENCE di primo livello (offset 0)?
  const bucoBin = salva('04-buco-completo.der', dentroBuco.subarray(0, (cmsDer.length + cms2.length)))
  const ap = execFileSync('openssl', ['asn1parse', '-inform', 'DER', '-in', bucoBin], { encoding: 'utf8' })
  const sequenzeRadice = ap.split('\n').filter((l) => /^\s*0:d=0\s/.test(l)).length
  riga.opensslAsn1parse = {
    strutturePrimoLivelloAOffset0: sequenzeRadice,
    // asn1parse enumera in sequenza: se dopo la prima struttura ne compare un altra, la vede
    righeConDepth0: ap.split('\n').filter((l) => /d=0\s+hl=/.test(l)).length,
  }
  console.log('     nostro albero: radice finisce a', fineAlbero, 'byte, dopo restano', riga.nostroAlbero.byteDopoLaRadice, '(il 2o CMS, non mostrato)')
  console.log('     openssl asn1parse: righe a depth 0 =', riga.opensslAsn1parse.righeConDepth0, '(una per struttura di primo livello)')
}

/* ------------------------------------------------------------------------------------- */
/* 5. Lo spazio che ci acceca. La specifica PDF (7.3.4.3) PERMETTE spazi e a capo dentro una */
/*    stringa esadecimale. Noi rifiutiamo con contents-illeggibile. pdfsig e openssl no?      */
/*    Sostituisco due zeri di padding con due spazi: lunghezza identica, CMS immutato.        */
/* ------------------------------------------------------------------------------------- */
{
  const bytes = sovrascrivi(signed, padStart, ascii('  ')) // due 0x20 al posto di due '0'
  const { r, riga } = await misura('05-spazio-nella-stringa-hex', bytes, 'invalid', {
    modifica: 'due zeri di padding -> due spazi (0x20) a offset ' + padStart,
    notaSpec: 'PDF 32000-1 §7.3.4.3: i whitespace in una stringa esadecimale vanno IGNORATI',
  })
  console.log('     nostro reason:', r.reason, '| pdfsig:', riga.pdfsig.sintesi, '| openssl:', riga.openssl.sintesi)
}

// 5b. Variante: un solo spazio -> lunghezza hex dispari. La spec PDF assume uno '0' finale
//     mancante; noi e la nostra estrazione openssl «grezza» inciampiamo entrambe sul dispari.
{
  const bytes = sovrascrivi(signed, padStart, ascii(' ')) // un solo 0x20
  const { r, riga } = await misura('05b-spazio-singolo-hex-dispari', bytes, 'invalid', {
    modifica: 'un solo zero di padding -> uno spazio (0x20)',
  })
  console.log('     nostro reason:', r.reason, '| pdfsig:', riga.pdfsig.sintesi, '| openssl:', riga.openssl.sintesi)
}

/* ------------------------------------------------------------------------------------- */
/* 6. Il round-trip. Il carico nel buco sopravvive se qualcuno RISALVA il PDF? Passo il      */
/*    file «02-pdf-nel-pdf» (valid, con sample.pdf dentro) attraverso ghostscript e rimisuro. */
/* ------------------------------------------------------------------------------------- */
{
  const ingresso = join(OUT, '02-pdf-nel-pdf.pdf')
  const uscita = join(OUT, '06-dopo-ghostscript.pdf')
  let gsOk = true
  let gsErr = ''
  try {
    execFileSync('gs', ['-q', '-o', uscita, '-sDEVICE=pdfwrite', '-dNOPAUSE', '-dBATCH', ingresso], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    gsOk = false
    gsErr = String(e.stderr ?? e.message)
  }
  if (gsOk) {
    const dopo = new Uint8Array(readFileSync(uscita))
    const r = await verify(dopo)
    const p = await pareri(uscita)
    // La firma sopravvive? Il carico sopravvive?
    const est = (() => {
      try {
        return estraiDalBuco(dopo)
      } catch {
        return { magico: false }
      }
    })()
    const magicPresente = indexOf(dopo, MAGIC) !== -1
    const riga = {
      nome: '06-round-trip-ghostscript',
      file: uscita,
      lunghezza: dopo.length,
      atteso: 'nessuna-firma (gs riserializza e butta via firma e carico)',
      nostro: { verdetto: r.verdict, reason: r.reason, firme: r.signatures.length },
      pdfsig: { sintesi: p.pdfsig.sintesi, quante: p.pdfsig.quante },
      openssl: { sintesi: p.openssl.sintesi },
      lettore: { importo: p.lettore.importo },
      firmaSopravvive: r.signatures.length > 0 && r.verdict !== 'invalid',
      caricoSopravvive: magicPresente,
      estrazioneDopo: est.magico,
    }
    rilievi.push(riga)
    console.log(
      '[06-round-trip-ghostscript]'.padEnd(40),
      `nostro=${r.verdict}/${r.reason}`.padEnd(30),
      `firme=${r.signatures.length}`,
      '| carico (magic NELBUCO) ancora nel file:', magicPresente,
    )
  } else {
    rilievi.push({ nome: '06-round-trip-ghostscript', errore: 'ghostscript non ha prodotto un PDF: ' + gsErr })
    console.log('[06-round-trip-ghostscript] ghostscript ha fallito:', gsErr.split('\n')[0])
  }
}

/* ------------------------------------------------------------------------------------- */
/* 7. Mappa firmato / non-firmato del dizionario di firma (pista: un byte non firmato che    */
/*    cambia il significato?). Classifico ogni token del /Sig come coperto o no, e cerco un   */
/*    byte NON firmato ma semanticamente carico. Se non esiste, il controllo tiene: e un      */
/*    fallimento che vale una scoperta.                                                       */
/* ------------------------------------------------------------------------------------- */
{
  const [a, b, c, d] = byteRange
  const coperto = (off) => (off >= a && off < a + b) || (off >= c && off < c + d)
  const text = fromAscii(signed)
  // Trovo il dizionario di firma: da "6 0 obj" a "endobj".
  const objStart = indexOf(signed, '6 0 obj')
  const objEnd = indexOf(signed, 'endobj', objStart) + 'endobj'.length
  // Alcuni token chiave e la loro copertura.
  const tokens = ['/Type /Sig', '/ByteRange', '/Contents', '/M (', 'endobj']
  const mappaTokens = tokens.map((t) => {
    const at = text.indexOf(t, objStart)
    return { token: t, offset: at, primoByteCoperto: coperto(at), ultimoByteCoperto: coperto(at + t.length - 1) }
  })
  // Confine esatto: primo byte NON coperto e ultimo byte NON coperto dentro l oggetto.
  let primoNonCoperto = -1
  let ultimoNonCoperto = -1
  for (let off = objStart; off < objEnd; off++) {
    if (!coperto(off)) {
      if (primoNonCoperto === -1) primoNonCoperto = off
      ultimoNonCoperto = off
    }
  }
  // C e almeno un byte NON coperto che NON stia dentro il valore <...> del /Contents?
  const buco0 = contentsStart // '<'
  const buco1 = contentsEnd // '>'
  let byteNonCopertoFuoriDalBuco = -1
  for (let off = objStart; off < objEnd; off++) {
    if (!coperto(off) && !(off >= buco0 && off <= buco1)) {
      byteNonCopertoFuoriDalBuco = off
      break
    }
  }
  const riga = {
    nome: '07-mappa-firmato-non-firmato',
    dizionarioFirma: { start: objStart, end: objEnd },
    intervalliFirmati: [[a, a + b], [c, c + d]],
    bucoContents: [buco0, buco1],
    mappaTokens,
    primoByteNonFirmato: primoNonCoperto,
    ultimoByteNonFirmato: ultimoNonCoperto,
    byteNonFirmatoFuoriDalValoreContents: byteNonCopertoFuoriDalBuco, // -1 = nessuno
    conclusione:
      byteNonCopertoFuoriDalBuco === -1
        ? 'ogni byte non firmato sta DENTRO il valore <...> del /Contents (inerte per un lettore): il controllo tiene'
        : 'esiste un byte non firmato fuori dal valore /Contents a offset ' + byteNonCopertoFuoriDalBuco,
  }
  rilievi.push(riga)
  console.log('[07-mappa-firmato-non-firmato]'.padEnd(40))
  console.log('     intervalli firmati:', JSON.stringify(riga.intervalliFirmati))
  console.log('     buco /Contents (non firmato):', JSON.stringify(riga.bucoContents))
  console.log('     primo/ultimo byte NON firmato:', primoNonCoperto, '/', ultimoNonCoperto)
  console.log('     byte non firmato FUORI dal valore /Contents:', byteNonCopertoFuoriDalBuco, '(-1 = nessuno)')
  for (const t of mappaTokens) {
    console.log(`     token ${t.token.padEnd(12)} @${t.offset}  coperto=${t.primoByteCoperto}`)
  }
}

/* ------------------------------------------------------------------------------------- */
/* Rapporto                                                                                 */
/* ------------------------------------------------------------------------------------- */

writeFileSync(join(OUT, 'misure.json'), JSON.stringify(rilievi, null, 2))
console.log('\nmisure complete in', join(OUT, 'misure.json'))
