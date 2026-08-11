/**
 * terzi.mjs — il parere degli strumenti che non sanno niente di questo progetto.
 *
 * Il prompt del collaudo impone una regola che vale come criterio di accettazione: per ogni
 * attacco, il verdetto di `verify()` va SEMPRE confrontato con quello di `pdfsig` e di
 * `openssl`. Una divergenza da uno strumento terzo e un rilievo anche quando il nostro verdetto
 * sembra piu severo — perche vuol dire che due verificatori guardano lo stesso file e vedono due
 * documenti diversi, ed e esattamente il tipo di cosa su cui si costruisce un attacco.
 *
 * Questo modulo esiste perche quel confronto non sia facoltativo ne riscritto ogni volta in modo
 * leggermente diverso: `pareri(file)` restituisce, per un PDF qualunque, i quattro giudizi
 * affiancati e riproducibili a mano. Ogni campo porta con se il COMANDO che lo ha prodotto, cosi
 * chi legge un rilievo in docs/vulnerabilita.md puo rieseguirlo dal vivo.
 *
 * I quattro pareri:
 *
 *   nostro     src/core/verify.js — verdetto a tre stati, copertura, digest, firma, identita,
 *              e la voce per OGNI firma trovata.
 *   pdfsig     poppler 26.07 — legge l'/AcroForm, quindi vede solo le firme REGISTRATE nel
 *              documento: la divergenza col nostro conteggio e un dato, non un guasto.
 *   openssl    3.6.3 — non sa niente di PDF. Gli si passa il CMS estratto dal /Contents e i byte
 *              che il /ByteRange dichiara di coprire: dice se quella matematica torna, e basta.
 *              E il giudice piu duro, perche non ha nessuna opinione sul contenitore.
 *   pdftotext  poppler — cosa LEGGE un essere umano che apre il file. Non e un verificatore:
 *              serve a misurare la distanza fra cio che il documento dice e cio che la firma
 *              copre, che e il cuore di meta degli attacchi.
 *
 * Nessuno dei quattro puo far fallire il chiamante: uno strumento che si rifiuta di leggere un
 * file rotto e a sua volta un dato da riportare, non un incidente. Ogni campo puo valere
 * `{ errore: '...' }` e il confronto prosegue.
 *
 * Uso come modulo:
 *   import { pareri, stampaPareri } from '../comune/terzi.mjs'
 *   const p = await pareri('/percorso/attacco.pdf')
 *
 * Uso da riga di comando (un file o piu):
 *   node scripts/collaudo/comune/terzi.mjs out/attacco.pdf
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { verify } from '../../../src/core/verify.js'
import { fromAscii, fromHex, indexOf } from '../../../src/core/bytes.js'

export const RADICE = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/** Il database NSS vuoto che pdfsig si aspetta: senza, si lamenta invece di giudicare. */
const NSS = `sql:${process.env.HOME}/.pki/nssdb`

/* ------------------------------------------------------------------------------------- */
/* Esecuzione di comandi esterni                                                           */
/* ------------------------------------------------------------------------------------- */

/**
 * Esegue un comando e restituisce sempre un oggetto, mai un'eccezione.
 * `stato` e il codice di uscita: per openssl e proprio quello a portare il verdetto.
 */
export function esegui(comando, argomenti, opzioni = {}) {
  const riga = [comando, ...argomenti.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))].join(' ')
  try {
    const uscita = execFileSync(comando, argomenti, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      ...opzioni,
    })
    return { comando: riga, stato: 0, uscita: uscita.trim(), errori: '' }
  } catch (problema) {
    return {
      comando: riga,
      stato: problema.status ?? -1,
      uscita: String(problema.stdout ?? '').trim(),
      errori: String(problema.stderr ?? problema.message ?? '').trim(),
    }
  }
}

/* ------------------------------------------------------------------------------------- */
/* 1. Il nostro verdetto                                                                   */
/* ------------------------------------------------------------------------------------- */

