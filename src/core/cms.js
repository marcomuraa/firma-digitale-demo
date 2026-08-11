/**
 * Il CMS SignedData: la firma vera e propria.
 *
 * Terzo anello. Quello che finisce dentro `/Contents` del PDF non e «la firma» nel senso di un
 * blocco RSA nudo: e una struttura CMS (RFC 5652) che dice *cosa* e stato firmato, *con quale
 * certificato*, *quando*, e solo alla fine porta i 256 byte di RSA.
 *
 * Due scelte fanno di questo CMS una firma PAdES baseline e non un CMS qualunque:
 *
 * 1. **Detached.** Non c'e `eContent`: il documento firmato non e dentro la firma, sta fuori.
 *    Cio che lega i due e l'attributo `messageDigest`, che contiene l'impronta dei byte del PDF
 *    coperti dal `/ByteRange`. Se un byte del PDF cambia, l'impronta non torna piu.
 *
 * 2. **Attributi firmati.** La firma RSA non copre il digest del documento: copre il DER degli
 *    attributi firmati, che *contengono* quel digest insieme a data, tipo di contenuto e
 *    identita del certificato. Firmare gli attributi e cio che impedisce di riciclare la stessa
 *    firma su un documento diverso o attribuirla a un altro certificato.
 *
 * Ambiente: browser. Solo `globalThis.crypto` piu asn1js, che e una libreria pura.
 */

import * as asn1js from 'asn1js'
import { sha256 } from './bytes.js'

/** Gli OID che compaiono nella struttura, scritti una volta sola. */
export const CMS_OIDS = Object.freeze({
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1',
})

/** Lunghezza in byte di un digest SHA-256. */
const SHA256_LENGTH = 32

/**
 * Costruisce il CMS SignedData detached.
 *
 * @param {object} params
 * @param {Uint8Array} params.messageDigest  SHA-256 dei byte coperti dal `/ByteRange`
 * @param {Uint8Array} params.certDer        il certificato del firmatario, in DER
 * @param {CryptoKey}  params.privateKey     la chiave privata corrispondente
 * @param {Date}       [params.signingTime]  data dichiarata di firma
 * @returns {Promise<{ cmsDer: Uint8Array, signedAttrsDer: Uint8Array, signature: Uint8Array }>}
 *   `cmsDer` e cio che va scritto nel PDF. Gli altri due sono per la pagina: `signedAttrsDer`
 *   sono esattamente i byte su cui RSA ha lavorato, e mostrarli e meta della spiegazione.
 */
