import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAsn1Tree } from './asn1-view.js'

/**
 * Fixture congelate.
 *
 * Generate una volta sola con openssl 3.6.3, e da allora non si toccano — sono byte, non dati
 * di comodo, e le asserzioni sugli offset valgono solo se restano identiche:
 *
 *   openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650 -nodes -sha256 \
 *     -subj "/C=IT/O=Universita di Prova/CN=Demo Firma Digitale"
 *   openssl x509 -in cert.pem -outform DER -out cert.der
 *   openssl cms -sign -in data.txt -signer cert.pem -inkey key.pem -outform DER -nodetach \
 *     -md sha256 -out cms.der
 *   openssl rsa -in key.pem -RSAPublicKey_out -outform DER -out rsapub.der
 *
 * Il CMS serve al cuore didattico della vista: e li che si devono riconoscere gli attributi
 * firmati (contentType, signingTime, messageDigest) e l'impronta SHA-256 da 32 byte.
 */

/** Certificato X.509 self-signed RSA-2048, 887 byte. */
const CERT_B64 = [
  'MIIDczCCAlugAwIBAgIUV+MTTq3rDcyfQ2HD37I/p5+03awwDQYJKoZIhvcNAQELBQAwSTELMAkGA1UEBhMCSVQxHDAaBgNVBAoM',
  'E1VuaXZlcnNpdGEgZGkgUHJvdmExHDAaBgNVBAMME0RlbW8gRmlybWEgRGlnaXRhbGUwHhcNMjYwODEwMTcyNjI5WhcNMzYwODA3',
  'MTcyNjI5WjBJMQswCQYDVQQGEwJJVDEcMBoGA1UECgwTVW5pdmVyc2l0YSBkaSBQcm92YTEcMBoGA1UEAwwTRGVtbyBGaXJtYSBE',
  'aWdpdGFsZTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALIzpXEY3PV1DddzJJYho1YGA9sJGAAQlCz/2KhbLFGsI3X0',
  'c5e08P1mYjXi8YhqD1Udred0OxXupUA5/aux8FKymDdkx6/8OoliglddLqe9hzuzee2I+gzuhCA0g4V5ahwSfx0YaNWGgETHiCbd',
  'Tf/WDTgUEM5tH20MFyUaqVyc6DniXq8TuTghsRDetcoRNj1Op96y+koyEKnkfwVfMo1FOSIy69j0+f3MKBkyiWHh7GJQmcXBTmfI',
  '0g/2SH3biggvq9ZLXfjxUobxPp/CsPMmYJAcH7/gdXr91TXmEqmAOcVszLkRXSDbUKhYEs7L/2BJFH+j+mofdk5UqQBHqU0CAwEA',
  'AaNTMFEwHQYDVR0OBBYEFGsRSjEg+Mx0Yj/pORw/mcRo4VZWMB8GA1UdIwQYMBaAFGsRSjEg+Mx0Yj/pORw/mcRo4VZWMA8GA1Ud',
  'EwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAILNHmQl2IH2xvw1+oP+N2JG6zU8akCMI7fYcMSQ6q5pATHMYigGPiZDcSkL',
  'k8OjbTPPQhmqSw6NxHSGdhUBirZ7cCO8G7p+yBXXIwqF4ajxV1EHPCtzMnxDSpYZ9bIMKeQuNdbYgNSa9elotMaszlQVektexTYz',
  'txm1J/gwEMbrEOl39hy5IBXrGiE4ryigxzfbJiHWc6q8hkUVywlUDapxMdmfES/HleliobCVofOZSu1HsuJcVb+ZbO3GkKGFDvYI',
  'bbVKq47u11IdgB4b+hpeEXmhQnS6PASkwKkkmsUF6U92ce1kTm7Gpytfnw9odWzayMqN5qbvkvtclEA7tgs=',
].join('')

/** CMS SignedData con attributi firmati, contenuto incluso, 1623 byte. */
const CMS_B64 = [
  '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',
].join('')

