/**
 * Attrezzi comuni del collaudo avversariale sulla copertura.
 *
 * Nessuna funzione di src/core/ viene riscritta: qui si costruisce solo il materiale d attacco.
 * Tutto cio che viene dichiarato in un rilievo deve essere ricalcolabile da questo file.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateKeyPair } from '../../../src/core/keys.js'
import { buildSelfSigned } from '../../../src/core/certificate.js'
import { buildSignedData } from '../../../src/core/cms.js'
import {
  addPlaceholder,
  buildIncrementalUpdate,
  digestCovered,
  findFirstPageNumber,
  findObject,
  injectSignature,
  readTrailerInfo,
} from '../../../src/core/pades.js'
import { ascii, concat, fromAscii, indexOf, lastIndexOf, toHex } from '../../../src/core/bytes.js'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const OUT = join(HERE, 'out')
export const SAMPLE = new Uint8Array(readFileSync(join(HERE, '../../../src/assets/sample.pdf')))
export const TEMPO = new Date(Date.UTC(2026, 7, 10, 12, 0, 0))
export const PADDING = 4096

mkdirSync(OUT, { recursive: true })

export const testo = (bytes, start = 0, end = bytes.length) => fromAscii(bytes.subarray(start, end))

export function salva(nome, bytes) {
  writeFileSync(join(OUT, nome), bytes)
  return join(OUT, nome)
}

/** La catena vera, identica a quella della pagina. Ritorna tutto cio che serve agli attacchi. */
export async function firmaIlCampione(subjectCN = 'Lorenzo Rossi') {
  const pair = await generateKeyPair()
  const cert = await buildSelfSigned({ ...pair, subjectCN, now: TEMPO })
  const { pdfWithHole, byteRange, contentsStart } = addPlaceholder(SAMPLE, {
    padding: PADDING,
    signingTime: TEMPO,
  })
  const messageDigest = await digestCovered(pdfWithHole, byteRange)
  const { cmsDer, signedAttrsDer, signature } = await buildSignedData({
    messageDigest,
    certDer: cert.certDer,
    privateKey: pair.privateKey,
    signingTime: TEMPO,
  })
  const signed = injectSignature(pdfWithHole, contentsStart, cmsDer)
  return {
    signed,
    byteRange,
    contentsStart,
    contentsEnd: indexOf(signed, '>', contentsStart),
    cmsDer,
    signedAttrsDer,
    signature,
    messageDigest,
    certDer: cert.certDer,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
  }
}

/**
 * Appende al PDF una SECONDA firma completa, con chiavi e certificato dell aggressore.
 *
 * Non usa addPlaceholder perche quello rifiuta un catalogo che ha gia un /AcroForm — cioe un
 * documento gia firmato. Un aggressore non ha questo scrupolo: aggiunge il proprio campo alla
 * lista dei /Fields esistenti, esattamente come farebbe una seconda firma legittima.
 */
export async function appendiSecondaFirma(pdf, { subjectCN = 'Lorenzo Rossi', padding = 2048 } = {}) {
  const pair = await generateKeyPair()
  const cert = await buildSelfSigned({ ...pair, subjectCN, now: TEMPO })

  const info = readTrailerInfo(pdf)
  const sigNum = info.size
  const fieldNum = info.size + 1

  const catalog = findObject(pdf, info.rootNum)
  const catalogText = testo(pdf, catalog.start, catalog.end).replace(
    /\/Fields\s*\[([^\]]*)\]/,
    (_m, dentro) => `/Fields [${dentro.trim()} ${fieldNum} 0 R]`,
  )
  const pageNum = findFirstPageNumber(pdf, info.rootNum)
  const page = findObject(pdf, pageNum)
  const pageText = testo(pdf, page.start, page.end).replace(
    /\/Annots\s*\[([^\]]*)\]/,
    (_m, dentro) => `/Annots [${dentro.trim()} ${fieldNum} 0 R]`,
  )

  const holeLength = padding * 2 + 2
  const head = '/Contents '

  const costruisci = (byteRange) => {
    const sigText =
      `${sigNum} 0 obj\n` +
      '<< /Type /Sig\n' +
      '   /Filter /Adobe.PPKLite\n' +
      '   /SubFilter /ETSI.CAdES.detached\n' +
      `   /ByteRange [${byteRange.join(' ')}]\n` +
      `   ${head}<${'0'.repeat(padding * 2)}>\n` +
      "   /M (D:20260810120000+00'00')\n" +
      '>>\n' +
      'endobj\n'
    const fieldText =
      `${fieldNum} 0 obj\n` +
      '<< /Type /Annot\n   /Subtype /Widget\n   /FT /Sig\n   /T (Firma2)\n' +
      `   /Rect [0 0 0 0]\n   /F 132\n   /P ${pageNum} 0 R\n   /V ${sigNum} 0 R\n>>\n` +
      'endobj\n'
    const built = buildIncrementalUpdate(pdf, [
      { num: info.rootNum, text: catalogText + '\n' },
      { num: pageNum, text: pageText + '\n' },
      { num: sigNum, text: sigText },
      { num: fieldNum, text: fieldText },
    ])
    const contentsStart = built.objectOffsets.get(sigNum) + sigText.indexOf(head) + head.length
    return { bytes: built.bytes, contentsStart }
  }

  let byteRange = [0, 0, 0, 0]
  for (let pass = 0; pass < 8; pass++) {
    const { bytes, contentsStart } = costruisci(byteRange)
    const misurato = [
      0,
      contentsStart,
      contentsStart + holeLength,
      bytes.length - (contentsStart + holeLength),
    ]
    if (misurato.every((n, i) => n === byteRange[i])) {
      const messageDigest = await digestCovered(bytes, misurato)
      const { cmsDer } = await buildSignedData({
        messageDigest,
        certDer: cert.certDer,
        privateKey: pair.privateKey,
        signingTime: TEMPO,
      })
      return {
        bytes: injectSignature(bytes, contentsStart, cmsDer),
        byteRange: misurato,
        contentsStart,
        certDer: cert.certDer,
        subjectCN,
      }
    }
    byteRange = misurato
  }
  throw new Error('il /ByteRange della seconda firma non si stabilizza')
}

/** Sostituisce byte in posizione, senza cambiare la lunghezza del file. */
export function sovrascrivi(pdf, offset, nuovi) {
  const out = new Uint8Array(pdf)
  out.set(nuovi instanceof Uint8Array ? nuovi : ascii(nuovi), offset)
  return out
}

export { ascii, concat, fromAscii, indexOf, lastIndexOf, toHex }