export async function buildSignedData({ messageDigest, certDer, privateKey, signingTime = new Date() }) {
  validateDigest(messageDigest)
  if (!privateKey) throw new Error('serve la chiave privata per firmare')
  if (!(signingTime instanceof Date) || Number.isNaN(signingTime.getTime())) {
    throw new Error('signingTime deve essere una Date valida')
  }
  const certificate = certificateFields(certDer)

  // --- Gli attributi firmati -------------------------------------------------------------
  const attributes = [
    // Che tipo di contenuto e stato firmato. Per un PDF e `id-data`: byte grezzi.
    attribute(CMS_OIDS.contentType, [new asn1js.ObjectIdentifier({ value: CMS_OIDS.data })]),
    // L'impronta del documento. E l'unico anello che tocca il PDF.
    attribute(CMS_OIDS.messageDigest, [octetString(messageDigest)]),
    // Quando il firmatario dichiara di aver firmato. Dichiara: non e una marca temporale, non
    // e attestata da nessuno. La differenza fra le due cose e un pannello della pagina.
    attribute(CMS_OIDS.signingTime, [timeValue(signingTime)]),
    // signing-certificate-v2 (RFC 5035): l'impronta del certificato entra fra i dati firmati,
    // cosi la firma dice anche «sono stato io, con questo certificato e non con un altro».
    attribute(CMS_OIDS.signingCertificateV2, [
      await signingCertificateV2(certificate),
    ]),
  ]

  // Un SET OF in DER e ordinato per codifica, non per come lo si e scritto nel sorgente.
  // Non e pedanteria: OpenSSL riordina il SET quando ricalcola l'impronta in verifica, quindi
  // un ordine diverso qui significa firmare byte diversi da quelli che verranno verificati.
  const ordered = sortSetOf(attributes)

  // --- I byte che vengono firmati --------------------------------------------------------
  // Qui sta l'errore classico. Dentro SignerInfo gli attributi firmati compaiono con il tag
  // implicito [0] (0xa0), perche il campo e `signedAttrs [0] IMPLICIT SignedAttributes`. Ma la
  // firma va calcolata sulla stessa sequenza codificata con il suo tag vero, SET (0x31), come
  // prescrive RFC 5652 §5.4. Firmare i byte con 0xa0 in testa produce una firma che nessun
  // validatore serio accetta — e la pagina non avrebbe niente da mostrare.
  const signedAttrsDer = new Uint8Array(new asn1js.Set({ value: ordered }).toBER(false))
  const signature = new Uint8Array(
    await globalThis.crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, signedAttrsDer),
  )

  // --- SignerInfo ------------------------------------------------------------------------
  const signerInfo = new asn1js.Sequence({
    value: [
      new asn1js.Integer({ value: 1 }), // version 1: il firmatario e indicato da emittente + seriale
      new asn1js.Sequence({ value: [certificate.issuer(), certificate.serialNumber()] }),
      digestAlgorithm(),
      implicitTag(0, ordered), // gli stessi byte di sopra, con 0xa0 al posto di 0x31
      signatureAlgorithm(),
      octetString(signature),
    ],
  })

  // --- SignedData ------------------------------------------------------------------------
  const signedData = new asn1js.Sequence({
    value: [
      new asn1js.Integer({ value: 1 }),
      new asn1js.Set({ value: [digestAlgorithm()] }),
      // encapContentInfo con il solo eContentType: nessun eContent, ed e cio che vuol dire
      // «detached». Il documento resta fuori dalla firma.
      new asn1js.Sequence({ value: [new asn1js.ObjectIdentifier({ value: CMS_OIDS.data })] }),
      // Il certificato viaggia dentro la firma: chi verifica non deve andarselo a cercare.
      implicitTag(0, [certificate.node()]),
      new asn1js.Set({ value: [signerInfo] }),
    ],
  })

  // --- ContentInfo, la busta esterna -----------------------------------------------------
  const contentInfo = new asn1js.Sequence({
    value: [
      new asn1js.ObjectIdentifier({ value: CMS_OIDS.signedData }),
      explicitTag(0, signedData),
    ],
  })

  return { cmsDer: new Uint8Array(contentInfo.toBER(false)), signedAttrsDer, signature }
}

/* -------------------------------------------------------------------------------------- */
/* Mattoni ASN.1                                                                            */
/* -------------------------------------------------------------------------------------- */

/**
 * `Attribute ::= SEQUENCE { attrType OBJECT IDENTIFIER, attrValues SET OF AttributeValue }`
 */
function attribute(oid, values) {
  return new asn1js.Sequence({
    value: [new asn1js.ObjectIdentifier({ value: oid }), new asn1js.Set({ value: values })],
  })
}

/**
 * L'algoritmo di digest. RFC 5754 vuole i parametri **assenti** per la famiglia SHA-2: non
 * `NULL`, proprio niente. E cio che scrive anche OpenSSL.
 */
function digestAlgorithm() {
  return new asn1js.Sequence({ value: [new asn1js.ObjectIdentifier({ value: CMS_OIDS.sha256 })] })
}

/**
 * L'algoritmo di firma. In CMS, RSASSA-PKCS1-v1_5 si dichiara con l'OID `rsaEncryption` e i
 * parametri `NULL` (RFC 3370 §3.2, PKCS#1): l'impronta e gia dichiarata da `digestAlgorithm`,
 * qui si dichiara solo come la si incapsula.
 */
function signatureAlgorithm() {
  return new asn1js.Sequence({
    value: [new asn1js.ObjectIdentifier({ value: CMS_OIDS.rsaEncryption }), new asn1js.Null()],
  })
}

/**
 * `SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }`, con
 * `ESSCertIDv2 ::= SEQUENCE { hashAlgorithm DEFAULT sha256, certHash OCTET STRING, issuerSerial OPTIONAL }`.
 *
 * `hashAlgorithm` viene omesso di proposito: SHA-256 e il valore di default, e in DER un campo
 * uguale al proprio default non si codifica. `issuerSerial` invece c'e, perche fa parte di cio
 * che rende l'attributo utile: lega la firma a *quel* certificato di *quell'emittente*.
 */
async function signingCertificateV2(certificate) {
  const certHash = await sha256(certificate.der)
  const issuerSerial = new asn1js.Sequence({
    value: [
      // GeneralNames con un solo GeneralName di tipo directoryName, che e [4] EXPLICIT
      new asn1js.Sequence({ value: [explicitTag(4, certificate.issuer())] }),
      certificate.serialNumber(),
    ],
  })
  const essCertIDv2 = new asn1js.Sequence({ value: [octetString(certHash), issuerSerial] })
  return new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertIDv2] })] })
}

