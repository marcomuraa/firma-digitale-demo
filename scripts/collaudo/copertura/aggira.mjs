/**
 * Collaudo avversariale — «il controllo di copertura si puo aggirare?»
 *
 * Tesi da confutare: il verdetto a tre stati (valid / extended / invalid) non si puo ingannare.
 * Qui si prova a far dire "valid" a un documento a cui e stato aggiunto qualcosa dopo la firma.
 *
 * Ogni riga della tabella e un file vero, depositato in out/, verificato dal verify.js della demo
 * senza nessuna informazione privilegiata: solo i byte.
 *
 *   node scripts/collaudo/copertura/aggira.mjs
 */

import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { verify } from '../../../src/core/verify.js'
import { appendIncrementalUpdate } from '../../../src/core/attacks.js'
import {
  OUT,
  appendiSecondaFirma,
  ascii,
  concat,
  firmaIlCampione,
  indexOf,
  salva,
  sovrascrivi,
  testo,
  toHex,
} from './comune.mjs'

const base = await firmaIlCampione()
const { signed, byteRange, contentsStart, contentsEnd, cmsDer } = base

const righe = []

async function prova(nome, atteso, bytes, note = {}) {
  const r = await verify(bytes)
  const file = salva(`${nome}.pdf`, bytes)
  const riga = {
    nome,
    atteso,
    verdetto: r.verdict,
    lunghezza: bytes.length,
    complete: r.coverage?.complete ?? null,
    gapMatchesContents: r.coverage?.gapMatchesContents ?? null,
    codaScoperta: r.coverage?.uncoveredTail ?? null,
    digest: r.digest?.match ?? null,
    firma: r.signature?.ok ?? null,
    reason: r.reason,
    cn: r.identity?.subjectCN ?? null,
    esito: r.verdict === atteso ? 'come atteso' : `DIVERSO (atteso ${atteso})`,
    file,
    ...note,
  }
  righe.push(riga)
  return { r, bytes }
}

// ---------------------------------------------------------------------------------------
// 0. Il documento firmato, intatto. Tutto il resto si misura da qui.
// ---------------------------------------------------------------------------------------
console.log('documento firmato   ', signed.length, 'byte')
console.log('/ByteRange nel file ', JSON.stringify(byteRange))
console.log('buco /Contents      ', contentsStart, '..', contentsEnd, `(${contentsEnd - contentsStart + 1} byte)`)
console.log('CMS                 ', cmsDer.length, 'byte =', cmsDer.length * 2, 'caratteri esadecimali')
console.log('padding disponibile ', contentsEnd - (contentsStart + 1 + cmsDer.length * 2), 'caratteri esadecimali')
console.log()

await prova('00-firmato-intatto', 'valid', signed)

// ---------------------------------------------------------------------------------------
// 1. Roba appesa dopo %%EOF: a capo, byte nulli, commento PDF.
// ---------------------------------------------------------------------------------------
await prova('01-coda-un-a-capo', 'extended', concat(signed, ascii('\n')))
await prova('02-coda-64-byte-nulli', 'extended', concat(signed, new Uint8Array(64)))
await prova('03-coda-commento-pdf', 'extended', concat(signed, ascii('% niente da vedere qui\n')))

// ---------------------------------------------------------------------------------------
// 2. L attacco 2 vero, quello della demo.
// ---------------------------------------------------------------------------------------
const esteso = appendIncrementalUpdate(signed).bytes
await prova('04-incremental-update', 'extended', esteso, { appendedFrom: signed.length })

// ---------------------------------------------------------------------------------------
// 3. /ByteRange manomesso: dichiara di coprire piu di quanto copra.
//
// Il /ByteRange sta DENTRO il primo intervallo, quindi riscriverlo cambia i byte firmati. Per non
// spostare nessun offset la riscrittura consuma gli spazi di rientro davanti a "/ByteRange":
// la lunghezza del file resta identica al byte.
// ---------------------------------------------------------------------------------------
function riscriviByteRange(pdf, nuovi) {
  const at = indexOf(pdf, '/ByteRange')
  const chiusa = indexOf(pdf, ']', at)
  const nuovo = `/ByteRange [${nuovi.join(' ')}]`
  const spazio = chiusa + 1 - at
  if (nuovo.length > spazio + 3) throw new Error('non ci sta nemmeno mangiandosi il rientro')
  const inizio = at - Math.max(0, nuovo.length - spazio)
  const testoNuovo = nuovo.padStart(chiusa + 1 - inizio, ' ')
  return { bytes: sovrascrivi(pdf, inizio, testoNuovo), inizio, testoNuovo }
}

