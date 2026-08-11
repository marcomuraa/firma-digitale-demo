/**
 * misura.mjs — la geometria del campione firmato, rimisurata e non creduta sulla parola.
 *
 * Prima di provare a far comparire una firma fantasma PRIMA di quella vera bisogna sapere DOVE
 * sta la vera nell'ordine del file: a che offset comincia il suo `7 0 obj`, dove apre e chiude il
 * buco /Contents, e quali byte sono firmati. Tutto il resto della famiglia si appoggia a questi
 * numeri, quindi qui si stampano e basta.
 */

import { firmaIlCampione, fromAscii, indexOf } from '../copertura/comune.mjs'
import { verify } from '../../../src/core/verify.js'

const base = await firmaIlCampione()
const { signed, byteRange, contentsStart, contentsEnd } = base
const text = fromAscii(signed)

console.log('firmato               ', signed.length, 'byte')
console.log('/ByteRange            ', JSON.stringify(byteRange))
console.log('buco /Contents        ', contentsStart, '..', contentsEnd, `(${contentsEnd - contentsStart + 1} byte)`)
console.log('coperto               ', `[0, ${byteRange[1]})  +  [${byteRange[2]}, ${byteRange[2] + byteRange[3]})`)

// Dove sta ogni definizione di oggetto, nell'ordine del file: e l'ordine che verify() usa per
// decidere chi e la primaria (signatures[0]).
const OBJ = /(?<![0-9])(\d+)[\0\t\n\f\r ]+(\d+)[\0\t\n\f\r ]+obj(?![A-Za-z0-9])/g
console.log('\ndefinizioni di oggetto, in ordine di offset:')
for (let m = OBJ.exec(text); m !== null; m = OBJ.exec(text)) {
  const at = m.index
  const dopoBuco = at > contentsStart
  const dentroCoperto = at < byteRange[1]
  const dictStart = text.indexOf('<<', at)
  const haByteRange = dictStart !== -1 && text.slice(dictStart, text.indexOf('endobj', at) === -1 ? text.length : text.indexOf('endobj', at)).includes('/ByteRange')
  console.log(
    `  offset ${String(at).padStart(6)}  ${m[0].padEnd(10)}` +
      `  ${dentroCoperto ? 'nel PRIMO intervallo firmato' : dopoBuco ? 'dopo il buco' : 'nel buco/coda'}` +
      `${haByteRange ? '   <-- ha /ByteRange (firma)' : ''}`,
  )
}

const r = await verify(signed)
console.log('\nverify():', r.verdict, '| firme:', r.signatures.length, '| primaria CN:', r.identity?.subjectCN)
console.log('primo intervallo firmato: [0,', byteRange[1], ') -> qui NON si puo inserire senza rompere il digest')
console.log('buco non firmato:', contentsStart, '..', contentsEnd, '-> ma sta DOPO il 7 0 obj, quindi una fantasma qui non e primaria')
