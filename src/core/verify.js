/**
 * verify.js — la verifica, con il verdetto a tre stati.
 *
 * Ultimo anello, e l'unico che non costruisce niente: riceve i byte di un PDF e prova a
 * smentirlo. Non si fida di come e stato prodotto — rilegge il /ByteRange scritto nel file,
 * riestrae il CMS dal /Contents, ricalcola l'impronta adesso, e verifica la firma con la chiave
 * pubblica che trova dentro il certificato del CMS. Niente arriva da fuori: chi chiama passa
 * solo i byte, esattamente come farebbe un verificatore che non ha visto la firma nascere.
 *
 * I TRE CONTROLLI, in quest'ordine.
 *
 *   1. COPERTURA   Gli intervalli del /ByteRange piu il buco del /Contents coprono l'intero file?
 *                  Byte oltre la fine del secondo intervallo -> `uncoveredTail > 0`. E anche:
 *                  il buco dichiarato dal /ByteRange e davvero il buco del /Contents, e non una
 *                  finestra piu larga in cui nascondere byte non firmati.
 *   2. INTEGRITA   SHA-256 ricalcolato sui due intervalli, confrontato con l'attributo firmato
 *                  `messageDigest` estratto dal CMS. `expected` e quello scritto dentro la firma,
 *                  `actual` e quello dei byte che si hanno in mano adesso.
 *   3. FIRMA       `crypto.subtle.verify` sul DER degli attributi firmati, con la chiave pubblica
 *                  presa dal certificato che viaggia dentro il CMS.
 *
 * IL VERDETTO.
 *
 *   valid      copertura totale, digest coincide, firma verifica
 *   extended   digest e firma a posto, copertura incompleta  (l'attacco 2: coda appesa dopo la firma)
 *   invalid    digest o firma non tornano                    (l'attacco 1: il documento e cambiato)
 *
 * PIU FIRME IN UN FILE, e perche cambia tutto.
 *
 * Un PDF puo contenere piu di una firma: ogni incremental update puo aggiungerne una. Cercare
 * «la» firma con `lastIndexOf('/ByteRange')` — cioe fidandosi dell'ultima cosa che nel file
 * somiglia a una firma — era il buco che il collaudo avversariale ha aperto. L'esca: si parte dal
 * PDF gia manomesso con l'attacco 2 e gli si appende un SECONDO dizionario di firma, con le chiavi
 * dell'attaccante e un certificato autofirmato che dichiara lo STESSO Common Name. Quella firma
 * copre tutto il file nuovo ed e matematicamente ineccepibile: il verdetto diventava `valid` su un
 * documento che `pdftotext` legge come «1.000.000 euro». Non serviva la chiave di Lorenzo: serviva
 * solo un verificatore che guardasse l'ULTIMA firma invece di tutte, e che non dicesse di CHI e.
 *
 * COME SI TROVANO LE FIRME, adesso. Si percorre la struttura del file, non si cercano stringhe:
 *
 *   1. si individuano le definizioni di oggetto, `N G obj` … `endobj`;
 *   2. di ciascuna si prende il dizionario di primo livello, contando le parentesi `<<` e `>>`
 *      annidate (`dictEndAt` di pades.js): cosi il corpo di uno stream resta fuori dal dizionario;
 *   3. e un dizionario di firma quello che DENTRO quel dizionario dichiara un `/ByteRange`. I suoi
 *      quattro numeri e il suo `/Contents` si leggono li, nello stesso dizionario, non altrove.
 *
 * Ogni firma trovata viene valutata con i SUOI intervalli e finisce in `signatures`, nell'ordine
 * in cui compare nel file. La firma PRIMARIA e la prima: e l'unica che puo aver firmato il
 * documento originale, perche tutte le altre sono state per forza appese dopo. I campi storici —
 * `coverage`, `digest`, `signature`, `identity` — parlano di lei, e nessuno cambia forma.
 *
 * IL VERDETTO COMPLESSIVO E IL PEGGIORE fra le firme, non il piu comodo: `invalid` batte
 * `extended`, `extended` batte `valid`. Nell'esca la firma dell'attaccante e `valid` davvero, ma
 * la primaria dice `extended` — il documento e stato esteso dopo che Lorenzo l'ha firmato — e
 * vince quella. A parita di gravita decide la prima, cioe la primaria.
 *
 * L'IMPRONTA DEL CERTIFICATO. `identity.fingerprint` e lo SHA-256 del DER del certificato, lo
 * stesso numero che stampa `openssl x509 -fingerprint -sha256`. Serve perche nell'esca il Common
 * Name delle due firme e IDENTICO: il nome non identifica nessuno, l'impronta si.
 *
 * LIMITI ONESTI di questa strategia, dichiarati perche si vedano:
 *
 *   - si contano le DEFINIZIONI di oggetto, non gli oggetti «vivi» secondo la xref. Se un
 *     aggiornamento ridefinisce l'oggetto della firma, qui compaiono entrambe le definizioni. E
 *     voluto: una firma che c'era e che qualcuno ha soprascritto e una prova, non spazzatura;
 *   - non si segue la xref e non si legge l'`/AcroForm`. Un dizionario di firma appeso e mai
 *     registrato fra i `/Fields` — esattamente cio che fa l'esca — per poppler non esiste, per noi
 *     si. La divergenza e voluta e va nella direzione prudente: cio che nel file dichiara di essere
 *     una firma viene guardato e raccontato;
 *   - la scansione delle definizioni di oggetto e lessicale: una sequenza `N 0 obj … /ByteRange …`
 *     nascosta dentro uno stream binario diventerebbe una firma fantasma. Puo solo rendere il
 *     verdetto piu severo, mai piu indulgente — una firma in piu che non verifica peggiora il
 *     peggiore — quindi si fallisce chiuso, che e il verso giusto in cui sbagliare;
 *   - non si distingue un'estensione legittima (una seconda firma di un secondo firmatario) da una
 *     manomissione: entrambe rendono la prima firma `extended`. Un validatore vero guarderebbe
 *     `/DocMDP`; questa demo dice cosa e cambiato e lascia il giudizio a chi guarda.
 *
 * COSA DICONO GLI STRUMENTI TERZI (collaudo dell'11 agosto 2026, poppler/pdfsig 26.07):
 *
 *   - `manomesso-coda.pdf`, una coda appesa che contiene la parola `/ByteRange` dentro un commento:
 *     pdfsig dice «Signature is Valid» + «Not total document signed». Prima dicevamo `invalid` con
 *     motivo `byterange-illeggibile`, perche la ricerca per stringa cadeva nel commento. Adesso
 *     diciamo `extended`, d'accordo con pdfsig e per la ragione giusta: un commento fuori da ogni
 *     oggetto non e un dizionario di firma. Fallire chiuso era difendibile, ma diceva la cosa
 *     sbagliata — «non riesco a leggere il /ByteRange» invece di «il file e cresciuto dopo la firma»;
 *   - `attacco2-con-esca.pdf`, dove il testo dell'importo contiene `/ByteRange [0 0 0 0]` dentro il
 *     content stream: stessa storia, da `invalid` a `extended`, d'accordo con pdfsig;
 *   - `manomesso-contents.pdf`: pdfsig dice «Unknown Validation Failure», noi `invalid` con motivo
 *     `cms-illeggibile`. Siamo d'accordo, e in piu diciamo cosa non si e potuto leggere;
 *   - `esca.pdf`: pdfsig vede una firma sola, quella registrata nell'`/AcroForm`, e dice «Not total
 *     document signed»; noi ne vediamo due e diciamo `extended`, con le due impronte diverse a
 *     schermo. Nessuno dei due dice `valid`, ed e il punto.
 *
 * IDENTITA. Il certificato e autofirmato: nessuno lo ha controllato. Il dato viene restituito,
 * non nascosto — `identity.selfSigned` e calcolato confrontando emittente e soggetto, non
 * dichiarato a priori. Verdetto `valid` vuol dire «la matematica torna», non «l'identita e
 * verificata»: e la distinzione che il pannello certificato mostra all'utente, e questo modulo
 * gliene fornisce il materiale invece di appiattirla.
 *
 * ROBUSTEZZA. verify() non lancia mai. Riceve anche PDF strutturalmente rotti — l'attacco 1b
 * produce un file con /Length incoerente e xref disallineata, e un file troncato a meta e
 * altrettanto legittimo come input. In quei casi restituisce comunque un oggetto della stessa
 * forma, con verdetto `invalid`, i campi che non ha potuto calcolare messi a `null`, e `error`
 * con una frase che dice cosa non e stato possibile leggere. Un'eccezione non gestita qui
 * significherebbe una pagina bianca durante la presentazione.
 *
 * LA FORMA DEL RISULTATO. Oltre ai cinque campi del contratto ce ne sono quattro, sempre presenti:
 *   `signatures`         una voce per OGNI dizionario di firma trovato, in ordine di file:
 *                        `{ index, byteRange, contentsStart, coverage, digest, signature, identity }`
 *                        piu `verdict`, `reason` ed `error` della singola firma — esposti perche
 *                        chi mostra due firme affiancate non debba ricalcolarne il giudizio.
 *   `multipleSignatures` vero quando `signatures` ne contiene piu di una.
 *   `reason`  codice breve e stabile del perche la verifica non e arrivata in fondo (`null` se
 *             il verdetto viene dai tre controlli e non da un intoppo). Serve alla pagina per
 *             scegliere il testo giusto senza dover riconoscere una frase in italiano.
 *   `error`   la frase in italiano corrispondente, `null` se non c'e stato nessun intoppo.
 *
 * I `reason` possibili, elenco chiuso — la pagina puo appoggiarcisi:
 *   `input-non-valido`         non sono stati passati byte
 *   `nessuna-firma`            nessun dizionario di firma nel file: il PDF non e firmato
 *   `byterange-illeggibile`    c'e un dizionario con /ByteRange, ma non nella forma [a b c d]
 *   `contents-illeggibile`     il /Contents manca, o non e una stringa esadecimale
 *   `firma-non-riempita`       c'e il segnaposto ma e ancora tutto a zero: non e stato firmato
 *   `cms-illeggibile`          il contenuto del buco non e un CMS SignedData leggibile
 *   `certificato-assente`      il CMS non porta con se il certificato del firmatario
 *   `certificato-illeggibile`  il certificato c'e ma e malformato
 *   `algoritmo-non-supportato` la firma non e RSA PKCS#1 v1.5 con SHA-256
 *   `copertura-fuori-dal-file` il /ByteRange dichiara byte che nel file non ci sono
 *   `firma-non-verificabile`   la chiave pubblica non si e potuta usare per verificare
 *   `errore-interno`           tutto il resto: non deve capitare, e se capita si vede
 * E dentro `coverage` ci sono due booleani in piu, `complete` e `gapMatchesContents`: il primo e
 * il predicato che decide fra `valid` ed `extended`, esposto perche la pagina non debba
 * reimplementarlo; il secondo dice se il buco dichiarato coincide con quello vero.
 *
 * Ambiente: browser. Nessun import di node, nessun Buffer; solo `globalThis.crypto` e asn1js,
 * che e una libreria pura e restituisce gia l'albero parsato.
 */

