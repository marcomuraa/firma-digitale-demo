/**
 * Collaudo avversariale — «dentro la busta CMS: quello che il parser non guarda».
 *
 * La busta CMS SignedData vive nel /Contents, cioe nell'UNICA parte del file che il /ByteRange
 * lascia fuori dalla firma. Chiunque puo riscriverla senza toccare un byte coperto. La domanda di
 * questo collaudo non e «il documento e cambiato?» (a quello risponde la copertura) ma «il nostro
 * lettore di CMS, readCms(), guarda davvero tutto quello che dice di guardare?».
 *
 * readCms() prende cinque scorciatoie, e ogni file qui sotto ne prende una di mira:
 *   - childrenOf(signerInfos)[0]  -> guarda SOLO il primo firmatario;
 *   - childrenOf(certsNode)[0]    -> prende SOLO il primo certificato, e non confronta mai il `sid`
 *                                    del firmatario con il certificato scelto;
 *   - contentType / eContentType  -> non li controlla mai;
 *   - messageDigestOf             -> prende il PRIMO messageDigest che trova;
 *   - signedAttrsDer[0] = 0x31    -> riscrive un byte solo, dando per scontato tag corto e
 *                                    lunghezza definita.
 *
 * Ogni riga produce un PDF vero in out/, verificato da verify.js e confrontato con pdfsig e
 * openssl (i tre pareri di scripts/collaudo/comune/terzi.mjs). Le misure finiscono in
 * out/misure.json, da cui si scrive rilievi.json.
 *
 *   node scripts/collaudo/busta/busta.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { firmaIlCampione } from '../copertura/comune.mjs'
import { verify } from '../../../src/core/verify.js'
import { pareri, stampaPareri } from '../comune/terzi.mjs'
import {
  OID,
  attributiCanonici,
  contenutoDi,
  contentInfoDer,
  ctx,
  digestAlgDer,
  firmaAttributi,
  iniettaCms,
  firmaPdf,
  attore,
  setOf,
  signerInfoDer,
  sidDer,
  seq,
  intDer,
  octetDer,
  oidDer,
  sigAlgDer,
} from './busta-comune.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'out')
const RADICE = join(HERE, '../../..')
const SAMPLE = new Uint8Array(readFileSync(join(RADICE, 'src/assets/sample.pdf')))

// Il mio out/, dentro il mio perimetro. NON tocco scripts/collaudo/copertura/out.
mkdirSync(OUT, { recursive: true })

const base = await firmaIlCampione()
const attrsContent = contenutoDi(base.signedAttrsDer) // contenuto del SET degli attributi firmati
const campoDefinito = ctx(0, attrsContent) // il campo [0] a lunghezza definita, byte reali

console.log('base firmata     ', base.signed.length, 'byte  /ByteRange', JSON.stringify(base.byteRange))
console.log('buco /Contents   ', base.contentsStart, '..', base.contentsEnd)
console.log('CMS reale        ', base.cmsDer.length, 'byte')
console.log()

const misure = []

/** Esegue un attacco: salva il PDF, lo fa giudicare dai tre, registra tutto cio che serve. */
async function prova(nome, bytes, meta = {}) {
  const file = join(OUT, `${nome}.pdf`)
  writeFileSync(file, bytes)
  const p = await pareri(file)
  const o0 = p.openssl.firme[0] ?? {}
  const riga = {
    nome,
    file,
    lunghezza: bytes.length,
    nostro: {
      verdetto: p.nostro.verdetto,
      reason: p.nostro.reason,
      firme: p.nostro.firme,
      digest: p.nostro.digest?.match ?? null,
      firma: p.nostro.firma,
      fingerprint: p.nostro.identita?.fingerprint ?? null,
      cn: p.nostro.identita?.subjectCN ?? null,
    },
    pdfsig: {
      quante: p.pdfsig.quante,
      sintesi: p.pdfsig.sintesi,
      copreTutto: p.pdfsig.copreTutto,
      validazione: p.pdfsig.validazione,
    },
    openssl: {
      sintesi: p.openssl.sintesi,
      verifica: o0.verifica ?? null,
      messaggio: o0.messaggio ?? null,
      quantiSignerInfo: o0.quantiSignerInfo ?? null,
      eContentType: o0.eContentType ?? null,
    },
    lettore: p.lettore.importo,
    divergenze: p.divergenze,
    ...meta,
  }
  misure.push(riga)
  console.log(stampaPareri(p))
  console.log(`   >>> ${nome}: nostro=${riga.nostro.verdetto}  openssl=${o0.verifica}  pdfsig=${p.pdfsig.quante}f  [${meta.mira ?? ''}]`)
  return { p, bytes }
}