/** RSAPublicKey nudo: SEQUENCE { modulus INTEGER (257 byte), publicExponent INTEGER }, 270 byte. */
const RSA_PUBLIC_B64 = [
  'MIIBCgKCAQEAsjOlcRjc9XUN13MkliGjVgYD2wkYABCULP/YqFssUawjdfRzl7Tw/WZiNeLxiGoPVR2t53Q7Fe6lQDn9q7HwUrKY',
  'N2THr/w6iWKCV10up72HO7N57Yj6DO6EIDSDhXlqHBJ/HRho1YaARMeIJt1N/9YNOBQQzm0fbQwXJRqpXJzoOeJerxO5OCGxEN61',
  'yhE2PU6n3rL6SjIQqeR/BV8yjUU5IjLr2PT5/cwoGTKJYeHsYlCZxcFOZ8jSD/ZIfduKCC+r1ktd+PFShvE+n8Kw8yZgkBwfv+B1',
  'ev3VNeYSqYA5xWzMuRFdINtQqFgSzsv/YEkUf6P6ah92TlSpAEepTQIDAQAB',
].join('')

function fromBase64(text) {
  return new Uint8Array(Buffer.from(text, 'base64'))
}

const CERT = fromBase64(CERT_B64)
const CMS = fromBase64(CMS_B64)
const RSA_PUBLIC = fromBase64(RSA_PUBLIC_B64)

/** Fixture piccole scritte a mano: un byte fuori posto e si vede subito quale. */
const HAND = {
  nullo: new Uint8Array([0x05, 0x00]),
  sequenzaVuota: new Uint8Array([0x30, 0x00]),
  sequenzaConUnFiglio: new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x2a]),
  interoNegativo: new Uint8Array([0x02, 0x01, 0xff]),
  booleanoFalso: new Uint8Array([0x01, 0x01, 0x00]),
  contestoPrimitivo: new Uint8Array([0x80, 0x02, 0xab, 0xcd]),
  contestoCostruito: new Uint8Array([0xa3, 0x03, 0x02, 0x01, 0x07]),
  ia5: new Uint8Array([0x16, 0x03, 0x61, 0x40, 0x62]),
  generalizedTime: new Uint8Array([
    0x18, 0x13, ...[...'20260810173140.500Z'].map((c) => c.charCodeAt(0)),
  ]),
  // Casi limite che devono produrre ok:false
  troncatoNellIntestazione: new Uint8Array([0x30]),
  troncatoNelContenuto: new Uint8Array([0x30, 0x0a, 0x02, 0x01, 0x05]),
  lunghezzaIndefinita: new Uint8Array([0x30, 0x80, 0x02, 0x01, 0x05, 0x00, 0x00]),
  tagRiservato: new Uint8Array([0x1f, 0x7f, 0x00]),
  lunghezzaAssurda: new Uint8Array([0x30, 0x84, 0x7f, 0xff, 0xff, 0xff, 0x02, 0x01, 0x05]),
}

const VALUE_KINDS = new Set([
  'oid',
  'integer',
  'utctime',
  'generalizedtime',
  'octetstring',
  'bitstring',
  'utf8string',
  'printablestring',
  'null',
  'boolean',
  'raw',
])
const TAG_CLASSES = new Set(['universal', 'application', 'context', 'private'])
const CLASS_BITS = { universal: 0x00, application: 0x40, context: 0x80, private: 0xc0 }

function byId(view, id) {
  return view.flat.find((node) => node.id === id)
}

function byOid(view, oid) {
  return view.flat.filter((node) => node.oid === oid)
}

/** Il fratello successivo di un nodo, secondo il percorso: '0.1.0' -> '0.1.1'. */
function nextSibling(view, id) {
  const cut = id.lastIndexOf('.')
  const index = Number(id.slice(cut + 1))
  return byId(view, id.slice(0, cut + 1) + (index + 1))
}

/**
 * Gli invarianti che ogni albero valido deve rispettare, qualunque sia il DER di partenza.
 * Sono la rete di sicurezza del fuzzing: un albero che li viola mente sugli offset.
 */