import * as asn1js from 'asn1js'
import { equals, fromAscii, fromHex, indexOf, sha256, toHex } from './bytes.js'
import { CERT_OIDS } from './certificate.js'
import { CMS_OIDS } from './cms.js'
import { dictEndAt, digestCovered } from './pades.js'

const LT = 0x3c // '<'

/**
 * Gravita dei tre verdetti. Il verdetto complessivo di un file con piu firme e il massimo di
 * questa scala: una firma che non torna non si compensa con una che torna.
 */
const SEVERITY = { valid: 0, extended: 1, invalid: 2 }

/**
 * Una definizione di oggetto PDF: `N G obj`. Il lookbehind evita di agganciare la coda di un
 * numero piu lungo, e il lookahead che `obj` sia una parola intera e non l'inizio di un'altra.
 */
const OBJECT_HEADER = /(?<![0-9])(\d+)[\0\t\n\f\r ]+(\d+)[\0\t\n\f\r ]+obj(?![A-Za-z0-9])/g

/* ------------------------------------------------------------------------------------- */
/* La verifica                                                                             */
/* ------------------------------------------------------------------------------------- */

/**
 * Verifica le firme PAdES di un PDF.
 *
 * I cinque campi storici parlano della firma PRIMARIA — la prima del file, l'unica che possa aver
 * firmato il documento originale — tranne `verdict`, che e il PEGGIORE fra i verdetti di tutte le
 * firme trovate. `signatures` le contiene tutte, in ordine di file.
 *
 * @param {Uint8Array} pdfBytes  i byte del documento, cosi come stanno su disco
 * @returns {Promise<{
 *   verdict: 'valid' | 'extended' | 'invalid',
 *   coverage: null | { byteRange: number[], fileLength: number, coveredBytes: number,
 *                      uncoveredTail: number, complete: boolean, gapMatchesContents: boolean },
 *   digest: null | { expected: string, actual: string | null, match: boolean },
 *   signature: null | { ok: boolean },
 *   identity: null | { selfSigned: boolean, subjectCN: string | null, issuerCN: string | null,
 *                      fingerprint: string },
 *   reason: string | null,
 *   error: string | null,
 *   signatures: Array<{ index: number, byteRange: number[] | null, contentsStart: number | null,
 *                       coverage: object | null, digest: object | null, signature: object | null,
 *                       identity: object | null, verdict: string, reason: string | null,
 *                       error: string | null }>,
 *   multipleSignatures: boolean,
 * }>} sempre un oggetto, mai un'eccezione.
 */
