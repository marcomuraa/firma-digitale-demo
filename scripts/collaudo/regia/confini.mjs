/**
 * confini.mjs — i limiti dichiarati del progetto, misurati invece che raccontati.
 *
 * docs/vulnerabilita.md si chiude con una sezione «Cosa resta indifendibile per costruzione»:
 * certificato autofirmato senza ancoraggio di fiducia, nessuna marca temporale, nessun controllo
 * di revoca. Non sono difetti — sono il confine del discorso, e il progetto li ha scelti.
 *
 * Ma una sezione che DICHIARA tre limiti senza mostrarli e esattamente il genere di pagina che la
 * prima domanda scomoda smonta. Qui i tre limiti vengono MISURATI sul file firmato vero, con gli
 * stessi strumenti terzi usati per gli attacchi: si vede che il certificato non ha ancoraggio
 * perche openssl si rifiuta di validarlo; che non c'e marca temporale perche nella busta CMS non
 * c'e nessun attributo non firmato; che non c'e controllo di revoca perche nel certificato non c'e
 * nessun punto di distribuzione CRL ne alcun OCSP a cui chiedere.
 *
 * Il quarto confine non era nell'elenco e viene fuori dalla misura: la DATA DI FIRMA e un attributo
 * FIRMATO, quindi immodificabile da terzi — ma dichiarato dal firmatario stesso, quindi non e una
 * prova di quando la firma e avvenuta. E la differenza esatta fra `signingTime` e una marca
 * temporale, e vale la pena mostrarla perche e la ragione per cui le marche temporali esistono.
 *
 *   node scripts/collaudo/regia/confini.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { esegui } from '../comune/terzi.mjs'
import { firmaIlCampione } from '../copertura/comune.mjs'
import { extractSignature, verify } from '../../../src/core/verify.js'

const QUI = dirname(fileURLToPath(import.meta.url))
const OUT = join(QUI, 'out')
mkdirSync(OUT, { recursive: true })

const NSS = `sql:${process.env.HOME}/.pki/nssdb`

const base = await firmaIlCampione()
const firmato = join(OUT, 'confini-firmato.pdf')
writeFileSync(firmato, base.signed)

const estratto = extractSignature(base.signed)
const cmsDer = join(OUT, 'confini-cms.der')
const certDer = join(OUT, 'confini-cert.der')
const certPem = join(OUT, 'confini-cert.pem')
writeFileSync(cmsDer, estratto.cmsDer)
writeFileSync(certDer, estratto.certDer)
esegui('openssl', ['x509', '-inform', 'DER', '-in', certDer, '-out', certPem])

const risultato = await verify(base.signed)
const confini = []

const titolo = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`)

/* ------------------------------------------------------------------------------------- */
titolo('1. Nessun ancoraggio di fiducia: il certificato e autofirmato')
/* ------------------------------------------------------------------------------------- */

// `openssl verify` senza `-CAfile` cerca la catena negli archivi di sistema: un autofirmato che
// nessuno ha mai messo in un archivio non la trova, ed e esattamente il punto.
const catena = esegui('openssl', ['verify', certPem])
// La matematica dell'autofirma invece torna: il certificato firma se stesso, e openssl lo conferma.
const autofirma = esegui('openssl', ['verify', '-CAfile', certPem, certPem])
const soggetto = esegui('openssl', ['x509', '-in', certPem, '-noout', '-subject', '-issuer', '-fingerprint', '-sha256'])
const pdfsigCert = esegui('pdfsig', ['-nssdir', NSS, firmato])
const rigaCert = pdfsigCert.uscita.split('\n').map((r) => r.trim()).find((r) => r.startsWith('- Certificate Validation:'))

console.log(soggetto.uscita)
console.log(`\n$ ${catena.comando}\n  uscita ${catena.stato}: ${(catena.errori || catena.uscita).split('\n').slice(0, 2).join(' / ')}`)
console.log(`\n$ ${autofirma.comando}\n  uscita ${autofirma.stato}: ${(autofirma.uscita || autofirma.errori).split('\n')[0]}`)
console.log(`\npdfsig:  ${rigaCert}`)
console.log(`verify(): identity.selfSigned = ${risultato.identity.selfSigned}, subjectCN = ${JSON.stringify(risultato.identity.subjectCN)}, issuerCN = ${JSON.stringify(risultato.identity.issuerCN)}`)

