/**
 * Collaudo avversariale — «Il certificato: quello che nessuno controlla».
 *
 * Tesi da confutare: perche verify() dica `valid` non basta che la matematica torni, deve anche
 * essere ragionevole il certificato che la porta. FALSO. verify() fa TRE controlli — copertura,
 * digest, firma RSA — e il certificato lo apre solo per prendere la chiave pubblica, il Common
 * Name e per calcolare `selfSigned`. Non guarda: le date di validita, il keyUsage, il
 * basicConstraints, l'extendedKeyUsage, il contenuto del Common Name, la robustezza della chiave.
 * Quei dati vengono RESTITUITI (`identity`) ma non pesano MAI sul verdetto.
 *
 * Qui lo si mostra byte alla mano: si firma davvero il campione con certificati sempre piu
 * inaccettabili in senso X.509 — scaduti, non ancora validi, che dichiarano di essere una CA,
 * con keyUsage che vieta la firma, con Common Name in omografi cirillici, con chiave RSA-1024, o
 * emessi da una CA finta e quindi NON autofirmati — e ogni volta si misura cosa dice verify(),
 * cosa dice pdfsig, cosa dice openssl.
 *
 * Non si riscrive niente di src/core/: il CMS e il PDF li costruiscono i moduli veri. L'unica cosa
 * costruita a mano e il certificato, con pkijs, perche buildSelfSigned() della demo ha estensioni
 * e date fisse e non sa fare un certificato cattivo — che e esattamente il punto.
 *
 *   node scripts/collaudo/certificato/certificato.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as asn1js from 'asn1js'
import { AttributeTypeAndValue, BasicConstraints, Certificate, Extension, ExtKeyUsage, Time } from 'pkijs'

import { readFileSync } from 'node:fs'
import { generateKeyPair, exportPublicKeySpki } from '../../../src/core/keys.js'
import { buildSelfSigned } from '../../../src/core/certificate.js'
import { buildSignedData } from '../../../src/core/cms.js'
import { addPlaceholder, digestCovered, injectSignature } from '../../../src/core/pades.js'
import { toHex } from '../../../src/core/bytes.js'
import { pareri, stampaPareri } from '../comune/terzi.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'out')
mkdirSync(OUT, { recursive: true })

const SAMPLE = new Uint8Array(readFileSync(join(HERE, '../../../src/assets/sample.pdf')))
/** L'istante di firma «vero» della demo: tutto quel che non e sotto attacco resta ancorato qui. */
const TEMPO = new Date(Date.UTC(2026, 7, 10, 12, 0, 0))
const PADDING = 4096

/* ------------------------------------------------------------------------------------- */
/* Costruzione di certificati arbitrari                                                    */
/* ------------------------------------------------------------------------------------- */

/** Il Common Name come attributo di un DN. `value` puo essere qualunque stringa, anche assurda. */
function cnAttr(cn) {
  return new AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: cn }) })
}

/**
 * Un `Time` X.509 con la codifica GIUSTA per l'anno: UTCTime fino al 2049, GeneralizedTime dopo,
 * come impone RFC 5280. certificate.js della demo usa sempre UTCTime (type 0): con una data nel
 * 2050 quel codice scriverebbe «50...» che si rilegge come 1950 — la ragione per cui qui la scelta
 * la fa l'anno, cosi «non ancora valido» e davvero nel futuro e non wrappato nel passato.
 */
function tempo(date) {
  const year = date.getUTCFullYear()
  return new Time({ type: year >= 1950 && year <= 2049 ? 0 : 1, value: date })
}

/** Seriale casuale positivo in forma minima, come fa certificate.js. */
function serialeCasuale() {
  const s = globalThis.crypto.getRandomValues(new Uint8Array(16))
  s[0] &= 0x7f
  if (s[0] === 0) s[0] = 0x01
  return s
}

