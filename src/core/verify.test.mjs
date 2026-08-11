/**
 * Prove della verifica.
 *
 * Niente e simulato: la catena gira davvero. Si generano le chiavi, si costruisce il certificato
 * autofirmato, si scava il placeholder nel PDF campione, si calcola l'impronta dei byte coperti,
 * si costruisce il CMS e lo si scrive dentro il buco. Poi si consegna a `verify()` **solo i byte**
 * del file, come farebbe qualcuno che la firma non l'ha vista nascere, e si guarda cosa dice.
 *
 * I cinque stati veri della demo — quelli che il pubblico vedra — sono la spina dorsale di questo
 * file: se passano, la demo funziona.
 *
 *   a) PDF firmato integro                 -> valid
 *   b) dopo tamperDigit                    -> invalid
 *   c) dopo tamperWords                    -> invalid, e senza lanciare
 *   d) dopo appendIncrementalUpdate        -> extended, con uncoveredTail > 0
 *   e) PDF non firmato del tutto           -> oggetto ben formato che dice che firma non ce n'e
 *
 * Attorno a quei cinque c'e la prova che vale quanto loro: `verify()` non lancia mai, qualunque
 * cosa gli si dia. Un'eccezione non gestita, in pagina, e uno schermo bianco davanti a un'aula.
 *
 * Si esegue con:  node --test src/core/verify.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { verify, extractSignature } from './verify.js'
import { generateKeyPair } from './keys.js'
import { buildSelfSigned } from './certificate.js'
import { buildSignedData } from './cms.js'
import { addPlaceholder, digestCovered, injectSignature } from './pades.js'
import { appendIncrementalUpdate, tamperDigit, tamperWords } from './attacks.js'
import { ascii, concat, equals, fromAscii, indexOf, lastIndexOf, toHex } from './bytes.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SAMPLE = new Uint8Array(readFileSync(join(HERE, '../assets/sample.pdf')))
const SUBJECT_CN = 'Lorenzo Rossi'
/** Data fissa: le prove non devono cambiare esito a seconda dell'ora in cui girano. */
const SIGNING_TIME = new Date(Date.UTC(2026, 7, 10, 12, 0, 0))
const PADDING = 4096

/**
 * La catena vera, dall'inizio alla fine. Gira una volta sola: RSA-2048 non e gratis, e tutte le
 * prove che seguono partono comunque dallo stesso documento firmato.
 */
async function signSample() {
  const pair = await generateKeyPair()
  const cert = await buildSelfSigned({ ...pair, subjectCN: SUBJECT_CN, now: SIGNING_TIME })
  const { pdfWithHole, byteRange, contentsStart } = addPlaceholder(SAMPLE, {
    padding: PADDING,
    signingTime: SIGNING_TIME,
  })
  const messageDigest = await digestCovered(pdfWithHole, byteRange)
  const { cmsDer, signedAttrsDer, signature } = await buildSignedData({
    messageDigest,
    certDer: cert.certDer,
    privateKey: pair.privateKey,
    signingTime: SIGNING_TIME,
  })
  return {
    signed: injectSignature(pdfWithHole, contentsStart, cmsDer),
    pdfWithHole,
    byteRange,
    contentsStart,
    messageDigest,
    cmsDer,
    signedAttrsDer,
    signature,
    certDer: cert.certDer,
  }
}

const chain = await signSample()
const SIGNED = chain.signed

/** Gravita dei tre verdetti: serve a controllare la regola del peggiore a ogni verifica. */
const GRAVITA = { valid: 0, extended: 1, invalid: 2 }