confini.push({
  confine: 'nessun ancoraggio di fiducia',
  misura: {
    opensslSenzaAncora: { comando: catena.comando, stato: catena.stato, messaggio: (catena.errori || catena.uscita).split('\n').slice(0, 3) },
    opensslConSeStesso: { comando: autofirma.comando, stato: autofirma.stato, messaggio: (autofirma.uscita || autofirma.errori).split('\n')[0] },
    pdfsig: rigaCert,
    nostro: { selfSigned: risultato.identity.selfSigned, subjectCN: risultato.identity.subjectCN, issuerCN: risultato.identity.issuerCN },
  },
  cosaSignifica:
    'La matematica della firma torna e il certificato firma se stesso, ma nessuno ha mai controllato ' +
    'che quel nome appartenga a quella chiave. «Firma valida» non vuol dire «documento autentico».',
})

/* ------------------------------------------------------------------------------------- */
titolo('2. Nessuna marca temporale')
/* ------------------------------------------------------------------------------------- */

// Una marca temporale in CMS e un attributo NON firmato del SignerInfo (id-aa-timeStampToken,
// OID 1.2.840.113549.1.9.16.2.14): un token emesso da una terza parte, che attesta che quei byte
// esistevano prima di un certo istante. Se nella busta non c'e nessun attributo non firmato, non
// c'e nessuna terza parte che dica quando.
const stampa = esegui('openssl', ['cms', '-inform', 'DER', '-in', cmsDer, '-cmsout', '-noout', '-print'])
const albero = esegui('openssl', ['asn1parse', '-inform', 'DER', '-in', cmsDer, '-i'])
const haUnsignedAttrs = /unsignedAttrs:\s*\n\s*<ABSENT>/.test(stampa.uscita) === false && /unsignedAttrs/.test(stampa.uscita)
const assente = /unsignedAttrs:\s*<ABSENT>|unsignedAttrs:\s*\n\s*<ABSENT>/.test(stampa.uscita)
const haTimeStampOid = albero.uscita.includes('1.2.840.113549.1.9.16.2.14')
const signingTime = /signingTime|1\.2\.840\.113549\.1\.9\.5/.test(albero.uscita)

console.log(`unsignedAttrs nel SignerInfo:        ${assente ? 'ASSENTE (nessun attributo non firmato)' : haUnsignedAttrs ? 'presente' : 'non riconosciuto'}`)
console.log(`OID della marca temporale (1.2.840.113549.1.9.16.2.14): ${haTimeStampOid ? 'PRESENTE' : 'ASSENTE'}`)
console.log(`attributo signingTime (dichiarato dal firmatario):      ${signingTime ? 'PRESENTE' : 'ASSENTE'}`)
console.log(`\npdfsig legge come data di firma: ${pdfsigCert.uscita.split('\n').map((r) => r.trim()).find((r) => r.startsWith('- Signing Time:'))}`)
console.log(`la demo ha firmato dichiarando:  ${base.signed && 'TEMPO = ' + new Date(Date.UTC(2026, 7, 10, 12, 0, 0)).toISOString()}`)
console.log(
  '\nsignedAttrs (openssl asn1parse, righe con gli OID degli attributi firmati):\n' +
    albero.uscita
      .split('\n')
      .filter((r) => /:[a-zA-Z]/.test(r) && /OBJECT/.test(r))
      .map((r) => '  ' + r.trim())
      .join('\n'),
)

confini.push({
  confine: 'nessuna marca temporale',
  misura: {
    unsignedAttrsAssenti: assente,
    oidMarcaTemporale: haTimeStampOid ? 'presente' : 'assente',
    signingTimePresente: signingTime,
    pdfsigSigningTime: pdfsigCert.uscita.split('\n').map((r) => r.trim()).find((r) => r.startsWith('- Signing Time:')) ?? null,
    comando: albero.comando,
  },
  cosaSignifica:
    'La data che la pagina mostra e un attributo FIRMATO: nessun estraneo puo cambiarla senza rompere ' +
    'la firma. Ma e il firmatario stesso a dichiararla, quindi prova solo che chi ha firmato ha SCRITTO ' +
    'quella data, non che la firma sia avvenuta allora. Una marca temporale e un token di una terza ' +
    'parte, e qui non ce n\'e nessuno.',
})

