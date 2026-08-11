import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as asn1js from 'asn1js'

import { CMS_OIDS, buildSignedData } from './cms.js'
import { buildSelfSigned } from './certificate.js'
import { generateKeyPair } from './keys.js'
import { concat, equals, indexOf, sha256, toHex } from './bytes.js'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Il PDF campione fa da contenuto: il suo SHA-256 e un valore documentato, non inventato qui. */
const CONTENT = new Uint8Array(readFileSync(join(HERE, '../assets/sample.pdf')))
const CONTENT_SHA256 = '8eb0f906ed51563c81f354f818e12dd3d561ff703fc4bb7d2b391b5e61e507a1'
const SIGNING_TIME = new Date('2026-08-10T09:15:30.750Z')

const pair = await generateKeyPair()
const cert = await buildSelfSigned({ ...pair, subjectCN: 'Lorenzo Rossi', now: SIGNING_TIME })
const messageDigest = await sha256(CONTENT)
const signed = await buildSignedData({
  messageDigest,
  certDer: cert.certDer,
  privateKey: pair.privateKey,
  signingTime: SIGNING_TIME,
})

const dir = mkdtempSync(join(tmpdir(), 'firma-cms-'))
const files = {
  content: join(dir, 'contenuto.bin'),
  contentAltered: join(dir, 'contenuto-manomesso.bin'),
  cms: join(dir, 'firma.p7s'),
  cmsWrongTag: join(dir, 'firma-tag-sbagliato.p7s'),
  certPem: join(dir, 'cert.pem'),
}
writeFileSync(files.content, CONTENT)
writeFileSync(files.cms, signed.cmsDer)
{
  const alterato = new Uint8Array(CONTENT)
  alterato[577] = 0x39 // '1' -> '9', l'attacco 1a sulla riga dell'importo
  writeFileSync(files.contentAltered, alterato)
}
{
  const derCert = join(dir, 'cert.der')
  writeFileSync(derCert, cert.certDer)
  writeFileSync(files.certPem, run(['x509', '-inform', 'DER', '-in', derCert, '-outform', 'PEM']).stdout)
}