// =======================================================================================
// 00. Ricostruzione dai pezzi: prova che l'encoder e onesto (deve dare 'valid').
// =======================================================================================
{
  const si = signerInfoDer({ sidCertDer: base.certDer, signedAttrsField: campoDefinito, signature: base.signature })
  const cms = contentInfoDer({ signerInfos: [si], certs: [base.certDer] })
  await prova('00-ricostruito-dai-pezzi', iniettaCms(base.signed, base.contentsStart, cms), {
    mira: 'sanita encoder',
    atteso: 'valid',
  })
}

// =======================================================================================
// 01. Due firmatari, il PRIMO valido e il secondo spazzatura.
//     readCms guarda solo childrenOf(signerInfos)[0]: il secondo non viene mai valutato.
// =======================================================================================
{
  const firmaRotta = new Uint8Array(base.signature)
  firmaRotta[10] ^= 0xff // stessa struttura del primo, ma la firma non torna
  const siBuono = signerInfoDer({ sidCertDer: base.certDer, signedAttrsField: campoDefinito, signature: base.signature })
  const siRotto = signerInfoDer({ sidCertDer: base.certDer, signedAttrsField: campoDefinito, signature: firmaRotta })
  const cms = contentInfoDer({ signerInfos: [siBuono, siRotto], certs: [base.certDer] })
  await prova('01-due-firmatari-primo-buono', iniettaCms(base.signed, base.contentsStart, cms), {
    mira: 'primo SignerInfo soltanto',
    atteso: 'valid (noi), openssl dovrebbe bocciare il 2o',
  })
}

// =======================================================================================
// 02. Due firmatari, il PRIMO spazzatura e il secondo valido.
//     Se un tool accettasse "almeno un firmatario valido" direbbe ok; noi guardiamo solo il primo.
// =======================================================================================
{
  const firmaRotta = new Uint8Array(base.signature)
  firmaRotta[10] ^= 0xff
  const siRotto = signerInfoDer({ sidCertDer: base.certDer, signedAttrsField: campoDefinito, signature: firmaRotta })
  const siBuono = signerInfoDer({ sidCertDer: base.certDer, signedAttrsField: campoDefinito, signature: base.signature })
  const cms = contentInfoDer({ signerInfos: [siRotto, siBuono], certs: [base.certDer] })
  await prova('02-due-firmatari-secondo-buono', iniettaCms(base.signed, base.contentsStart, cms), {
    mira: 'primo SignerInfo soltanto',
    atteso: 'invalid (noi guardiamo il primo, che e rotto)',
  })
}

// =======================================================================================
// 03. Due certificati, il `sid` ignorato.
//     L'aggressore rifirma con la SUA chiave (CN identico), mette il suo cert PER PRIMO nella busta
//     ma lascia il `sid` puntato al certificato VERO. Noi verifichiamo con il primo cert (l'aggressore
//     -> torna), openssl segue il `sid` (il cert vero -> non torna). Impronta mostrata: l'aggressore.
// =======================================================================================
{
  const agg = await attore('Lorenzo Rossi')
  const { field, signature } = await firmaAttributi(attributiCanonici({ digest: base.messageDigest }), agg.privateKey)
  const si = signerInfoDer({ sidCertDer: base.certDer /* sid -> cert VERO */, signedAttrsField: field, signature })
  const cms = contentInfoDer({ signerInfos: [si], certs: [agg.certDer, base.certDer] /* aggressore per primo */ })
  await prova('03-due-cert-sid-ignorato', iniettaCms(base.signed, base.contentsStart, cms), {
    mira: 'primo certificato, sid mai confrontato',
    atteso: 'valid (noi, con impronta aggressore), openssl segue il sid e boccia',
    improntaAggressore: null,
  })
}