/* ------------------------------------------------------------------------------------- */
titolo('3. Nessun controllo di revoca')
/* ------------------------------------------------------------------------------------- */

// Revocare vuol dire poter dire «quella chiave non vale piu». Perche sia possibile, il certificato
// deve dire DOVE si chiede: un punto di distribuzione CRL, o un servizio OCSP nell'estensione
// Authority Information Access. Se non li dichiara, non c'e nessun posto a cui chiedere — e questo
// e vero anche per un verificatore molto piu serio del nostro.
const testoCert = esegui('openssl', ['x509', '-in', certPem, '-noout', '-text'])
const estensioni = (/X509v3 extensions:\n([\s\S]*?)(\n    Signature Algorithm|\n$)/.exec(testoCert.uscita) ?? [])[1] ?? ''
const haCrl = /CRL Distribution Points/.test(testoCert.uscita)
const haOcsp = /Authority Information Access|OCSP - URI/.test(testoCert.uscita)
const ocspUri = esegui('openssl', ['x509', '-in', certPem, '-noout', '-ocsp_uri'])

console.log(`CRL Distribution Points:      ${haCrl ? 'presente' : 'ASSENTE'}`)
console.log(`Authority Information Access: ${haOcsp ? 'presente' : 'ASSENTE'}`)
console.log(`$ ${ocspUri.comando}\n  -> ${ocspUri.uscita || '(nessun URI: non c\'e nessuno a cui chiedere)'}`)
console.log(`\nestensioni presenti nel certificato:\n${estensioni.trim() ? estensioni.replace(/^/gm, '  ') : '  (nessuna)'}`)
console.log(`\nvalidita dichiarata: ${esegui('openssl', ['x509', '-in', certPem, '-noout', '-dates']).uscita.replace(/\n/g, '  ')}`)

confini.push({
  confine: 'nessun controllo di revoca',
  misura: {
    crlDistributionPoints: haCrl,
    authorityInformationAccess: haOcsp,
    ocspUri: ocspUri.uscita || null,
    estensioni: estensioni.trim() || null,
    comando: testoCert.comando,
  },
  cosaSignifica:
    'Un certificato revocato resta matematicamente valido: la revoca e un\'informazione che sta ' +
    'ALTROVE, e il certificato deve dire dove. Questo non lo dice, quindi nessun verificatore — ne ' +
    'il nostro ne un altro — puo sapere se quella chiave sia stata compromessa.',
})

/* ------------------------------------------------------------------------------------- */
titolo('4. Il confine che nessuno aveva elencato: nessuna rete, e nessun orologio')
/* ------------------------------------------------------------------------------------- */

// Vale la pena misurarlo perche e la ragione tecnica per cui i primi tre non sono riparabili
// DENTRO questa demo: le tre cose che mancano richiedono tutte di parlare con qualcun altro.
console.log('I tre limiti sopra hanno la stessa radice: richiedono tutti una terza parte.')
console.log('  - l\'ancoraggio di fiducia richiede una CA che abbia emesso il certificato;')
console.log('  - la marca temporale richiede una TSA che emetta il token;')
console.log('  - la revoca richiede una CRL o un OCSP da interrogare.')
console.log('La demo e un file HTML unico che gira da file:// senza una sola richiesta di rete')
console.log('(build:check lo verifica). Quindi non sono difetti da riparare: sono il confine del')
console.log('discorso, e la risposta istituzionale a tutti e tre ha un nome — il certificato')
console.log('qualificato eIDAS, che e il pannello con cui la demo si chiude.')

confini.push({
  confine: 'la radice comune: tutti e tre richiedono una terza parte, e la demo non ha rete',
  misura: { retePermessa: false, nota: 'build:check verifica che le pagine non facciano nessuna richiesta di rete' },
  cosaSignifica:
    'I tre limiti non sono trascuratezze: discendono dalla scelta di una demo autonoma, un file solo, ' +
    'nessuna rete. Dichiararli e piu forte che farseli trovare.',
})

writeFileSync(join(OUT, 'confini.json'), JSON.stringify(confini, null, 2))
console.log(`\nrapporto: ${join(OUT, 'confini.json')}`)