/** openssl senza eccezioni: qui l'esito e il dato che interessa, anche quando e un fallimento. */
function run(args) {
  const r = spawnSync('openssl', args, { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/* ------------------------------------------------------------------------------------- */
/* Cio che deve esserci dentro la struttura                                                */
/* ------------------------------------------------------------------------------------- */

test('il contenuto di prova e proprio il PDF campione documentato', () => {
  assert.equal(toHex(messageDigest), CONTENT_SHA256)
  assert.equal(
    execFileSync('openssl', ['dgst', '-sha256', '-r', files.content], { encoding: 'utf8' }).split(' ')[0],
    CONTENT_SHA256,
  )
})

test('la busta esterna e un ContentInfo di tipo signedData', () => {
  assert.ok(signed.cmsDer instanceof Uint8Array)
  const contentInfo = asn1js.fromBER(signed.cmsDer).result
  assert.ok(contentInfo instanceof asn1js.Sequence)
  const [tipo, contenuto] = contentInfo.valueBlock.value
  assert.equal(tipo.valueBlock.toString(), CMS_OIDS.signedData)
  assert.equal(contenuto.idBlock.tagClass, 3) // [0] EXPLICIT
  assert.equal(contenuto.idBlock.tagNumber, 0)
})

test('e detached: encapContentInfo dichiara il tipo e non porta contenuto', () => {
  const encap = signedData().valueBlock.value[2]
  assert.equal(encap.valueBlock.value.length, 1, 'un eContent qui dentro romperebbe il detached')
  assert.equal(encap.valueBlock.value[0].valueBlock.toString(), CMS_OIDS.data)
})

test('il certificato del firmatario viaggia dentro la firma', () => {
  const certificates = signedData().valueBlock.value[3]
  assert.equal(certificates.idBlock.tagClass, 3)
  assert.equal(certificates.idBlock.tagNumber, 0)
  assert.equal(certificates.valueBlock.value.length, 1)
  assert.ok(
    equals(new Uint8Array(certificates.valueBlock.value[0].toBER(false)), cert.certDer),
    'il certificato incluso deve essere identico byte per byte a quello costruito',
  )
})

test('gli attributi firmati sono i quattro previsti dal profilo PAdES', () => {
  const oids = attributes().map((a) => a.valueBlock.value[0].valueBlock.toString())
  assert.deepEqual(
    [...oids].sort(),
    [
      CMS_OIDS.signingCertificateV2, // 1.2.840.113549.1.9.16.2.47
      CMS_OIDS.contentType, // 1.2.840.113549.1.9.3
      CMS_OIDS.messageDigest, // 1.2.840.113549.1.9.4
      CMS_OIDS.signingTime, // 1.2.840.113549.1.9.5
    ].sort(),
  )
})

test('messageDigest contiene esattamente il digest ricevuto', () => {
  const valore = attributeValue(CMS_OIDS.messageDigest)
  assert.ok(equals(new Uint8Array(valore.valueBlock.valueHexView), messageDigest))
})

test('contentType dice id-data e signingTime e una UTCTime al secondo', () => {
  assert.equal(attributeValue(CMS_OIDS.contentType).valueBlock.toString(), CMS_OIDS.data)
  const tempo = attributeValue(CMS_OIDS.signingTime)
  assert.equal(tempo.idBlock.tagNumber, 23) // UTCTime
  assert.equal(tempo.toDate().toISOString(), '2026-08-10T09:15:30.000Z')
})

test('signing-certificate-v2 porta lo SHA-256 del certificato e ne cita emittente e seriale', async () => {
  const seq = attributeValue(CMS_OIDS.signingCertificateV2)
  const essCertIDv2 = seq.valueBlock.value[0].valueBlock.value[0]

  // hashAlgorithm omesso: in DER un campo uguale al proprio default non si codifica
  const [certHash, issuerSerial] = essCertIDv2.valueBlock.value
  assert.ok(certHash instanceof asn1js.OctetString, 'primo campo: certHash, non hashAlgorithm')
  assert.ok(
    equals(new Uint8Array(certHash.valueBlock.valueHexView), await sha256(cert.certDer)),
  )

  const [generalNames, serialNumber] = issuerSerial.valueBlock.value
  const directoryName = generalNames.valueBlock.value[0]
  assert.equal(directoryName.idBlock.tagNumber, 4) // GeneralName [4] directoryName
  const issuerDelCert = asn1js.fromBER(cert.certDer).result.valueBlock.value[0].valueBlock.value[3]
  assert.ok(
    equals(
      new Uint8Array(directoryName.valueBlock.value[0].toBER(false)),
      new Uint8Array(issuerDelCert.toBER(false)),
    ),
    'l emittente citato deve essere identico byte per byte a quello del certificato',
  )
  assert.equal(
    toHex(new Uint8Array(serialNumber.valueBlock.valueHexView)).replace(/^0+/, ''),
    cert.serial.replace(/^0+/, ''),
  )
})

test('gli algoritmi sono SHA-256 e RSASSA-PKCS1-v1_5', () => {
  const digestAlgs = signedData().valueBlock.value[1]
  assert.equal(digestAlgs.valueBlock.value.length, 1)
  const alg = digestAlgs.valueBlock.value[0]
  assert.equal(alg.valueBlock.value[0].valueBlock.toString(), CMS_OIDS.sha256)
  assert.equal(alg.valueBlock.value.length, 1, 'RFC 5754: parametri assenti per SHA-2, non NULL')

  const si = signerInfo().valueBlock.value
  assert.equal(si[2].valueBlock.value[0].valueBlock.toString(), CMS_OIDS.sha256)
  assert.equal(si[4].valueBlock.value[0].valueBlock.toString(), CMS_OIDS.rsaEncryption)
  assert.ok(si[4].valueBlock.value[1] instanceof asn1js.Null, 'PKCS#1 vuole i parametri NULL')
  assert.equal(new Uint8Array(si[5].valueBlock.valueHexView).length, 256) // RSA 2048
})

/* ------------------------------------------------------------------------------------- */
/* Il punto che fa la differenza: SET esplicito, non [0] implicito                          */
/* ------------------------------------------------------------------------------------- */

test('i byte firmati portano il tag SET (0x31), non il tag implicito [0] (0xa0)', () => {
  assert.equal(signed.signedAttrsDer[0], 0x31)

  const implicito = signerInfo().valueBlock.value[3]
  assert.equal(implicito.idBlock.tagClass, 3)
  assert.equal(implicito.idBlock.tagNumber, 0)

  // stesso contenuto, un solo byte di differenza: il tag
  const dentroAlCms = new Uint8Array(signed.signedAttrsDer)
  dentroAlCms[0] = 0xa0
  assert.notEqual(
    indexOf(signed.cmsDer, dentroAlCms), -1,
    'nel CMS gli attributi devono comparire con 0xa0 e contenuto identico',
  )
  assert.equal(indexOf(signed.cmsDer, signed.signedAttrsDer), -1, 'il SET non compare nel file')
})

test('gli attributi sono ordinati come vuole DER per un SET OF', () => {
  const codifiche = attributes().map((a) => new Uint8Array(a.toBER(false)))
  const ordinate = [...codifiche].sort((a, b) => {
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]
    return a.length - b.length
  })
  assert.deepEqual(codifiche.map(toHex), ordinate.map(toHex))
})

test('la firma RSA verifica sui byte con tag SET e fallisce su quelli con tag [0]', async () => {
  const publicKey = await crypto.subtle.importKey(
    'spki', await crypto.subtle.exportKey('spki', pair.publicKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
  )
  const conSet = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' }, publicKey, signed.signature, signed.signedAttrsDer,
  )
  assert.equal(conSet, true)

  const conTagImplicito = new Uint8Array(signed.signedAttrsDer)
  conTagImplicito[0] = 0xa0
  const conA0 = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' }, publicKey, signed.signature, conTagImplicito,
  )
  assert.equal(conA0, false, 'un solo byte di tag cambia i byte firmati')
})

/* ------------------------------------------------------------------------------------- */
/* La prova che non si puo saltare: openssl                                                */
/* ------------------------------------------------------------------------------------- */

test('openssl asn1parse legge la struttura senza errori', () => {
  const r = run(['asn1parse', '-inform', 'DER', '-i', '-in', files.cms])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /OBJECT\s+:pkcs7-signedData/)
  assert.match(r.stdout, /OBJECT\s+:contentType/)
  assert.match(r.stdout, /OBJECT\s+:messageDigest/)
  assert.match(r.stdout, /OBJECT\s+:signingTime/)
  assert.match(r.stdout, /OBJECT\s+:id-smime-aa-signingCertificateV2/)
  assert.doesNotMatch(r.stdout, /Error/)
})