/** Il risultato di verify() ridotto a cio che si mette in tabella, con tutte le firme. */
export async function parereNostro(bytes) {
  const r = await verify(bytes)
  return {
    comando: `node -e 'verify(bytes)'  (src/core/verify.js)`,
    verdetto: r.verdict,
    reason: r.reason,
    error: r.error,
    firme: r.signatures.length,
    multipleSignatures: r.multipleSignatures,
    copertura: r.coverage && {
      byteRange: r.coverage.byteRange,
      fileLength: r.coverage.fileLength,
      coveredBytes: r.coverage.coveredBytes,
      uncoveredTail: r.coverage.uncoveredTail,
      complete: r.coverage.complete,
      gapMatchesContents: r.coverage.gapMatchesContents,
    },
    digest: r.digest && { match: r.digest.match, expected: r.digest.expected, actual: r.digest.actual },
    firma: r.signature && r.signature.ok,
    identita: r.identity && {
      subjectCN: r.identity.subjectCN,
      issuerCN: r.identity.issuerCN,
      selfSigned: r.identity.selfSigned,
      fingerprint: r.identity.fingerprint,
    },
    perFirma: r.signatures.map((s) => ({
      index: s.index,
      verdetto: s.verdict,
      byteRange: s.byteRange,
      complete: s.coverage?.complete ?? null,
      gapMatchesContents: s.coverage?.gapMatchesContents ?? null,
      codaScoperta: s.coverage?.uncoveredTail ?? null,
      digest: s.digest?.match ?? null,
      firma: s.signature?.ok ?? null,
      cn: s.identity?.subjectCN ?? null,
      impronta: s.identity?.fingerprint ?? null,
      reason: s.reason,
    })),
  }
}

/* ------------------------------------------------------------------------------------- */
/* 2. pdfsig                                                                               */
/* ------------------------------------------------------------------------------------- */

/**
 * Il parere di poppler, letto FIRMA PER FIRMA.
 *
 * La lettura a blocco unico e una trappola misurata: su un file con due firme, dove la prima
 * dice «Not total document signed» e la seconda «Total document signed», un `some()` sull'intero
 * testo restituisce «copre tutto» e cancella proprio il fatto interessante. L'uscita di pdfsig si
 * spezza quindi sulle righe `Signature #N:` e ogni firma porta i suoi campi.
 */