/** I nove campi che ogni risultato ha, sempre, qualunque cosa sia andata storta. */
function assertShape(result, dove) {
  assert.equal(typeof result, 'object', `${dove}: il risultato deve essere un oggetto`)
  assert.notEqual(result, null, `${dove}: il risultato non puo essere null`)
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      'coverage',
      'digest',
      'error',
      'identity',
      'multipleSignatures',
      'reason',
      'signature',
      'signatures',
      'verdict',
    ],
    `${dove}: la forma del risultato e cambiata`,
  )
  assert.ok(
    ['valid', 'extended', 'invalid'].includes(result.verdict),
    `${dove}: verdetto "${result.verdict}" fuori dai tre stati`,
  )
  for (const campo of ['coverage', 'digest', 'signature', 'identity']) {
    assert.ok(
      result[campo] === null || typeof result[campo] === 'object',
      `${dove}: ${campo} deve essere un oggetto oppure null`,
    )
  }
  assert.ok(result.error === null || typeof result.error === 'string', `${dove}: error`)
  assert.ok(result.reason === null || typeof result.reason === 'string', `${dove}: reason`)
  if (result.error !== null) {
    assert.ok(result.reason !== null, `${dove}: un errore senza reason non e classificabile`)
    assert.ok(result.error.length > 20, `${dove}: il messaggio d'errore deve essere una frase`)
  }

  // --- la parte multi-firma del contratto -------------------------------------------------
  assert.ok(Array.isArray(result.signatures), `${dove}: signatures deve essere un array`)
  assert.equal(
    result.multipleSignatures,
    result.signatures.length > 1,
    `${dove}: multipleSignatures deve dire se le firme sono piu di una`,
  )
  result.signatures.forEach((firma, i) => {
    assert.deepEqual(
      Object.keys(firma).sort(),
      [
        'byteRange',
        'contentsStart',
        'coverage',
        'digest',
        'error',
        'identity',
        'index',
        'reason',
        'signature',
        'verdict',
      ],
      `${dove}: la forma della firma ${i} e cambiata`,
    )
    assert.equal(firma.index, i, `${dove}: index deve essere la posizione nell array`)
    assert.ok(
      ['valid', 'extended', 'invalid'].includes(firma.verdict),
      `${dove}: firma ${i}, verdetto "${firma.verdict}" fuori dai tre stati`,
    )
    if (firma.identity !== null) {
      assert.match(
        firma.identity.fingerprint,
        /^[0-9a-f]{64}$/,
        `${dove}: firma ${i}, fingerprint deve essere uno SHA-256 esadecimale`,
      )
    }
  })

  if (result.signatures.length === 0) {
    assert.equal(result.coverage, null, `${dove}: senza firme non c'e niente da misurare`)
    assert.equal(result.verdict, 'invalid', `${dove}: senza firme il verdetto non puo che essere invalid`)
  } else {
    // I cinque campi storici parlano della firma primaria, e sono proprio i suoi oggetti.
    const primaria = result.signatures[0]
    for (const campo of ['coverage', 'digest', 'signature', 'identity']) {
      assert.equal(result[campo], primaria[campo], `${dove}: ${campo} deve essere quello della primaria`)
    }
    const peggiore = Math.max(...result.signatures.map((f) => GRAVITA[f.verdict]))
    assert.equal(
      GRAVITA[result.verdict],
      peggiore,
      `${dove}: il verdetto complessivo deve essere il peggiore fra le firme`,
    )
  }
  return result
}

/** Verifica e controllo di forma insieme: nessuna prova puo dimenticarsi il secondo. */
async function verified(bytes, dove) {
  return assertShape(await verify(bytes), dove)
}

// ===========================================================================
// I cinque stati veri della demo
// ===========================================================================

test('a) il PDF firmato integro: valid', async () => {
  const r = await verified(SIGNED, 'firmato')

  assert.equal(r.verdict, 'valid')
  assert.equal(r.error, null, 'un documento sano non deve produrre nessun messaggio d\'errore')
  assert.equal(r.reason, null)

  assert.equal(r.digest.match, true)
  assert.equal(r.digest.expected, r.digest.actual)
  assert.equal(r.signature.ok, true)

  assert.equal(r.coverage.complete, true)
  assert.equal(r.coverage.uncoveredTail, 0)
  assert.equal(r.coverage.fileLength, SIGNED.length)
  assert.equal(r.coverage.gapMatchesContents, true)
  assert.deepEqual(r.coverage.byteRange, chain.byteRange)
  assert.equal(
    r.coverage.coveredBytes,
    SIGNED.length - (PADDING * 2 + 2),
    'firmato tutto il file tranne il buco del /Contents',
  )
})