export async function verify(pdfBytes) {
  const result = {
    verdict: 'invalid',
    coverage: null,
    digest: null,
    signature: null,
    identity: null,
    reason: null,
    error: null,
    signatures: [],
    multipleSignatures: false,
  }

  let bytes
  try {
    bytes = asBytes(pdfBytes)
  } catch (problem) {
    return stopHere(result, problem)
  }

  try {
    const fields = findSignatureFields(bytes)
    if (fields.length === 0) throw noSignature()

    // Ogni firma con i SUOI intervalli: nessuna eredita il giudizio di un'altra.
    for (let index = 0; index < fields.length; index++) {
      result.signatures.push(await evaluateField(bytes, fields[index], index))
    }
    result.multipleSignatures = result.signatures.length > 1

    // I campi storici sono quelli della primaria: chi si appoggia gia a `coverage`, `digest`,
    // `signature` e `identity` continua a leggere la firma che ha firmato il documento.
    const primary = result.signatures[0]
    result.coverage = primary.coverage
    result.digest = primary.digest
    result.signature = primary.signature
    result.identity = primary.identity

    // Il verdetto invece e il peggiore, e a spiegarlo e la firma che lo ha deciso.
    const deciding = worstOf(result.signatures)
    result.verdict = deciding.verdict
    result.reason = deciding.reason
    result.error =
      deciding.error === null || deciding === primary
        ? deciding.error
        : `Firma numero ${deciding.index + 1} di ${result.signatures.length}: ${deciding.error}`
    return result
  } catch (problem) {
    return stopHere(result, problem)
  }
}

