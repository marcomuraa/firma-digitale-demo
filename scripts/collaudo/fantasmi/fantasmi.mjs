/**
 * Collaudo avversariale — «firme fantasma: contare male, e mostrare la firma sbagliata».
 *
 * Tesi da confutare: la pagina mostra SEMPRE la firma vera come primaria, e il conteggio delle
 * firme e affidabile. verify() individua le firme scandendo le definizioni `N G obj`, prende il
 * dizionario di primo livello e vi cerca `/ByteRange`. La firma PRIMARIA — quella di cui la pagina
 * stampa identita, /ByteRange e impronte — e `signatures[0]`, cioe la PRIMA NELL'ORDINE DEL FILE.
 *
 * L'ipotesi che attacco: se faccio comparire un dizionario di firma PRIMA di quello vero, la pagina
 * mostra i MIEI dati (certificato, copertura, impronte), anche se il verdetto complessivo — il
 * peggiore fra tutte le firme — resta severo. E poi: quante firme fantasma posso far contare? Il
 * conteggio ha un limite? E c'e un costo che rende la pagina inservibile?
 *
 * Ogni riga e un file vero in out/, giudicato dai TRE verificatori (verify, pdfsig, openssl) piu
 * pdftotext, con i numeri alla mano. Comando unico: `sh scripts/collaudo/fantasmi/collauda.sh`.
 *
 *   node scripts/collaudo/fantasmi/fantasmi.mjs
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { verify } from '../../../src/core/verify.js'
import { buildIncrementalUpdate, digestCovered, findObject, readTrailerInfo } from '../../../src/core/pades.js'
import { buildSignedData } from '../../../src/core/cms.js'
import { generateKeyPair } from '../../../src/core/keys.js'
import { buildSelfSigned } from '../../../src/core/certificate.js'
import { firmaIlCampione, TEMPO } from '../copertura/comune.mjs'
import { pareri } from '../comune/terzi.mjs'
import {
  OUT,
  ascii,
  concat,
  fromAscii,
  indexOf,
  toHex,
  salvaMio,
  oggettoFantasma,
} from './comune-fantasmi.mjs'

// ---------------------------------------------------------------------------------------
// Il documento firmato vero, e la sua geometria misurata (non creduta).
// ---------------------------------------------------------------------------------------
const base = await firmaIlCampione() // il firmatario vero della demo, chiunque sia il nome di default
const { signed, byteRange, contentsStart, contentsEnd, cmsDer } = base
const cmsHex = toHex(cmsDer)
const sigObjOffset = indexOf(signed, ascii('6 0 obj')) // la firma vera, misurata sopra a 1535
const primariaVera = (await verify(signed)).identity
const veroCN = primariaVera.subjectCN
const veroFingerprint = primariaVera.fingerprint
const NOME_AGGRESSORE = 'Mario Bianchi' // volutamente diverso dal firmatario vero

console.log('firmato          ', signed.length, 'byte  · /ByteRange', JSON.stringify(byteRange))
console.log('firma vera a      offset', sigObjOffset, '(6 0 obj) · buco', contentsStart, '..', contentsEnd)
console.log('firmatario vero   ', veroCN, '· impronta', veroFingerprint.slice(0, 24), '...\n')

const righe = []

/**
 * Fabbrica, verifica coi tre strumenti, deposita e registra. `note` porta i numeri specifici
 * dell'attacco. Restituisce il parere completo per gli assert successivi.
 */