/**
 * Costruisce un certificato X.509 con qualunque combinazione di campi — comprese quelle che un
 * certificato onesto non avrebbe mai. Il firmatario del certificato (`signerPrivateKey`) puo
 * essere il soggetto stesso (autofirmato) o un altro (una CA): e cosa distingue un autofirmato da
 * una catena.
 *
 * @param {object} p
 * @param {AttributeTypeAndValue[]} p.subject   gli attributi del DN del soggetto
 * @param {AttributeTypeAndValue[]} p.issuer    gli attributi del DN dell'emittente
 * @param {Uint8Array} p.subjectSpkiDer         la chiave pubblica del soggetto, in DER SPKI
 * @param {CryptoKey}  p.signerPrivateKey       chi firma il certificato
 * @param {Date}       p.notBefore
 * @param {Date}       p.notAfter
 * @param {Uint8Array} [p.serial]               seriale imposto (per costruire due gemelli)
 * @param {Extension[]} [p.extensions]          estensioni (basicConstraints, keyUsage, EKU...)
 * @returns {Promise<Uint8Array>} il DER del certificato
 */
async function costruisciCert({ subject, issuer, subjectSpkiDer, signerPrivateKey, notBefore, notAfter, serial, extensions }) {
  const cert = new Certificate()
  cert.version = 2 // v3
  cert.serialNumber = new asn1js.Integer({ valueHex: (serial ?? serialeCasuale()).buffer })
  for (const a of issuer) cert.issuer.typesAndValues.push(a)
  for (const a of subject) cert.subject.typesAndValues.push(a)
  cert.notBefore = tempo(notBefore)
  cert.notAfter = tempo(notAfter)
  const spki = asn1js.fromBER(subjectSpkiDer)
  if (spki.offset === -1) throw new Error('SPKI illeggibile')
  cert.subjectPublicKeyInfo.fromSchema(spki.result)
  if (extensions && extensions.length) cert.extensions = extensions
  // Firma del TBS: se signerPrivateKey e la privata del soggetto, il certificato e autofirmato.
  await cert.sign(signerPrivateKey, 'SHA-256')
  return new Uint8Array(cert.toSchema(false).toBER(false))
}

/** basicConstraints con cA a piacere; critica come vuole RFC 5280. */
function estBasicConstraints(cA) {
  return new Extension({
    extnID: '2.5.29.19',
    critical: true,
    extnValue: new BasicConstraints({ cA }).toSchema().toBER(false),
  })
}

/** keyUsage arbitrario. `byte` sono i bit accesi (0x80=digitalSignature ... 0x20=keyEncipherment). */
function estKeyUsage(byte, unusedBits) {
  return new Extension({
    extnID: '2.5.29.15',
    critical: true,
    extnValue: new asn1js.BitString({ unusedBits, valueHex: new Uint8Array([byte]).buffer }).toBER(false),
  })
}

/** extendedKeyUsage con gli scopi dati (OID). */
function estEku(...oids) {
  return new Extension({
    extnID: '2.5.29.37',
    critical: false,
    extnValue: new ExtKeyUsage({ keyPurposes: oids }).toSchema().toBER(false),
  })
}

/* ------------------------------------------------------------------------------------- */
/* Firma del campione con un certificato dato                                              */
/* ------------------------------------------------------------------------------------- */

/**
 * Firma DAVVERO il campione con la coppia e il certificato passati. La chiave privata deve
 * corrispondere alla pubblica dentro il certificato, altrimenti la matematica non torna — e in
 * questa famiglia vogliamo che la matematica torni sempre, per isolare il fatto che il certificato
 * non viene guardato.
 *
 * `signingTime` finisce sia nel /M del dizionario (byte firmati) sia nell'attributo firmato
 * signingTime del CMS: cosi pdfsig e la nostra vista leggono la stessa data.
 */
async function firmaCampione({ certDer, privateKey, signingTime = TEMPO }) {
  const { pdfWithHole, byteRange, contentsStart } = addPlaceholder(SAMPLE, { padding: PADDING, signingTime })
  const messageDigest = await digestCovered(pdfWithHole, byteRange)
  const { cmsDer } = await buildSignedData({ messageDigest, certDer, privateKey, signingTime })
  return injectSignature(pdfWithHole, contentsStart, cmsDer)
}