export function parerePdfsig(percorso) {
  const e = esegui('pdfsig', ['-nssdir', NSS, percorso])
  const testo = [e.uscita, e.errori].filter(Boolean).join('\n')
  const righe = testo.split('\n').map((r) => r.trim())

  // Un blocco per firma: si apre a «Signature #N:» e si chiude all'inizio del successivo.
  const blocchi = []
  for (const riga of righe) {
    if (/^Signature #\d+:/.test(riga)) blocchi.push([])
    else if (blocchi.length > 0) blocchi[blocchi.length - 1].push(riga)
  }

  const campo = (blocco, etichetta) => {
    const riga = blocco.find((r) => r.startsWith(`- ${etichetta}:`))
    return riga ? riga.slice(etichetta.length + 3).trim() : null
  }

  const firme = blocchi.map((blocco, i) => ({
    index: i,
    campo: campo(blocco, 'Signature Field Name'),
    cn: campo(blocco, 'Signer Certificate Common Name'),
    dataDichiarata: campo(blocco, 'Signing Time'),
    tipo: campo(blocco, 'Signature Type'),
    intervalli: campo(blocco, 'Signed Ranges'),
    validazione: campo(blocco, 'Signature Validation'),
    certificato: campo(blocco, 'Certificate Validation'),
    copreTutto: blocco.includes('- Total document signed')
      ? true
      : blocco.includes('- Not total document signed')
        ? false
        : null,
  }))

  return {
    comando: e.comando,
    stato: e.stato,
    quante: firme.length,
    firme,
    // I campi «del documento» sono quelli della PRIMA firma, che e la sola che possa aver
    // firmato l'originale: e la stessa convenzione di verify(), cosi il confronto e alla pari.
    copreTutto: firme[0]?.copreTutto ?? null,
    validazione: firme.map((f) => f.validazione).filter(Boolean),
    intervalli: firme.map((f) => f.intervalli).filter(Boolean),
    cn: firme.map((f) => f.cn).filter(Boolean),
    // Il giudizio di poppler TRADOTTO nella nostra scala a tre stati, per poterlo mettere nella
    // stessa colonna. E una traduzione fatta da noi, non una parola di pdfsig: il testo originale
    // resta in `testo` e va citato ogni volta che si riporta una divergenza.
    verdettoTradotto: traduciPdfsig(firme[0]),
    sintesi: sintesiPdfsig({ stato: e.stato, firme, testo }),
    testo,
  }
}

/**
 * pdfsig non ha tre stati: ha «la firma e valida?» e «il documento e coperto per intero?», che sono
 * esattamente i due assi da cui noi ricaviamo valid/extended/invalid. La traduzione e quindi diretta,
 * e vale la pena scriverla una volta sola invece di rifarla a mente davanti a ogni tabella.
 */
function traduciPdfsig(prima) {
  if (!prima) return null
  const v = prima.validazione ?? ''
  if (!/is Valid/i.test(v)) return 'invalid'
  if (prima.copreTutto === true) return 'valid'
  if (prima.copreTutto === false) return 'extended'
  return 'valid?' // firma valida ma copertura non dichiarata: caso da guardare a mano
}

function sintesiPdfsig({ stato, firme, testo }) {
  if (firme.length === 0) {
    return /does not contain any signature/i.test(testo)
      ? 'nessuna firma'
      : `nessun giudizio (uscita ${stato})`
  }
  const perFirma = firme.map((f) => {
    const v = f.validazione ?? ''
    const base = /Digest Mismatch/i.test(v)
      ? 'digest non torna'
      : /is Invalid/i.test(v)
        ? 'non valida'
        : /Unknown Validation Failure/i.test(v)
          ? 'errore ignoto'
          : /is Valid/i.test(v)
            ? 'valida'
            : 'giudizio non riconosciuto'
    const copertura = f.copreTutto === true ? 'copre tutto' : f.copreTutto === false ? 'NON copre tutto' : 'copertura non detta'
    return `#${f.index + 1} ${base}, ${copertura}`
  })
  return `${firme.length} firma/e · ${perFirma.join(' · ')}`
}

/* ------------------------------------------------------------------------------------- */
/* 3. openssl                                                                              */
/* ------------------------------------------------------------------------------------- */

/**
 * Il parere di openssl sulla matematica, firma per firma.
 *
 * Il PDF non c'entra: si estraggono dal file i byte del /Contents (il CMS) e i byte che il
 * /ByteRange dichiara di coprire, si scrivono su disco e si chiede a openssl se quella busta
 * firma quel contenuto. `-noverify` disattiva il controllo della catena di fiducia, che su un
 * certificato autofirmato fallirebbe sempre e nasconderebbe il giudizio sulla matematica: la
 * fiducia e un discorso separato, ed e dichiarato nei limiti del progetto.
 *
 * Si estrae a mano invece di usare extractSignature() per una ragione di indipendenza: se il
 * nostro parser sbagliasse a individuare la firma, un modulo che si appoggia a lui sbaglierebbe
 * allo stesso modo e il confronto non varrebbe niente. Qui si cercano i dizionari con la stessa
 * ingenuita di un attaccante armato di grep.
 */
export function parereOpenssl(bytes, cartellaLavoro) {
  const trovate = firmeGrezze(bytes)
  if (trovate.length === 0) {
    return { comando: '(nessun /ByteRange trovato nel file)', firme: [], sintesi: 'nessuna firma da passare a openssl' }
  }
  mkdirSync(cartellaLavoro, { recursive: true })

  const firme = trovate.map((f, i) => {
    const base = join(cartellaLavoro, `firma-${i}`)
    const esito = { index: i, byteRange: f.byteRange, problema: null }

    if (f.problema) return { ...esito, problema: f.problema, sintesi: 'non estraibile: ' + f.problema }

    writeFileSync(`${base}.der`, f.cms)
    // I byte coperti, cosi come il /ByteRange li dichiara. Se dichiara byte che non ci sono,
    // e proprio quello il rilievo: si riporta e non si verifica.
    const [a, b, c, d] = f.byteRange
    if (a + b > bytes.length || c + d > bytes.length || a < 0 || b < 0 || c < 0 || d < 0) {
      return {
        ...esito,
        problema: `il /ByteRange dichiara byte fuori dal file (lungo ${bytes.length})`,
        sintesi: 'intervalli fuori dal file: openssl non ha nulla da verificare',
      }
    }
    const coperti = new Uint8Array(b + d)
    coperti.set(bytes.subarray(a, a + b), 0)
    coperti.set(bytes.subarray(c, c + d), b)
    writeFileSync(`${base}-coperti.bin`, coperti)

    const v = esegui('openssl', [
      'cms', '-verify', '-inform', 'DER', '-in', `${base}.der`,
      '-content', `${base}-coperti.bin`, '-binary', '-noverify', '-out', '/dev/null',
    ])
    const struttura = esegui('openssl', ['cms', '-inform', 'DER', '-in', `${base}.der`, '-cmsout', '-noout', '-print'])
    const certs = esegui('openssl', [
      'cms', '-inform', 'DER', '-in', `${base}.der`, '-cmsout', '-noout', '-certsout', `${base}-certs.pem`,
    ])

    let certificato = { errore: certs.stato === 0 ? null : certs.errori }
    if (certs.stato === 0) {
      const date = esegui('openssl', ['x509', '-in', `${base}-certs.pem`, '-noout', '-dates', '-subject', '-issuer', '-serial', '-fingerprint', '-sha256'])
      const est = esegui('openssl', ['x509', '-in', `${base}-certs.pem`, '-noout', '-text'])
      const scaduto = esegui('openssl', ['x509', '-in', `${base}-certs.pem`, '-noout', '-checkend', '0'])
      certificato = {
        comando: date.comando,
        campi: Object.fromEntries(
          date.uscita.split('\n').map((r) => {
            const at = r.indexOf('=')
            return at === -1 ? [r, ''] : [r.slice(0, at), r.slice(at + 1)]
          }),
        ),
        // `-checkend 0` esce 0 se il certificato e ancora valido adesso, 1 se e scaduto.
        scadutoAdesso: scaduto.stato !== 0,
        keyUsage: (/X509v3 Key Usage:.*\n\s*(.+)/.exec(est.uscita) ?? [])[1]?.trim() ?? null,
        basicConstraints: (/X509v3 Basic Constraints:.*\n\s*(.+)/.exec(est.uscita) ?? [])[1]?.trim() ?? null,
        quantiCertificati: (est.uscita.match(/Certificate:/g) ?? []).length,
      }
    }

    return {
      ...esito,
      comando: v.comando,
      verificaStato: v.stato,
      verifica: v.stato === 0,
      messaggio: (v.errori || v.uscita).split('\n')[0] ?? '',
      quantiSignerInfo: (struttura.uscita.match(/signerInfo:/g) ?? []).length || contaSignerInfo(struttura.uscita),
      eContentType: (/eContentType:\s*(.+)/.exec(struttura.uscita) ?? [])[1]?.trim() ?? null,
      certificato,
      sintesi: v.stato === 0 ? 'CMS verificato' : 'CMS NON verificato',
      struttura: struttura.uscita,
    }
  })

  return {
    comando: firme[0]?.comando ?? '(nessun comando)',
    firme,
    sintesi: firme.map((f) => `#${f.index}: ${f.sintesi}`).join(' · '),
  }
}

function contaSignerInfo(stampa) {
  // openssl stampa i SignerInfo come blocchi "  signerInfo:" oppure, secondo la versione,
  // ripetendo "version:" dentro signerInfos. Si conta la forma che c'e.
  const dentro = /signerInfos:\s*\n([\s\S]*)/.exec(stampa)
  if (!dentro) return 0
  return (dentro[1].match(/^\s{4}version:/gm) ?? []).length
}

/**
 * I dizionari di firma trovati con la sola forza bruta: ogni `/ByteRange [a b c d]` del file,
 * con il `/Contents <...>` che lo segue. Deliberatamente ingenuo — e il punto di vista di chi
 * non ha il nostro parser — e serve solo a dare a openssl qualcosa da masticare.
 */
export function firmeGrezze(bytes) {
  const testo = fromAscii(bytes)
  const trovate = []
  const espressione = /\/ByteRange\s*\[\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)[^\]]*\]/g
  for (let m = espressione.exec(testo); m !== null; m = espressione.exec(testo)) {
    const byteRange = m.slice(1, 5).map(Number)
    const contentsAt = testo.indexOf('/Contents', m.index)
    if (contentsAt === -1) {
      trovate.push({ byteRange, problema: 'nessun /Contents dopo il /ByteRange' })
      continue
    }
    const apre = indexOf(bytes, '<', contentsAt)
    const chiude = indexOf(bytes, '>', apre + 1)
    if (apre === -1 || chiude === -1) {
      trovate.push({ byteRange, problema: 'il /Contents non e una stringa esadecimale chiusa' })
      continue
    }
    const hex = fromAscii(bytes.subarray(apre + 1, chiude)).replace(/[\s\0]/g, '')
    if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex) || hex.length === 0) {
      trovate.push({ byteRange, problema: 'il /Contents non e esadecimale' })
      continue
    }
    trovate.push({ byteRange, contentsStart: apre, contentsEnd: chiude, cms: potaZeri(fromHex(hex)) })
  }
  return trovate
}