async function prova(nome, atteso, bytes, note = {}) {
  const percorso = salvaMio(`${nome}.pdf`, bytes)
  const p = await pareri(percorso)
  const n = p.nostro
  const riga = {
    nome,
    file: percorso,
    lunghezza: bytes.length,
    atteso,
    // il nostro verdetto
    verdetto: n.verdetto,
    firmeNostre: n.firme,
    primariaCN: n.identita?.subjectCN ?? null,
    primariaImpronta: n.identita?.fingerprint ?? null,
    primariaByteRange: n.perFirma[0]?.byteRange ?? null,
    // il giudizio della SOLA firma primaria (quella di cui la pagina mostra i pannelli)
    primariaVerdetto: n.perFirma[0]?.verdetto ?? null,
    primariaCompleta: n.perFirma[0]?.complete ?? null,
    primariaDigest: n.perFirma[0]?.digest ?? null,
    primariaFirma: n.perFirma[0]?.firma ?? null,
    primariaImpersona: n.identita?.fingerprint != null && n.identita.fingerprint !== veroFingerprint,
    // i byteRange di TUTTE le firme che vediamo, in ordine di file
    byteRangeVisti: n.perFirma.map((f) => f.byteRange),
    reason: n.reason,
    // i terzi
    pdfsigQuante: p.pdfsig.quante,
    pdfsig: p.pdfsig.sintesi,
    openssl: p.openssl.sintesi,
    lettore: p.lettore.apre ? (p.lettore.importo ?? '(nessun "euro")') : 'non apre',
    divergenze: p.divergenze.map((d) => d.su),
    esito: n.verdetto === atteso ? 'come atteso' : `DIVERSO (atteso ${atteso})`,
    ...note,
  }
  righe.push(riga)
  console.log(
    `${nome}\n   nostro=${n.verdetto} firme=${n.firme} primariaCN=${riga.primariaCN}` +
      `${riga.primariaImpersona ? ' [IMPRONTA CAMBIATA]' : ''}` +
      `\n   pdfsig=${p.pdfsig.quante} firme · ${p.pdfsig.sintesi}\n   openssl=${p.openssl.sintesi}` +
      `\n   lettore=${riga.lettore}${p.divergenze.length ? '\n   DIVERGE: ' + riga.divergenze.join(' | ') : ''}\n`,
  )
  return { p, bytes }
}

// =======================================================================================
// F0. Il documento firmato intatto: il metro.
// =======================================================================================
await prova('f00-firmato-intatto', 'valid', signed)

// =======================================================================================
// F1. Raffica di fantasmi: quante firme posso far contare? Tre, dieci, cento?
//
// Appendo N dizionari di firma sciolti dopo %%EOF. Non sono registrati nell'/AcroForm, quindi
// pdfsig non li vede: ne conta sempre UNA. Noi li contiamo tutti. Perche il verdetto non precipiti
// a invalid (nascondendo il fenomeno del conteggio), ogni fantasma copia il /ByteRange E il CMS
// VERI: i byte [0,1663) e [9857,10273) non li ho toccati, quindi il loro digest torna ancora e la
// firma verifica — ma la copertura e incompleta (il file e cresciuto): ogni fantasma e `extended`.
// Restano tutti dopo la firma vera (offset 1535), quindi la PRIMARIA resta Lorenzo: la pagina
// mostrerebbe l'identita giusta, ma con «N+1 firme rilevate», e la lista affiancata esplode.
// =======================================================================================
function raffica(n) {
  let coda = '\n'
  for (let i = 0; i < n; i++) coda += oggettoFantasma(100 + i, byteRange, cmsHex)
  return concat(signed, ascii(coda))
}
for (const n of [3, 10, 100]) {
  await prova(`f01-raffica-${String(n).padStart(3, '0')}-fantasmi`, 'extended', raffica(n), {
    fantasmiAppesi: n,
    idea: 'ogni fantasma copia /ByteRange e CMS veri -> extended; non registrati in AcroForm',
  })
}

// =======================================================================================
// F2. Fantasma dentro uno stream binario — il limite dichiarato da verify().
//
// verify.js dichiara: «una sequenza N 0 obj … /ByteRange … nascosta dentro uno stream binario
// diventerebbe una firma fantasma. Puo solo rendere il verdetto piu severo, mai piu indulgente».
// Lo VERIFICO. Appendo un incremental update con un oggetto-stream il cui CONTENUTO e il testo di
// un dizionario di firma. La sequenza sta dopo la parola `stream`, quindi fuori dal dizionario
// dell'oggetto per `dictEndAt` — ma la scansione lessicale `N G obj` la aggancia lo stesso.
// Atteso: il fantasma viene contato e il verdetto NON migliora (resta >= extended).
// =======================================================================================
{
  const info = readTrailerInfo(signed)
  const streamNum = info.size + 10
  const veleno = oggettoFantasma(200, [0, 10, 20, 30], 'deadbeef') // firma finta DENTRO lo stream
  const objText =
    `${streamNum} 0 obj\n<< /Length ${veleno.length} >>\nstream\n${veleno}endstream\nendobj\n`
  const conStream = buildIncrementalUpdate(signed, [{ num: streamNum, text: objText }]).bytes
  await prova('f02-fantasma-in-uno-stream', 'invalid', conStream, {
    idea: 'la firma finta e nel corpo di uno stream: fuori dal dizionario, ma la scansione la conta',
    veroLimite: 'verify dichiara «puo solo peggiorare il verdetto» — qui lo misuro',
  })
}

