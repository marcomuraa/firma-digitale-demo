/**
 * Attrezzi per attaccare la busta CMS dentro il /Contents.
 *
 * verify.js legge il CMS con un parser scritto a mano (readCms) che prende scorciatoie: guarda
 * SOLO il primo SignerInfo, SOLO il primo certificato, non confronta mai il `sid` del firmatario
 * col certificato scelto, non controlla contentType ne eContentType, e riscrive `signedAttrsDer[0]`
 * dando per scontato che il tag sia un byte solo e la lunghezza in forma definita. Qui si
 * costruiscono buste fatte APPOSTA per cadere in quelle scorciatoie.
 *
 * Perche un encoder DER/BER a mano invece di asn1js: perche l'attacco vive proprio nei byte che
 * asn1js "normalizzerebbe". Serve poter emettere una lunghezza indefinita, un SET non ordinato,
 * un secondo certificato in testa — cose che una libreria educata non ti lascia fare. L'encoder e
 * minimo e usa asn1js solo per ottenere i TLV delle foglie (OID, INTEGER, OCTET STRING).
 *
 * Nessun file di src/ viene toccato: si RIUSANO le sue funzioni (firma vera, iniezione nel buco).
 */

import * as asn1js from 'asn1js'

import { generateKeyPair } from '../../../src/core/keys.js'
import { buildSelfSigned } from '../../../src/core/certificate.js'
import { buildSignedData } from '../../../src/core/cms.js'
import { addPlaceholder, digestCovered, injectSignature } from '../../../src/core/pades.js'
import { concat, indexOf } from '../../../src/core/bytes.js'

/** Istante di firma congelato, identico a quello del resto del collaudo. */
export const TEMPO = new Date(Date.UTC(2026, 7, 10, 12, 0, 0))

/** Gli OID che servono, scritti una volta. */
export const OID = Object.freeze({
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha512: '2.16.840.1.101.3.4.2.3',
  rsa: '1.2.840.113549.1.1.1',
})

/* --------------------------------------------------------------------------------------- */
/* Un encoder DER/BER minimo                                                                 */
/* --------------------------------------------------------------------------------------- */

/** La codifica DER di una lunghezza (forma definita, corta o lunga). */
function encLen(n) {
  if (n < 0x80) return Uint8Array.of(n)
  const parti = []
  let v = n
  while (v > 0) {
    parti.unshift(v & 0xff)
    v = Math.floor(v / 256)
  }
  return Uint8Array.of(0x80 | parti.length, ...parti)
}

/**
 * Un TLV: tag, lunghezza, contenuto. Con `indefinita` emette la forma a lunghezza indefinita
 * (tag, 0x80, contenuto, 00 00) — la stessa che asn1js accetta ma che una firma calcolata su DER
 * non riconosce piu.
 */
export function tlv(tag, contenuto, indefinita = false) {
  if (indefinita) return concat(Uint8Array.of(tag, 0x80), contenuto, Uint8Array.of(0, 0))
  return concat(Uint8Array.of(tag), encLen(contenuto.length), contenuto)
}

export const seq = (...parti) => tlv(0x30, concat(...parti))
export const setOf = (...parti) => tlv(0x31, concat(...parti))
/** Contesto costruito implicito [n]: sostituisce il tag naturale del contenuto. */
export const ctx = (n, contenuto, indefinita = false) => tlv(0xa0 | n, contenuto, indefinita)
/** Contesto costruito esplicito [n]: avvolge il figlio lasciandogli il suo tag. */
export const ctxExplicit = (n, figlio) => tlv(0xa0 | n, figlio)

const derDi = (nodo) => new Uint8Array(nodo.toBER(false))
export const oidDer = (s) => derDi(new asn1js.ObjectIdentifier({ value: s }))
export const intDer = (n) => derDi(new asn1js.Integer({ value: n }))
export const octetDer = (bytes) => derDi(new asn1js.OctetString({ valueHex: new Uint8Array(bytes).buffer }))
export const nullDer = () => derDi(new asn1js.Null())
export const utcTimeDer = (data) => derDi(new asn1js.UTCTime({ valueDate: data }))