/**
 * Il giudizio su una singola firma: gli stessi tre controlli di sempre, applicati agli intervalli
 * che quella firma dichiara. Non lancia: un intoppo diventa `reason` ed `error` della sua voce, e
 * le altre firme continuano a essere valutate.
 */
async function evaluateField(bytes, field, index) {
  const entry = {
    index,
    byteRange: field.byteRange,
    contentsStart: field.contentsStart,
    coverage: null,
    digest: null,
    signature: null,
    identity: null,
    verdict: 'invalid',
    reason: null,
    error: null,
  }

  try {
    // Un dizionario che dichiara una firma ma non dice in modo leggibile dove sta: si e comunque
    // trovato qualcosa che pretende di essere una firma, e va contato invece che ignorato.
    if (field.problem) throw field.problem

    // --- 1. Copertura -------------------------------------------------------------------
    // Si legge il /ByteRange dal file, non lo si assume: e cio che il documento dichiara di
    // aver firmato, ed e la prima cosa che un attacco potrebbe voler far mentire.
    entry.coverage = coverageOf(bytes, field)

    // Il CMS esce dal buco del /Contents. Da qui in avanti non si guarda piu il PDF — e se il
    // contenuto del buco e illeggibile, la copertura resta comunque misurata e restituita.
    const cms = readCms(hexContents(bytes, field))
    entry.identity = {
      selfSigned: cms.selfSigned,
      subjectCN: cms.subjectCN,
      issuerCN: cms.issuerCN,
      // Il nome non identifica nessuno: nell'esca e identico. L'impronta del certificato si.
      fingerprint: toHex(await sha256(cms.certDer)),
    }

    // --- 2. Integrita -------------------------------------------------------------------
    const expected = toHex(cms.messageDigest)
    let actual = null
    try {
      actual = toHex(await digestCovered(bytes, field.byteRange))
    } catch (problem) {
      note(
        entry,
        'copertura-fuori-dal-file',
        "Non e stato possibile ricalcolare l'impronta sui byte dichiarati dal /ByteRange: " +
          messageOf(problem),
      )
    }
    entry.digest = { expected, actual, match: actual !== null && actual === expected }

    // --- 3. Firma -----------------------------------------------------------------------
    let ok = false
    try {
      ok = await checkSignature(cms)
    } catch (problem) {
      note(
        entry,
        'firma-non-verificabile',
        'Non e stato possibile verificare la firma con la chiave pubblica del certificato: ' +
          messageOf(problem),
      )
    }
    entry.signature = { ok }

    entry.verdict = verdictOf(entry)
  } catch (problem) {
    entry.verdict = 'invalid'
    note(
      entry,
      problem?.reason ?? 'errore-interno',
      problem?.reason
        ? problem.message
        : 'La verifica di questa firma si e interrotta per un errore imprevisto: ' +
            messageOf(problem),
    )
  }
  return entry
}

/** La firma che decide il verdetto: la piu grave, e a parita di gravita la prima del file. */
function worstOf(signatures) {
  let worst = signatures[0]
  for (const candidate of signatures) {
    if (SEVERITY[candidate.verdict] > SEVERITY[worst.verdict]) worst = candidate
  }
  return worst
}

/**
 * Estrae dal PDF cio che la firma contiene, senza giudicare niente.
 *
 * Serve ai pannelli della pagina — la vista ASN.1 vuole il DER vero, quello estratto dal file, non
 * una copia tenuta da parte. A differenza di `verify()` questa funzione **lancia** se il PDF non e
 * firmato o se la firma e illeggibile: chi la chiama sa gia che il documento e firmato, perche
 * `verify()` glielo ha detto.
 *
 * `index` sceglie quale firma estrarre e segue l'ordine di `verify().signatures`: `0` e la
 * primaria, ed e il default perche e la firma di cui la demo racconta la storia. Nell'esca `1` e
 * quella dell'attaccante, e serve a mostrare i due certificati affiancati.
 *
 * @param {Uint8Array} pdfBytes
 * @param {number} [index]
 * @returns {{ byteRange: number[], contentsStart: number, contentsEnd: number,
 *             cmsDer: Uint8Array, certDer: Uint8Array, signedAttrsDer: Uint8Array,
 *             signature: Uint8Array, messageDigest: Uint8Array }}
 */
export function extractSignature(pdfBytes, index = 0) {
  const bytes = asBytes(pdfBytes)
  const fields = findSignatureFields(bytes)
  if (fields.length === 0) throw noSignature()
  const field = fields[index]
  if (!field) {
    throw fail(
      'nessuna-firma',
      `Questo PDF contiene ${fields.length} firme: la firma numero ${index + 1} non esiste.`,
    )
  }
  if (field.problem) throw field.problem
  const cms = readCms(hexContents(bytes, field))
  return {
    byteRange: field.byteRange,
    contentsStart: field.contentsStart,
    contentsEnd: field.contentsEnd,
    cmsDer: cms.cmsDer,
    certDer: cms.certDer,
    signedAttrsDer: cms.signedAttrsDer,
    signature: cms.signature,
    messageDigest: cms.messageDigest,
  }
}