// =======================================================================================
// 04. Certificato ESCA in testa, firma VERA di Lorenzo conservata.
//     Anteponiamo un certificato estraneo. readCms prende il primo -> mostra l'identita SBAGLIATA e
//     verifica la firma vera con la chiave sbagliata (fallisce). openssl segue il sid -> tutto ok.
// =======================================================================================
{
  const esca = await attore('Ministero delle Finanze')
  const si = signerInfoDer({ sidCertDer: base.certDer, signedAttrsField: campoDefinito, signature: base.signature })
  const cms = contentInfoDer({ signerInfos: [si], certs: [esca.certDer, base.certDer] /* esca per primo */ })
  await prova('04-cert-esca-in-testa', iniettaCms(base.signed, base.contentsStart, cms), {
    mira: 'primo certificato usato per identita E verifica',
    atteso: 'invalid (noi, firma vera verificata col cert sbagliato); openssl valido',
  })
}

// =======================================================================================
// 05. eContentType che mente, firma VERA conservata.
//     encapContentInfo dichiara id-signedData invece di id-data. La firma non lo copre, quindi resta
//     valida per noi; ma contentType (attributo firmato) dice id-data: i due si contraddicono.
// =======================================================================================
{
  const si = signerInfoDer({ sidCertDer: base.certDer, signedAttrsField: campoDefinito, signature: base.signature })
  const cms = contentInfoDer({ signerInfos: [si], certs: [base.certDer], eContentTypeOid: OID.signedData })
  await prova('05-econtenttype-mente', iniettaCms(base.signed, base.contentsStart, cms), {
    mira: 'eContentType mai controllato',
    atteso: 'valid (noi); openssl potrebbe segnalare il disaccordo contentType/eContentType',
  })
}

// =======================================================================================
// 05b. contentType (attributo FIRMATO) che mente, rifirmato con la chiave VERA.
//      L'attributo dice id-signedData; noi non lo confrontiamo con niente -> passa.
// =======================================================================================
{
  const attrs = attributiCanonici({ digest: base.messageDigest, contentTypeOid: OID.signedData })
  const { field, signature } = await firmaAttributi(attrs, base.privateKey)
  const si = signerInfoDer({ sidCertDer: base.certDer, signedAttrsField: field, signature })
  const cms = contentInfoDer({ signerInfos: [si], certs: [base.certDer] })
  await prova('05b-contenttype-attr-mente', iniettaCms(base.signed, base.contentsStart, cms), {
    mira: 'attributo contentType mai controllato',
    atteso: 'valid (noi); openssl controlla che contentType == eContentType',
  })
}

// =======================================================================================
// 06. Doppio messageDigest fra gli attributi firmati: il primo giusto, il secondo (0xff...) falso.
//     messageDigestOf prende il primo che trova. Rifirmato con la chiave vera (SET ordinato DER:
//     0x6b.. < 0xff.., quindi il vero viene per primo).
// =======================================================================================
{
  const falso = new Uint8Array(32).fill(0xff)
  const attrs = attributiCanonici({ digest: base.messageDigest, extraMessageDigest: falso })
  const { field, signature } = await firmaAttributi(attrs, base.privateKey)
  const si = signerInfoDer({ sidCertDer: base.certDer, signedAttrsField: field, signature })
  const cms = contentInfoDer({ signerInfos: [si], certs: [base.certDer] })
  await prova('06-doppio-messagedigest', iniettaCms(base.signed, base.contentsStart, cms), {
    mira: 'messageDigestOf prende il primo',
    atteso: 'valid (noi, primo=vero); openssl potrebbe rifiutare il duplicato',
  })
}

// =======================================================================================
// 07. Attributi firmati in BER a lunghezza INDEFINITA, firma VERA conservata.
//     La firma fu fatta sul SET in DER (0x31 lunghezza-definita). Noi prendiamo i byte grezzi e
//     riscriviamo solo il primo byte a 0x31: con la lunghezza indefinita i byte non coincidono piu
//     con cio che fu firmato -> per noi la firma non torna. openssl ricanonicalizza in DER -> torna.
// =======================================================================================
{
  const campoIndefinito = ctx(0, attrsContent, /* indefinita */ true)
  const si = signerInfoDer({ sidCertDer: base.certDer, signedAttrsField: campoIndefinito, signature: base.signature })
  const cms = contentInfoDer({ signerInfos: [si], certs: [base.certDer] })
  await prova('07-signedattrs-ber-indefinito', iniettaCms(base.signed, base.contentsStart, cms), {
    mira: 'signedAttrsDer[0]=0x31 assume DER a lunghezza definita',
    atteso: 'invalid (noi, byte diversi da quelli firmati); openssl valido',
  })
}