test('b) dopo tamperDigit: invalid — la firma regge, il documento no', async () => {
  const { bytes, offset } = tamperDigit(SIGNED)
  const r = await verified(bytes, 'cifra manomessa')

  assert.equal(r.verdict, 'invalid')
  assert.equal(r.digest.match, false, 'un byte cambiato dentro la zona coperta deve cambiare l\'impronta')
  assert.notEqual(r.digest.actual, r.digest.expected)
  assert.equal(
    r.signature.ok,
    true,
    'la firma RSA copre gli attributi, che sono intatti: e il confronto delle impronte a smascherare',
  )
  assert.equal(r.coverage.complete, true, 'la struttura non e cambiata: un byte dentro, stessa lunghezza')
  assert.equal(r.coverage.uncoveredTail, 0)

  // L'attacco cade davvero dentro il primo intervallo del /ByteRange: non stiamo simulando.
  const [a, b] = r.coverage.byteRange
  assert.ok(offset >= a && offset < a + b, 'il byte manomesso deve stare dentro la zona firmata')
})

test('c) dopo tamperWords: invalid, e senza lanciare — il file e strutturalmente rotto', async () => {
  const attacco = tamperWords(SIGNED)
  assert.equal(attacco.brokenLength, true, 'il presupposto della prova: /Length non torna piu')
  assert.equal(attacco.brokenXref, true, 'e le voci xref non puntano piu agli oggetti')

  // Il punto della prova e questo: su un file rotto verify() risponde, non esplode.
  const r = await verified(attacco.bytes, 'parole manomesse')

  assert.equal(r.verdict, 'invalid')
  assert.equal(r.digest.match, false)
  assert.equal(r.coverage.complete, false)
  assert.equal(
    r.coverage.uncoveredTail,
    3,
    'il file e cresciuto di tre byte dopo la fine di cio che il /ByteRange dichiara di coprire',
  )
  assert.equal(
    r.coverage.gapMatchesContents,
    false,
    'il buco si e spostato di tre byte: il /ByteRange non lo indica piu',
  )
  assert.equal(r.identity.subjectCN, SUBJECT_CN, 'il certificato resta leggibile anche in un file rotto')
})

test('d) dopo appendIncrementalUpdate: extended, con la coda fuori dalla firma', async () => {
  const { bytes, appendedFrom } = appendIncrementalUpdate(SIGNED)
  const r = await verified(bytes, 'aggiornamento appeso')

  assert.equal(r.verdict, 'extended')
  assert.equal(r.digest.match, true, 'i byte firmati sono ancora tutti li, identici')
  assert.equal(r.signature.ok, true)
  assert.equal(r.coverage.complete, false)
  assert.ok(r.coverage.uncoveredTail > 0)
  assert.equal(
    r.coverage.uncoveredTail,
    bytes.length - appendedFrom,
    'la coda non coperta e esattamente cio che l\'attacco ha appeso',
  )
  assert.equal(r.coverage.fileLength, bytes.length)
  assert.equal(r.coverage.coveredBytes, SIGNED.length - (PADDING * 2 + 2))
})

test('e) un PDF non firmato del tutto: oggetto ben formato che lo dice', async () => {
  const r = await verified(SAMPLE, 'campione non firmato')

  assert.equal(r.verdict, 'invalid')
  assert.equal(r.reason, 'nessuna-firma')
  assert.match(r.error, /nessuna firma/i)
  assert.equal(r.coverage, null, 'senza /ByteRange non c\'e niente da misurare')
  assert.equal(r.digest, null)
  assert.equal(r.signature, null)
  assert.equal(r.identity, null)
})

// ===========================================================================
// I tre controlli, uno per uno
// ===========================================================================

test('1. copertura: i numeri del /ByteRange sono quelli scritti nel file, non quelli di chi ha firmato', async () => {
  const testo = fromAscii(SIGNED)
  const scritto = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\]/.exec(testo)
  assert.ok(scritto, 'il /ByteRange deve essere leggibile a occhio nel file')

  const r = await verified(SIGNED, 'copertura')
  assert.deepEqual(r.coverage.byteRange, scritto.slice(1, 5).map(Number))

  const [a, b, c, d] = r.coverage.byteRange
  assert.equal(a + b, chain.contentsStart, 'il primo intervallo finisce dove comincia il buco')
  assert.equal(c, chain.contentsStart + PADDING * 2 + 2, 'il secondo comincia dopo il buco')
  assert.equal(c + d, SIGNED.length)
})