/** Il CMS senza gli zeri di riempimento: openssl si ferma alla fine della struttura, ma se ne lamenta. */
function potaZeri(contenuto) {
  let fine = contenuto.length
  while (fine > 0 && contenuto[fine - 1] === 0) fine--
  return contenuto.subarray(0, fine)
}

/* ------------------------------------------------------------------------------------- */
/* 4. pdftotext: cosa legge un essere umano                                                */
/* ------------------------------------------------------------------------------------- */

export function pareroLettore(percorso) {
  const e = esegui('pdftotext', ['-layout', percorso, '-'])
  const righe = e.uscita.split('\n').map((r) => r.trim()).filter(Boolean)
  return {
    comando: e.comando,
    stato: e.stato,
    apre: e.stato === 0,
    importo: righe.find((r) => /euro/i.test(r)) ?? null,
    righe,
    errori: e.errori.split('\n').filter(Boolean).slice(0, 4),
  }
}

/* ------------------------------------------------------------------------------------- */
/* Il confronto                                                                            */
/* ------------------------------------------------------------------------------------- */

/**
 * I quattro pareri su uno stesso file, piu il giudizio sul loro accordo.
 *
 * @param {string} percorso  un PDF su disco (gli strumenti terzi vogliono un file, non byte)
 * @returns {Promise<object>}
 */