test('openssl riconosce il SignedData e ne stampa i pezzi', () => {
  const r = run(['cms', '-inform', 'DER', '-in', files.cms, '-cmsout', '-noout', '-print'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /contentType: pkcs7-signedData/)
  assert.match(r.stdout, /eContentType: pkcs7-data/)
  assert.match(r.stdout, /eContent: <ABSENT>/) // detached: nessun contenuto incapsulato
  assert.match(r.stdout, /signedAttrs:/)
  assert.match(r.stdout, /object: id-smime-aa-signingCertificateV2/)
  assert.match(r.stdout, /digestAlgorithm:\s*\n\s*algorithm: sha256/)
})

/**
 * `-binary` non e un dettaglio: senza, openssl tratta il contenuto come testo e converte i fine
 * riga prima di calcolarne l'impronta. Su un PDF cambierebbe i byte, e il digest non tornerebbe.
 * `-noverify` salta la catena di fiducia, che per un autofirmato non porta da nessuna parte:
 * qui si sta verificando la firma, non l'identita.
 */
const VERIFICA = ['cms', '-verify', '-binary', '-inform', 'DER', '-in', files.cms]

test('openssl cms -verify accetta la firma sul contenuto giusto', () => {
  const r = run([
    ...VERIFICA,
    '-content', files.content, '-certfile', files.certPem, '-noverify', '-out', '/dev/null',
  ])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stderr, /Verification successful/)
})