test('2. integrita: expected e cio che sta dentro la firma, actual e cio che si ricalcola adesso', async () => {
  const r = await verified(SIGNED, 'integrita')
  const [a, b, c, d] = chain.byteRange

  // Controprova con un'altra implementazione di SHA-256 (quella di node).
  const atteso = createHash('sha256')
    .update(Buffer.from(SIGNED.subarray(a, a + b)))
    .update(Buffer.from(SIGNED.subarray(c, c + d)))
    .digest('hex')

  assert.equal(r.digest.actual, atteso, 'actual e lo SHA-256 dei due intervalli, e di nient\'altro')
  assert.equal(r.digest.expected, toHex(chain.messageDigest), 'expected viene dall\'attributo firmato')
  assert.equal(r.digest.expected, atteso)
})

test('2. integrita: la firma non guarda dentro il buco', async () => {
  // Sporcare gli zeri di riempimento del /Contents non tocca nessun byte firmato: il documento
  // resta valido. Non e una svista, e la ragione per cui una firma puo stare dentro cio che firma.
  const sporcato = new Uint8Array(SIGNED)
  const chiusura = indexOf(sporcato, '>', chain.contentsStart)
  sporcato[chiusura - 1] = ascii('a')[0]

  const r = await verified(sporcato, 'buco sporcato')
  assert.equal(r.verdict, 'valid')
  assert.equal(r.digest.match, true)
})

test('3. firma: verifica davvero con la chiave del certificato, e cade se la firma cambia', async () => {
  const r = await verified(SIGNED, 'firma')
  assert.equal(r.signature.ok, true)

  // Si ribalta un carattere dei 256 byte di RSA, li dove stanno davvero dentro il /Contents. Il
  // digest del documento non ne risente (il buco non e coperto), quindi qui a parlare e solo il
  // controllo numero 3.
  const firmaNelCms = indexOf(chain.cmsDer, chain.signature)
  assert.notEqual(firmaNelCms, -1, 'i byte della firma devono comparire dentro il CMS')
  const firmaHexAt = chain.contentsStart + 1 + (firmaNelCms + 10) * 2 // dentro la firma, non al bordo
  const guasto = new Uint8Array(SIGNED)
  guasto[firmaHexAt] = guasto[firmaHexAt] === 0x30 ? 0x31 : 0x30

  const rotto = await verified(guasto, 'firma ribaltata')
  assert.equal(rotto.digest.match, true, 'i byte del documento non sono stati toccati')
  assert.equal(rotto.signature.ok, false, 'ma la firma non corrisponde piu agli attributi firmati')
  assert.equal(rotto.verdict, 'invalid')
})

test('identita: il certificato e autofirmato, e il risultato lo dice invece di nasconderlo', async () => {
  const r = await verified(SIGNED, 'identita')
  assert.equal(r.identity.selfSigned, true)
  assert.equal(r.identity.subjectCN, SUBJECT_CN)
  assert.equal(r.identity.issuerCN, SUBJECT_CN)
  // fingerprint: SHA-256 del DER del certificato, aggiunta dopo l'attacco dell'esca. Il Common
  // Name non identifica nessuno — nell'attacco e identico — quindi e l'impronta che va guardata.
  assert.match(r.identity.fingerprint, /^[0-9a-f]{64}$/)
  assert.equal(
    r.verdict,
    'valid',
    'verdetto valid vuol dire «matematica corretta»: l\'identita non garantita sta in identity',
  )
})

// ===========================================================================
// Estrazione: cio che la pagina mostra viene dal file, non da una copia tenuta da parte
// ===========================================================================

test('extractSignature ritira dal PDF esattamente i byte che ci erano stati scritti', () => {
  const estratto = extractSignature(SIGNED)

  assert.ok(equals(estratto.cmsDer, chain.cmsDer), 'il CMS estratto deve essere identico a quello iniettato')
  assert.ok(equals(estratto.certDer, chain.certDer), 'il certificato estratto deve essere quello costruito')
  assert.ok(equals(estratto.signature, chain.signature), 'i byte della firma RSA')
  assert.ok(equals(estratto.messageDigest, chain.messageDigest), 'l\'impronta dichiarata')
  assert.ok(
    equals(estratto.signedAttrsDer, chain.signedAttrsDer),
    'gli attributi firmati vanno riletti con il tag SET (0x31), non con il tag implicito [0] (0xa0)',
  )
  assert.equal(estratto.signedAttrsDer[0], 0x31)
  assert.deepEqual(estratto.byteRange, chain.byteRange)
  assert.equal(estratto.contentsStart, chain.contentsStart)
})

test('extractSignature lancia dove verify() invece risponde: sono due mestieri diversi', () => {
  assert.throws(() => extractSignature(SAMPLE), /nessuna firma/i)
})