/** UTCTime fino al 2049, GeneralizedTime dopo: e la regola di RFC 5652 per `signingTime`. */
function timeValue(date) {
  const year = date.getUTCFullYear()
  if (year >= 1950 && year <= 2049) return new asn1js.UTCTime({ valueDate: date })
  return new asn1js.GeneralizedTime({ valueDate: date })
}

/** OCTET STRING da byte, con copia difensiva: la vista in ingresso puo essere una fetta. */
function octetString(bytes) {
  return new asn1js.OctetString({ valueHex: new Uint8Array(bytes).buffer })
}

/** Tag di contesto costruito, forma implicita: sostituisce il tag naturale del contenuto. */
function implicitTag(tagNumber, children) {
  return new asn1js.Constructed({
    idBlock: { tagClass: 3, tagNumber },
    value: children,
  })
}

/** Tag di contesto costruito, forma esplicita: avvolge il contenuto lasciandogli il suo tag. */
function explicitTag(tagNumber, child) {
  return implicitTag(tagNumber, [child])
}

/**
 * Ordinamento DER di un SET OF: le codifiche si confrontano byte per byte, e a parita di
 * prefisso viene prima la piu corta. E la stessa regola che applica OpenSSL quando riserializza.
 */
function sortSetOf(nodes) {
  return nodes
    .map((node) => ({ node, der: new Uint8Array(node.toBER(false)) }))
    .sort((a, b) => compareDer(a.der, b.der))
    .map((entry) => entry.node)
}

function compareDer(a, b) {
  const shared = Math.min(a.length, b.length)
  for (let i = 0; i < shared; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

/* -------------------------------------------------------------------------------------- */
/* Lettura del certificato                                                                  */
/* -------------------------------------------------------------------------------------- */

/**
 * Estrae dal certificato i due campi che il CMS deve ricopiare: emittente e numero di serie.
 *
 * Vengono restituiti come byte e ricostruiti a ogni uso, non condivisi come nodi: la stessa
 * coppia compare in due punti diversi della struttura (in `SignerInfo.sid` e dentro
 * `signing-certificate-v2`) e due rami dello stesso albero non devono essere lo stesso oggetto.
 * Ricopiare i byte grezzi garantisce inoltre che l'emittente citato dalla firma sia identico,
 * byte per byte, a quello scritto nel certificato: un DN ricodificato «equivalente» ma diverso
 * farebbe fallire la ricerca del firmatario.
 */
function certificateFields(certDer) {
  if (!(certDer instanceof Uint8Array)) throw new Error('certDer deve essere un Uint8Array')
  const der = new Uint8Array(certDer)
  const cert = parseDer(der, 'Certificate')
  if (!(cert instanceof asn1js.Sequence) || cert.valueBlock.value.length !== 3) {
    throw new Error('certificato malformato: non e una SEQUENCE di tre campi')
  }
  const fields = cert.valueBlock.value[0].valueBlock.value
  // `version` e opzionale ed e taggata [0]: se c'e, ogni campo successivo slitta di uno.
  const tagged = fields[0]?.idBlock.tagClass === 3 && fields[0]?.idBlock.tagNumber === 0
  const serialNode = fields[tagged ? 1 : 0]
  const issuerNode = fields[tagged ? 3 : 2]
  if (!(serialNode instanceof asn1js.Integer)) {
    throw new Error('certificato malformato: numero di serie non trovato')
  }
  if (!(issuerNode instanceof asn1js.Sequence)) {
    throw new Error('certificato malformato: emittente non trovato')
  }
  const serialDer = new Uint8Array(serialNode.toBER(false))
  const issuerDer = new Uint8Array(issuerNode.toBER(false))
  return {
    der,
    node: () => parseDer(der, 'Certificate'),
    issuer: () => parseDer(issuerDer, 'emittente'),
    serialNumber: () => parseDer(serialDer, 'numero di serie'),
  }
}

function parseDer(der, what) {
  const parsed = asn1js.fromBER(der)
  if (parsed.offset === -1) throw new Error('DER illeggibile (' + what + '): ' + parsed.result.error)
  return parsed.result
}

function validateDigest(messageDigest) {
  if (!(messageDigest instanceof Uint8Array)) {
    throw new Error('messageDigest deve essere un Uint8Array')
  }
  if (messageDigest.length !== SHA256_LENGTH) {
    throw new Error(
      'messageDigest deve essere lungo ' + SHA256_LENGTH + ' byte (SHA-256), ne ha ' + messageDigest.length,
    )
  }
}
