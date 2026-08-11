/**
 * Costruttore di firme PAdES con un /ByteRange QUALUNQUE.
 *
 * addPlaceholder di pades.js sa scrivere solo il /ByteRange canonico [0 cs ce+1 d]: quattro numeri,
 * separati da spazi, nell'ordine giusto. Ma la specifica PDF (ISO 32000, tabella dei tipi) descrive
 * il ByteRange come «un array di COPPIE di interi», e un numero PDF ammette segno, zeri iniziali,
 * spazi multipli, a capo e commenti `%` fra un token e l'altro. Per attaccare la LETTURA di quei
 * numeri — la regexp di readSignatureField e il conto di coverageOf — mi serve poter firmare un
 * documento VERO il cui /ByteRange sia scritto in una qualunque di quelle forme legali (o illegali).
 *
 * Da qui questo modulo: costruisce un incremental update di firma identico a quello della demo
 * (dizionario /Type /Sig, widget, /AcroForm registrato — cosi pdfsig la vede davvero), ma:
 *
 *   - il TESTO fra le parentesi quadre del /ByteRange lo decide chi chiama (`testoBR`), quindi puo
 *     contenere sei numeri, byte NUL al posto degli spazi, un commento, un segno +, quel che vuole;
 *   - i byte su cui si calcola l'impronta li decide chi chiama (`intervalli`), quindi la firma resta
 *     matematicamente vera anche quando copre il file con tre intervalli invece di due.
 *
 * Il /ByteRange sposta se stesso: la lunghezza del suo testo cambia dove cade il buco /Contents, che
 * cambia i numeri, che cambiano il testo. E lo stesso punto fisso di addPlaceholder, risolto qui in
 * modo generico partendo dal file piu corto e lasciando crescere la lunghezza finche si stabilizza.
 *
 * Niente di src/core/ viene riscritto: si importano i mattoni e basta. La catena crypto e IDENTICA a
 * quella della pagina, cosi la firma che produco e indistinguibile da una legittima — tranne nel
 * punto che sto attaccando.
 */

import { generateKeyPair } from '../../../src/core/keys.js'
import { buildSelfSigned } from '../../../src/core/certificate.js'
import { buildSignedData } from '../../../src/core/cms.js'
import {
  buildIncrementalUpdate,
  findFirstPageNumber,
  findObject,
  injectSignature,
  readTrailerInfo,
} from '../../../src/core/pades.js'
import { ascii, concat, fromAscii, indexOf, sha256, toHex } from '../../../src/core/bytes.js'

const LT = 0x3c // '<'
const TEMPO = new Date(Date.UTC(2026, 7, 10, 12, 0, 0))

/** Inserisce una voce in fondo a un dizionario, prima del suo `>>` di chiusura di primo livello. */
function conVoceInDizionario(objectText, voce) {
  const close = objectText.lastIndexOf('>>')
  if (close === -1) throw new Error('oggetto senza dizionario da estendere')
  return objectText.slice(0, close) + '   ' + voce + '\n' + objectText.slice(close)
}

/** Le coppie (offset, lunghezza) di un array di numeri: [n0 n1 n2 n3 ...] -> [[n0,n1],[n2,n3],...]. */
export function coppieDi(nums) {
  const out = []
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]])
  return out
}

/**
 * Firma il campione con un /ByteRange su misura.
 *
 * @param {Uint8Array} pdfBase   il PDF da firmare (di norma sample.pdf)
 * @param {object} opts
 * @param {(cs:number, ce:number, len:number) => number[]} opts.numeriDa
 *        i valori CANONICI del ByteRange, dati l'offset del '<' del buco (cs), del '>' (ce) e la
 *        lunghezza del file (len). Sono i numeri VERI, quelli che descrivono la copertura reale.
 * @param {(nums:number[]) => string} [opts.testoBR]
 *        il testo esatto fra le quadre. Default: `nums.join(' ')`. Qui si mette NUL, commenti, +,
 *        zeri iniziali, un secondo /ByteRange... purche i numeri che un parser corretto ne estrae
 *        coincidano con `numeriDa` (altrimenti la firma non sarebbe vera per nessuno).
 * @param {(nums:number[]) => [number,number][]} [opts.intervalli]
 *        i byte da firmare, come coppie (offset, lunghezza). Default: le coppie di `nums`.
 * @param {number} [opts.padding]     mezzo-buco in byte (il buco vale padding*2+2 caratteri)
 * @param {string} [opts.subjectCN]
 * @returns {Promise<{ signed: Uint8Array, nums: number[], contentsStart: number,
 *                     contentsEnd: number, certDer: Uint8Array, intervalli: [number,number][],
 *                     messageDigest: Uint8Array }>}
 */