/* ------------------------------------------------------------------------------------- */
/* 1. Dove le firme dicono di essere                                                       */
/* ------------------------------------------------------------------------------------- */

/**
 * Tutti i dizionari di firma del file, in ordine di offset crescente.
 *
 * Si percorre la struttura invece di cercare una stringa: ogni definizione di oggetto
 * `N G obj` … `endobj`, il suo dizionario di primo livello delimitato contando le `<<` e `>>`
 * annidate, e — dentro quel dizionario e solo li — il `/ByteRange` che lo qualifica come firma.
 *
 * Cosa questo taglia fuori, e perche il taglio conta: il testo di un content stream (dove un
 * attaccante puo scrivere `/ByteRange [0 0 0 0]` come parte dell'importo) sta DOPO la parola
 * chiave `stream`, quindi fuori dal dizionario; un commento appeso in coda al file sta fuori da
 * ogni oggetto. Nessuno dei due diventa una firma.
 *
 * `/Type /Sig` non e richiesto: la specifica PDF lo rende facoltativo, e un dizionario che
 * dichiara un `/ByteRange` sta gia dicendo di essere una firma. Chi mente sul tipo non guadagna
 * niente — verrebbe valutato lo stesso.
 *
 * Il file viene letto come testo latin-1 (un byte, un carattere), quindi ogni indice della
 * stringa e anche un offset in byte. Su un PDF di qualche megabyte e una copia in piu; per la
 * demo, che lavora su un documento di pochi kilobyte, e il prezzo giusto per un codice leggibile.
 */
function findSignatureFields(bytes) {
  const text = fromAscii(bytes)
  const fields = []

  OBJECT_HEADER.lastIndex = 0
  for (let match = OBJECT_HEADER.exec(text); match !== null; match = OBJECT_HEADER.exec(text)) {
    const bodyAt = match.index + match[0].length
    const endObjAt = text.indexOf('endobj', bodyAt)
    const limit = endObjAt === -1 ? text.length : endObjAt

    const dictStart = text.indexOf('<<', bodyAt)
    if (dictStart === -1 || dictStart >= limit) continue
    let dictEnd
    try {
      dictEnd = dictEndAt(bytes, dictStart)
    } catch {
      continue // dizionario mai chiuso: file troncato o rotto, non e una firma leggibile
    }

    const dict = text.slice(dictStart, dictEnd)
    if (!dict.includes('/ByteRange')) continue
    fields.push(readSignatureField(bytes, dict, dictStart))
  }
  return fields
}

/**
 * Le due cose che contano dentro un dizionario di firma: il /ByteRange, cioe quali byte il
 * firmatario dichiara di aver coperto, e il /Contents, cioe il buco esadecimale in cui sta la
 * firma. Entrambi si leggono in quel dizionario, non altrove nel file: `/Contents` compare anche
 * nella pagina, con tutt'altro significato (il riferimento al content stream).
 *
 * Non lancia. Un dizionario che dichiara una firma illeggibile resta comunque una firma trovata —
 * dimenticarla vorrebbe dire far sparire dal conto proprio l'oggetto piu sospetto — e si porta
 * dietro il `problem` che spiega cosa non si e potuto leggere.
 */
function readSignatureField(bytes, dict, dictStart) {
  const field = { byteRange: null, contentsStart: null, contentsEnd: null, problem: null }

  const numbers = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(dict)
  if (!numbers) {
    field.problem = fail(
      'byterange-illeggibile',
      'Il /ByteRange non e nella forma prevista [a b c d]: il documento dichiara una firma ma ' +
        'non dice in modo leggibile quali byte copre.',
    )
    return field
  }
  field.byteRange = numbers.slice(1, 5).map(Number)

  const contentsAt = dict.indexOf('/Contents')
  if (contentsAt === -1) {
    field.problem = fail(
      'contents-illeggibile',
      'Il dizionario di firma dichiara un /ByteRange ma non ha nessun /Contents: manca proprio ' +
        'il posto in cui la firma dovrebbe stare.',
    )
    return field
  }

  let at = dictStart + contentsAt + '/Contents'.length
  while (at < bytes.length && isWhitespace(bytes[at])) at++
  if (bytes[at] !== LT) {
    field.problem = fail(
      'contents-illeggibile',
      'Il /Contents del dizionario di firma non e una stringa esadecimale fra parentesi angolari: ' +
        'la firma non sta dove il documento dice che sta.',
    )
    return field
  }
  field.contentsStart = at

  const contentsEnd = indexOf(bytes, '>', at)
  if (contentsEnd === -1) {
    field.problem = fail(
      'contents-illeggibile',
      'Il /Contents comincia ma non viene mai chiuso da ">".',
    )
    return field
  }
  field.contentsEnd = contentsEnd
  return field
}

