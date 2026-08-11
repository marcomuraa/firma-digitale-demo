import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toHex, fromHex, ascii, fromAscii, concat, equals,
  indexOf, lastIndexOf, indexesOf, isPrintable, printableChar, sha256,
} from './bytes.js'

test('toHex e fromHex si annullano a vicenda', () => {
  const b = new Uint8Array([0x00, 0x31, 0x7f, 0x80, 0xff])
  assert.equal(toHex(b), '00317f80ff')
  assert.equal(toHex(b, { separator: ' ' }), '00 31 7f 80 ff')
  assert.equal(toHex(b, { uppercase: true }), '00317F80FF')
  assert.ok(equals(fromHex(toHex(b)), b))
  assert.ok(equals(fromHex('00 31\n7f'), new Uint8Array([0, 0x31, 0x7f])))
})

test('fromHex rifiuta input malformato', () => {
  assert.throws(() => fromHex('abc'), /dispari/)
  assert.throws(() => fromHex('zz'), /non esadecimale/)
})

test('ascii rifiuta i caratteri accentati', () => {
  assert.ok(equals(ascii('1.000'), new Uint8Array([0x31, 0x2e, 0x30, 0x30, 0x30])))
  assert.throws(() => ascii('pagherò'), /non ASCII/)
})

test('fromAscii non decodifica UTF-8: un byte, un carattere', () => {
  assert.equal(fromAscii(new Uint8Array([0xc3, 0xa8])), 'Ã¨')
})

test('concat ed equals', () => {
  const a = new Uint8Array([1, 2])
  const b = new Uint8Array([3])
  assert.ok(equals(concat(a, b, new Uint8Array(0)), new Uint8Array([1, 2, 3])))
  assert.ok(!equals(a, new Uint8Array([1, 2, 3])))
  assert.ok(!equals(a, new Uint8Array([1, 3])))
})

test('indexOf trova stringhe ASCII e rispetta il punto di partenza', () => {
  const hay = ascii('mille euro (mille euro)')
  assert.equal(indexOf(hay, 'mille'), 0)
  assert.equal(indexOf(hay, 'mille', 1), 12)
  assert.equal(indexOf(hay, 'novemila'), -1)
  assert.equal(indexOf(hay, new Uint8Array(0)), -1)
  assert.equal(lastIndexOf(hay, 'mille'), 12)
  assert.deepEqual(indexesOf(hay, 'mille'), [0, 12])
})

test('la stampabilita segue il dump: spazio si, controllo no', () => {
  assert.ok(isPrintable(0x20) && isPrintable(0x7e))
  assert.ok(!isPrintable(0x1f) && !isPrintable(0x7f) && !isPrintable(0x80))
  assert.equal(printableChar(0x31), '1')
  assert.equal(printableChar(0x0a), '.')
})

test('sha256 su vettore noto', async () => {
  // SHA-256 della stringa vuota, valore di riferimento pubblico
  assert.equal(
    toHex(await sha256(new Uint8Array(0))),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
  assert.equal(
    toHex(await sha256(ascii('abc'))),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
})