// =======================================================================================
// 08. Un CMS di UN ALTRO documento (importo diverso) nel buco: il digest non puo tornare.
// =======================================================================================
{
  const altro = new Uint8Array(SAMPLE)
  altro[577] = altro[577] === 0x39 ? 0x31 : 0x39 // la cifra dell'importo: 9 <-> 1
  const doc = await firmaPdf(altro, 'Lorenzo Rossi')
  await prova('08-cms-di-altro-documento', iniettaCms(base.signed, base.contentsStart, doc.cmsDer), {
    mira: 'firma detached legata ai byte di QUESTO documento',
    atteso: 'invalid (digest non torna)',
  })
}

// =======================================================================================
// 08b. Un CMS di un ALTRO firmatario ma con gli STESSI byte coperti: il digest torna.
//      Dimostra che la busta si puo scambiare con quella di chiunque abbia firmato lo stesso testo.
// =======================================================================================
{
  const doc = await firmaPdf(SAMPLE, 'Lorenzo Rossi') // stesso campione, chiavi diverse
  await prova('08b-cms-altro-firmatario-stessi-byte', iniettaCms(base.signed, base.contentsStart, doc.cmsDer), {
    mira: 'la busta CMS vive nella parte non firmata',
    atteso: 'valid (noi), ma impronta diversa dalla base',
    improntaBase: base.certDer ? null : null,
  })
}

// =======================================================================================
// 09. Firma valida ma SENZA certificato nella busta: non c'e chiave con cui verificare.
// =======================================================================================
{
  const agg = await attore('Lorenzo Rossi')
  const { field, signature } = await firmaAttributi(attributiCanonici({ digest: base.messageDigest }), agg.privateKey)
  const si = signerInfoDer({ sidCertDer: agg.certDer, signedAttrsField: field, signature })
  const cms = contentInfoDer({ signerInfos: [si], certs: [] })
  await prova('09-senza-certificato', iniettaCms(base.signed, base.contentsStart, cms), {
    mira: 'certificato-assente',
    atteso: 'invalid (noi, certificato-assente); openssl non ha il cert del firmatario',
  })
}

// =======================================================================================
// 10. digestAlgorithms di SignedData dichiara sha512, ma il SignerInfo usa sha256 (firma vera).
//     readCms legge l'algoritmo dal SignerInfo e ignora il SET di SignedData.
// =======================================================================================
{
  const si = signerInfoDer({ sidCertDer: base.certDer, signedAttrsField: campoDefinito, signature: base.signature })
  const cms = contentInfoDer({
    signerInfos: [si],
    certs: [base.certDer],
    digestAlgorithmsSet: setOf(digestAlgDer(OID.sha512)),
  })
  await prova('10-digestalgorithms-mente', iniettaCms(base.signed, base.contentsStart, cms), {
    mira: 'digestAlgorithms di SignedData ignorato',
    atteso: 'valid (noi); openssl potrebbe pretendere coerenza',
  })
}

// =======================================================================================
// Tabella e misure
// =======================================================================================
console.log('\n' + '='.repeat(90))
console.log(['nome'.padEnd(38), 'nostro'.padEnd(9), 'openssl', 'pdfsig', 'digest', 'firma'].join(' '))
for (const m of misure) {
  console.log(
    [
      m.nome.padEnd(38),
      String(m.nostro.verdetto).padEnd(9),
      String(m.openssl.verifica).padEnd(7),
      String(m.pdfsig.quante + 'f').padEnd(6),
      String(m.nostro.digest).padEnd(6),
      String(m.nostro.firma).padEnd(5),
      m.nostro.reason ?? '',
    ].join(' '),
  )
}

writeFileSync(join(OUT, 'misure.json'), JSON.stringify(misure, null, 2))
console.log('\nmisure:', join(OUT, 'misure.json'))