/** Un PDF senza nemmeno un dizionario di firma: non c'e niente da verificare. */
function noSignature() {
  return fail(
    'nessuna-firma',
    'Questo PDF non contiene nessuna firma digitale: non c\'e nessun dizionario di firma con un ' +
      '/ByteRange, quindi non c\'e niente da verificare.',
  )
}

/**
 * I byte della firma, decodificati dall'esadecimale del /Contents (zeri di riempimento compresi).
 *
 * Sta separata da `locateSignatureField` per una ragione precisa: la copertura si misura con i soli
 * numeri del /ByteRange, e va restituita anche quando il contenuto del buco e spazzatura. Un
 * risultato che dicesse solo «illeggibile», senza dire quanto del file era coperto, spegnerebbe
 * meta del pannello proprio nel caso in cui c'e piu da spiegare.
 */
function hexContents(bytes, { contentsStart, contentsEnd }) {
  const hex = fromAscii(bytes.subarray(contentsStart + 1, contentsEnd))
  if (hex.length === 0 || hex.length % 2 !== 0) {
    throw fail(
      'contents-illeggibile',
      `Il /Contents contiene ${hex.length} caratteri esadecimali: un numero dispari (o nessuno) ` +
        'non puo essere una sequenza di byte.',
    )
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw fail(
      'contents-illeggibile',
      'Il /Contents contiene caratteri che non sono esadecimali: quello che c\'e dentro non e una firma.',
    )
  }
  return fromHex(hex)
}

/**
 * Il conto della copertura. Aritmetica pura: qui non si legge piu niente dal file, si confronta
 * cio che il /ByteRange dichiara con quanto e lungo il file davvero.
 *
 * `complete` e vero quando i due intervalli piu il buco tassellano l'intero file: il primo parte
 * da zero, il secondo arriva all'ultimo byte, e il buco in mezzo e esattamente il /Contents.
 * L'ultima condizione non e pedanteria — un /ByteRange che dichiarasse un buco piu largo del
 * /Contents lascerebbe byte non firmati in mezzo al documento, e sarebbero invisibili a un
 * controllo che guardasse solo la coda.
 */
function coverageOf(bytes, field) {
  const [a, b, c, d] = field.byteRange
  const gapMatchesContents = a + b === field.contentsStart && c === field.contentsEnd + 1
  return {
    byteRange: [a, b, c, d],
    fileLength: bytes.length,
    coveredBytes: b + d,
    uncoveredTail: Math.max(0, bytes.length - (c + d)),
    complete: a === 0 && a + b <= c && c + d === bytes.length && gapMatchesContents,
    gapMatchesContents,
  }
}

/* ------------------------------------------------------------------------------------- */
/* 2 e 3. Cosa c'e dentro la firma                                                         */
/* ------------------------------------------------------------------------------------- */

/**
 * Apre il CMS SignedData e ne tira fuori i cinque pezzi che servono a verificare:
 * il DER esatto degli attributi firmati, i byte della firma RSA, l'impronta dichiarata, il
 * certificato e la chiave pubblica dentro di esso.
 *
 * Due punti delicati, entrambi risolti prendendo i byte come stanno invece di ricostruirli:
 *
 *   - gli attributi firmati compaiono nel SignerInfo con il tag implicito [0] (0xa0), ma la firma
 *     e stata calcolata sugli stessi byte con il loro tag vero, SET (0x31), come prescrive
 *     RFC 5652 §5.4. Si riprendono i byte originali e si sostituisce il solo primo byte: cosi
 *     non si ricodifica niente, e cio che si verifica e esattamente cio che e stato firmato.
 *   - il certificato e la sua chiave pubblica si estraggono come sotto-fette del DER originale,
 *     non riserializzando l'albero: una ricodifica «equivalente» ma diversa di un solo byte
 *     farebbe fallire la verifica senza che nessun documento sia stato manomesso.
 */
