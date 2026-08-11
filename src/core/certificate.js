/**
 * Il certificato X.509 autofirmato.
 *
 * Secondo anello: la chiave pubblica da sola non dice a chi appartiene. Il certificato e
 * l'affermazione «questa chiave pubblica e di Tizio», e la firma sul certificato dice chi lo
 * afferma. Qui chi lo afferma e Tizio stesso — e proprio questo e il punto didattico:
 * l'autofirmato dimostra l'integrita ma non l'identita. Nessuno lo ha controllato, quindi la
 * catena di fiducia si ferma al primo anello e ogni verificatore serio lo segnalera.
 *
 * Ambiente: browser. Solo `globalThis.crypto` piu asn1js/pkijs, che sono librerie pure.
 */

import * as asn1js from 'asn1js'
import { AttributeTypeAndValue, BasicConstraints, Certificate, Extension, Time } from 'pkijs'
import { toHex } from './bytes.js'
import { exportPublicKeySpki } from './keys.js'

/** Gli OID che compaiono nel certificato, scritti una volta sola. */
export const CERT_OIDS = Object.freeze({
  commonName: '2.5.4.3',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  subjectKeyIdentifier: '2.5.29.14',
})

/** Durata della validita: un anno esatto. */
const VALIDITY_YEARS = 1

/** Byte del numero di serie. 16 byte casuali sono la prassi per un seriale non prevedibile. */
const SERIAL_BYTES = 16

/**
 * Costruisce il certificato autofirmato della demo.
 *
 * @param {object} params
 * @param {CryptoKey} params.publicKey   chiave pubblica da certificare
 * @param {CryptoKey} params.privateKey  chiave privata con cui autofirmarlo (la stessa coppia)
 * @param {string}    params.subjectCN   il Common Name: nome fittizio, lo decide la pagina
 * @param {Date}      [params.now]       istante di riferimento; serve ai test, in pagina e adesso
 * @returns {Promise<{ certDer: Uint8Array, notBefore: Date, notAfter: Date, serial: string }>}
 *   `serial` e esadecimale minuscolo senza separatori; `notBefore`/`notAfter` sono troncati al
 *   secondo, perche il secondo e la risoluzione di UTCTime: cosi cio che si restituisce e
 *   esattamente cio che c'e scritto nel DER, non un valore che ci somiglia.
 */
export async function buildSelfSigned({ publicKey, privateKey, subjectCN, now = new Date() }) {
  const commonName = validateCommonName(subjectCN)
  if (!publicKey || !privateKey) throw new Error('servono sia la chiave pubblica sia la privata')

  const spkiDer = await exportPublicKeySpki(publicKey)

  const notBefore = new Date(Math.floor(now.getTime() / 1000) * 1000)
  const notAfter = new Date(notBefore.getTime())
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + VALIDITY_YEARS)

  const serialValue = randomSerial()

  const cert = new Certificate()
  cert.version = 2 // v3: la numerazione ASN.1 parte da zero, quindi 2 vuol dire «versione 3»
  cert.serialNumber = new asn1js.Integer({ valueHex: serialValue.buffer })

  // Emittente e soggetto sono lo stesso nome, ed e tutto il senso di «autofirmato»: il
  // certificato garantisce se stesso. Sono due istanze separate perche pkijs le serializza
  // in due punti diversi della struttura.
  cert.issuer.typesAndValues.push(commonNameAttribute(commonName))
  cert.subject.typesAndValues.push(commonNameAttribute(commonName))

  cert.notBefore = new Time({ type: 0, value: notBefore }) // type 0 = UTCTime
  cert.notAfter = new Time({ type: 0, value: notAfter })

  // La chiave pubblica entra cosi com'e uscita da WebCrypto: `exportKey('spki')` *e* gia il
  // SubjectPublicKeyInfo in DER, quindi si tratta di reinnestare un ramo, non di ricostruirlo.
  cert.subjectPublicKeyInfo.fromSchema(parseDer(spkiDer, 'SubjectPublicKeyInfo'))

  cert.extensions = [
    // Non e una CA: non puo emettere certificati per altri. Critica, perche chi non capisce
    // questo vincolo deve rifiutare il certificato invece di ignorarlo.
    new Extension({
      extnID: CERT_OIDS.basicConstraints,
      critical: true,
      extnValue: new BasicConstraints({ cA: false }).toSchema().toBER(false),
    }),
    // digitalSignature + nonRepudiation: i due bit che dichiarano a cosa serve la chiave.
    // nonRepudiation e quello che in ambito eIDAS regge la firma con valore giuridico.
    new Extension({
      extnID: CERT_OIDS.keyUsage,
      critical: true,
      extnValue: keyUsageBits().toBER(false),
    }),
    // Identificatore della chiave: un'etichetta corta per dire «questa chiave, non un'altra».
    new Extension({
      extnID: CERT_OIDS.subjectKeyIdentifier,
      critical: false, // RFC 5280: questa estensione non e mai critica
      extnValue: new asn1js.OctetString({
        valueHex: (await subjectKeyIdentifier(spkiDer)).buffer,
      }).toBER(false),
    }),
  ]

  // Firma del TBSCertificate con la chiave privata: qui il certificato diventa autofirmato.
  // pkijs deduce `sha256WithRSAEncryption` dalla coppia (RSASSA-PKCS1-v1_5, SHA-256).
  await cert.sign(privateKey, 'SHA-256')

  // `toSchema(false)` reimpiega i byte del TBS che sono stati firmati davvero, invece di
  // ricodificarli: cosi la firma copre esattamente cio che finisce nel file.
  const certDer = new Uint8Array(cert.toSchema(false).toBER(false))

  return { certDer, notBefore, notAfter, serial: toHex(serialValue) }
}