function checkInvariants(view, bytes) {
  assert.equal(view.error, null)
  assert.ok(view.root)
  assert.equal(view.flat[0], view.root)

  const preorder = []
  const visit = (node, depth, id) => {
    preorder.push(node)
    assert.equal(node.id, id)
    assert.equal(node.depth, depth)

    assert.ok(node.offset >= 0)
    assert.ok(node.length > 0)
    assert.ok(node.offset + node.length <= view.totalLength)
    assert.ok(node.headerLength >= 2)
    assert.equal(node.contentOffset, node.offset + node.headerLength)
    assert.equal(node.contentOffset + node.contentLength, node.offset + node.length)

    assert.ok(TAG_CLASSES.has(node.tagClass))
    assert.ok(VALUE_KINDS.has(node.valueKind))
    assert.equal(typeof node.valuePreview, 'string')
    assert.ok(node.valuePreview.length <= 64, 'anteprima troppo lunga: ' + node.valuePreview)
    if (node.valueKind !== 'oid') assert.equal(node.oid, null)
    if (node.oid === null) assert.equal(node.oidLabel, null)
    if (node.oid !== null) assert.match(node.oid, /^\d+(\.\d+)*$/)

    // Il byte di tag al suo offset: e la prova che gli offset non sono inventati.
    if (node.tagNumber >= 0 && node.tagNumber < 31 && bytes) {
      const expected = CLASS_BITS[node.tagClass] | (node.constructed ? 0x20 : 0x00) | node.tagNumber
      assert.equal(bytes[node.offset], expected, 'byte di tag sbagliato al nodo ' + node.id)
    }

    if (node.children.length > 0) {
      assert.equal(node.constructed, true)
      assert.equal(node.children[0].offset, node.contentOffset)
      const last = node.children[node.children.length - 1]
      assert.ok(last.offset + last.length <= node.contentOffset + node.contentLength)
      for (let i = 1; i < node.children.length; i++) {
        assert.equal(
          node.children[i].offset,
          node.children[i - 1].offset + node.children[i - 1].length,
        )
      }
    }

    node.children.forEach((child, i) => visit(child, depth + 1, id + '.' + i))
  }
  visit(view.root, 0, '0')

  // `flat` e l'albero in ordine di visita anticipata, e gli id sono unici.
  assert.deepEqual(view.flat, preorder)
  assert.equal(new Set(view.flat.map((n) => n.id)).size, view.flat.length)
}

// ---------------------------------------------------------------------------
// Certificato reale
// ---------------------------------------------------------------------------

test('le fixture generate con openssl sono quelle congelate', () => {
  assert.equal(CERT.length, 887)
  assert.equal(CMS.length, 1623)
  assert.equal(RSA_PUBLIC.length, 270)
})

test('un certificato X.509 reale diventa un albero di SEQUENCE annidati', () => {
  const view = buildAsn1Tree(CERT)

  assert.equal(view.ok, true)
  assert.equal(view.error, null)
  assert.equal(view.totalLength, 887)
  checkInvariants(view, CERT)

  // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
  const root = view.root
  assert.equal(root.id, '0')
  assert.equal(root.depth, 0)
  assert.equal(root.tagClass, 'universal')
  assert.equal(root.tagNumber, 16)
  assert.equal(root.tagLabel, 'SEQUENCE')
  assert.equal(root.constructed, true)
  assert.equal(root.offset, 0)
  assert.equal(root.length, 887)
  assert.equal(root.headerLength, 4)
  assert.equal(root.contentOffset, 4)
  assert.equal(root.contentLength, 883)
  assert.equal(root.valuePreview, '3 elementi')
  assert.equal(root.children.length, 3)

  const tbs = byId(view, '0.0')
  assert.equal(tbs.tagLabel, 'SEQUENCE')
  assert.equal(tbs.offset, 4)
  assert.equal(tbs.length, 607)
  assert.equal(tbs.depth, 1)

  // [0] EXPLICIT Version DEFAULT v1 -> v3
  const version = byId(view, '0.0.0')
  assert.equal(version.tagClass, 'context')
  assert.equal(version.tagNumber, 0)
  assert.equal(version.tagLabel, '[0]')
  assert.equal(version.constructed, true)
  assert.equal(version.valuePreview, '1 elemento')
  assert.equal(byId(view, '0.0.0.0').valueKind, 'integer')
  assert.equal(byId(view, '0.0.0.0').valuePreview, '2')

  // Numero di serie: 20 byte, quindi esadecimale con la lunghezza, non un decimale gigante.
  const serial = byId(view, '0.0.1')
  assert.equal(serial.valueKind, 'integer')
  assert.equal(serial.contentLength, 20)
  assert.match(serial.valuePreview, /^[0-9a-f]+(…)? \(20 byte\)$/)
})

