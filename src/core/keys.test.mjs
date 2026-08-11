import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { KEY_PARAMS, describePublicKey, exportPublicKeySpki, generateKeyPair } from './keys.js'
import { toHex } from './bytes.js'

/** Una sola coppia per tutto il file: generarne una per test costa secondi, non millisecondi. */
const pair = await generateKeyPair()

test('la coppia e RSASSA-PKCS1-v1_5 a 2048 bit con SHA-256', () => {
  for (const key of [pair.privateKey, pair.publicKey]) {
    assert.equal(key.algorithm.name, 'RSASSA-PKCS1-v1_5')
    assert.equal(key.algorithm.modulusLength, 2048)
    assert.equal(key.algorithm.hash.name, 'SHA-256')
    assert.deepEqual(new Uint8Array(key.algorithm.publicExponent), new Uint8Array([1, 0, 1]))
  }
  assert.equal(pair.privateKey.type, 'private')
  assert.equal(pair.publicKey.type, 'public')
  assert.deepEqual(pair.privateKey.usages, ['sign'])
  assert.deepEqual(pair.publicKey.usages, ['verify'])
})

test('le chiavi sono esportabili: la pagina deve poter mostrare la pubblica', () => {
  assert.equal(pair.publicKey.extractable, true)
  assert.equal(pair.privateKey.extractable, true)
})

test('KEY_PARAMS dichiara esattamente cio che la catena si aspetta', () => {
  assert.equal(KEY_PARAMS.name, 'RSASSA-PKCS1-v1_5')
  assert.equal(KEY_PARAMS.modulusLength, 2048)
  assert.equal(KEY_PARAMS.hash, 'SHA-256')
  assert.deepEqual(KEY_PARAMS.publicExponent, new Uint8Array([1, 0, 1]))
})

test('la coppia firma e verifica davvero', async () => {
  const message = new TextEncoder().encode('promessa di pagamento')
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' }, pair.privateKey, message,
  )
  assert.equal(signature.byteLength, 256) // 2048 bit
  assert.equal(
    await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, pair.publicKey, signature, message),
    true,
  )
  message[0] ^= 0x01
  assert.equal(
    await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, pair.publicKey, signature, message),
    false,
  )
})

test('la chiave pubblica esportata e un SubjectPublicKeyInfo che openssl legge', async () => {
  const spki = await exportPublicKeySpki(pair.publicKey)
  assert.ok(spki instanceof Uint8Array)
  assert.equal(spki[0], 0x30) // SEQUENCE: e DER, non JWK ne PEM
  assert.equal(spki.length, 294) // SPKI di una RSA 2048 con esponente 65537

  const dir = mkdtempSync(join(tmpdir(), 'firma-keys-'))
  const file = join(dir, 'public.der')
  writeFileSync(file, spki)
  const shown = execFileSync(
    'openssl', ['pkey', '-pubin', '-inform', 'DER', '-in', file, '-noout', '-text'],
    { encoding: 'utf8' },
  )
  assert.match(shown, /Public-Key: \(2048 bit\)/)
  assert.match(shown, /Exponent: 65537 \(0x10001\)/)
})

test('describePublicKey restituisce i due numeri che sono la chiave', async () => {
  const described = await describePublicKey(pair.publicKey)
  assert.equal(described.modulusBits, 2048)
  assert.equal(described.modulus.length, 256)
  assert.deepEqual(described.exponent, new Uint8Array([0x01, 0x00, 0x01]))
  // il modulo di una RSA 2048 ha sempre il bit piu alto acceso
  assert.ok(described.modulus[0] >= 0x80, 'modulo che comincia con ' + toHex(described.modulus.slice(0, 1)))
})

test('describePublicKey rifiuta una chiave che non e RSA', async () => {
  const ecPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  await assert.rejects(() => describePublicKey(ecPair.publicKey), /non e RSA/)
})

test('due coppie generate di seguito sono diverse', async () => {
  const other = await generateKeyPair()
  const a = toHex(await exportPublicKeySpki(pair.publicKey))
  const b = toHex(await exportPublicKeySpki(other.publicKey))
  assert.notEqual(a, b)
})