/** Il Common Name come attributo di un Distinguished Name. */
function commonNameAttribute(commonName) {
  return new AttributeTypeAndValue({
    type: CERT_OIDS.commonName,
    value: new asn1js.Utf8String({ value: commonName }),
  })
}

/**
 * KeyUsage e un BIT STRING: bit 0 = digitalSignature, bit 1 = nonRepudiation.
 * Accesi entrambi da sinistra fanno `11000000` = 0xC0, con sei bit di riempimento finali che
 * vanno dichiarati come inutilizzati — altrimenti un lettore conta otto usi invece di due.
 */
function keyUsageBits() {
  return new asn1js.BitString({ unusedBits: 6, valueHex: new Uint8Array([0xc0]).buffer })
}

/**
 * subjectKeyIdentifier: 160 bit ricavati dalla chiave pubblica.
 *
 * La ricetta classica di RFC 5280 usa SHA-1. Qui si usa il metodo 1 di RFC 7093 — i 160 bit
 * piu a sinistra di SHA-256 — che e altrettanto standard e non introduce SHA-1 in una demo il
 * cui argomento e proprio la solidita delle impronte. Nessun verificatore ricalcola questo
 * valore: e un'etichetta, non una prova.
 */
async function subjectKeyIdentifier(spkiDer) {
  const spki = parseDer(spkiDer, 'SubjectPublicKeyInfo')
  const publicKeyBits = spki.valueBlock.value[1]
  if (!(publicKeyBits instanceof asn1js.BitString)) {
    throw new Error('SubjectPublicKeyInfo malformato: il secondo campo non e un BIT STRING')
  }
  const raw = new Uint8Array(publicKeyBits.valueBlock.valueHexView)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', raw)
  return new Uint8Array(digest).slice(0, 20)
}

/** Seriale casuale, positivo e in forma minima: il primo byte non ha il bit di segno ne e nullo. */
function randomSerial() {
  const serial = globalThis.crypto.getRandomValues(new Uint8Array(SERIAL_BYTES))
  serial[0] &= 0x7f // un INTEGER DER con il bit alto acceso sarebbe negativo
  if (serial[0] === 0) serial[0] = 0x01 // e uno zero iniziale sarebbe una codifica non minima
  return serial
}

/** Parsing DER con messaggio d'errore che dice quale struttura non e stata capita. */
function parseDer(der, what) {
  const parsed = asn1js.fromBER(der)
  if (parsed.offset === -1) throw new Error('DER illeggibile (' + what + '): ' + parsed.result.error)
  return parsed.result
}

/** Il CN e un dato in ingresso: se e vuoto o smisurato lo si dice subito, non a valle. */
function validateCommonName(subjectCN) {
  if (typeof subjectCN !== 'string') throw new Error('subjectCN deve essere una stringa')
  const commonName = subjectCN.trim()
  if (commonName.length === 0) throw new Error('subjectCN non puo essere vuoto')
  if (commonName.length > 64) throw new Error('subjectCN supera i 64 caratteri ammessi da X.520')
  return commonName
}