/* ------------------------------------------------------------------------------------- */
/* La batteria                                                                             */
/* ------------------------------------------------------------------------------------- */

const esiti = []

/**
 * Scrive il file, lo passa ai TRE verificatori, ne stampa il confronto e conserva l'essenziale.
 * `attesoNostro` e cio che ci aspettiamo da verify(): quasi sempre `valid`, ed e proprio la notizia.
 */
async function prova(nome, attesoNostro, bytes, contesto = {}) {
  const file = join(OUT, `${nome}.pdf`)
  writeFileSync(file, bytes)
  const p = await pareri(file)
  console.log(stampaPareri(p))

  const cert0 = p.openssl.firme[0]?.certificato ?? {}
  const esito = {
    nome,
    file,
    lunghezza: bytes.length,
    contesto,
    nostro: {
      verdetto: p.nostro.verdetto,
      atteso: attesoNostro,
      come_atteso: p.nostro.verdetto === attesoNostro,
      reason: p.nostro.reason,
      selfSigned: p.nostro.identita?.selfSigned ?? null,
      subjectCN: p.nostro.identita?.subjectCN ?? null,
      issuerCN: p.nostro.identita?.issuerCN ?? null,
      fingerprint: p.nostro.identita?.fingerprint ?? null,
      digest: p.nostro.digest?.match ?? null,
      firma: p.nostro.firma ?? null,
    },
    pdfsig: {
      quante: p.pdfsig.quante,
      validazione: p.pdfsig.validazione,
      certificato: p.pdfsig.firme.map((f) => f.certificato),
      dataDichiarata: p.pdfsig.firme.map((f) => f.dataDichiarata),
      cn: p.pdfsig.cn,
      copreTutto: p.pdfsig.copreTutto,
      sintesi: p.pdfsig.sintesi,
    },
    openssl: {
      cmsVerificato: p.openssl.firme[0]?.verifica ?? null,
      messaggio: p.openssl.firme[0]?.messaggio ?? null,
      scadutoAdesso: cert0.scadutoAdesso ?? null,
      notBefore: cert0.campi?.notBefore ?? null,
      notAfter: cert0.campi?.notAfter ?? null,
      keyUsage: cert0.keyUsage ?? null,
      basicConstraints: cert0.basicConstraints ?? null,
      subject: cert0.campi?.subject ?? null,
      issuer: cert0.campi?.issuer ?? null,
      serial: cert0.campi?.serial ?? null,
      fingerprint: cert0.campi?.['SHA256 Fingerprint'] ?? null,
    },
    lettore: p.lettore.importo,
    divergenze: p.divergenze,
  }
  esiti.push(esito)
  return esito
}

/* --- 00. Baseline: certificato onesto, autofirmato, valido. -------------------------- */
{
  const pair = await generateKeyPair()
  const spki = await exportPublicKeySpki(pair.publicKey)
  const cert = await costruisciCert({
    subject: [cnAttr('Lorenzo Rossi')],
    issuer: [cnAttr('Lorenzo Rossi')],
    subjectSpkiDer: spki,
    signerPrivateKey: pair.privateKey,
    notBefore: new Date(Date.UTC(2026, 0, 1)),
    notAfter: new Date(Date.UTC(2027, 0, 1)),
    extensions: [estBasicConstraints(false), estKeyUsage(0xc0, 6)], // digitalSignature+nonRepudiation
  })
  await prova('00-baseline-onesto', 'valid', await firmaCampione({ certDer: cert, privateKey: pair.privateKey }), {
    descr: 'certificato onesto costruito con pkijs: autofirmato, valido 2026-2027, keyUsage corretto',
  })
}

