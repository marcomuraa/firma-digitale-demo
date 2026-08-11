/**
 * Vista ad albero di una struttura ASN.1 codificata in DER.
 *
 * E la lente con cui si guarda dentro il certificato e dentro il CMS: chi segue la demo deve
 * riconoscere a occhio il SignedData, i suoi attributi firmati, l'impronta SHA-256 e la chiave
 * pubblica. Percio questo modulo NON e un parser: il parsing lo fa `asn1js.fromBER`, che e
 * codice collaudato da anni. Qui si traduce l'albero gia parsato in un ViewModel puro —
 * offset, etichette, anteprime leggibili — e nient'altro.
 *
 * Due invarianti che il resto della pagina da per scontati:
 *
 * 1. `buildAsn1Tree` non lancia MAI. Gli attacchi della demo corrompono davvero i byte del CMS,
 *    e un DER rotto deve produrre un verdetto (`ok: false` con un `error` in italiano), non una
 *    pagina bianca.
 * 2. Gli offset sono assoluti dall'inizio del `der` ricevuto, cosi il pannello esadecimale puo
 *    evidenziare esattamente i byte di un nodo senza rifare i conti.
 *
 * Nessun DOM, nessuno stato, nessun accesso a `window`: funzione pura.
 * Contratto normativo in docs/contratti-ui.md.
 */

import { fromBER } from 'asn1js'
import { toHex } from '../core/bytes.js'

/** Il contratto fissa il tetto: un'anteprima non supera mai i 64 caratteri. */
const MAX_PREVIEW = 64

/** Byte mostrati in chiaro dentro un'anteprima esadecimale, prima dei puntini. */
const PREVIEW_BYTES = 16

/**
 * Fino a 8 byte un INTEGER si legge in decimale; oltre no. E la regola che tiene il modulo RSA
 * (256 byte) fuori dai numeroni illeggibili e dentro l'esadecimale, dove almeno si confronta.
 */
const DECIMAL_INTEGER_BYTES = 8

/** Puntini di sospensione: un carattere solo, cosi il troncamento costa 1 e non 3. */
const ELLIPSIS = '…'

/** asn1js numera le classi 1..4; il contratto le vuole per nome. */
const TAG_CLASS_NAMES = { 1: 'universal', 2: 'application', 3: 'context', 4: 'private' }

/** Nomi X.680 dei tag universali. Restano in inglese tecnico: sono nomi propri dello standard. */
const UNIVERSAL_TAG_LABELS = {
  0: 'END OF CONTENT',
  1: 'BOOLEAN',
  2: 'INTEGER',
  3: 'BIT STRING',
  4: 'OCTET STRING',
  5: 'NULL',
  6: 'OBJECT IDENTIFIER',
  7: 'OBJECT DESCRIPTOR',
  8: 'EXTERNAL',
  9: 'REAL',
  10: 'ENUMERATED',
  11: 'EMBEDDED PDV',
  12: 'UTF8String',
  13: 'RELATIVE OID',
  14: 'TIME',
  16: 'SEQUENCE',
  17: 'SET',
  18: 'NumericString',
  19: 'PrintableString',
  20: 'TeletexString',
  21: 'VideotexString',
  22: 'IA5String',
  23: 'UTCTime',
  24: 'GeneralizedTime',
  25: 'GraphicString',
  26: 'VisibleString',
  27: 'GeneralString',
  28: 'UniversalString',
  29: 'CHARACTER STRING',
  30: 'BMPString',
  31: 'DATE',
  32: 'TIME OF DAY',
  33: 'DATE TIME',
  34: 'DURATION',
}

/**
 * Da tag universale a `valueKind`. L'elenco dei kind e chiuso dal contratto: quello che non c'e
 * diventa 'raw', che significa "mostrami i byte", non "non l'ho capito".
 */
const UNIVERSAL_VALUE_KINDS = {
  1: 'boolean',
  2: 'integer',
  3: 'bitstring',
  4: 'octetstring',
  5: 'null',
  6: 'oid',
  12: 'utf8string',
  19: 'printablestring',
  23: 'utctime',
  24: 'generalizedtime',
}