// ===========================================================================
// Robustezza: verify() non lancia mai
// ===========================================================================

/** L'elenco chiuso documentato in cima a verify.js: la pagina ci si appoggia per scegliere i testi. */
const REASONS = new Set([
  'input-non-valido',
  'nessuna-firma',
  'byterange-illeggibile',
  'contents-illeggibile',
  'firma-non-riempita',
  'cms-illeggibile',
  'certificato-assente',
  'certificato-illeggibile',
  'algoritmo-non-supportato',
  'copertura-fuori-dal-file',
  'firma-non-verificabile',
  'errore-interno',
])

test('ogni reason restituito appartiene all elenco chiuso, e nessuno e "errore-interno"', async () => {
  const casi = [
    SAMPLE,
    chain.pdfWithHole,
    new Uint8Array(0),
    new Uint8Array(randomBytes(2048)),
    ascii('%PDF-1.7\n/ByteRange [ciao]\n%%EOF\n'),
    ascii('%PDF-1.7\n1 0 obj\n<< /ByteRange [0 1 2 3] >>\nendobj\n'),
    tamperWords(SIGNED).bytes,
    null,
  ]
  for (const caso of casi) {
    const r = await verified(caso, 'reason')
    if (r.reason === null) continue
    assert.ok(REASONS.has(r.reason), `reason "${r.reason}" non e nell elenco documentato`)
    assert.notEqual(
      r.reason,
      'errore-interno',
      'un intoppo previsto non deve finire nel cestino delle eccezioni impreviste',
    )
  }
})

test('input che non sono byte: risposta, non eccezione', async () => {
  for (const roba of [null, undefined, 42, 'un PDF', {}, [], true]) {
    const r = await verified(roba, `input ${String(roba)}`)
    assert.equal(r.verdict, 'invalid')
    assert.equal(r.reason, 'input-non-valido')
  }
})

test('byte che non sono un PDF: risposta, non eccezione', async () => {
  const casi = [
    ['vuoto', new Uint8Array(0)],
    ['zeri', new Uint8Array(4096)],
    ['casuali', new Uint8Array(randomBytes(4096))],
    ['solo intestazione', ascii('%PDF-1.7\n%%EOF\n')],
    ['/ByteRange senza numeri', ascii('%PDF-1.7\n/ByteRange [ciao]\n%%EOF\n')],
    ['/ByteRange senza /Contents', ascii('%PDF-1.7\n1 0 obj\n<< /ByteRange [0 1 2 3] >>\nendobj\n')],
  ]
  for (const [nome, byte] of casi) {
    const r = await verified(byte, nome)
    assert.equal(r.verdict, 'invalid', nome)
    assert.notEqual(r.error, null, `${nome}: deve spiegare cosa non ha potuto leggere`)
  }
})

test('un PDF firmato troncato in un punto qualsiasi: sempre una risposta', async () => {
  // Il taglio cade a turno in ogni zona del file: intestazione, contenuto, buco della firma,
  // xref, coda. Nessuno di questi punti deve produrre un'eccezione.
  for (let taglio = 0; taglio <= SIGNED.length; taglio += 97) {
    const r = await verified(SIGNED.subarray(0, taglio), `troncato a ${taglio}`)
    assert.notEqual(r.verdict, 'valid', `un file troncato a ${taglio} non puo essere valido`)
  }
})

test('un byte a caso ribaltato ovunque nel file: sempre una risposta, mai valid per caso', async () => {
  for (let i = 0; i < SIGNED.length; i += 211) {
    const guasto = new Uint8Array(SIGNED)
    guasto[i] = guasto[i] ^ 0xff
    const r = await verified(guasto, `byte ${i} ribaltato`)
    // L'unica zona in cui un byte puo cambiare senza conseguenze e il riempimento del /Contents,
    // che per costruzione non e firmato.
    const dentroIlBuco = i > chain.contentsStart && i < indexOf(SIGNED, '>', chain.contentsStart)
    if (!dentroIlBuco) {
      assert.notEqual(r.verdict, 'valid', `il byte ${i} e coperto dalla firma: non puo cambiare impunemente`)
    }
  }
})