/* --- 01. Certificato SCADUTO (notAfter nel passato). --------------------------------- */
{
  const pair = await generateKeyPair()
  const spki = await exportPublicKeySpki(pair.publicKey)
  const cert = await costruisciCert({
    subject: [cnAttr('Lorenzo Rossi')],
    issuer: [cnAttr('Lorenzo Rossi')],
    subjectSpkiDer: spki,
    signerPrivateKey: pair.privateKey,
    notBefore: new Date(Date.UTC(2019, 0, 1)),
    notAfter: new Date(Date.UTC(2020, 0, 1)), // scaduto da sei anni rispetto alla firma
    extensions: [estBasicConstraints(false), estKeyUsage(0xc0, 6)],
  })
  // Il documento e firmato «oggi» (TEMPO 2026) con un certificato che era gia morto nel 2020.
  await prova('01-cert-scaduto', 'valid', await firmaCampione({ certDer: cert, privateKey: pair.privateKey }), {
    descr: 'certificato valido 2019-2020, documento firmato nel 2026: sei anni dopo la scadenza',
  })
}

/* --- 02. Certificato NON ANCORA VALIDO (notBefore nel futuro). ----------------------- */
{
  const pair = await generateKeyPair()
  const spki = await exportPublicKeySpki(pair.publicKey)
  const cert = await costruisciCert({
    subject: [cnAttr('Lorenzo Rossi')],
    issuer: [cnAttr('Lorenzo Rossi')],
    subjectSpkiDer: spki,
    signerPrivateKey: pair.privateKey,
    notBefore: new Date(Date.UTC(2050, 0, 1)), // nasce nel 2050
    notAfter: new Date(Date.UTC(2051, 0, 1)),
    extensions: [estBasicConstraints(false), estKeyUsage(0xc0, 6)],
  })
  await prova('02-cert-non-ancora-valido', 'valid', await firmaCampione({ certDer: cert, privateKey: pair.privateKey }), {
    descr: 'certificato valido dal 2050: usato per firmare nel 2026, ventiquattro anni prima di esistere',
  })
}

/* --- 03. signingTime nel FUTURO (2050). ---------------------------------------------- */
/* La data di firma e un attributo FIRMATO, ma non e verificata contro niente: ne contro
 * l'orologio, ne contro le date del certificato. Si firma dichiarando di aver firmato nel 2050. */
{
  const pair = await generateKeyPair()
  const spki = await exportPublicKeySpki(pair.publicKey)
  const cert = await costruisciCert({
    subject: [cnAttr('Lorenzo Rossi')],
    issuer: [cnAttr('Lorenzo Rossi')],
    subjectSpkiDer: spki,
    signerPrivateKey: pair.privateKey,
    notBefore: new Date(Date.UTC(2026, 0, 1)),
    notAfter: new Date(Date.UTC(2027, 0, 1)),
    extensions: [estBasicConstraints(false), estKeyUsage(0xc0, 6)],
  })
  const futuro = new Date(Date.UTC(2050, 0, 1, 12, 0, 0))
  await prova('03-signingtime-2050', 'valid', await firmaCampione({ certDer: cert, privateKey: pair.privateKey, signingTime: futuro }), {
    descr: 'signingTime dichiarato: 1 gennaio 2050, con un certificato valido solo nel 2026',
  })
}

/* --- 04. signingTime nel PASSATO (1990), prima ancora della chiave. ------------------ */
{
  const pair = await generateKeyPair()
  const spki = await exportPublicKeySpki(pair.publicKey)
  const cert = await costruisciCert({
    subject: [cnAttr('Lorenzo Rossi')],
    issuer: [cnAttr('Lorenzo Rossi')],
    subjectSpkiDer: spki,
    signerPrivateKey: pair.privateKey,
    notBefore: new Date(Date.UTC(2026, 0, 1)),
    notAfter: new Date(Date.UTC(2027, 0, 1)),
    extensions: [estBasicConstraints(false), estKeyUsage(0xc0, 6)],
  })
  const passato = new Date(Date.UTC(1990, 0, 1, 12, 0, 0))
  await prova('04-signingtime-1990', 'valid', await firmaCampione({ certDer: cert, privateKey: pair.privateKey, signingTime: passato }), {
    descr: 'signingTime dichiarato: 1 gennaio 1990, trentasei anni prima della firma vera',
  })
}