const gonfiato = riscriviByteRange(esteso, [0, byteRange[1], byteRange[2], esteso.length - byteRange[2]])
await prova('05-byterange-gonfiato-copre-tutto', 'invalid', gonfiato.bytes, {
  scritto: gonfiato.testoNuovo.trim(),
  aOffset: gonfiato.inizio,
})

const oltre = riscriviByteRange(signed, [0, byteRange[1], byteRange[2], 99999])
await prova('06-byterange-oltre-la-fine-del-file', 'invalid', oltre.bytes, {
  scritto: oltre.testoNuovo.trim(),
  aOffset: oltre.inizio,
})

// ---------------------------------------------------------------------------------------
// 4. Dentro il buco /Contents, che per costruzione non e firmato.
// ---------------------------------------------------------------------------------------
const padStart = contentsStart + 1 + cmsDer.length * 2
const spazioNelBuco = contentsEnd - padStart

// 4a. Carico utile che resta esadecimale: nessuna regola sintattica lo vieta.
const messaggio =
  'QUESTO TESTO NON E FIRMATO E STA DENTRO IL DOCUMENTO. ' +
  'Ci stanno ' + Math.floor(spazioNelBuco / 2) + ' byte arbitrari. ' +
  'Il verdetto non se ne accorge.'
const carico = toHex(ascii(messaggio))
const nascosto = sovrascrivi(signed, padStart, carico)
await prova('07-carico-esadecimale-nel-buco', 'valid', nascosto, {
  aOffset: padStart,
  byteNascosti: Math.floor(spazioNelBuco / 2),
  messaggio,
})

// 4b. Carico utile che NON e esadecimale (testo in chiaro dentro il buco).
const chiaro = sovrascrivi(signed, padStart, 'TESTO IN CHIARO NEL BUCO')
await prova('08-carico-in-chiaro-nel-buco', 'invalid', chiaro, { aOffset: padStart })

// 4c. Il buco chiuso in anticipo, e dopo la chiusura un oggetto PDF completo.
const oggettoInfilato = '>/Spazzatura <</Tipo /Oggetto /Infilato true>>' + '0'.repeat(20)
const anticipata = sovrascrivi(signed, padStart, oggettoInfilato)
await prova('09-buco-chiuso-in-anticipo', 'invalid', anticipata, { aOffset: padStart })

// 4d. La parentesi ">" che chiude il buco sta DENTRO il buco, quindi non e firmata: si puo
//     cambiare senza toccare un byte coperto.
const chiusuraCancellata = sovrascrivi(signed, contentsEnd, '0')
await prova('10-chiusura-del-buco-cancellata', 'invalid', chiusuraCancellata, { aOffset: contentsEnd })

// ---------------------------------------------------------------------------------------
// 5. L update che finisce esattamente dove finisce il secondo intervallo.
//
// c+d vale gia la lunghezza del file firmato: per appendere k byte e avere ancora c+d === lunghezza
// bisogna toglierne k da qualche parte. L unico posto non firmato e il buco: si accorcia il buco di
// k caratteri e si appendono k byte in coda.
// ---------------------------------------------------------------------------------------
const k = 40
const coda = ascii('%'.padEnd(k - 1, 'x') + '\n')
const compensato = concat(
  signed.subarray(0, contentsEnd - k), // il buco perde k caratteri di padding
  signed.subarray(contentsEnd), // ">" e tutto il resto scivolano indietro di k
  coda,
)
await prova('11-buco-compensato-lunghezza-identica', 'invalid', compensato, {
  lunghezzaOriginale: signed.length,
  cPiuD: byteRange[2] + byteRange[3],
})

// ---------------------------------------------------------------------------------------
// 6. Un secondo dizionario di firma appeso.
// ---------------------------------------------------------------------------------------
// 6a. Esca senza firma valida: /ByteRange e /Contents copiati, numeri originali.
const esca =
  '\n8 0 obj\n<< /Type /Sig /ByteRange [' +
  byteRange.join(' ') +
  ']\n   /Contents <' +
  toHex(cmsDer) +
  '>\n>>\nendobj\n'
await prova('12-esca-secondo-dizionario-di-firma', 'extended', concat(esteso, ascii(esca)), {
  nota: 'stesso CMS, stessi numeri: il digest torna, ma il buco dichiarato non e questo',
})