test('il segnaposto non ancora firmato: lo dice, invece di verificare zeri', async () => {
  const r = await verified(chain.pdfWithHole, 'segnaposto')
  assert.equal(r.verdict, 'invalid')
  assert.equal(r.reason, 'firma-non-riempita')
  assert.match(r.error, /non e stato firmato/)
  assert.notEqual(r.coverage, null, 'la copertura si sa gia leggere: e il contenuto che manca')
  assert.equal(r.coverage.complete, true)
})

test('il /Contents pieno di spazzatura: nessuna eccezione, un messaggio che dice cosa', async () => {
  const spazzatura = new Uint8Array(SIGNED)
  spazzatura.set(ascii('zz'), chain.contentsStart + 1)
  const r = await verified(spazzatura, 'contents non esadecimale')
  assert.equal(r.verdict, 'invalid')
  assert.equal(r.reason, 'contents-illeggibile')
  assert.notEqual(r.coverage, null, 'la copertura si misura sui numeri del /ByteRange, non sul buco')

  const cmsRotto = new Uint8Array(SIGNED)
  cmsRotto.set(ascii('ff'), chain.contentsStart + 1) // il DER non comincia piu con 0x30
  const r2 = await verified(cmsRotto, 'cms illeggibile')
  assert.equal(r2.verdict, 'invalid')
  assert.equal(r2.reason, 'cms-illeggibile')
  assert.notEqual(r2.coverage, null, 'la copertura era gia stata misurata prima di aprire il CMS')
})

test('verify() non tocca i byte che riceve', async () => {
  const copia = new Uint8Array(SIGNED)
  await verify(SIGNED)
  assert.deepEqual(SIGNED, copia)
})

// ===========================================================================
// I due attacchi in fila, come li vedra l'aula
// ===========================================================================

test('la sequenza della demo produce i tre verdetti nell\'ordine giusto', async () => {
  const passi = [
    ['firmato', SIGNED, 'valid'],
    ['attacco 1a', tamperDigit(SIGNED).bytes, 'invalid'],
    ['attacco 1b', tamperWords(SIGNED).bytes, 'invalid'],
    ['attacco 2', appendIncrementalUpdate(SIGNED).bytes, 'extended'],
  ]
  for (const [nome, byte, atteso] of passi) {
    const r = await verified(byte, nome)
    assert.equal(r.verdict, atteso, `${nome}: verdetto atteso ${atteso}, ottenuto ${r.verdict}`)
  }
})

test('l\'attacco 2 due volte di fila resta extended, e la coda cresce', async () => {
  // Il testo del primo aggiornamento resta nella forma «cifre euro (parola euro)» apposta: e la
  // sola che l'attacco sappia riconoscere quando gli si ridà in pasto il proprio risultato.
  const uno = appendIncrementalUpdate(SIGNED, { newText: '2.000 euro (duemila euro)' }).bytes
  const due = appendIncrementalUpdate(uno, { newText: '9.000 euro (novemila euro)' }).bytes

  const r1 = await verified(uno, 'un aggiornamento')
  const r2 = await verified(due, 'due aggiornamenti')
  assert.equal(r1.verdict, 'extended')
  assert.equal(r2.verdict, 'extended')
  assert.ok(r2.coverage.uncoveredTail > r1.coverage.uncoveredTail)
  assert.equal(r2.digest.match, true, 'i byte firmati non sono stati toccati nemmeno la seconda volta')
})

test('attacco 1a piu attacco 2 insieme: resta invalid, non torna extended', async () => {
  // L'ordine dei controlli conta: «esteso dopo la firma» e un'attenuante che spetta solo a chi
  // la firma ce l'ha valida. Chi ha cambiato il documento non se la merita.
  const misto = appendIncrementalUpdate(tamperDigit(SIGNED).bytes).bytes
  const r = await verified(misto, 'manomesso e poi esteso')
  assert.equal(r.verdict, 'invalid')
  assert.equal(r.digest.match, false)
  assert.ok(r.coverage.uncoveredTail > 0)
})

/**
 * Riscrive il /ByteRange di un PDF **senza spostare un byte**: se i numeri nuovi sono piu lunghi,
 * si recupera il carattere togliendo lo spazio dopo la parola chiave (un PDF accetta `[` attaccata);
 * se sono piu corti, si riempie con zeri iniziali, che in un intero PDF sono legali e innocui.
 *
 * Serve a simulare un attaccante *competente*: uno che non si limita ad appendere, ma aggiusta
 * anche la dichiarazione di copertura per farla tornare.
 */