/* --- 05. keyUsage SENZA digitalSignature: il certificato vieta di firmare. ------------ */
/* keyUsage = solo keyEncipherment (0x20). Un certificato cosi dichiara «questa chiave serve a
 * cifrare chiavi di sessione, NON a firmare documenti». verify() firma lo stesso. */
{
  const pair = await generateKeyPair()
  const spki = await exportPublicKeySpki(pair.publicKey)
  const cert = await costruisciCert({
    subject: [cnAttr('Lorenzo Rossi')],
    issuer: [cnAttr('Lorenzo Rossi')],
    subjectSpkiDer: spki,
    signerPrivateKey: pair.privateKey,
    notBefore: new Date(Date.UTC(2026, 0, 1)),
    notAfter: new Date(Date.UTC(2027, 0, 1)),
    extensions: [estBasicConstraints(false), estKeyUsage(0x20, 5)], // solo keyEncipherment
  })
  await prova('05-keyusage-senza-firma', 'valid', await firmaCampione({ certDer: cert, privateKey: pair.privateKey }), {
    descr: 'keyUsage = solo keyEncipherment: il certificato dichiara che questa chiave non firma',
  })
}

/* --- 06. Il certificato dichiara di essere una CA (basicConstraints CA:TRUE). --------- */
{
  const pair = await generateKeyPair()
  const spki = await exportPublicKeySpki(pair.publicKey)
  const cert = await costruisciCert({
    subject: [cnAttr('Lorenzo Rossi')],
    issuer: [cnAttr('Lorenzo Rossi')],
    subjectSpkiDer: spki,
    signerPrivateKey: pair.privateKey,
    notBefore: new Date(Date.UTC(2026, 0, 1)),
    notAfter: new Date(Date.UTC(2027, 0, 1)),
    extensions: [estBasicConstraints(true), estKeyUsage(0xc0, 6)], // CA:TRUE
  })
  await prova('06-cert-e-una-CA', 'valid', await firmaCampione({ certDer: cert, privateKey: pair.privateKey }), {
    descr: "basicConstraints CA:TRUE: un'autorita di certificazione che firma un documento invece di emettere certificati",
  })
}

/* --- 07. extendedKeyUsage incoerente: buono per firmare codice, non documenti. -------- */
{
  const pair = await generateKeyPair()
  const spki = await exportPublicKeySpki(pair.publicKey)
  const cert = await costruisciCert({
    subject: [cnAttr('Lorenzo Rossi')],
    issuer: [cnAttr('Lorenzo Rossi')],
    subjectSpkiDer: spki,
    signerPrivateKey: pair.privateKey,
    notBefore: new Date(Date.UTC(2026, 0, 1)),
    notAfter: new Date(Date.UTC(2027, 0, 1)),
    // id-kp-codeSigning + id-kp-timeStamping, nessuno dei quali autorizza la firma di un PDF.
    extensions: [estBasicConstraints(false), estKeyUsage(0xc0, 6), estEku('1.3.6.1.5.5.7.3.3', '1.3.6.1.5.5.7.3.8')],
  })
  await prova('07-eku-incoerente', 'valid', await firmaCampione({ certDer: cert, privateKey: pair.privateKey }), {
    descr: 'extendedKeyUsage = codeSigning + timeStamping: scopi che non includono la firma di documenti',
  })
}