export async function firmaConByteRange(pdfBase, opts) {
  const {
    numeriDa,
    testoBR = (nums) => nums.join(' '),
    intervalli = (nums) => coppieDi(nums),
    padding = 2048,
    subjectCN = 'Lorenzo Rossi',
  } = opts

  const pair = await generateKeyPair()
  const cert = await buildSelfSigned({ ...pair, subjectCN, now: TEMPO })

  const info = readTrailerInfo(pdfBase)
  const catalogNum = info.rootNum
  const pageNum = findFirstPageNumber(pdfBase, catalogNum)
  const sigNum = info.size
  const fieldNum = info.size + 1

  const catalog = findObject(pdfBase, catalogNum)
  const catalogText = fromAscii(pdfBase.subarray(catalog.start, catalog.end))
  const page = findObject(pdfBase, pageNum)
  const pageText = fromAscii(pdfBase.subarray(page.start, page.end))

  const head = '/Contents '
  const zeros = '0'.repeat(padding * 2)

  const costruisci = (nums) => {
    const sigText =
      `${sigNum} 0 obj\n` +
      '<< /Type /Sig\n' +
      '   /Filter /Adobe.PPKLite\n' +
      '   /SubFilter /ETSI.CAdES.detached\n' +
      `   /ByteRange [${testoBR(nums)}]\n` +
      `   ${head}<${zeros}>\n` +
      "   /M (D:20260810120000+00'00')\n" +
      '>>\n' +
      'endobj\n'
    const fieldText =
      `${fieldNum} 0 obj\n` +
      '<< /Type /Annot\n   /Subtype /Widget\n   /FT /Sig\n   /T (Firma1)\n' +
      `   /Rect [0 0 0 0]\n   /F 132\n   /P ${pageNum} 0 R\n   /V ${sigNum} 0 R\n>>\n` +
      'endobj\n'
    const objects = [
      { num: catalogNum, text: conVoceInDizionario(catalogText, `/AcroForm << /Fields [${fieldNum} 0 R] /SigFlags 3 >>`) + '\n' },
      { num: pageNum, text: conVoceInDizionario(pageText, `/Annots [${fieldNum} 0 R]`) + '\n' },
      { num: sigNum, text: sigText },
      { num: fieldNum, text: fieldText },
    ]
    const built = buildIncrementalUpdate(pdfBase, objects)
    const contentsStart = built.objectOffsets.get(sigNum) + sigText.indexOf(head) + head.length
    if (built.bytes[contentsStart] !== LT) {
      throw new Error('errore interno: il buco /Contents non e finito dove il calcolo lo aspettava')
    }
    return { bytes: built.bytes, contentsStart }
  }

  // Punto fisso: parto da numeri piccoli e lascio crescere la lunghezza del testo del ByteRange.
  let nums = numeriDa(0, 0, pdfBase.length)
  for (let pass = 0; pass < 16; pass++) {
    const { bytes, contentsStart } = costruisci(nums)
    const ce = indexOf(bytes, '>', contentsStart)
    const next = numeriDa(contentsStart, ce, bytes.length)
    if (next.length === nums.length && next.every((n, i) => n === nums[i])) {
      // Stabile: calcolo l'impronta sui byte dichiarati e inietto il CMS vero.
      const ranges = intervalli(nums)
      const parti = ranges.map(([o, l]) => bytes.subarray(o, o + l))
      const messageDigest = await sha256(concat(...parti))
      const { cmsDer } = await buildSignedData({
        messageDigest,
        certDer: cert.certDer,
        privateKey: pair.privateKey,
        signingTime: TEMPO,
      })
      const signed = injectSignature(bytes, contentsStart, cmsDer)
      return {
        signed,
        nums,
        contentsStart,
        contentsEnd: indexOf(signed, '>', contentsStart),
        certDer: cert.certDer,
        intervalli: ranges,
        messageDigest,
      }
    }
    nums = next
  }
  throw new Error('il /ByteRange non si stabilizza in 16 passate')
}

export { TEMPO, ascii, concat, fromAscii, indexOf, toHex, sha256 }