test('gli OID del certificato sono riconosciuti per nome', () => {
  const view = buildAsn1Tree(CERT)

  const algorithm = byId(view, '0.0.2.0')
  assert.equal(algorithm.valueKind, 'oid')
  assert.equal(algorithm.tagLabel, 'OBJECT IDENTIFIER')
  assert.equal(algorithm.oid, '1.2.840.113549.1.1.11')
  assert.equal(algorithm.oidLabel, 'sha256WithRSAEncryption')
  assert.equal(algorithm.valuePreview, 'sha256WithRSAEncryption (1.2.840.113549.1.1.11)')

  // I parametri dell'algoritmo: NULL, che ha un tag e nessun contenuto.
  const parameters = byId(view, '0.0.2.1')
  assert.equal(parameters.valueKind, 'null')
  assert.equal(parameters.tagLabel, 'NULL')
  assert.equal(parameters.contentLength, 0)
  assert.equal(parameters.valuePreview, '')

  const labels = new Map(view.flat.filter((n) => n.oid).map((n) => [n.oid, n.oidLabel]))
  assert.equal(labels.get('2.5.4.6'), 'countryName')
  assert.equal(labels.get('2.5.4.10'), 'organizationName')
  assert.equal(labels.get('2.5.4.3'), 'commonName')
  assert.equal(labels.get('1.2.840.113549.1.1.1'), 'rsaEncryption')
  assert.equal(labels.get('2.5.29.14'), 'subjectKeyIdentifier')
  assert.equal(labels.get('2.5.29.19'), 'basicConstraints')
})

test('i valori del certificato si leggono senza decodificarli a mano', () => {
  const view = buildAsn1Tree(CERT)

  // Nome distinto: PrintableString e UTF8String, mostrati come testo.
  const country = nextSibling(view, byOid(view, '2.5.4.6')[0].id)
  assert.equal(country.valueKind, 'printablestring')
  assert.equal(country.tagLabel, 'PrintableString')
  assert.equal(country.valuePreview, 'IT')

  const organization = nextSibling(view, byOid(view, '2.5.4.10')[0].id)
  assert.equal(organization.valueKind, 'utf8string')
  assert.equal(organization.valuePreview, 'Universita di Prova')

  const commonName = nextSibling(view, byOid(view, '2.5.4.3')[0].id)
  assert.equal(commonName.valuePreview, 'Demo Firma Digitale')

  // Validity: due UTCTime, che devono leggersi come date e non come cifre appiccicate.
  const notBefore = byId(view, '0.0.4.0')
  const notAfter = byId(view, '0.0.4.1')
  assert.equal(notBefore.valueKind, 'utctime')
  assert.equal(notBefore.tagLabel, 'UTCTime')
  assert.equal(notBefore.valuePreview, '2026-08-10 17:26:29 UTC')
  assert.equal(notAfter.valuePreview, '2036-08-07 17:26:29 UTC')

  // basicConstraints: cA = TRUE, dentro un OCTET STRING corto mostrato per intero.
  const basicConstraints = byOid(view, '2.5.29.19')[0]
  const critical = nextSibling(view, basicConstraints.id)
  assert.equal(critical.valueKind, 'boolean')
  assert.equal(critical.valuePreview, 'TRUE')
  const extensionValue = nextSibling(view, critical.id)
  assert.equal(extensionValue.valueKind, 'octetstring')
  assert.equal(extensionValue.valuePreview, '30030101ff (5 byte)')
})

test('le BIT STRING della chiave e della firma dicono byte e bit inutilizzati', () => {
  const view = buildAsn1Tree(CERT)

  // subjectPublicKey: la chiave pubblica RSA-2048 impacchettata in una BIT STRING.
  const subjectPublicKey = byId(view, '0.0.6.1')
  assert.equal(subjectPublicKey.valueKind, 'bitstring')
  assert.equal(subjectPublicKey.tagLabel, 'BIT STRING')
  assert.equal(subjectPublicKey.constructed, false)
  assert.equal(subjectPublicKey.contentLength, 271) // 270 byte + il byte dei bit inutilizzati
  assert.match(subjectPublicKey.valuePreview, /^[0-9a-f]{32}… \(270 byte, 0 bit non usati\)$/)

  // signatureValue: 2048 bit di firma RSA.
  const signatureValue = byId(view, '0.2')
  assert.equal(signatureValue.valueKind, 'bitstring')
  assert.match(signatureValue.valuePreview, /^[0-9a-f]{32}… \(256 byte, 0 bit non usati\)$/)
})

// ---------------------------------------------------------------------------
// CMS: il cuore didattico
// ---------------------------------------------------------------------------