/* --- 08. Common Name in OMOGRAFI cirillici: a schermo e «Lorenzo Rossi». -------------- */
/* La 'е' e la 'о' NON sono latine: sono U+0435 e U+043E cirilliche. Indistinguibili a occhio,
 * diversissime nei byte. Un pannello che stampa il subjectCN mostra un nome che l'utente crede
 * di riconoscere. */
{
  const pair = await generateKeyPair()
  const spki = await exportPublicKeySpki(pair.publicKey)
  const cnOmografo = 'Lоrеnzо Rоssi' // е cirillica, о cirillica
  const cert = await costruisciCert({
    subject: [cnAttr(cnOmografo)],
    issuer: [cnAttr(cnOmografo)],
    subjectSpkiDer: spki,
    signerPrivateKey: pair.privateKey,
    notBefore: new Date(Date.UTC(2026, 0, 1)),
    notAfter: new Date(Date.UTC(2027, 0, 1)),
    extensions: [estBasicConstraints(false), estKeyUsage(0xc0, 6)],
  })
  await prova('08-cn-omografo-cirillico', 'valid', await firmaCampione({ certDer: cert, privateKey: pair.privateKey }), {
    descr: "Common Name «Lоrеnzо Rоssi» con е e о CIRILLICHE: a schermo identico a «Lorenzo Rossi»",
    cnByte: Buffer.from(cnOmografo, 'utf8').toString('hex'),
  })
}

/* --- 09. Common Name con caratteri di CONTROLLO e a capo. ----------------------------- */
{
  const pair = await generateKeyPair()
  const spki = await exportPublicKeySpki(pair.publicKey)
  // Un a capo e un ritorno carrello dentro il nome: un pannello che non li neutralizza puo
  // mostrare due righe, o troncare, o far sparire tutto cio che segue.
  const cnControllo = 'Lorenzo Rossi\r\n VALIDO E FIDATO'
  const cert = await costruisciCert({
    subject: [cnAttr(cnControllo)],
    issuer: [cnAttr(cnControllo)],
    subjectSpkiDer: spki,
    signerPrivateKey: pair.privateKey,
    notBefore: new Date(Date.UTC(2026, 0, 1)),
    notAfter: new Date(Date.UTC(2027, 0, 1)),
    extensions: [estBasicConstraints(false), estKeyUsage(0xc0, 6)],
  })
  await prova('09-cn-caratteri-di-controllo', 'valid', await firmaCampione({ certDer: cert, privateKey: pair.privateKey }), {
    descr: 'Common Name con CR, LF e BEL (0x07) incorporati: iniezione di testo nel nome',
    cnByte: Buffer.from(cnControllo, 'utf8').toString('hex'),
  })
}

/* --- 10. Common Name VUOTO (stringa vuota). ------------------------------------------- */
{
  const pair = await generateKeyPair()
  const spki = await exportPublicKeySpki(pair.publicKey)
  const cert = await costruisciCert({
    subject: [cnAttr('')], // UTF8String vuota
    issuer: [cnAttr('')],
    subjectSpkiDer: spki,
    signerPrivateKey: pair.privateKey,
    notBefore: new Date(Date.UTC(2026, 0, 1)),
    notAfter: new Date(Date.UTC(2027, 0, 1)),
    extensions: [estBasicConstraints(false), estKeyUsage(0xc0, 6)],
  })
  await prova('10-cn-vuoto', 'valid', await firmaCampione({ certDer: cert, privateKey: pair.privateKey }), {
    descr: 'Common Name = stringa vuota: il pannello identita non ha niente da mostrare',
  })
}

/* --- 11. Chiave RSA-1024, debole per gli standard odierni. ---------------------------- */
/* verify() importa la chiave con RSASSA-PKCS1-v1_5/SHA-256 senza guardare la lunghezza del modulo. */
{
  const pair = await globalThis.crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 1024, publicExponent: new Uint8Array([0x01, 0x00, 0x01]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  )
  const spki = new Uint8Array(await globalThis.crypto.subtle.exportKey('spki', pair.publicKey))
  const cert = await costruisciCert({
    subject: [cnAttr('Lorenzo Rossi')],
    issuer: [cnAttr('Lorenzo Rossi')],
    subjectSpkiDer: spki,
    signerPrivateKey: pair.privateKey,
    notBefore: new Date(Date.UTC(2026, 0, 1)),
    notAfter: new Date(Date.UTC(2027, 0, 1)),
    extensions: [estBasicConstraints(false), estKeyUsage(0xc0, 6)],
  })
  await prova('11-rsa-1024', 'valid', await firmaCampione({ certDer: cert, privateKey: pair.privateKey }), {
    descr: 'chiave RSA a 1024 bit: sotto la soglia minima di 2048 raccomandata da anni',
  })
}