// 6b. La cosa seria: l aggressore rifirma il documento esteso con chiavi sue.
const rifirmatoAltroNome = await appendiSecondaFirma(esteso, { subjectCN: 'Mario Bianchi (aggressore)' })
await prova('13-rifirmato-con-altro-nome', 'invalid', rifirmatoAltroNome.bytes, {
  nota: 'seconda firma completa, certificato dell aggressore',
  byteRange2: rifirmatoAltroNome.byteRange,
})

// 6c. Lo stesso, ma il certificato dell aggressore porta lo stesso Common Name.
const rifirmatoStessoNome = await appendiSecondaFirma(esteso, { subjectCN: 'Lorenzo Rossi' })
await prova('14-rifirmato-con-lo-stesso-nome', 'invalid', rifirmatoStessoNome.bytes, {
  nota: 'indistinguibile dal legittimo se si guarda solo il CN',
  byteRange2: rifirmatoStessoNome.byteRange,
})

// ---------------------------------------------------------------------------------------
// 7. Una stringa "/ByteRange" appesa dove capita: verify prende l ULTIMA.
// ---------------------------------------------------------------------------------------
await prova(
  '15-byterange-in-un-commento-dopo-eof',
  'extended',
  concat(signed, ascii('\n% /ByteRange [0 1 2 3]\n')),
  { nota: '23 byte di commento PDF appesi a un documento valido' },
)

// 7b. Attraverso l API della demo: il testo dell attacco 2 finisce nel content stream.
const conTesto = appendIncrementalUpdate(signed, {
  newText: '1.000.000 euro /ByteRange [0 0 0 0] (un milione)',
}).bytes
await prova('16-byterange-dentro-il-testo-dellattacco-2', 'extended', conTesto, {
  nota: 'newText e un parametro pubblico di appendIncrementalUpdate',
})

// 7c. La forgeria "ovvia": un dizionario di firma appeso i cui numeri descrivono il buco NUOVO
//     (cosi gapMatchesContents e c+d===lunghezza tornano) ma il cui CMS e quello originale.
const codaPrima = esteso.length + 1
const cmsHex = toHex(cmsDer)
const testa = `\n9 0 obj\n<< /Type /Sig /ByteRange [`
const corpo = `] /Contents <${cmsHex}>\n>>\nendobj\n`
let numeri = [0, 0, 0, 0]
let forgiato = null
for (let pass = 0; pass < 8; pass++) {
  const blocco = testa + numeri.join(' ') + corpo
  const bytes = concat(esteso, ascii(blocco))
  const cs = codaPrima + blocco.indexOf('/Contents <') + '/Contents '.length - 1
  const ce = indexOf(bytes, '>', cs)
  const misurato = [0, cs, ce + 1, bytes.length - (ce + 1)]
  if (misurato.every((n, i) => n === numeri[i])) {
    forgiato = bytes
    break
  }
  numeri = misurato
}
await prova('17-firma-appesa-che-dichiara-copertura-totale', 'invalid', forgiato, {
  nota: 'numeri coerenti col buco nuovo, ma il CMS e quello vecchio: l impronta non torna',
  byteRangeFinto: numeri,
})

// ---------------------------------------------------------------------------------------
// 8. Un file che dichiara una lunghezza e ne ha un altra: troncato dopo la firma.
// ---------------------------------------------------------------------------------------
await prova('18-file-troncato-di-10-byte', 'invalid', signed.slice(0, signed.length - 10), {
  nota: 'il /ByteRange dichiara byte che nel file non ci sono piu',
})

// ---------------------------------------------------------------------------------------
// Tabella
// ---------------------------------------------------------------------------------------
console.log(
  ['nome'.padEnd(42), 'verdetto'.padEnd(9), 'atteso'.padEnd(9), 'compl', 'gap  ', 'coda  ', 'dig  ', 'firma', 'reason'].join(
    ' ',
  ),
)
for (const r of righe) {
  console.log(
    [
      r.nome.padEnd(42),
      String(r.verdetto).padEnd(9),
      String(r.atteso).padEnd(9),
      String(r.complete).padEnd(5),
      String(r.gapMatchesContents).padEnd(5),
      String(r.codaScoperta).padEnd(6),
      String(r.digest).padEnd(5),
      String(r.firma).padEnd(5),
      r.reason ?? '',
    ].join(' '),
  )
}
console.log()
for (const r of righe.filter((x) => x.esito !== 'come atteso')) {
  console.log('DIVERSO DAL PREVISTO:', r.nome, '->', r.verdetto, `(previsto ${r.atteso})`, r.reason ?? '')
}

writeFileSync(join(OUT, 'aggira.json'), JSON.stringify(righe, null, 2))
console.log('\nrapporto:', join(OUT, 'aggira.json'))