test('nel CMS si riconoscono il SignedData e i suoi attributi firmati', () => {
  const view = buildAsn1Tree(CMS)

  assert.equal(view.ok, true)
  assert.equal(view.totalLength, 1623)
  checkInvariants(view, CMS)

  // ContentInfo ::= SEQUENCE { contentType, [0] EXPLICIT content }
  assert.equal(byId(view, '0.0').oid, '1.2.840.113549.1.7.2')
  assert.equal(byId(view, '0.0').oidLabel, 'id-signedData')
  assert.equal(byId(view, '0.0').valuePreview, 'id-signedData (1.2.840.113549.1.7.2)')
  assert.equal(byId(view, '0.1').tagLabel, '[0]')

  const labels = new Map(view.flat.filter((n) => n.oid).map((n) => [n.oid, n.oidLabel]))
  assert.equal(labels.get('1.2.840.113549.1.7.1'), 'id-data')
  assert.equal(labels.get('1.2.840.113549.1.9.3'), 'contentType')
  assert.equal(labels.get('1.2.840.113549.1.9.5'), 'signingTime')
  assert.equal(labels.get('1.2.840.113549.1.9.4'), 'messageDigest')
  assert.equal(labels.get('2.16.840.1.101.3.4.2.1'), 'sha-256')

  // Un OID fuori dalla catena della demo resta senza nome: nessuna invenzione.
  assert.equal(labels.get('1.2.840.113549.1.9.15'), null)
})

test("l'impronta SHA-256 dentro messageDigest si legge come esadecimale troncato", () => {
  const view = buildAsn1Tree(CMS)

  // Attribute ::= SEQUENCE { attrType OID, attrValues SET OF ANY }
  const attributeType = byOid(view, '1.2.840.113549.1.9.4')[0]
  const attributeValues = nextSibling(view, attributeType.id)
  assert.equal(attributeValues.tagLabel, 'SET')
  const digest = attributeValues.children[0]

  assert.equal(digest.valueKind, 'octetstring')
  assert.equal(digest.tagLabel, 'OCTET STRING')
  assert.equal(digest.contentLength, 32)
  assert.match(digest.valuePreview, /^[0-9a-f]{32}… \(32 byte\)$/)
  // I byte mostrati sono davvero i primi dell'impronta, non un riassunto qualsiasi.
  const primi16 = Buffer.from(CMS.subarray(digest.contentOffset, digest.contentOffset + 16))
  assert.ok(digest.valuePreview.startsWith(primi16.toString('hex')))
})

test('signingTime si legge come data, non come cifre appiccicate', () => {
  const view = buildAsn1Tree(CMS)

  const attributeType = byOid(view, '1.2.840.113549.1.9.5')[0]
  const attributeValues = nextSibling(view, attributeType.id)
  const time = attributeValues.children[0]

  assert.equal(time.valueKind, 'utctime')
  assert.equal(time.valuePreview, '2026-08-10 17:31:40 UTC')
})

// ---------------------------------------------------------------------------
// INTEGER lunghi: il modulo RSA
// ---------------------------------------------------------------------------

test('il modulo RSA e esadecimale troncato, non un decimale da 617 cifre', () => {
  const view = buildAsn1Tree(RSA_PUBLIC)

  assert.equal(view.ok, true)
  checkInvariants(view, RSA_PUBLIC)
  assert.equal(view.root.children.length, 2)

  const modulus = byId(view, '0.0')
  assert.equal(modulus.valueKind, 'integer')
  assert.equal(modulus.contentLength, 257) // 256 byte di modulo + lo zero di segno
  assert.match(modulus.valuePreview, /^[0-9a-f]{32}… \(257 byte\)$/)
  assert.doesNotMatch(modulus.valuePreview, /^\d+$/)

  // L'esponente invece e corto, e in decimale si legge al volo.
  const exponent = byId(view, '0.1')
  assert.equal(exponent.valueKind, 'integer')
  assert.equal(exponent.valuePreview, '65537')
})

// ---------------------------------------------------------------------------
// Fixture scritte a mano
// ---------------------------------------------------------------------------