test('openssl cms -verify -cades approva anche signing-certificate-v2', () => {
  // -cades non ammette -noverify: pretende di controllare anche il certificato. Glielo si da
  // come radice fidata — e quanto vale un autofirmato: fidato solo perche lo si e dichiarato.
  const r = run([
    ...VERIFICA, '-cades',
    '-content', files.content, '-CAfile', files.certPem, '-partial_chain', '-out', '/dev/null',
  ])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stderr, /Verification successful/)
})

test('un solo byte cambiato nel contenuto e openssl rifiuta la firma', () => {
  const r = run([
    ...VERIFICA,
    '-content', files.contentAltered, '-certfile', files.certPem, '-noverify', '-out', '/dev/null',
  ])
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /digest failure|verification failure|Verification failure/)
})

test('firmando il tag implicito invece del SET, openssl rifiuta: e l errore classico', async () => {
  const conTagImplicito = new Uint8Array(signed.signedAttrsDer)
  conTagImplicito[0] = 0xa0
  const firmaSbagliata = new Uint8Array(
    await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, pair.privateKey, conTagImplicito),
  )
  const at = indexOf(signed.cmsDer, signed.signature)
  assert.notEqual(at, -1)
  const rotto = concat(
    signed.cmsDer.subarray(0, at), firmaSbagliata, signed.cmsDer.subarray(at + signed.signature.length),
  )
  assert.equal(rotto.length, signed.cmsDer.length) // stessa lunghezza: il DER resta valido
  writeFileSync(files.cmsWrongTag, rotto)

  const struttura = run(['asn1parse', '-inform', 'DER', '-i', '-in', files.cmsWrongTag])
  assert.equal(struttura.status, 0, 'la struttura resta leggibile: il difetto e solo nella firma')

  const r = run([
    'cms', '-verify', '-binary', '-inform', 'DER', '-in', files.cmsWrongTag,
    '-content', files.content, '-certfile', files.certPem, '-noverify', '-out', '/dev/null',
  ])
  assert.notEqual(r.status, 0, 'openssl avrebbe dovuto rifiutare questa firma')
  assert.match(r.stderr, /verification failure|Verification failure|signature failure/)
})

/* ------------------------------------------------------------------------------------- */
/* Ingressi malformati                                                                     */
/* ------------------------------------------------------------------------------------- */

test('un digest della lunghezza sbagliata viene respinto subito', async () => {
  const base = { certDer: cert.certDer, privateKey: pair.privateKey, signingTime: SIGNING_TIME }
  await assert.rejects(() => buildSignedData({ ...base, messageDigest: new Uint8Array(20) }), /32 byte/)
  await assert.rejects(() => buildSignedData({ ...base, messageDigest: 'abc' }), /Uint8Array/)
  await assert.rejects(
    () => buildSignedData({ messageDigest, certDer: cert.certDer, privateKey: null }),
    /chiave privata/,
  )
  await assert.rejects(
    () => buildSignedData({ messageDigest, certDer: new Uint8Array([1, 2, 3]), privateKey: pair.privateKey }),
    /DER illeggibile|malformato/,
  )
  await assert.rejects(
    () => buildSignedData({ ...base, messageDigest, signingTime: 'ieri' }),
    /Date valida/,
  )
})

/* ------------------------------------------------------------------------------------- */
/* Scorciatoie di lettura della struttura                                                  */
/* ------------------------------------------------------------------------------------- */

function signedData() {
  return asn1js.fromBER(signed.cmsDer).result.valueBlock.value[1].valueBlock.value[0]
}

function signerInfo() {
  return signedData().valueBlock.value[4].valueBlock.value[0]
}

function attributes() {
  return signerInfo().valueBlock.value[3].valueBlock.value
}

function attributeValue(oid) {
  const found = attributes().find((a) => a.valueBlock.value[0].valueBlock.toString() === oid)
  assert.ok(found, 'attributo ' + oid + ' assente')
  return found.valueBlock.value[1].valueBlock.value[0]
}