/**
 * Nomi degli OID. I primi sedici sono quelli imposti dal contratto, cioe quelli che compaiono
 * davvero nella catena della demo; gli altri sono quelli che si incontrano in un certificato
 * self-signed qualunque. Un OID che non e in tavola resta senza nome: qui non si tira a
 * indovinare, perche un nome sbagliato accanto a un OID e peggio di nessun nome.
 */
const OID_LABELS = {
  // CMS / PKCS#7 e attributi firmati
  '1.2.840.113549.1.7.1': 'id-data',
  '1.2.840.113549.1.7.2': 'id-signedData',
  '1.2.840.113549.1.9.3': 'contentType',
  '1.2.840.113549.1.9.4': 'messageDigest',
  '1.2.840.113549.1.9.5': 'signingTime',
  '1.2.840.113549.1.9.16.2.12': 'signing-certificate',
  '1.2.840.113549.1.9.16.2.47': 'signing-certificate-v2',
  '1.2.840.113549.1.9.1': 'emailAddress',
  // Digest
  '2.16.840.1.101.3.4.2.1': 'sha-256',
  '2.16.840.1.101.3.4.2.2': 'sha-384',
  '2.16.840.1.101.3.4.2.3': 'sha-512',
  '1.3.14.3.2.26': 'sha-1',
  // Chiavi e firme
  '1.2.840.113549.1.1.1': 'rsaEncryption',
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption',
  '1.2.840.113549.1.1.8': 'id-mgf1',
  '1.2.840.113549.1.1.10': 'RSASSA-PSS',
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
  '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
  '1.2.840.10045.2.1': 'id-ecPublicKey',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256',
  // Nome distinto
  '2.5.4.3': 'commonName',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'countryName',
  '2.5.4.7': 'localityName',
  '2.5.4.8': 'stateOrProvinceName',
  '2.5.4.10': 'organizationName',
  '2.5.4.11': 'organizationalUnitName',
  // Estensioni X.509
  '2.5.29.14': 'subjectKeyIdentifier',
  '2.5.29.15': 'keyUsage',
  '2.5.29.17': 'subjectAltName',
  '2.5.29.19': 'basicConstraints',
  '2.5.29.31': 'cRLDistributionPoints',
  '2.5.29.32': 'certificatePolicies',
  '2.5.29.35': 'authorityKeyIdentifier',
  '2.5.29.37': 'extKeyUsage',
  '1.3.6.1.5.5.7.1.1': 'authorityInfoAccess',
  '1.3.6.1.5.5.7.3.1': 'id-kp-serverAuth',
  '1.3.6.1.5.5.7.3.2': 'id-kp-clientAuth',
  '1.3.6.1.5.5.7.3.3': 'id-kp-codeSigning',
  '1.3.6.1.5.5.7.3.4': 'id-kp-emailProtection',
}

/**
 * I messaggi di asn1js sono in inglese e parlano al programmatore. Qui diventano frasi italiane
 * che dicono a chi guarda *che cosa* non torna nei byte.
 */
const ERROR_RULES = [
  [/input buffer has zero length/i, "DER vuoto: non c'e nessun byte da analizzare."],
  [/zero buffer length/i, "DER troncato: i byte finiscono dentro l'intestazione di un elemento."],
  [
    /end of input reached/i,
    "DER troncato: i byte finiscono prima della fine dell'elemento dichiarato.",
  ],
  [
    /reserved by ASN\.1 standard/i,
    "Tag sconosciuto: quel numero di tag universale non e ammesso dallo standard ASN.1.",
  ],
  [
    /maximum ASN\.1 content length/i,
    'Lunghezza dichiarata non plausibile: supera il massimo che il parser accetta.',
  ],
  [
    /maximum ASN\.1 depth/i,
    'Struttura troppo annidata: il parser si ferma prima di sprofondare nella ricorsione.',
  ],
  [/maximum ASN\.1 nodes/i, 'Troppi elementi: il parser si ferma prima di esaurire la memoria.'],
  [/wrong values? for/i, 'Contenuto non conforme al tag dichiarato.'],
  [/unable to parse|unknown block/i, 'Elemento ASN.1 non riconosciuto.'],
]

// ---------------------------------------------------------------------------
// Utilita interne
// ---------------------------------------------------------------------------

