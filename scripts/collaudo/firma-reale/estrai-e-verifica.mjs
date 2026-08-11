/**
 * Collaudo avversariale — verifica RSA «a mano», senza il nostro codice.
 *
 * Gli offset dei pezzi non li chiediamo ad asn1js (che e la libreria che li ha scritti): li
 * leggiamo dall'output di `openssl asn1parse`, cioe da un parser che non ha mai visto questo
 * progetto. Poi ricostruiamo i byte che RSA deve aver firmato — il SET (0x31) degli attributi
 * firmati, non il tag implicito [0] (0xa0) — e chiediamo a `openssl dgst -verify` se tornano.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'out')
const cmsPath = join(OUT, 'cms-dal-pdf.der')
const cms = readFileSync(cmsPath)

const dump = execFileSync('openssl', ['asn1parse', '-inform', 'DER', '-i', '-in', cmsPath], {
  encoding: 'utf8',
})

/** Una riga di asn1parse: "  979:d=5  hl=3 l= 243 cons:      cont [ 0 ]" */
const rows = []
for (const line of dump.split('\n')) {
  const m = /^\s*(\d+):d=(\d+)\s+hl=\s*(\d+)\s+l=\s*(\d+)\s+(cons|prim):\s*(.*)$/.exec(line)
  if (m) {
    rows.push({
      off: Number(m[1]),
      depth: Number(m[2]),
      hl: Number(m[3]),
      len: Number(m[4]),
      kind: m[5],
      label: m[6].trim(),
    })
  }
}

const fail = (msg) => {
  console.error('COLLAUDO FALLITO: ' + msg)
  process.exit(1)
}

// Il SignerInfo: l'ultimo SET di livello d=3 contiene i SignerInfo (d=4).
// Gli attributi firmati sono il cont [ 0 ] di livello d=5 che CONTIENE l'OID messageDigest.
const mdRow = rows.find((r) => r.label.includes('messageDigest'))
if (!mdRow) fail('nel CMS non c e nessun attributo messageDigest')
const signedAttrs = rows
  .filter((r) => r.label.startsWith('cont [ 0 ]') && r.off < mdRow.off && r.off + r.hl + r.len > mdRow.off)
  .pop()
if (!signedAttrs) fail('non trovo il blocco [0] degli attributi firmati che contenga messageDigest')

// La firma: l'ultima OCTET STRING di livello d=5 dentro il SignerInfo, dopo gli attributi.
const sigRow = rows.filter((r) => r.label.startsWith('OCTET STRING') && r.off > signedAttrs.off).pop()
if (!sigRow) fail('non trovo la OCTET STRING della firma')

// --- i byte firmati: stessa sequenza, tag rimesso a SET ----------------------------------
const attrs = Buffer.from(cms.subarray(signedAttrs.off, signedAttrs.off + signedAttrs.hl + signedAttrs.len))
if (attrs[0] !== 0xa0) fail(`gli attributi firmati non hanno il tag implicito 0xa0 ma 0x${attrs[0].toString(16)}`)
const asSet = Buffer.from(attrs)
asSet[0] = 0x31
writeFileSync(join(OUT, 'signedattrs-implicito-a0.der'), attrs)
writeFileSync(join(OUT, 'signedattrs-set-31.der'), asSet)

// --- la firma RSA nuda -------------------------------------------------------------------
const sig = Buffer.from(cms.subarray(sigRow.off + sigRow.hl, sigRow.off + sigRow.hl + sigRow.len))
writeFileSync(join(OUT, 'signature-dal-pdf.bin'), sig)

// --- il messageDigest dichiarato ---------------------------------------------------------
const mdOctet = rows.find((r) => r.off > mdRow.off && r.label.startsWith('OCTET STRING'))
const declared = /\[HEX DUMP\]:([0-9A-F]+)/.exec(mdOctet.label)
if (!declared) fail('non riesco a leggere il valore di messageDigest')
writeFileSync(join(OUT, 'messagedigest-dichiarato.hex'), declared[1].toLowerCase() + '\n')

console.log(
  JSON.stringify(
    {
      offsetAttributiFirmati: signedAttrs.off,
      lunghezzaAttributiFirmati: signedAttrs.hl + signedAttrs.len,
      tagOriginale: '0x' + attrs[0].toString(16),
      offsetFirma: sigRow.off,
      lunghezzaFirma: sig.length,
      messageDigestDichiarato: declared[1].toLowerCase(),
      // controprova: gli stessi byte che il nostro cms.js dice di aver firmato
      coincideConSignedAttrsDellaCatena: asSet.equals(readFileSync(join(OUT, 'signedattrs-dalla-catena.der'))),
      coincideConLaFirmaDellaCatena: sig.equals(readFileSync(join(OUT, 'signature-dalla-catena.bin'))),
    },
    null,
    2,
  ),
)
