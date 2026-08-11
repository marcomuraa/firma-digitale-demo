/**
 * La coppia di chiavi.
 *
 * Primo anello della catena: senza una chiave privata non c'e firma, e senza la corrispondente
 * chiave pubblica non c'e certificato. Qui non si inventa niente di crittografico — si chiede a
 * WebCrypto una coppia RSA e la si espone nel formato che serve al resto della catena.
 *
 * Vincolo d'ambiente: questo modulo gira nel browser. Nessun import di node, nessun `Buffer`:
 * solo `globalThis.crypto`, che nel browser e in node e la stessa identica API.
 */

/**
 * I parametri della coppia, in un posto solo.
 *
 * RSASSA-PKCS1-v1_5 con SHA-256 e modulo 2048 non e una scelta di gusto: e cio che il
 * certificato dichiarera come `sha256WithRSAEncryption` e cio che il CMS dichiarera come
 * `rsaEncryption`. Se questi parametri cambiano qui, cambiano gli OID la dentro, e la firma
 * smette di essere quella che la pagina racconta.
 */
export const KEY_PARAMS = Object.freeze({
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([0x01, 0x00, 0x01]), // 65537, l'esponente pubblico di prammatica
  hash: 'SHA-256',
})

/**
 * Genera la coppia RSA della demo.
 *
 * `extractable: true` e deliberato: la pagina deve poter mostrare la chiave pubblica, byte per
 * byte, altrimenti il pannello «ecco cosa verifica chi verifica» non ha niente da mostrare.
 * In una firma vera la chiave privata sta su un dispositivo e non esce mai — qui esce perche
 * qui non c'e niente da proteggere, ed e un punto che vale la pena dire ad alta voce.
 *
 * @returns {Promise<{ privateKey: CryptoKey, publicKey: CryptoKey }>}
 */
export async function generateKeyPair() {
  const pair = await globalThis.crypto.subtle.generateKey(KEY_PARAMS, true, ['sign', 'verify'])
  return { privateKey: pair.privateKey, publicKey: pair.publicKey }
}

/**
 * Chiave pubblica in DER, formato SubjectPublicKeyInfo.
 *
 * WebCrypto esporta gia esattamente la struttura che il certificato X.509 si aspetta nel campo
 * `subjectPublicKeyInfo`: algoritmo piu chiave, imbustati in ASN.1. Non va ricostruita a mano —
 * ricostruirla significherebbe reimplementare (male) cio che il browser gia fa.
 *
 * @param {CryptoKey} publicKey
 * @returns {Promise<Uint8Array>} DER del SubjectPublicKeyInfo
 */
export async function exportPublicKeySpki(publicKey) {
  const spki = await globalThis.crypto.subtle.exportKey('spki', publicKey)
  return new Uint8Array(spki)
}

/**
 * I due numeri che *sono* la chiave pubblica RSA: modulo ed esponente.
 *
 * Serve alla pagina, non alla firma: mostrare i 256 byte del modulo accanto ai 3 byte
 * dell'esponente rende concreto che una chiave pubblica e un numero, non un file magico.
 *
 * @param {CryptoKey} publicKey
 * @returns {Promise<{ modulusBits: number, modulus: Uint8Array, exponent: Uint8Array }>}
 */
export async function describePublicKey(publicKey) {
  const jwk = await globalThis.crypto.subtle.exportKey('jwk', publicKey)
  if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
    throw new Error('la chiave pubblica non e RSA: mancano modulo o esponente')
  }
  const modulus = fromBase64Url(jwk.n)
  return { modulusBits: modulus.length * 8, modulus, exponent: fromBase64Url(jwk.e) }
}

/**
 * base64url -> byte. Sta qui e non in bytes.js perche e un dettaglio del formato JWK, e JWK
 * si affaccia solo da questa parte della catena.
 */
function fromBase64Url(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = globalThis.atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