function readCms(contents) {
  if (contents.every((byte) => byte === 0)) {
    throw fail(
      'firma-non-riempita',
      'Il documento ha il segnaposto della firma ma il /Contents e ancora tutto a zero: ' +
        'il PDF e stato preparato per essere firmato, e non e stato firmato.',
    )
  }
  const parsed = asn1js.fromBER(contents)
  if (parsed.offset === -1) {
    throw fail(
      'cms-illeggibile',
      'Non si riesce a leggere la busta CMS dentro il /Contents: ' + parsed.result.error,
    )
  }
  const contentInfo = parsed.result
  const outer = childrenOf(contentInfo)
  if (!(contentInfo instanceof asn1js.Sequence) || outer.length < 2) {
    throw fail('cms-illeggibile', 'Il contenuto della firma non e un ContentInfo CMS.')
  }
  if (oidOf(outer[0]) !== CMS_OIDS.signedData) {
    throw fail(
      'cms-illeggibile',
      'Il contenuto della firma non e di tipo signedData: e un CMS, ma non una firma.',
    )
  }
  // `fromBER` si ferma alla fine della struttura: il resto del buco sono zeri di riempimento.
  const cmsDer = contents.slice(0, parsed.offset)

  const signedData = childrenOf(outer[1])[0]
  const sd = childrenOf(signedData)
  if (sd.length < 4) throw fail('cms-illeggibile', 'La struttura SignedData e incompleta.')

  // signerInfos e il SET che segue encapContentInfo; certificati e CRL, se ci sono, stanno in
  // mezzo con un tag di contesto, quindi non si contano le posizioni: si cerca il primo SET.
  const signerInfos = sd.slice(3).find((node) => node instanceof asn1js.Set)
  const signerInfo = signerInfos ? childrenOf(signerInfos)[0] : undefined
  if (!signerInfo) throw fail('cms-illeggibile', 'La firma non contiene nessun SignerInfo.')
  const si = childrenOf(signerInfo)

  const attrsIndex = si.findIndex((node) => isContextTag(node, 0))
  if (attrsIndex === -1) {
    throw fail(
      'cms-illeggibile',
      'La firma non ha attributi firmati: questa demo verifica firme PAdES, in cui la firma RSA ' +
        'copre gli attributi e non direttamente il documento.',
    )
  }
  if (si.length < attrsIndex + 3) {
    throw fail('cms-illeggibile', 'Nel SignerInfo mancano l\'algoritmo di firma o la firma stessa.')
  }

  // Il DER su cui RSA ha lavorato: gli stessi byte, con 0x31 (SET) al posto di 0xa0.
  const signedAttrsDer = rawOf(si[attrsIndex])
  signedAttrsDer[0] = 0x31

  const digestOid = oidOf(childrenOf(si[2])[0])
  if (digestOid !== CMS_OIDS.sha256) {
    throw fail(
      'algoritmo-non-supportato',
      `La firma dichiara l'algoritmo di impronta ${digestOid}: questa demo verifica solo SHA-256.`,
    )
  }
  const signatureOid = oidOf(childrenOf(si[attrsIndex + 1])[0])
  if (signatureOid !== CMS_OIDS.rsaEncryption) {
    throw fail(
      'algoritmo-non-supportato',
      `La firma dichiara l'algoritmo ${signatureOid}: questa demo verifica solo RSA PKCS#1 v1.5.`,
    )
  }

  const signatureNode = si[attrsIndex + 2]
  if (!(signatureNode instanceof asn1js.OctetString)) {
    throw fail('cms-illeggibile', 'Il valore della firma non e una OCTET STRING.')
  }
  const signature = new Uint8Array(signatureNode.valueBlock.valueHexView)

  const certsNode = sd.find((node) => isContextTag(node, 0))
  const certNode = certsNode ? childrenOf(certsNode)[0] : undefined
  if (!certNode) {
    throw fail(
      'certificato-assente',
      'Dentro la firma non c\'e nessun certificato: non c\'e la chiave pubblica con cui verificarla.',
    )
  }

  return {
    cmsDer,
    signedAttrsDer,
    signature,
    messageDigest: messageDigestOf(si[attrsIndex]),
    ...readCertificate(rawOf(certNode)),
  }
}

/** L'impronta del documento dichiarata dagli attributi firmati. */
function messageDigestOf(signedAttrs) {
  for (const attribute of childrenOf(signedAttrs)) {
    const parts = childrenOf(attribute)
    if (parts.length < 2 || oidOf(parts[0]) !== CMS_OIDS.messageDigest) continue
    const value = childrenOf(parts[1])[0]
    if (!(value instanceof asn1js.OctetString)) break
    return new Uint8Array(value.valueBlock.valueHexView)
  }
  throw fail(
    'cms-illeggibile',
    'Fra gli attributi firmati manca messageDigest: la firma non dichiara nessuna impronta del ' +
      'documento, quindi non c\'e niente da confrontare.',
  )
}

/** Emittente, soggetto e chiave pubblica del certificato che viaggia dentro la firma. */
function readCertificate(certDer) {
  const cert = asn1js.fromBER(certDer)
  if (cert.offset === -1) {
    throw fail(
      'certificato-illeggibile',
      'Non si riesce a leggere il certificato dentro la firma: ' + cert.result.error,
    )
  }
  const tbs = childrenOf(cert.result)[0]
  const fields = childrenOf(tbs)
  // `version` e opzionale ed e taggata [0]: se c'e, ogni campo successivo slitta di uno.
  const base = isContextTag(fields[0], 0) ? 1 : 0
  const issuer = fields[base + 2]
  const subject = fields[base + 4]
  const spki = fields[base + 5]
  if (!issuer || !subject || !spki) {
    throw fail('certificato-illeggibile', 'Il certificato dentro la firma e malformato.')
  }
  const spkiAlgorithm = oidOf(childrenOf(childrenOf(spki)[0])[0])
  if (spkiAlgorithm !== CMS_OIDS.rsaEncryption) {
    throw fail(
      'algoritmo-non-supportato',
      `Il certificato porta una chiave pubblica di tipo ${spkiAlgorithm}: questa demo verifica solo RSA.`,
    )
  }
  return {
    certDer,
    spkiDer: rawOf(spki),
    subjectCN: commonNameOf(subject),
    issuerCN: commonNameOf(issuer),
    // Autofirmato vuol dire questo, e nient'altro: chi lo emette e chi lo riceve sono lo stesso
    // nome. Si confrontano i byte del Distinguished Name, non le stringhe.
    selfSigned: equals(rawOf(issuer), rawOf(subject)),
  }
}

