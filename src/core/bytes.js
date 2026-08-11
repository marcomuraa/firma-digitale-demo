/**
 * Utilita sui byte, condivise da tutta la catena.
 *
 * Sta qui, e non dentro un modulo di firma, perche la catena crypto e la catena PDF ne hanno
 * bisogno entrambe: senza un posto solo dove vivono, due implementazioni divergono e i byte
 * cominciano a non tornare proprio dove tornare conta.
 *
 * Regole: nessun import (ne di node ne del browser), nessuno stato, funzioni pure.
 * L'unica dipendenza e WebCrypto, che esiste identica nel browser e in node dalla 18.
 */

const HEX = '0123456789abcdef'

/** Byte -> stringa esadecimale minuscola. `separator` serve ai dump leggibili. */
export function toHex(bytes, { separator = '', uppercase = false } = {}) {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    if (i > 0 && separator) out += separator
    out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15]
  }
  return uppercase ? out.toUpperCase() : out
}

/** Stringa esadecimale -> byte. Ignora spazi e a capo; rifiuta tutto il resto. */
export function fromHex(hex) {
  const clean = hex.replace(/[\s\n\r\t]/g, '')
  if (clean.length % 2 !== 0) throw new Error('esadecimale di lunghezza dispari')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error('carattere non esadecimale a ' + i * 2)
    out[i] = byte
  }
  return out
}

/**
 * Testo ASCII -> byte. Lancia se il testo esce dall'ASCII.
 * Il rifiuto e voluto: il PDF campione e ASCII puro per scelta, e un accento che ci finisce
 * dentro di straforo si manifesterebbe molto piu tardi, come offset sbagliato.
 */
export function ascii(text) {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code > 0x7f) throw new Error('carattere non ASCII "' + text[i] + '" in posizione ' + i)
    out[i] = code
  }
  return out
}

/** Byte -> testo, un byte un carattere. Non decodifica UTF-8: e voluto, qui i byte sono byte. */
export function fromAscii(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}

/** Concatena piu Uint8Array in uno nuovo. */
export function concat(...parts) {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** Uguaglianza byte a byte. */
export function equals(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Prima occorrenza di `needle` (byte o stringa ASCII) in `haystack`, oppure -1. */
export function indexOf(haystack, needle, from = 0) {
  const pat = typeof needle === 'string' ? ascii(needle) : needle
  if (pat.length === 0) return -1
  const last = haystack.length - pat.length
  outer: for (let i = Math.max(0, from); i <= last; i++) {
    for (let j = 0; j < pat.length; j++) if (haystack[i + j] !== pat[j]) continue outer
    return i
  }
  return -1
}

/** Ultima occorrenza di `needle`, oppure -1. Serve a trovare l'ultimo `startxref` di un file. */
export function lastIndexOf(haystack, needle) {
  const pat = typeof needle === 'string' ? ascii(needle) : needle
  if (pat.length === 0) return -1
  outer: for (let i = haystack.length - pat.length; i >= 0; i--) {
    for (let j = 0; j < pat.length; j++) if (haystack[i + j] !== pat[j]) continue outer
    return i
  }
  return -1
}

/** Tutte le occorrenze di `needle`. Serve a dimostrare che un bersaglio d'attacco e unico. */
export function indexesOf(haystack, needle) {
  const found = []
  let at = 0
  for (;;) {
    const i = indexOf(haystack, needle, at)
    if (i === -1) return found
    found.push(i)
    at = i + 1
  }
}

/** true se il byte si vede in un dump senza rovinare l'allineamento (spazio compreso). */
export function isPrintable(byte) {
  return byte >= 0x20 && byte <= 0x7e
}

/** Il carattere da mostrare in un dump: quello vero, oppure un punto. */
export function printableChar(byte) {
  return isPrintable(byte) ? String.fromCharCode(byte) : '.'
}

/** SHA-256. Ritorna byte, non esadecimale: chi vuole la stringa chiama `toHex`. */
export async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return new Uint8Array(digest)
}