export const digestAlgDer = (oid = OID.sha256) => seq(oidDer(oid))
export const sigAlgDer = () => seq(oidDer(OID.rsa), nullDer())

/** Il contenuto (senza intestazione) di un TLV: ci serve per riusare byte gia codificati. */
export function contenutoDi(der) {
  const primoLen = der[1]
  const headerLen = primoLen < 0x80 ? 2 : 2 + (primoLen & 0x7f)
  return der.subarray(headerLen)
}

/** Ordinamento DER di un SET OF: codifiche confrontate byte per byte, la piu corta a parita. */
export function ordinaDer(ders) {
  return [...ders].sort((a, b) => {
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]
    return a.length - b.length
  })
}

/* --------------------------------------------------------------------------------------- */
/* Lettura del certificato: emittente e seriale per il sid                                   */
/* --------------------------------------------------------------------------------------- */

/** Estrae dal certificato l'emittente e il numero di serie, come byte DER. */
export function issuerAndSerial(certDer) {
  const cert = asn1js.fromBER(certDer).result
  const tbs = cert.valueBlock.value[0]
  const f = tbs.valueBlock.value
  const tagged = f[0].idBlock.tagClass === 3 && f[0].idBlock.tagNumber === 0
  const serial = f[tagged ? 1 : 0]
  const issuer = f[tagged ? 3 : 2]
  return { issuerDer: derDi(issuer), serialDer: derDi(serial) }
}

/** IssuerAndSerialNumber ::= SEQUENCE { issuer Name, serialNumber INTEGER }. */
export function sidDer(certDer) {
  const { issuerDer, serialDer } = issuerAndSerial(certDer)
  return seq(issuerDer, serialDer)
}

/* --------------------------------------------------------------------------------------- */
/* Mattoni del CMS                                                                           */
/* --------------------------------------------------------------------------------------- */

/**
 * Un SignerInfo, assemblato pezzo per pezzo. `signedAttrsField` e gia il campo [0] (implicito),
 * cosi chi chiama decide se e a lunghezza definita o indefinita.
 */
export function signerInfoDer({ sidCertDer, signedAttrsField, signature, digestOid = OID.sha256 }) {
  return seq(
    intDer(1), // version 1: sid = issuerAndSerialNumber
    sidDer(sidCertDer),
    digestAlgDer(digestOid),
    signedAttrsField,
    sigAlgDer(),
    octetDer(signature),
  )
}

/**
 * Assembla una ContentInfo/SignedData completa dai pezzi. Ogni parametro e un aggancio per un
 * attacco: piu SignerInfo, piu certificati, eContentType diverso, digestAlgorithms che mente.
 *
 * @param {object} p
 * @param {Uint8Array[]} p.signerInfos   i SignerInfo gia codificati (uno o piu)
 * @param {Uint8Array[]} p.certs         i certificati gia in DER, nell'ordine in cui compaiono
 * @param {string} [p.eContentTypeOid]   l'OID di encapContentInfo (default id-data)
 * @param {Uint8Array} [p.digestAlgorithmsSet]  override del SET digestAlgorithms di SignedData
 */
export function contentInfoDer({ signerInfos, certs, eContentTypeOid = OID.data, digestAlgorithmsSet }) {
  const digestAlgorithms = digestAlgorithmsSet ?? setOf(digestAlgDer())
  const encap = seq(oidDer(eContentTypeOid))
  const certificati = certs.length > 0 ? ctx(0, concat(...certs)) : new Uint8Array(0)
  const signerInfoSet = setOf(concat(...signerInfos))
  const signedData = seq(intDer(1), digestAlgorithms, encap, certificati, signerInfoSet)
  return seq(oidDer(OID.signedData), ctxExplicit(0, signedData))
}

/* --------------------------------------------------------------------------------------- */
/* Attributi firmati e firma                                                                 */
/* --------------------------------------------------------------------------------------- */