/** Qualunque contenitore di byte -> Uint8Array, oppure `null` se non lo e. */
function toBytes(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  return null
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function messageOf(cause) {
  if (cause && typeof cause.message === 'string' && cause.message) return cause.message
  return String(cause)
}

/** Messaggio di asn1js -> frase italiana. Se non lo riconosce, lo riporta invece di inventarlo. */
function translateError(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  for (const [pattern, message] of ERROR_RULES) if (pattern.test(text)) return message
  return text ? 'DER non analizzabile: ' + text : 'DER non analizzabile.'
}

/** Verdetto negativo nella forma imposta dal contratto: albero assente, motivo esplicito. */
function failure(totalLength, error) {
  return { ok: false, error, totalLength, root: null, flat: [] }
}

function clip(text, max) {
  return text.length <= max ? text : text.slice(0, max - 1) + ELLIPSIS
}

function pad(value, width) {
  return String(value).padStart(width, '0')
}

/**
 * Byte -> esadecimale troncato, con un suffisso che dice sempre la lunghezza vera.
 * Il suffisso e la parte che vale: senza "(32 byte)" un'impronta troncata sembrerebbe corta.
 */
function previewBytesWithSuffix(bytes, suffix) {
  const full = toHex(bytes)
  const room = Math.max(0, MAX_PREVIEW - suffix.length)
  if (full.length <= room) return full + suffix
  let keep = Math.min(PREVIEW_BYTES * 2, room - 1)
  if (keep < 0) keep = 0
  keep -= keep % 2
  return full.slice(0, keep) + ELLIPSIS + suffix
}

function byteCountSuffix(count) {
  return ' (' + count + ' byte)'
}

/** I byte del contenuto di un nodo primitivo, se asn1js li espone. */
function hexViewOf(block) {
  const view = block.valueBlock && block.valueBlock.valueHexView
  return view && typeof view.length === 'number' ? view : null
}

/** INTEGER in complemento a due -> decimale. Serve solo per i numeri corti (versione, esponente). */
function decimalOfInteger(bytes) {
  if (bytes.length === 0) return '0'
  let value = 0n
  for (let i = 0; i < bytes.length; i++) value = (value << 8n) | BigInt(bytes[i])
  if (bytes[0] & 0x80) value -= 1n << BigInt(8 * bytes.length)
  return value.toString()
}

/** Testo di una stringa ASN.1, ripulito dai caratteri di controllo che sfascerebbero il layout. */
function textPreview(block) {
  const value = block.valueBlock && block.valueBlock.value
  if (typeof value !== 'string') return null
  // eslint-disable-next-line no-control-regex
  return clip(value.replace(/[\u0000-\u001f\u007f]/g, '.'), MAX_PREVIEW)
}

/** UTCTime / GeneralizedTime -> data leggibile. `null` se i campi non sono una data sensata. */
function timePreview(block, withMilliseconds) {
  const parts = [block.year, block.month, block.day, block.hour, block.minute, block.second]
  if (!parts.every((part) => Number.isFinite(part))) return null
  let text =
    pad(block.year, 4) +
    '-' +
    pad(block.month, 2) +
    '-' +
    pad(block.day, 2) +
    ' ' +
    pad(block.hour, 2) +
    ':' +
    pad(block.minute, 2) +
    ':' +
    pad(block.second, 2)
  if (withMilliseconds && Number.isFinite(block.millisecond) && block.millisecond > 0) {
    text += '.' + pad(block.millisecond, 3)
  }
  return text + ' UTC'
}

/** L'OID in forma puntata, oppure `null` se asn1js non e riuscito a ricomporlo. */
function readOid(block) {
  const value = block.valueBlock
  if (!value || typeof value.toString !== 'function') return null
  const text = value.toString()
  return typeof text === 'string' && /^\d+(\.\d+)*$/.test(text) ? text : null
}

/** Anteprima di un nodo primitivo. Non lancia: al peggio restituisce la stringa vuota. */
function primitivePreview(block, valueKind, oid, oidLabel) {
  try {
    switch (valueKind) {
      case 'oid':
        if (!oid) return ''
        return clip(oidLabel ? oidLabel + ' (' + oid + ')' : oid, MAX_PREVIEW)
      case 'integer': {
        const bytes = hexViewOf(block)
        if (!bytes) return ''
        if (bytes.length <= DECIMAL_INTEGER_BYTES) return clip(decimalOfInteger(bytes), MAX_PREVIEW)
        return previewBytesWithSuffix(bytes, byteCountSuffix(bytes.length))
      }
      case 'bitstring': {
        const bytes = hexViewOf(block)
        if (!bytes) return ''
        const unused = numberOr(block.valueBlock.unusedBits, 0)
        return previewBytesWithSuffix(
          bytes,
          ' (' + bytes.length + ' byte, ' + unused + ' bit non usati)',
        )
      }
      case 'octetstring': {
        const bytes = hexViewOf(block)
        if (!bytes) return ''
        return previewBytesWithSuffix(bytes, byteCountSuffix(bytes.length))
      }
      case 'boolean':
        return block.valueBlock && block.valueBlock.value ? 'TRUE' : 'FALSE'
      case 'null':
        return ''
      case 'utctime':
      case 'generalizedtime': {
        const text = timePreview(block, valueKind === 'generalizedtime')
        if (text) return clip(text, MAX_PREVIEW)
        break
      }
      case 'utf8string':
      case 'printablestring': {
        const text = textPreview(block)
        if (text !== null) return text
        break
      }
      default:
        break
    }
    // 'raw' e tutti i casi in cui la lettura tipizzata non ha prodotto niente: restano i byte,
    // che e comunque piu di quanto direbbe una casella vuota.
    const text = textPreview(block)
    if (text) return text
    const bytes = hexViewOf(block)
    return bytes ? previewBytesWithSuffix(bytes, byteCountSuffix(bytes.length)) : ''
  } catch {
    return ''
  }
}

/** Anteprima di un nodo costruito: quanti figli contiene, che e l'unica cosa utile da dire. */
function constructedPreview(count) {
  if (count === 0) return 'nessun elemento'
  if (count === 1) return '1 elemento'
  return count + ' elementi'
}

/**
 * I figli di un nodo, solo se sono davvero elementi ASN.1.
 * Serve un filtro perche asn1js usa `valueBlock.value` anche per cose che elementi non sono —
 * gli archi di un OBJECT IDENTIFIER, per esempio. Scendere li dentro romperebbe l'albero.
 */
function childBlocks(block) {
  if (!block.idBlock || block.idBlock.isConstructed !== true) return []
  const value = block.valueBlock && block.valueBlock.value
  if (!Array.isArray(value)) return []
  for (const child of value) if (!child || !child.idBlock || !child.lenBlock) return []
  return value
}

function tagLabelOf(tagClass, tagNumber) {
  if (tagClass === 'universal') {
    return UNIVERSAL_TAG_LABELS[tagNumber] || 'UNIVERSAL ' + tagNumber
  }
  if (tagClass === 'context') return '[' + tagNumber + ']'
  if (tagClass === 'application') return '[APPLICATION ' + tagNumber + ']'
  return '[PRIVATE ' + tagNumber + ']'
}

function valueKindOf(tagClass, tagNumber, constructed) {
  if (constructed) return 'raw'
  if (tagClass !== 'universal') return 'raw'
  return UNIVERSAL_VALUE_KINDS[tagNumber] || 'raw'
}

/**
 * Da blocco asn1js a nodo del ViewModel, ricorsivamente.
 *
 * asn1js conosce la lunghezza di ogni blocco ma non la sua posizione: gli offset assoluti
 * nascono qui, sommando le lunghezze dei fratelli a partire dal contenuto del padre. Vale
 * perche il DER e a lunghezza definita — ed e proprio per questo che la forma indefinita
 * finisce fra i problemi invece di essere disegnata.
 */
function buildNode(block, id, depth, offset, limit, flat, problems) {
  const idBlock = block.idBlock || {}
  const lenBlock = block.lenBlock || {}

  const headerLength = numberOr(idBlock.blockLength, 0) + numberOr(lenBlock.blockLength, 0)
  const length = numberOr(block.blockLength, 0)
  const contentOffset = offset + headerLength
  const contentLength = Math.max(0, length - headerLength)

  if (lenBlock.isIndefiniteForm === true) {
    problems.push(
      'Elemento ' +
        id +
        ': lunghezza in forma indefinita, che il BER ammette e il DER vieta.',
    )
  }
  if (typeof block.error === 'string' && block.error) {
    problems.push('Elemento ' + id + ': ' + translateError(block.error))
  }
  if (headerLength <= 0 || length <= 0 || offset < 0 || offset + length > limit) {
    problems.push('Elemento ' + id + ': i byte dichiarati escono dai limiti del DER.')
  }

  const tagClass = TAG_CLASS_NAMES[idBlock.tagClass] || 'universal'
  const tagNumber = numberOr(idBlock.tagNumber, -1)
  const constructed = idBlock.isConstructed === true
  const valueKind = valueKindOf(tagClass, tagNumber, constructed)
  const oid = valueKind === 'oid' ? readOid(block) : null
  const oidLabel = oid ? OID_LABELS[oid] || null : null

  const node = {
    id,
    depth,
    offset,
    length,
    headerLength,
    contentOffset,
    contentLength,
    tagClass,
    tagNumber,
    constructed,
    tagLabel: tagLabelOf(tagClass, tagNumber),
    valueKind,
    valuePreview: '',
    oid,
    oidLabel,
    children: [],
  }
  // `flat` e in ordine di visita: il nodo entra prima dei suoi figli, e viene completato dopo.
  flat.push(node)

  const kids = childBlocks(block)
  let at = contentOffset
  for (let i = 0; i < kids.length; i++) {
    node.children.push(buildNode(kids[i], id + '.' + i, depth + 1, at, limit, flat, problems))
    at += numberOr(kids[i].blockLength, 0)
  }

  node.valuePreview = constructed
    ? constructedPreview(node.children.length)
    : primitivePreview(block, valueKind, oid, oidLabel)

  return node
}

// ---------------------------------------------------------------------------
// API pubblica
// ---------------------------------------------------------------------------

/**
 * Albero navigabile di un DER: `buildAsn1Tree(der) -> Asn1ViewModel`.
 *
 * `der: Uint8Array` (un ArrayBuffer o un'altra vista vanno bene lo stesso). Restituisce
 * `{ ok, error, totalLength, root, flat }`; `flat` e lo stesso albero in ordine di visita
 * anticipata, comodo per liste e ricerche.
 *
 * Non lancia in nessun caso. Producono `ok: false` con un motivo leggibile: un ingresso che non
 * e fatto di byte, un DER vuoto o troncato, un tag che lo standard non ammette, una lunghezza
 * in forma indefinita, un elemento che dichiara piu byte di quanti ne esistano.
 *
 * Eventuali byte dopo l'ultimo elemento non sono un errore — il `/Contents` di un PDF firmato e
 * imbottito di zeri per costruzione. Si vedono nel ViewModel come differenza fra `totalLength`
 * e `root.offset + root.length`.
 */
export function buildAsn1Tree(der) {
  const bytes = toBytes(der)
  if (bytes === null) {
    return failure(0, 'Ingresso non valido: serve una sequenza di byte (Uint8Array).')
  }
  if (bytes.length === 0) {
    return failure(0, "DER vuoto: non c'e nessun byte da analizzare.")
  }

  let parsed = null
  try {
    parsed = fromBER(bytes)
  } catch (cause) {
    return failure(bytes.length, 'DER non analizzabile: ' + messageOf(cause))
  }
  if (!parsed || !parsed.result || parsed.offset === -1) {
    const raw = parsed && parsed.result ? parsed.result.error : ''
    return failure(bytes.length, translateError(raw))
  }

  const flat = []
  const problems = []
  let root = null
  try {
    root = buildNode(parsed.result, '0', 0, 0, bytes.length, flat, problems)
  } catch (cause) {
    return failure(bytes.length, 'Albero ASN.1 non ricostruibile: ' + messageOf(cause))
  }
  // Il primo problema e il piu a monte: e quello che spiega tutti gli altri.
  if (problems.length > 0) return failure(bytes.length, problems[0])

  return { ok: true, error: null, totalLength: bytes.length, root, flat }
}