export async function pareri(percorso) {
  const bytes = new Uint8Array(readFileSync(percorso))
  const lavoro = mkdtempSync(join(tmpdir(), 'collaudo-terzi-'))
  const nostro = await parereNostro(bytes)
  const pdfsig = parerePdfsig(percorso)
  const openssl = parereOpenssl(bytes, lavoro)
  const lettore = pareroLettore(percorso)

  return {
    file: percorso,
    nome: basename(percorso),
    lunghezza: bytes.length,
    nostro,
    pdfsig,
    openssl,
    lettore,
    divergenze: divergenzeFra({ nostro, pdfsig, openssl }),
    lavoro,
  }
}

/**
 * Dove i tre verificatori NON dicono la stessa cosa. Ogni voce e un rilievo candidato: va poi
 * deciso a mano se e un difetto nostro, una prudenza voluta, o un limite dello strumento terzo.
 */
function divergenzeFra({ nostro, pdfsig, openssl }) {
  const fuori = []

  // Quante firme. pdfsig legge l'/AcroForm, noi le definizioni di oggetto: la differenza e
  // attesa e documentata in verify.js, ma va MISURATA ogni volta invece che ricordata.
  if (pdfsig.quante !== nostro.firme) {
    fuori.push({
      su: 'quante firme',
      nostro: nostro.firme,
      pdfsig: pdfsig.quante,
      nota: 'noi contiamo i dizionari di firma nel file, pdfsig i campi registrati nell /AcroForm',
    })
  }

  // IL VERDETTO COMPLESSIVO, che e la colonna centrale di ogni referto: dove i due verificatori
  // arrivano a conclusioni diverse sullo stesso file, c'e per forza qualcosa da raccontare.
  if (pdfsig.verdettoTradotto !== null && pdfsig.verdettoTradotto !== nostro.verdetto) {
    fuori.push({
      su: 'il verdetto complessivo',
      nostro: nostro.verdetto + (nostro.reason ? ` (${nostro.reason})` : ''),
      pdfsig: `${pdfsig.verdettoTradotto} — testualmente: «${pdfsig.firme[0]?.validazione ?? '?'}» + «${
        pdfsig.copreTutto === true ? 'Total document signed' : pdfsig.copreTutto === false ? 'Not total document signed' : 'copertura non dichiarata'
      }»`,
    })
  }

  // Copertura totale. E l'asse su cui si decide valid contro extended.
  const nostroCopre = nostro.copertura?.complete ?? null
  if (pdfsig.copreTutto !== null && nostroCopre !== null && pdfsig.copreTutto !== nostroCopre) {
    fuori.push({ su: 'il documento e coperto per intero', nostro: nostroCopre, pdfsig: pdfsig.copreTutto })
  }

  // La matematica. Se openssl verifica e noi diciamo che la firma non torna (o viceversa), uno
  // dei due sta guardando byte diversi: e la divergenza piu grave possibile.
  const nostraFirma = nostro.firma
  const opensslPrima = openssl.firme[0]
  if (opensslPrima && typeof opensslPrima.verifica === 'boolean' && typeof nostraFirma === 'boolean') {
    const nostraMatematica = nostraFirma && (nostro.digest?.match ?? false)
    if (opensslPrima.verifica !== nostraMatematica) {
      fuori.push({
        su: 'la matematica della firma primaria',
        nostro: nostraMatematica ? 'torna (digest + RSA)' : 'non torna',
        openssl: opensslPrima.verifica ? 'CMS verificato' : 'CMS non verificato',
        nota: opensslPrima.messaggio,
      })
    }
  }

  // Il certificato, che noi non guardiamo affatto: date, keyUsage, CA.
  //
  // La condizione su `notAfter` non e pedanteria: `openssl x509 -checkend 0` esce diverso da zero
  // anche quando il certificato non c'e proprio, e su un file col /Contents devastato quello
  // diventerebbe un «certificato scaduto» che non e mai esistito. Un rilievo inventato da un falso
  // positivo e peggio di un rilievo mancato: in sede di presentazione lo smonta la prima verifica.
  const cert = opensslPrima?.certificato
  const dateLette = Boolean(cert?.campi?.notAfter)
  if (cert && !cert.errore && dateLette) {
    if (cert.scadutoAdesso) {
      fuori.push({
        su: 'validita temporale del certificato',
        nostro: 'non guardata (verify() non legge notBefore/notAfter)',
        openssl: `scaduto: ${cert.campi?.notAfter ?? '?'}`,
      })
    }
    if (cert.basicConstraints && /CA:TRUE/.test(cert.basicConstraints)) {
      fuori.push({
        su: 'il certificato dichiara di essere una CA',
        nostro: 'non guardato',
        openssl: cert.basicConstraints,
      })
    }
  }

  return fuori
}