test('i tipi elementari hanno etichetta e anteprima prevedibili', () => {
  const nullo = buildAsn1Tree(HAND.nullo)
  assert.equal(nullo.ok, true)
  assert.equal(nullo.root.tagLabel, 'NULL')
  assert.equal(nullo.root.valueKind, 'null')
  assert.equal(nullo.root.headerLength, 2)
  assert.equal(nullo.root.contentLength, 0)
  assert.equal(nullo.root.valuePreview, '')

  const vuota = buildAsn1Tree(HAND.sequenzaVuota)
  assert.equal(vuota.ok, true)
  assert.equal(vuota.root.valuePreview, 'nessun elemento')
  assert.deepEqual(vuota.root.children, [])
  assert.equal(vuota.flat.length, 1)

  const unFiglio = buildAsn1Tree(HAND.sequenzaConUnFiglio)
  assert.equal(unFiglio.root.valuePreview, '1 elemento')
  assert.equal(unFiglio.root.children[0].valuePreview, '42')

  assert.equal(buildAsn1Tree(HAND.interoNegativo).root.valuePreview, '-1')
  assert.equal(buildAsn1Tree(HAND.booleanoFalso).root.valuePreview, 'FALSE')

  const ia5 = buildAsn1Tree(HAND.ia5)
  assert.equal(ia5.root.tagLabel, 'IA5String')
  assert.equal(ia5.root.valuePreview, 'a@b')

  const generalized = buildAsn1Tree(HAND.generalizedTime)
  assert.equal(generalized.root.valueKind, 'generalizedtime')
  assert.equal(generalized.root.valuePreview, '2026-08-10 17:31:40.500 UTC')
})

test('i tag non universali si etichettano con la loro classe', () => {
  const primitivo = buildAsn1Tree(HAND.contestoPrimitivo)
  assert.equal(primitivo.root.tagClass, 'context')
  assert.equal(primitivo.root.tagNumber, 0)
  assert.equal(primitivo.root.tagLabel, '[0]')
  assert.equal(primitivo.root.constructed, false)
  assert.equal(primitivo.root.valueKind, 'raw')
  assert.equal(primitivo.root.valuePreview, 'abcd (2 byte)')

  const costruito = buildAsn1Tree(HAND.contestoCostruito)
  assert.equal(costruito.root.tagLabel, '[3]')
  assert.equal(costruito.root.constructed, true)
  assert.equal(costruito.root.valueKind, 'raw')
  assert.equal(costruito.root.valuePreview, '1 elemento')
  assert.equal(costruito.root.children[0].valuePreview, '7')
})

// ---------------------------------------------------------------------------
// Robustezza: buildAsn1Tree non lancia mai
// ---------------------------------------------------------------------------

test('un DER troncato produce ok:false, non un lancio', () => {
  for (const bytes of [CERT.subarray(0, 20), CERT.subarray(0, 886), HAND.troncatoNelContenuto]) {
    const view = buildAsn1Tree(bytes)
    assert.equal(view.ok, false)
    assert.equal(view.root, null)
    assert.deepEqual(view.flat, [])
    assert.equal(view.totalLength, bytes.length)
    assert.match(view.error, /troncat/i)
  }

  const intestazione = buildAsn1Tree(HAND.troncatoNellIntestazione)
  assert.equal(intestazione.ok, false)
  assert.match(intestazione.error, /troncat/i)
})

test('ingressi degeneri producono un errore parlante', () => {
  const vuoto = buildAsn1Tree(new Uint8Array(0))
  assert.equal(vuoto.ok, false)
  assert.equal(vuoto.totalLength, 0)
  assert.match(vuoto.error, /vuoto/i)

  for (const brutto of [null, undefined, 42, 'ciao', {}, [], [0x30, 0x00]]) {
    const view = buildAsn1Tree(brutto)
    assert.equal(view.ok, false)
    assert.equal(view.root, null)
    assert.equal(view.totalLength, 0)
    assert.match(view.error, /Ingresso non valido/)
  }
})

test('la forma indefinita del BER viene respinta: il DER non la ammette', () => {
  const view = buildAsn1Tree(HAND.lunghezzaIndefinita)
  assert.equal(view.ok, false)
  assert.equal(view.root, null)
  assert.match(view.error, /indefinita/i)
})

test('un tag non ammesso o una lunghezza assurda non fanno esplodere la vista', () => {
  const tag = buildAsn1Tree(HAND.tagRiservato)
  assert.equal(tag.ok, false)
  assert.match(tag.error, /Tag sconosciuto/i)

  const lunghezza = buildAsn1Tree(HAND.lunghezzaAssurda)
  assert.equal(lunghezza.ok, false)
  assert.match(lunghezza.error, /Lunghezza dichiarata non plausibile/i)
})