function riscriviByteRange(bytes, nuovo) {
  const testo = fromAscii(bytes)
  const at = testo.indexOf('/ByteRange')
  const larghezza = testo.indexOf(']', at) + 1 - at
  for (const prefisso of ['/ByteRange [', '/ByteRange[']) {
    const minimo = `${prefisso}${nuovo.join(' ')}]`
    if (minimo.length > larghezza) continue
    const ultimo = '0'.repeat(larghezza - minimo.length) + String(nuovo[3])
    const finale = `${prefisso}${nuovo[0]} ${nuovo[1]} ${nuovo[2]} ${ultimo}]`
    assert.equal(finale.length, larghezza, 'la riscrittura deve avere la stessa lunghezza')
    const out = new Uint8Array(bytes)
    out.set(ascii(finale), at)
    assert.equal(out.length, bytes.length)
    return out
  }
  return assert.fail('il /ByteRange riscritto non ci sta nello spazio del vecchio')
}

test('il /ByteRange e esso stesso firmato: ritoccarne una cifra si vede subito', async () => {
  const testo = fromAscii(SIGNED)
  const at = testo.indexOf('/ByteRange')
  const cifra = testo.indexOf('9', at) // una cifra qualunque dentro l'array
  const ritoccato = new Uint8Array(SIGNED)
  ritoccato[cifra] = ascii('8')[0]

  const r = await verified(ritoccato, '/ByteRange ritoccato')
  assert.equal(r.verdict, 'invalid')
  assert.equal(
    r.digest.match,
    false,
    'il /ByteRange sta dentro il primo intervallo che dichiara: dichiarare il falso e manomettere',
  )
})

test('un attaccante che aggiusta anche il /ByteRange supera la copertura e cade sull impronta', async () => {
  // La domanda avversariale del collaudo: si puo costruire un incremental update che SFUGGA al
  // controllo di copertura? Si — basta riscrivere il /ByteRange perche il secondo intervallo
  // arrivi fino alla nuova fine del file. E infatti qui `coverage.complete` torna vero.
  // Il verdetto resta `invalid` lo stesso, e per una ragione che non si puo aggirare: quei numeri
  // stanno dentro i byte che l'impronta copre, quindi riscriverli cambia l'impronta.
  const esteso = appendIncrementalUpdate(SIGNED).bytes
  const [a, b, c] = chain.byteRange
  const furbo = riscriviByteRange(esteso, [a, b, c, esteso.length - c])

  const r = await verified(furbo, 'copertura rattoppata')
  assert.equal(r.coverage.complete, true, 'la copertura dichiarata torna: l attaccante ha fatto i conti')
  assert.equal(r.coverage.uncoveredTail, 0)
  assert.equal(r.signature.ok, true, 'la firma RSA sugli attributi e ancora quella')
  assert.equal(r.digest.match, false, 'ma i byte coperti non sono piu quelli firmati')
  assert.equal(r.verdict, 'invalid')
})

test('un /ByteRange che dichiara di coprire oltre la fine del file non fa esplodere niente', async () => {
  const testo = fromAscii(SIGNED)
  const at = testo.indexOf('/ByteRange [')
  const fine = testo.indexOf(']', at)
  const originale = testo.slice(at, fine + 1)
  // Stessa lunghezza in caratteri, cosi il resto del file non si sposta: l'ultimo numero diventa
  // enorme e il secondo intervallo finisce fuori dal file.
  const gonfiato = originale.replace(/(\d+)\]$/, (_, n) => '9'.repeat(n.length) + ']')
  assert.equal(gonfiato.length, originale.length)

  const bugiardo = new Uint8Array(SIGNED)
  bugiardo.set(ascii(gonfiato), at)

  const r = await verified(bugiardo, '/ByteRange gonfiato')
  assert.equal(r.verdict, 'invalid')
  assert.equal(r.digest.actual, null, 'l\'impronta non si e potuta calcolare')
  assert.equal(r.digest.match, false)
  assert.equal(r.reason, 'copertura-fuori-dal-file')
  assert.notEqual(r.coverage, null)
})