// =======================================================================================
// F3. Lo scippo del primo posto — il cuore della famiglia.
//
// Se un dizionario di firma compare PRIMA di quello vero (offset < 1535), diventa lui la primaria:
// identita, /ByteRange e impronte MOSTRATE dalla pagina sono le sue. Ma tutto cio che sta prima di
// 1535 e nel primo intervallo firmato [0,1663): toccarlo rompe per forza il digest della firma
// vera. Quindi lo scippo si paga con verdetto `invalid` — ed e proprio questo il confine.
// =======================================================================================

// --- F3a. Scippo minimo: sovrascrivo ~50 byte di contenuto con un dizionario-firma spazzatura.
//     Nessuna crittografia: bastano cinquanta byte per cambiare CHI la pagina chiama «primaria»
//     e QUALE /ByteRange mostra. L'identita resta nulla (CMS illeggibile), ma la copertura no.
{
  const veleno = ascii(oggettoFantasma(9, [11, 22, 33, 44], 'aa'))
  const dove = 600 // dentro il content stream del campione, ben prima della firma vera (1535)
  const scippo = new Uint8Array(signed)
  scippo.set(veleno, dove)
  await prova('f03a-scippo-minimo-spazzatura', 'invalid', scippo, {
    idea: 'un dizionario-firma spazzatura sovrascritto a offset 600: diventa lui la primaria',
    scrittoA: dove,
    byteRangeFinto: [11, 22, 33, 44],
  })
}

// --- F3b. Scippo perfetto: il fantasma e una firma VALIDA e COMPLETA di un altro certificato,
//     inserito in testa al file. Copre tutto il file nuovo con la propria chiave, quindi i pannelli
//     copertura/digest/firma sono tutti VERDI e l'identita e quella dell'attaccante. La firma vera,
//     scivolata in avanti, non torna piu: verdetto invalid. Sulla pagina: verdetto rosso in cima,
//     ma OGNI pannello di dettaglio racconta l'attaccante come firmatario legittimo.
{
  const scippo = await scippoPerfetto(NOME_AGGRESSORE)
  const { p } = await prova('f03b-scippo-perfetto-impersona', 'invalid', scippo.bytes, {
    idea: `firma valida e completa di ALTRO certificato (CN «${NOME_AGGRESSORE}») inserita in testa: primaria = attaccante`,
    cnAggressore: NOME_AGGRESSORE,
    cnVittima: veroCN,
    byteRangeFantasma: scippo.byteRange,
    improntaFantasma: scippo.fingerprint,
    improntaVera: veroFingerprint,
  })
  // La prova che conta: la primaria e valida per conto suo e non e quella vera.
  const prim = p.nostro.perFirma[0]
  console.log(
    `   >>> primaria: verdetto=${prim.verdetto} completa=${prim.complete} digest=${prim.digest} ` +
      `firma=${prim.firma} impronta=${prim.impronta.slice(0, 16)}… (vera=${veroFingerprint.slice(0, 16)}…)\n`,
  )
}

// --- F3c. Scippo perfetto MA con lo stesso Common Name della vittima: sulla pagina, «Lorenzo
//     Rossi» in cima al pannello identita, copertura completa, tutto verde — solo l'impronta
//     SHA-256 lo tradisce, ed e l'unico campo che la demo mostra apposta per questo.
{
  const scippo = await scippoPerfetto(veroCN) // stesso identico Common Name della vittima
  await prova('f03c-scippo-stesso-nome', 'invalid', scippo.bytes, {
    idea: `come f03b ma con lo STESSO CN della vittima («${veroCN}»): distinguibili solo dall'impronta`,
    cnAggressore: veroCN,
    cnVittima: veroCN,
    improntaFantasma: scippo.fingerprint,
    improntaVera: veroFingerprint,
  })
}

/**
 * Costruisce il file dello «scippo perfetto»: un oggetto-firma dell'attaccante inserito subito
 * dopo l'header `%PDF-1.7\n`, con una firma RSA valida che copre tutto il file risultante. E lo
 * stesso punto fisso di addPlaceholder — le cifre del /ByteRange spostano il buco — ma prependendo
 * invece di appendere. La firma vera, spinta in avanti, smette di verificare.
 */