/* --- 12. Esponente pubblico 3 invece di 65537. --------------------------------------- */
{
  const pair = await globalThis.crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([0x03]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  )
  const spki = new Uint8Array(await globalThis.crypto.subtle.exportKey('spki', pair.publicKey))
  const cert = await costruisciCert({
    subject: [cnAttr('Lorenzo Rossi')],
    issuer: [cnAttr('Lorenzo Rossi')],
    subjectSpkiDer: spki,
    signerPrivateKey: pair.privateKey,
    notBefore: new Date(Date.UTC(2026, 0, 1)),
    notAfter: new Date(Date.UTC(2027, 0, 1)),
    extensions: [estBasicConstraints(false), estKeyUsage(0xc0, 6)],
  })
  await prova('12-esponente-3', 'valid', await firmaCampione({ certDer: cert, privateKey: pair.privateKey }), {
    descr: 'esponente pubblico e=3: storicamente fragile, verify() non lo guarda',
  })
}

/* --- 13. NON autofirmato: leaf emesso da una CA finta costruita qui. ------------------ */
/* La demo racconta «autofirmato» come fatto costitutivo. Qui il certificato NON lo e: e emesso da
 * «Autorita Fidata SpA», che l'attaccante ha creato lui stesso cinque minuti prima. selfSigned
 * diventa false, e la storia che la pagina racconta cambia — ma il verdetto no. */
{
  const ca = await generateKeyPair()
  const caSpki = await exportPublicKeySpki(ca.publicKey)
  const caCert = await costruisciCert({
    subject: [cnAttr('Autorita Fidata SpA')],
    issuer: [cnAttr('Autorita Fidata SpA')],
    subjectSpkiDer: caSpki,
    signerPrivateKey: ca.privateKey,
    notBefore: new Date(Date.UTC(2025, 0, 1)),
    notAfter: new Date(Date.UTC(2035, 0, 1)),
    extensions: [estBasicConstraints(true), estKeyUsage(0x04, 5)], // keyCertSign
  })
  const leaf = await generateKeyPair()
  const leafSpki = await exportPublicKeySpki(leaf.publicKey)
  const leafCert = await costruisciCert({
    subject: [cnAttr('Lorenzo Rossi')],
    issuer: [cnAttr('Autorita Fidata SpA')], // emesso dalla CA finta
    subjectSpkiDer: leafSpki,
    signerPrivateKey: ca.privateKey, // firmato DALLA CA, non da se stesso
    notBefore: new Date(Date.UTC(2026, 0, 1)),
    notAfter: new Date(Date.UTC(2027, 0, 1)),
    extensions: [estBasicConstraints(false), estKeyUsage(0xc0, 6)],
  })
  // Nel CMS mettiamo la leaf; la firma dei signed-attrs e fatta con la privata della leaf.
  await prova('13-non-autofirmato', 'valid', await firmaCampione({ certDer: leafCert, privateKey: leaf.privateKey }), {
    descr: 'certificato NON autofirmato: soggetto «Lorenzo Rossi», emittente «Autorita Fidata SpA» (CA inventata)',
  })
  // Deposito anche il certificato della CA finta, cosi la catena e ispezionabile.
  writeFileSync(join(OUT, '13-ca-finta.der'), caCert)
}