/* ------------------------------------------------------------------------------------- */
/* Stampa                                                                                  */
/* ------------------------------------------------------------------------------------- */

export function stampaPareri(p) {
  const l = []
  l.push(`\n=== ${p.nome}  (${p.lunghezza} byte) ===`)
  l.push(
    `  nostro     ${p.nostro.verdetto}` +
      `  firme=${p.nostro.firme}` +
      `  completa=${p.nostro.copertura?.complete ?? '-'}` +
      `  gap=${p.nostro.copertura?.gapMatchesContents ?? '-'}` +
      `  coda=${p.nostro.copertura?.uncoveredTail ?? '-'}` +
      `  digest=${p.nostro.digest?.match ?? '-'}` +
      `  rsa=${p.nostro.firma ?? '-'}` +
      (p.nostro.reason ? `  motivo=${p.nostro.reason}` : ''),
  )
  l.push(`  pdfsig     ${p.pdfsig.sintesi}${p.pdfsig.intervalli.length ? '  intervalli=' + p.pdfsig.intervalli.join(' ') : ''}`)
  l.push(`  openssl    ${p.openssl.sintesi}`)
  l.push(`  lettore    ${p.lettore.apre ? (p.lettore.importo ?? '(nessuna riga con "euro")') : 'non apre il file'}`)
  for (const d of p.divergenze) {
    l.push(`  DIVERGE su «${d.su}»: nostro=${d.nostro}  ${d.pdfsig !== undefined ? 'pdfsig=' + d.pdfsig : 'openssl=' + d.openssl}`)
  }
  return l.join('\n')
}

/* Riga di comando --------------------------------------------------------------------- */

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const file = process.argv.slice(2)
  if (file.length === 0) {
    console.error('uso: node scripts/collaudo/comune/terzi.mjs <file.pdf> [altri.pdf...]')
    process.exit(2)
  }
  for (const f of file) console.log(stampaPareri(await pareri(f)))
}