async function scippoPerfetto(subjectCN) {
  const pair = await generateKeyPair()
  const cert = await buildSelfSigned({ ...pair, subjectCN, now: TEMPO })
  const headerLen = 9 // "%PDF-1.7\n", misurato: il primo oggetto vero comincia a 9
  const padding = 2048
  const holeLen = padding * 2 + 2

  const preambolo = `100 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached\n   /ByteRange `
  const costruisci = (br) => {
    const oggetto =
      `${preambolo}[${br.join(' ')}]\n   /Contents <` + '0'.repeat(padding * 2) + `>\n>>\nendobj\n`
    const bytes = concat(signed.subarray(0, headerLen), ascii(oggetto), signed.subarray(headerLen))
    // L'offset del '<' lo misuro sui byte veri, non lo calcolo: e la stessa prudenza di addPlaceholder.
    const contentsStartF = indexOf(bytes, ascii('/Contents <'), headerLen) + '/Contents '.length
    return { bytes, contentsStartF }
  }
  let br = [0, 0, 0, 0]
  for (let pass = 0; pass < 8; pass++) {
    const { bytes, contentsStartF } = costruisci(br)
    const misurato = [0, contentsStartF, contentsStartF + holeLen, bytes.length - (contentsStartF + holeLen)]
    if (misurato.every((n, i) => n === br[i])) {
      const messageDigest = await digestCovered(bytes, misurato)
      const { cmsDer: cAtt } = await buildSignedData({
        messageDigest,
        certDer: cert.certDer,
        privateKey: pair.privateKey,
        signingTime: TEMPO,
      })
      // inietto il CMS nel buco del fantasma
      const out = new Uint8Array(bytes)
      out.set(ascii(toHex(cAtt)), contentsStartF + 1)
      const r = await verify(out)
      return { bytes: out, byteRange: misurato, fingerprint: r.identity.fingerprint }
    }
    br = misurato
  }
  throw new Error('lo scippo perfetto non converge')
}

// =======================================================================================
// F4. Ridefinizione via incremental update: stesso numero d'oggetto, contenuto diverso.
//
// Appendo un aggiornamento che RIDEFINISCE l'oggetto 6 (la firma) con un dizionario diverso. Ora
// nel file ci sono DUE `6 0 obj`: l'originale a 1535 e la ridefinizione in coda. La xref del nuovo
// aggiornamento dichiara viva la SECONDA. verify() le conta entrambe (lo dichiara), e la PRIMARIA
// resta la PRIMA nell'ordine del file — l'originale. pdfsig segue la xref e valida la ridefinizione.
// Misura: chi e vivo per la xref, chi e primaria per noi, quante ne vede ciascuno.
// =======================================================================================
{
  const ridef = oggettoFantasma(6, [0, 0, 0, 0], 'cafe')
  const conRidef = buildIncrementalUpdate(signed, [{ num: 6, text: ridef }]).bytes
  await prova('f04-ridefinizione-oggetto-6', 'invalid', conRidef, {
    idea: 'due 6 0 obj: xref dichiara viva la ridefinizione, noi teniamo primaria l\'originale',
    ridefinizioneByteRange: [0, 0, 0, 0],
  })
}

// =======================================================================================
// F5. Firme annidate: un dizionario di firma dentro il valore di una chiave di un altro.
//
// `dictEndAt` conta le parentesi annidate, quindi il dizionario ESTERNO viene affettato per
// intero, quello interno compreso. La regex del /ByteRange prende pero il PRIMO che incontra. Se
// metto l'annidata PRIMA, e il suo /ByteRange (e il suo /Contents) a essere letto — e l'oggetto e
// contato UNA volta sola. Misura: quante firme vede verify, e quale /ByteRange finisce nei pannelli.
// =======================================================================================
{
  const annidata =
    '150 0 obj\n<< /Wrap << /Type /Sig /ByteRange [7 7 7 7] /Contents <bb> >>\n' +
    '   /Type /Sig /ByteRange [1 1 1 1] /Contents <aa> >>\nendobj\n'
  const conAnnidata = concat(signed, ascii('\n' + annidata))
  await prova('f05-firme-annidate', 'invalid', conAnnidata, {
    idea: 'firma dentro firma: dictEndAt affetta l\'esterna intera, la regex prende il primo /ByteRange',
    byteRangeInterno: [7, 7, 7, 7],
    byteRangeEsterno: [1, 1, 1, 1],
  })
}