/* --- 14. GEMELLI: due certificati con lo STESSO Common Name e lo STESSO seriale. ------ */
/* Impossibile avere due certificati con la stessa impronta SHA-256; ma stesso CN e stesso seriale
 * si costruiscono in un attimo, e sono i due campi che un umano usa per «riconoscere» un
 * certificato. A distinguerli resta solo l'impronta. Produciamo DUE file firmati. */
{
  const serialeCondiviso = serialeCasuale()
  const gemello = async (nome) => {
    const pair = await generateKeyPair()
    const spki = await exportPublicKeySpki(pair.publicKey)
    const cert = await costruisciCert({
      subject: [cnAttr('Lorenzo Rossi')],
      issuer: [cnAttr('Lorenzo Rossi')],
      subjectSpkiDer: spki,
      signerPrivateKey: pair.privateKey,
      notBefore: new Date(Date.UTC(2026, 0, 1)),
      notAfter: new Date(Date.UTC(2027, 0, 1)),
      serial: serialeCondiviso, // <-- stesso seriale
      extensions: [estBasicConstraints(false), estKeyUsage(0xc0, 6)],
    })
    return prova(nome, 'valid', await firmaCampione({ certDer: cert, privateKey: pair.privateKey }), {
      descr: 'gemello: stesso CN «Lorenzo Rossi» e stesso seriale ' + toHex(serialeCondiviso),
      serialeCondiviso: toHex(serialeCondiviso),
    })
  }
  const a = await gemello('14a-gemello-serial-condiviso')
  const b = await gemello('14b-gemello-serial-condiviso')
  console.log('\n  GEMELLI: seriale', toHex(serialeCondiviso))
  console.log('  14a impronta:', a.nostro.fingerprint)
  console.log('  14b impronta:', b.nostro.fingerprint)
  console.log('  distinti solo dall\'impronta:', a.nostro.fingerprint !== b.nostro.fingerprint)
}

/* --- 15. Il mostro: tutto insieme, e ancora `valid`. --------------------------------- */
/* Scaduto + CA:TRUE + keyUsage che vieta la firma + EKU per firmare codice + CN omografo. Un
 * certificato che ogni singolo controllo X.509 rifiuterebbe, e che verify() accetta lo stesso. */
{
  const pair = await generateKeyPair()
  const spki = await exportPublicKeySpki(pair.publicKey)
  const cert = await costruisciCert({
    subject: [cnAttr('Lоrеnzо Rоssi')],
    issuer: [cnAttr('Lоrеnzо Rоssi')],
    subjectSpkiDer: spki,
    signerPrivateKey: pair.privateKey,
    notBefore: new Date(Date.UTC(2010, 0, 1)),
    notAfter: new Date(Date.UTC(2011, 0, 1)), // scaduto da quindici anni
    extensions: [estBasicConstraints(true), estKeyUsage(0x20, 5), estEku('1.3.6.1.5.5.7.3.3')],
  })
  await prova('15-mostro-tutto-insieme', 'valid', await firmaCampione({ certDer: cert, privateKey: pair.privateKey }), {
    descr: 'scaduto + CA:TRUE + keyUsage keyEncipherment + EKU codeSigning + CN cirillico: ogni controllo lo rifiuterebbe',
  })
}

/* ------------------------------------------------------------------------------------- */
/* Riepilogo su disco                                                                      */
/* ------------------------------------------------------------------------------------- */

writeFileSync(join(OUT, 'esiti.json'), JSON.stringify(esiti, null, 2))

console.log('\n\n===================== RIEPILOGO =====================')
for (const e of esiti) {
  const oss = e.openssl
  console.log(
    `${e.nome.padEnd(32)} nostro=${e.nostro.verdetto.padEnd(8)}` +
      ` self=${String(e.nostro.selfSigned).padEnd(5)}` +
      ` scadutoOpenssl=${String(oss.scadutoAdesso).padEnd(5)}` +
      ` CA=${/CA:TRUE/.test(oss.basicConstraints ?? '') ? 'SI' : 'no'}` +
      ` pdfsigCert=${(e.pdfsig.certificato[0] ?? '-')}`,
  )
}
console.log(`\n${esiti.length} file prodotti in ${OUT}`)
console.log('esiti completi in out/esiti.json')