/** Il Common Name di un Distinguished Name, oppure null se quel nome non ne ha uno. */
function commonNameOf(name) {
  for (const rdn of childrenOf(name)) {
    for (const attribute of childrenOf(rdn)) {
      const parts = childrenOf(attribute)
      if (parts.length < 2 || oidOf(parts[0]) !== CERT_OIDS.commonName) continue
      const value = parts[1].valueBlock.value
      if (typeof value === 'string') return value
    }
  }
  return null
}

/**
 * Il terzo controllo. La chiave pubblica entra in WebCrypto cosi com'e scritta nel certificato —
 * `importKey('spki', ...)` vuole esattamente il SubjectPublicKeyInfo in DER — e `verify` dice se
 * quei 256 byte di RSA corrispondono davvero a quegli attributi firmati.
 *
 * `crypto.subtle.verify` restituisce `false` per una firma sbagliata: lancia solo se e la chiave
 * a essere illeggibile, e in quel caso la distinzione la fa il chiamante.
 */
async function checkSignature(cms) {
  const key = await globalThis.crypto.subtle.importKey(
    'spki',
    cms.spkiDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  return await globalThis.crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    cms.signature,
    cms.signedAttrsDer,
  )
}

/* ------------------------------------------------------------------------------------- */
/* Il verdetto                                                                             */
/* ------------------------------------------------------------------------------------- */

/**
 * Le tre regole, in un posto solo e in quest'ordine: prima si guarda se il documento e ancora
 * quello firmato (digest e firma), poi — e solo se lo e — se la firma lo copre tutto.
 *
 * L'ordine e cio che rende `extended` un verdetto onesto e non un'attenuante: si arriva a
 * «firma valida, documento esteso dopo la firma» soltanto quando la firma e davvero valida.
 */
function verdictOf({ coverage, digest, signature }) {
  if (!coverage || !digest || !signature) return 'invalid'
  if (!digest.match || !signature.ok) return 'invalid'
  return coverage.complete ? 'valid' : 'extended'
}

/* ------------------------------------------------------------------------------------- */
/* Attrezzi                                                                                */
/* ------------------------------------------------------------------------------------- */

/** Un errore che sa spiegarsi: `reason` per la pagina, il messaggio per chi legge. */
function fail(reason, message) {
  const problem = new Error(message)
  problem.reason = reason
  return problem
}

/**
 * Annota l'intoppo su un risultato o su una singola voce di `signatures`.
 * Il primo intoppo vince: annotarne un secondo sopra il primo nasconderebbe la causa vera.
 */
function note(result, reason, message) {
  if (result.error !== null) return
  result.reason = reason
  result.error = message
}

/** Chiude il risultato su un intoppo, lasciando intatto quel poco che si era gia potuto calcolare. */
function stopHere(result, problem) {
  result.verdict = 'invalid'
  if (result.error === null) {
    result.reason = problem?.reason ?? 'errore-interno'
    result.error = problem?.reason
      ? problem.message
      : 'La verifica si e interrotta per un errore imprevisto: ' + messageOf(problem)
  }
  return result
}

function messageOf(problem) {
  if (problem instanceof Error) return problem.message
  return String(problem)
}

/** I byte in ingresso, comunque siano stati passati. Tutto il resto non e un PDF. */
function asBytes(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  throw fail(
    'input-non-valido',
    'La verifica vuole i byte del PDF (un Uint8Array) e ha ricevuto ' +
      (input === null ? 'null' : typeof input) +
      '.',
  )
}

function isWhitespace(byte) {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09 || byte === 0x0c || byte === 0x00
}

function childrenOf(node) {
  const value = node?.valueBlock?.value
  return Array.isArray(value) ? value : []
}

/** L'OID di un nodo ObjectIdentifier, in forma puntata; stringa vuota se non lo e. */
function oidOf(node) {
  return node instanceof asn1js.ObjectIdentifier ? node.valueBlock.toString() : ''
}

function isContextTag(node, tagNumber) {
  return node?.idBlock?.tagClass === 3 && node.idBlock.tagNumber === tagNumber
}

/**
 * I byte originali di un nodo, com'erano nel file. asn1js li conserva mentre parsa: usarli evita
 * di riserializzare l'albero, che e il modo classico di ottenere un DER «equivalente» ma diverso —
 * e una firma si accorge della differenza anche di un byte solo.
 */
function rawOf(node) {
  const original = node.valueBeforeDecodeView
  return original && original.length > 0
    ? new Uint8Array(original)
    : new Uint8Array(node.toBER(false))
}