// ===========================================================================
// Il controllo che vale piu di tutti: un terzo e d'accordo?
//
// Fin qui a verificare e stato il mio codice, e un codice che si da ragione da solo non prova
// niente. Qui i byte estratti dal PDF — il CMS preso dal /Contents e i byte coperti dal
// /ByteRange, calcolati da questo modulo — passano a openssl, che la firma non l'ha vista nascere
// e non sa niente di questa demo. Se openssl e verify() dessero risposte diverse, uno dei due
// starebbe mentendo.
// ===========================================================================

const openssl = (args) => {
  const r = spawnSync('openssl', args, { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}
const OPENSSL = openssl(['version']).status === 0
const dir = mkdtempSync(join(tmpdir(), 'firma-verify-'))
const CERT_PEM = join(dir, 'cert.pem')
if (OPENSSL) {
  const der = join(dir, 'cert.der')
  writeFileSync(der, chain.certDer)
  writeFileSync(CERT_PEM, openssl(['x509', '-inform', 'DER', '-in', der, '-outform', 'PEM']).stdout)
}

/**
 * Il parere di openssl sui byte che questo modulo estrae dal PDF.
 *
 * `-binary` non e un dettaglio: senza, openssl tratta il contenuto come testo e converte i fine
 * riga prima di calcolarne l'impronta. `-noverify` salta la catena di fiducia, che per un
 * autofirmato non porta da nessuna parte: qui si verifica la firma, non l'identita.
 */
function opensslAccetta(pdfBytes, nome) {
  const { byteRange, cmsDer } = extractSignature(pdfBytes)
  const [a, b, c, d] = byteRange
  const coperti = concat(pdfBytes.subarray(a, a + b), pdfBytes.subarray(c, c + d))
  const fileCms = join(dir, `${nome}.p7s`)
  const fileCoperti = join(dir, `${nome}.bin`)
  writeFileSync(fileCms, cmsDer)
  writeFileSync(fileCoperti, coperti)
  const r = openssl([
    'cms', '-verify', '-binary', '-inform', 'DER', '-in', fileCms,
    '-content', fileCoperti, '-certfile', CERT_PEM, '-noverify', '-out', '/dev/null',
  ])
  return r.status === 0
}

test('openssl conferma la firma estratta dal PDF firmato', { skip: !OPENSSL && 'openssl assente' }, () => {
  assert.equal(opensslAccetta(SIGNED, 'firmato'), true)
})

test('openssl e verify() danno la stessa risposta in ogni stato del documento', { skip: !OPENSSL && 'openssl assente' }, async () => {
  const stati = [
    ['firmato', SIGNED],
    ['attacco-1a', tamperDigit(SIGNED).bytes],
    ['attacco-1b', tamperWords(SIGNED).bytes],
    ['attacco-2', appendIncrementalUpdate(SIGNED).bytes],
  ]
  for (const [nome, byte] of stati) {
    const r = await verified(byte, nome)
    // openssl controlla impronta e firma: e esattamente il secondo e il terzo dei tre controlli.
    assert.equal(
      opensslAccetta(byte, nome),
      r.digest.match && r.signature.ok,
      `${nome}: openssl e verify() non sono d'accordo su impronta e firma`,
    )
  }
})

test('sulla copertura openssl non ha niente da dire: e per questo che il terzo stato serve', { skip: !OPENSSL && 'openssl assente' }, async () => {
  // L'attacco 2 e il caso in cui un verificatore di CMS, da solo, non basta: openssl dice
  // «firma valida» e ha ragione, perche i byte firmati sono intatti. Ma il documento che si vede
  // a schermo non e piu quello firmato, e questo lo sa solo chi confronta il /ByteRange con la
  // lunghezza del file.
  const esteso = appendIncrementalUpdate(SIGNED).bytes
  assert.equal(opensslAccetta(esteso, 'esteso'), true, 'openssl accetta: la firma e valida davvero')
  const r = await verified(esteso, 'esteso')
  assert.equal(r.verdict, 'extended', 'ma il documento e stato esteso dopo la firma, e va detto')
})

test('un secondo startxref non confonde la ricerca della firma', async () => {
  // Dopo l'attacco 2 il file ha due xref, due trailer e tre %%EOF: la firma da verificare resta
  // l'unica che c'e, e va trovata comunque.
  const { bytes } = appendIncrementalUpdate(SIGNED)
  assert.ok(lastIndexOf(bytes, 'startxref') > lastIndexOf(SIGNED, 'startxref'))
  const estratto = extractSignature(bytes)
  assert.ok(equals(estratto.cmsDer, chain.cmsDer))
})
