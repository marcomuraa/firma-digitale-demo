import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as asn1js from 'asn1js'

import { buildSelfSigned } from './certificate.js'
import { generateKeyPair } from './keys.js'
import { fromHex, toHex } from './bytes.js'

const SUBJECT_CN = 'Lorenzo Rossi'
/** Istante fisso: cosi le date scritte nel DER sono prevedibili e confrontabili a mano. */
const NOW = new Date('2026-08-10T09:15:30.750Z')

const pair = await generateKeyPair()
const built = await buildSelfSigned({ ...pair, subjectCN: SUBJECT_CN, now: NOW })

const dir = mkdtempSync(join(tmpdir(), 'firma-cert-'))
const derFile = join(dir, 'cert.der')
const pemFile = join(dir, 'cert.pem')
writeFileSync(derFile, built.certDer)
writeFileSync(pemFile, openssl(['x509', '-inform', 'DER', '-in', derFile, '-outform', 'PEM']))

/** Lancia openssl e restituisce l'uscita; se openssl si lamenta, il test deve fallire. */
function openssl(args) {
  return execFileSync('openssl', args, { encoding: 'utf8' })
}

const text = openssl(['x509', '-inform', 'DER', '-in', derFile, '-noout', '-text'])

test('openssl legge il DER senza protestare', () => {
  assert.ok(built.certDer instanceof Uint8Array)
  assert.equal(built.certDer[0], 0x30)
  assert.match(text, /Certificate:/)
  assert.match(text, /Version: 3 \(0x2\)/)
})

test('emittente e soggetto coincidono: e questo che vuol dire autofirmato', () => {
  const subject = openssl(['x509', '-inform', 'DER', '-in', derFile, '-noout', '-subject']).trim()
  const issuer = openssl(['x509', '-inform', 'DER', '-in', derFile, '-noout', '-issuer']).trim()
  assert.equal(subject, 'subject=CN=' + SUBJECT_CN)
  assert.equal(issuer, 'issuer=CN=' + SUBJECT_CN)
  assert.equal(subject.slice('subject'.length), issuer.slice('issuer'.length))
})

test('la firma sul certificato e sha256WithRSAEncryption', () => {
  const occorrenze = text.match(/Signature Algorithm: sha256WithRSAEncryption/g)
  assert.equal(occorrenze.length, 2) // una nel TBS, una fuori: devono coincidere
})

test('openssl verifica la firma del certificato su se stesso', () => {
  const out = openssl([
    'verify', '-no-CApath', '-no-CAstore', '-check_ss_sig', '-CAfile', pemFile, pemFile,
  ])
  assert.match(out, /: OK/)
})

test('anche WebCrypto verifica la firma, senza passare da openssl', async () => {
  const cert = asn1js.fromBER(built.certDer).result
  const [tbs, , signatureBitString] = cert.valueBlock.value
  const spki = tbs.valueBlock.value[6]
  const publicKey = await crypto.subtle.importKey(
    'spki', spki.toBER(false), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
  )
  const ok = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    publicKey,
    signatureBitString.valueBlock.valueHexView,
    tbs.toBER(false),
  )
  assert.equal(ok, true, 'la firma deve coprire esattamente i byte del TBSCertificate')
})

test('il seriale e casuale, positivo e coincide con quello che openssl legge', async () => {
  assert.match(built.serial, /^[0-9a-f]{32}$/)
  const primoByte = fromHex(built.serial)[0]
  assert.ok(primoByte > 0 && primoByte < 0x80, 'primo byte del seriale: ' + primoByte)

  const letto = openssl(['x509', '-inform', 'DER', '-in', derFile, '-noout', '-serial']).trim()
  assert.equal(letto, 'serial=' + built.serial.toUpperCase())

  const altro = await buildSelfSigned({ ...pair, subjectCN: SUBJECT_CN })
  assert.notEqual(altro.serial, built.serial)
})

test('la validita dura un anno e le date restituite sono quelle scritte nel DER', () => {
  assert.equal(built.notBefore.toISOString(), '2026-08-10T09:15:30.000Z') // millisecondi troncati
  assert.equal(built.notAfter.toISOString(), '2027-08-10T09:15:30.000Z')
  const date = openssl(['x509', '-inform', 'DER', '-in', derFile, '-noout', '-dates'])
  assert.match(date, /notBefore=Aug 10 09:15:30 2026 GMT/)
  assert.match(date, /notAfter=Aug 10 09:15:30 2027 GMT/)
})

test('basicConstraints dice che non e una CA, ed e critica', () => {
  assert.match(text, /X509v3 Basic Constraints: critical\n\s+CA:FALSE/)
})

test('keyUsage accende digitalSignature e nonRepudiation, e solo quelli', () => {
  assert.match(text, /X509v3 Key Usage: critical\n\s+Digital Signature, Non Repudiation\n/)
})

test('subjectKeyIdentifier c e, non e critico, ed e lungo 20 byte', async () => {
  const riga = text.match(/X509v3 Subject Key Identifier: *\n\s+([0-9A-F:]+)/)
  assert.ok(riga, 'estensione assente')
  assert.ok(!/X509v3 Subject Key Identifier: critical/.test(text))
  const ski = fromHex(riga[1].replace(/:/g, ''))
  assert.equal(ski.length, 20)

  // RFC 7093 metodo 1: i 160 bit piu a sinistra di SHA-256 sulla chiave pubblica
  const cert = asn1js.fromBER(built.certDer).result
  const spki = cert.valueBlock.value[0].valueBlock.value[6]
  const bits = new Uint8Array(spki.valueBlock.value[1].valueBlock.valueHexView)
  const atteso = new Uint8Array(await crypto.subtle.digest('SHA-256', bits)).slice(0, 20)
  assert.equal(toHex(ski), toHex(atteso))
})

test('non ci sono estensioni oltre le tre dichiarate', () => {
  const estensioni = text.match(/^ {12}X509v3 [^\n]+$/gm)
  assert.equal(estensioni.length, 3, estensioni.join(' | '))
})

test('il CN e un parametro, non un valore cablato', async () => {
  const altro = await buildSelfSigned({ ...pair, subjectCN: '  Mario Bianchi  ' })
  const file = join(dir, 'altro.der')
  writeFileSync(file, altro.certDer)
  const subject = openssl(['x509', '-inform', 'DER', '-in', file, '-noout', '-subject']).trim()
  assert.equal(subject, 'subject=CN=Mario Bianchi') // gli spazi ai bordi sono tolti
})

test('un CN insensato viene respinto subito, non a valle', async () => {
  await assert.rejects(() => buildSelfSigned({ ...pair, subjectCN: '   ' }), /non puo essere vuoto/)
  await assert.rejects(() => buildSelfSigned({ ...pair, subjectCN: 42 }), /deve essere una stringa/)
  await assert.rejects(() => buildSelfSigned({ ...pair, subjectCN: 'x'.repeat(65) }), /64 caratteri/)
  await assert.rejects(
    () => buildSelfSigned({ publicKey: pair.publicKey, subjectCN: SUBJECT_CN }),
    /chiave pubblica sia la privata/,
  )
})