test('nessun prefisso del certificato fa lanciare la vista', () => {
  for (let length = 0; length < CERT.length; length++) {
    const view = buildAsn1Tree(CERT.subarray(0, length))
    assert.equal(view.ok, false, 'un prefisso non e un DER completo: ' + length)
    assert.equal(typeof view.error, 'string')
    assert.ok(view.error.length > 0)
  }
})

test('nessun byte corrotto del CMS fa lanciare la vista', () => {
  // PRNG deterministico: la stessa corruzione a ogni esecuzione, quindi un fallimento si ripete.
  let seed = 20260810
  const nextRandom = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }

  for (let round = 0; round < 400; round++) {
    const corrupted = CMS.slice()
    const howMany = 1 + Math.floor(nextRandom() * 4)
    for (let i = 0; i < howMany; i++) {
      corrupted[Math.floor(nextRandom() * corrupted.length)] = Math.floor(nextRandom() * 256)
    }

    const view = buildAsn1Tree(corrupted)
    assert.equal(typeof view.ok, 'boolean')
    assert.equal(view.totalLength, corrupted.length)
    if (view.ok) {
      checkInvariants(view, corrupted)
    } else {
      assert.equal(view.root, null)
      assert.deepEqual(view.flat, [])
      assert.equal(typeof view.error, 'string')
      assert.ok(view.error.length > 0)
    }
  }
})

test('i byte di imbottitura dopo il DER non sono un errore', () => {
  // Il /Contents di un PDF firmato e imbottito di zeri: se questo fosse un errore, il pannello
  // del CMS mostrerebbe un guasto proprio sul percorso felice.
  const imbottito = new Uint8Array(CMS.length + 8)
  imbottito.set(CMS, 0)

  const view = buildAsn1Tree(imbottito)
  assert.equal(view.ok, true)
  assert.equal(view.error, null)
  assert.equal(view.totalLength, CMS.length + 8)
  assert.equal(view.root.length, CMS.length)
  assert.equal(view.root.offset + view.root.length, CMS.length)
})

// ---------------------------------------------------------------------------
// Stabilita degli id
// ---------------------------------------------------------------------------

test('gli id sono stabili fra esecuzioni e seguono il percorso nell albero', () => {
  const primo = buildAsn1Tree(CERT)
  const secondo = buildAsn1Tree(CERT)

  const ids = (view) => view.flat.map((node) => node.id)
  assert.deepEqual(ids(primo), ids(secondo))
  assert.deepEqual(
    primo.flat.map((n) => [n.id, n.offset, n.length, n.tagLabel, n.valuePreview]),
    secondo.flat.map((n) => [n.id, n.offset, n.length, n.tagLabel, n.valuePreview]),
  )

  // Alcuni id fissati per iscritto: se la numerazione cambia, questo test lo dice.
  assert.equal(primo.root.id, '0')
  assert.equal(byId(primo, '0.0.2.0').oidLabel, 'sha256WithRSAEncryption')
  assert.equal(byId(primo, '0.0.6.0.0').oidLabel, 'rsaEncryption')
  assert.ok(byId(primo, '0.0.7'), 'le estensioni stanno in [3]')

  // Un id e sempre il percorso: id del padre, punto, indice del figlio.
  for (const node of primo.flat) {
    node.children.forEach((child, i) => {
      assert.equal(child.id, node.id + '.' + i)
      assert.equal(child.depth, node.depth + 1)
    })
  }

  // Gli id non dipendono dalla lunghezza del buffer che li contiene.
  const imbottito = new Uint8Array(CERT.length + 16)
  imbottito.set(CERT, 0)
  assert.deepEqual(ids(buildAsn1Tree(imbottito)), ids(primo))
})

test('flat contiene ogni nodo dell albero una volta sola', () => {
  for (const bytes of [CERT, CMS, RSA_PUBLIC]) {
    const view = buildAsn1Tree(bytes)
    let counted = 0
    const count = (node) => {
      counted++
      node.children.forEach(count)
    }
    count(view.root)
    assert.equal(counted, view.flat.length)
    assert.ok(view.flat.length >= 3)
  }

  // Il certificato e il CMS sono strutture profonde: se `flat` si sgonfia, qualcosa non scende.
  assert.ok(buildAsn1Tree(CERT).flat.length > 40)
  assert.ok(buildAsn1Tree(CMS).flat.length > 60)
})