/** Un Attribute ::= SEQUENCE { OID, SET OF valori }. */
export function attributoDer(oid, ...valori) {
  return seq(oidDer(oid), setOf(...valori))
}

/**
 * Costruisce gli attributi firmati e li FIRMA con la chiave data. Ritorna il campo [0]
 * (implicito) da mettere nel SignerInfo, i byte del SET su cui si e firmato, e la firma.
 *
 * `ordina=false` lascia gli attributi nell'ordine in cui li passi: serve a costruire un SET OF
 * NON in forma DER, per vedere se il nostro verificatore (che prende i byte grezzi) diverge da
 * openssl (che ricanonicalizza in DER prima di verificare).
 */
export async function firmaAttributi(attributi, privateKey, { ordina = true } = {}) {
  const ders = ordina ? ordinaDer(attributi) : attributi
  const content = concat(...ders)
  const setDer = tlv(0x31, content) // il SET vero, quello su cui RSA lavora
  const signature = new Uint8Array(
    await globalThis.crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, setDer),
  )
  return { field: ctx(0, content), signature, setDer, content }
}

/**
 * Gli attributi firmati "canonici" di una firma PAdES minima: contentType, messageDigest,
 * signingTime. `contentTypeOid` e un aggancio: lo si puo far mentire.
 */
export function attributiCanonici({ digest, contentTypeOid = OID.data, extraMessageDigest = null }) {
  const attributi = [
    attributoDer(OID.contentType, oidDer(contentTypeOid)),
    attributoDer(OID.messageDigest, octetDer(digest)),
    attributoDer(OID.signingTime, utcTimeDer(TEMPO)),
  ]
  if (extraMessageDigest) attributi.push(attributoDer(OID.messageDigest, octetDer(extraMessageDigest)))
  return attributi
}

/* --------------------------------------------------------------------------------------- */
/* Aggressori: chiavi e certificati                                                          */
/* --------------------------------------------------------------------------------------- */

/** Una coppia di chiavi e un certificato autofirmato con il CN che si vuole. */
export async function attore(subjectCN) {
  const pair = await generateKeyPair()
  const cert = await buildSelfSigned({ ...pair, subjectCN, now: TEMPO })
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, certDer: cert.certDer, subjectCN }
}

/* --------------------------------------------------------------------------------------- */
/* Firmare un PDF diverso, per l'attacco "CMS di un altro documento"                         */
/* --------------------------------------------------------------------------------------- */

/**
 * Firma un PDF qualunque con la catena vera e restituisce cio che serve. E la stessa pipeline di
 * firmaIlCampione, ma su byte che passi tu: cosi si puo firmare un documento con un importo diverso.
 */
export async function firmaPdf(pdfBytes, subjectCN = 'Lorenzo Rossi') {
  const pair = await generateKeyPair()
  const cert = await buildSelfSigned({ ...pair, subjectCN, now: TEMPO })
  const { pdfWithHole, byteRange, contentsStart } = addPlaceholder(pdfBytes, { padding: 4096, signingTime: TEMPO })
  const messageDigest = await digestCovered(pdfWithHole, byteRange)
  const { cmsDer } = await buildSignedData({
    messageDigest,
    certDer: cert.certDer,
    privateKey: pair.privateKey,
    signingTime: TEMPO,
  })
  const signed = injectSignature(pdfWithHole, contentsStart, cmsDer)
  return {
    signed,
    byteRange,
    contentsStart,
    contentsEnd: indexOf(signed, '>', contentsStart),
    cmsDer,
    messageDigest,
    certDer: cert.certDer,
    privateKey: pair.privateKey,
  }
}

/**
 * Sostituisce il CMS nel buco /Contents di un PDF gia firmato, senza spostare un byte: il
 * /ByteRange e i byte coperti restano identici. E il cuore di questi attacchi — la busta CMS vive
 * nella parte NON firmata del file, quindi si puo riscrivere a piacere.
 */
export function iniettaCms(pdfSignedBase, contentsStart, nuovoCmsDer) {
  return injectSignature(pdfSignedBase, contentsStart, nuovoCmsDer)
}

export { indexOf }