// =======================================================================================
// F6. Un oggetto con DUE dizionari: il primo NASCONDE il secondo.
//
// `findSignatureFields` prende il PRIMO `<<` dopo l'header e lo chiude con `dictEndAt`. Se il primo
// dizionario non ha /ByteRange, l'oggetto viene scartato — e il /ByteRange del SECONDO dizionario
// non viene mai visto. E un modo di NASCONDERE un dizionario di firma alla nostra scansione. Verifico
// se questo puo rendere verify piu INDULGENTE del dovuto (nascondendo una firma che pdfsig invece
// vede). Costruisco un secondo dizionario che sarebbe `extended` e controllo se sparisce dal conto.
// =======================================================================================
{
  const dueDict =
    '160 0 obj\n<< /Innocuo true >> << /Type /Sig /ByteRange [' +
    byteRange.join(' ') +
    '] /Contents <' +
    cmsHex +
    '> >>\nendobj\n'
  const conDueDict = concat(signed, ascii('\n' + dueDict))
  await prova('f06-due-dizionari-il-primo-nasconde', 'extended', conDueDict, {
    idea: 'primo dizionario senza /ByteRange -> l\'oggetto e scartato, il secondo (firma) sparisce dal conto',
    atteso_spiegazione:
      'se il secondo sparisce restiamo a 1 sola firma vista (la vera): il conteggio va GIU, non su',
  })
}

// =======================================================================================
// F7. `obj` senza `endobj` fino alla fine del file.
//
// Se manca `endobj`, verify usa `text.length` come limite: il dizionario viene comunque chiuso da
// `dictEndAt`. Ma un `<<` successivo lontano potrebbe essere agganciato. Misuro cosa succede.
// =======================================================================================
{
  const senzaEndobj = '170 0 obj\n<< /Type /Sig /ByteRange [0 0 0 0] /Contents <dd> >>\n' // niente endobj
  const conSenzaEndobj = concat(signed, ascii('\n' + senzaEndobj))
  await prova('f07-obj-senza-endobj', 'invalid', conSenzaEndobj, {
    idea: 'nessun endobj: il limite diventa la fine del file',
  })
}

// =======================================================================================
// F8. L'IMPOSSIBILE, misurato: una firma prima dei 1285 byte originali.
//
// I primi 1285 byte sono il campione, e stanno nel primo intervallo firmato. Ci scrivo dentro un
// dizionario di firma a offset 100. Diventa la primaria — ma il digest della firma vera si spacca.
// Il referto deve dire anche cosa NON si puo fare: avere insieme una fantasma-primaria E un
// documento valido. Le due cose si escludono per costruzione.
// =======================================================================================
{
  const veleno = ascii(oggettoFantasma(9, [0, 100, 200, 300], 'ff'))
  const dentroOriginale = new Uint8Array(signed)
  dentroOriginale.set(veleno, 100)
  await prova('f08-firma-prima-dei-1285-byte', 'invalid', dentroOriginale, {
    idea: 'fantasma a offset 100, dentro il campione originale: primaria fantasma MA digest vero rotto',
    scrittoA: 100,
    lezione: 'fantasma-primaria e documento-valido si escludono a vicenda',
  })
}

// ---------------------------------------------------------------------------------------
// Tabella e rapporto
// ---------------------------------------------------------------------------------------
console.log('\n' + '='.repeat(110))
console.log(
  ['nome'.padEnd(34), 'nostro'.padEnd(9), 'firme'.padEnd(6), 'pdfsig'.padEnd(7), 'primariaCN'.padEnd(16), 'imperson'].join(
    ' ',
  ),
)
for (const r of righe) {
  console.log(
    [
      r.nome.padEnd(34),
      String(r.verdetto).padEnd(9),
      String(r.firmeNostre).padEnd(6),
      String(r.pdfsigQuante).padEnd(7),
      String(r.primariaCN).slice(0, 15).padEnd(16),
      r.primariaImpersona ? 'SI' : '.',
    ].join(' '),
  )
}

writeFileSync(join(OUT, 'fantasmi.json'), JSON.stringify(righe, null, 2))
console.log('\nrapporto:', join(OUT, 'fantasmi.json'))
