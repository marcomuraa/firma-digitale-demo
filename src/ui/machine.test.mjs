/**
 * Prove della macchina a stati.
 *
 * Percorrono la demo INTERA in node, senza DOM: se questo file passa, le due direzioni visive
 * stanno disegnando una macchina che funziona davvero, e non un raccontino.
 *
 * I cinque esiti veri, quelli che il pubblico vedra:
 *
 *   a) documento firmato        -> verdetto `valid`, copertura completa
 *   b) attacco 1a               -> `invalid`, l'impronta non torna
 *   c) attacco 1b               -> `invalid`, e senza che niente esploda
 *   d) attacco 2                -> `extended`: firma valida, documento esteso dopo la firma
 *   e) ripristino               -> gli stessi byte del firmato integro, e di nuovo `valid`
 *
 * Attorno a quei cinque: l'immutabilita' dell'istantanea, subscribe/unsubscribe, l'ordine dei
 * passi, la storia che non si cancella, e il percorso d'errore che lascia la demo navigabile.
 *
 * NIENTE pdf.js qui dentro: src/ui/pdf-render.js non va importato, trascinerebbe 1,6 MB di
 * renderer dentro node per provare della logica che non ne ha bisogno.
 *
 * La generazione di una coppia RSA-2048 non e' istantanea: i test che la fanno hanno un timeout
 * esplicito, altrimenti su una macchina lenta fallirebbero per il motivo sbagliato.
 *
 * Si esegue con:  npm test        (node --test dalla radice; `node --test <cartella>` no)
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createDemo } from './machine.js'
import { STEP_IDS } from './steps.js'
import { SAMPLE_PDF_LENGTH, SAMPLE_PDF_SHA256, samplePdfBytes } from './sample-pdf.js'
import { ascii, equals, sha256, toHex } from '../core/bytes.js'
import { buildHexWindow } from '../views/hex-view.js'
import { buildAsn1Tree } from '../views/asn1-view.js'

const TIMEOUT = 60_000

const offsets = JSON.parse(
  readFileSync(fileURLToPath(new URL('../assets/sample-offsets.json', import.meta.url)), 'utf8'),
)

/* ------------------------------------------------------------------ un giro solo, riusato */

/**
 * La demo percorsa una volta per tutti i test che la guardano da fermi. Rifarla dodici volte
 * significherebbe dodici generazioni di chiavi RSA e nessuna prova in piu': cio' che si vuole
 * verificare e' un percorso, e il percorso e' deterministico salvo le chiavi.
 *
 * Restituisce la macchina, l'istantanea dopo ogni passo, e gli ordini in cui e' stata usata.
 */
let giroCompleto = null
function demoPercorsa() {
  if (giroCompleto === null) giroCompleto = percorri()
  return giroCompleto
}

async function percorri() {
  const demo = createDemo()
  const dopo = {}
  const ripristini = {}
  for (const passo of demo.steps) {
    dopo[passo] = await demo.run(passo)
    // Fra un attacco e l'altro il documento torna integro: e' l'azione che la demo compie
    // davvero in pubblico, quindi la si compie anche qui.
    if (passo === 'attacco-cifra' || passo === 'attacco-lettere') {
      ripristini[passo] = demo.restoreSigned()
    }
  }
  return { demo, dopo, ripristini, finale: demo.getState() }
}

/* ------------------------------------------------------------------ il campione incorporato */

test('sample-pdf.js decodifica esattamente i byte del campione congelato', async () => {
  const byte = samplePdfBytes()
  assert.equal(byte.length, SAMPLE_PDF_LENGTH)
  assert.equal(byte.length, offsets.fileLength)
  const impronta = toHex(await sha256(byte))
  assert.equal(impronta, SAMPLE_PDF_SHA256)
  assert.equal(
    impronta,
    offsets.sha256,
    'i byte incorporati in sample-pdf.js non sono quelli per cui gli offset sono stati congelati',
  )
})

test('samplePdfBytes() restituisce ogni volta un array nuovo', () => {
  const primo = samplePdfBytes()
  const secondo = samplePdfBytes()
  assert.notEqual(primo, secondo)
  primo[0] = 0
  assert.equal(secondo[0], 0x25, 'chi scrive sui byte ricevuti non deve toccare la copia successiva')
})

/* ------------------------------------------------------------------ forma e ordine */

test('steps e' + " l'elenco chiuso di steps.js, nello stesso ordine, e non si puo' riscrivere", () => {
  const demo = createDemo()
  assert.deepEqual([...demo.steps], STEP_IDS)
  assert.ok(Object.isFrozen(demo.steps))
})

test('lo stato iniziale e vuoto e dichiarato: nessun passo fatto, nessun documento', () => {
  const stato = createDemo().getState()
  assert.equal(stato.passoCorrente, null)
  assert.deepEqual(stato.passiFatti, [])
  assert.equal(stato.inCorso, null)
  assert.equal(stato.documento, null)
  assert.equal(stato.righello, null)
  assert.deepEqual(stato.evidenziazioni, [])
  assert.equal(stato.chiavi, null)
  assert.equal(stato.certificato, null)
  assert.equal(stato.cms, null)
  assert.equal(stato.byteRange, null)
  assert.equal(stato.contentsStart, null)
  assert.equal(stato.impronta, null)
  assert.equal(stato.verdetto, null)
  assert.equal(stato.verifica, null)
  assert.equal(stato.errore, null)
  assert.equal(stato.ripristinato, false)
  assert.deepEqual(stato.risultati, {})
})

test('canRun rifiuta i passi fuori ordine, e li accetta uno alla volta', async () => {
  const demo = createDemo()
  assert.equal(demo.canRun('documento'), true)
  for (const passo of STEP_IDS.slice(1)) {
    assert.equal(demo.canRun(passo), false, `${passo} non dovrebbe essere eseguibile per primo`)
  }
  assert.equal(demo.canRun('passo-inventato'), false)
  assert.equal(demo.canRun(null), false)
  assert.equal(demo.canRun(undefined), false)

  await demo.run('documento')
  assert.equal(demo.canRun('chiavi'), true)
  assert.equal(demo.canRun('certificato'), false, 'salta ancora un passo')
  assert.equal(demo.canRun('documento'), false, 'un passo gia fatto non si ripete')
})

test('un passo fuori ordine non esplode: mette un errore in italiano e lascia lo stato intatto', async () => {
  const demo = createDemo()
  const stato = await demo.run('firma')
  assert.equal(stato.errore.passo, 'firma')
  assert.match(stato.errore.messaggio, /Prima del passo/)
  assert.match(stato.errore.messaggio, /documento/)
  assert.deepEqual(stato.passiFatti, [])
  assert.equal(stato.documento, null)

  const sconosciuto = await demo.run('non-esiste')
  assert.equal(sconosciuto.errore.passo, null)
  assert.match(sconosciuto.errore.messaggio, /non e' uno dei dodici passi/)
})

/* ------------------------------------------------------------------ i cinque esiti veri */

test('a) il documento firmato: verdetto valid, copertura completa, una firma sola', { timeout: TIMEOUT }, async () => {
  const { dopo } = await demoPercorsa()
  const stato = dopo.verifica

  assert.equal(stato.verdetto, 'valid')
  assert.equal(stato.documento.etichetta, 'firmato')
  assert.equal(stato.verifica.verdict, 'valid')
  assert.equal(stato.verifica.coverage.complete, true)
  assert.equal(stato.verifica.coverage.uncoveredTail, 0)
  assert.equal(stato.verifica.digest.match, true)
  assert.equal(stato.verifica.signature.ok, true)
  assert.equal(stato.verifica.multipleSignatures, false)
  assert.equal(stato.verifica.signatures.length, 1)
  assert.equal(stato.verifica.identity.selfSigned, true)
  assert.equal(stato.verifica.identity.subjectCN, 'Lorenzo Rossi')
  assert.equal(stato.verifica.error, null)

  // Il righello dice la stessa cosa del verdetto, e la dice sull'asse giusto.
  assert.equal(stato.righello.coverage.complete, true)
  assert.equal(stato.righello.coverage.tailBytes, 0)
  assert.equal(
    stato.righello.coverage.coveredBytes + stato.righello.coverage.holeBytes,
    stato.documento.lunghezza,
  )
})

test('b) attacco 1a: un byte dentro la copertura, verdetto invalid, impronta che non torna', { timeout: TIMEOUT }, async () => {
  const { dopo } = await demoPercorsa()
  const stato = dopo['attacco-cifra']
  const risultato = stato.risultati['attacco-cifra']

  assert.equal(stato.verdetto, 'invalid')
  assert.equal(stato.documento.etichetta, 'manomesso-cifra')
  assert.equal(stato.verifica.digest.match, false)
  assert.equal(stato.verifica.signature.ok, true, 'la firma e sempre la stessa: e il documento a essere cambiato')
  assert.equal(risultato.offset, offsets.amount.digitOffset)
  assert.equal(risultato.da, '1')
  assert.equal(risultato.a, '9')
  assert.equal(risultato.deltaLunghezza, 0)
  assert.equal(stato.documento.lunghezza, dopo.verifica.documento.lunghezza)
  assert.equal(stato.documento.bytes[risultato.offset], 0x39)

  // Il byte cambiato e' evidenziato dove e' cambiato davvero, e il bersaglio era li' da prima.
  const cambiato = stato.evidenziazioni.find((e) => e.kind === 'changed')
  assert.equal(cambiato.start, offsets.amount.digitOffset)
  assert.equal(cambiato.end, offsets.amount.digitOffset + 1)
  assert.deepEqual(
    stato.bersagli['attacco-cifra'].map((b) => [b.start, b.end, b.kind]),
    [[offsets.amount.digitOffset, offsets.amount.digitOffset + 1, 'target']],
  )
})

test('c) attacco 1b: verdetto invalid, struttura incoerente misurata, e nessuna eccezione', { timeout: TIMEOUT }, async () => {
  const { dopo } = await demoPercorsa()
  const stato = dopo['attacco-lettere']
  const risultato = stato.risultati['attacco-lettere']

  assert.equal(stato.errore, null, 'un file strutturalmente rotto non e un errore della macchina')
  assert.equal(stato.verdetto, 'invalid')
  assert.equal(stato.documento.etichetta, 'manomesso-lettere')
  assert.equal(risultato.deltaLunghezza, 3)
  assert.equal(stato.documento.lunghezza, dopo.verifica.documento.lunghezza + 3)
  assert.equal(risultato.lunghezzaRotta, true)
  assert.equal(risultato.xrefRotta, true)
  assert.equal(risultato.prove.length.declared, 650)
  assert.equal(risultato.prove.length.actual, 653)

  // docs/stato.md punto 2: il renderer NON si rifiuta. Nessun codice qui deve aspettarselo.
  assert.equal(risultato.ilRendererApreLoStesso, true)
  assert.equal(risultato.testoDopo, '1.000 euro (novemila euro)')

  // Il righello regge su un file incoerente, e resta una tassellatura.
  assert.notEqual(stato.righello, null)
  verificaTassellatura(stato.righello, stato.documento.lunghezza)
})

test('d) attacco 2: verdetto extended, firma ancora valida, coda fuori dalla copertura', { timeout: TIMEOUT }, async () => {
  const { dopo } = await demoPercorsa()
  const stato = dopo['attacco-coda']
  const risultato = stato.risultati['attacco-coda']

  assert.equal(stato.verdetto, 'extended')
  assert.equal(stato.documento.etichetta, 'esteso-in-coda')
  assert.equal(stato.verifica.digest.match, true)
  assert.equal(stato.verifica.signature.ok, true)
  assert.equal(stato.verifica.coverage.complete, false)
  assert.ok(stato.verifica.coverage.uncoveredTail > 0)
  assert.equal(stato.verifica.coverage.uncoveredTail, risultato.byteAppesi)

  // La coda spunta fuori dalla parte coperta, ed e' esattamente cio' che il righello disegna.
  assert.equal(stato.righello.coverage.tailBytes, risultato.byteAppesi)
  const coda = stato.righello.segments.filter((s) => s.kind === 'tail')
  assert.equal(coda.length, 1)
  assert.equal(coda[0].start, risultato.appendedFrom)
  assert.equal(coda[0].end, stato.documento.lunghezza)
  assert.equal(coda[0].covered, false)
  assert.equal(
    stato.righello.marks.find((m) => m.kind === 'tail').offset,
    risultato.appendedFrom,
    'la tacca di fine copertura e il punto in cui l attacco 2 diventa visibile',
  )

  // Il bersaglio dell'attacco 2 e' vuoto apposta: non tocca nessun byte gia' scritto.
  assert.deepEqual(stato.bersagli['attacco-coda'], [])
})

test('e) il ripristino riporta agli stessi byte del firmato integro, e di nuovo a valid', { timeout: TIMEOUT }, async () => {
  const { dopo, ripristini } = await demoPercorsa()
  const firmato = dopo.firma.documento.bytes

  for (const attacco of ['attacco-cifra', 'attacco-lettere']) {
    const ripristinato = ripristini[attacco]
    assert.equal(ripristinato.documento.etichetta, 'firmato')
    assert.equal(ripristinato.documento.lunghezza, firmato.length)
    assert.ok(
      equals(ripristinato.documento.bytes, firmato),
      `dopo ${attacco} il ripristino deve riportare gli stessi identici byte`,
    )
    assert.equal(ripristinato.verdetto, 'valid')
    assert.equal(ripristinato.verifica.coverage.complete, true)
    assert.equal(ripristinato.ripristinato, true)
    assert.equal(ripristinato.errore, null)
    // Le evidenziazioni tornano quelle del passo `verifica`: i byte cambiati non ci sono piu'.
    assert.equal(ripristinato.evidenziazioni.every((e) => e.kind !== 'changed'), true)
    assert.equal(ripristinato.righello.coverage.tailBytes, 0)
  }
})

/* ------------------------------------------------------------------ la storia non si cancella */

test('i pannelli si impilano: dopo gli attacchi il materiale di «verifica» e ancora intatto', { timeout: TIMEOUT }, async () => {
  const { dopo, finale } = await demoPercorsa()

  const appenaVerificato = dopo.verifica.risultati.verifica
  const allaFine = finale.risultati.verifica
  assert.deepEqual(allaFine, appenaVerificato)
  assert.equal(allaFine.verdetto, 'valid')
  assert.equal(allaFine.esito.coverage.complete, true)
  assert.equal(allaFine.righello.coverage.tailBytes, 0)

  // E ogni passo eseguito ha lasciato il suo blocco, nessuno escluso.
  assert.deepEqual(finale.passiFatti, STEP_IDS)
  assert.deepEqual(Object.keys(finale.risultati).sort(), [...STEP_IDS].sort())
  for (const passo of STEP_IDS) assert.equal(finale.risultati[passo].passo, passo)
})

test('il ripristino non tocca la storia: passi fatti, passo corrente e risultati restano', { timeout: TIMEOUT }, async () => {
  const { dopo, ripristini } = await demoPercorsa()
  const prima = dopo['attacco-cifra']
  const poi = ripristini['attacco-cifra']

  assert.deepEqual(poi.passiFatti, prima.passiFatti)
  assert.equal(poi.passoCorrente, 'attacco-cifra')
  assert.deepEqual(poi.risultati['attacco-cifra'], prima.risultati['attacco-cifra'])
  assert.equal(
    poi.risultati['attacco-cifra'].verdetto,
    'invalid',
    'il pannello dell attacco resta in pagina con il suo verdetto rosso',
  )
})

test('reset cancella la storia e riporta allo stato iniziale', { timeout: TIMEOUT }, async () => {
  const demo = createDemo()
  await demo.run('documento')
  await demo.run('chiavi')
  assert.equal(demo.getState().passiFatti.length, 2)

  const azzerato = demo.reset()
  assert.deepEqual(azzerato.passiFatti, [])
  assert.deepEqual(azzerato.risultati, {})
  assert.equal(azzerato.passoCorrente, null)
  assert.equal(azzerato.documento, null)
  assert.equal(azzerato.chiavi, null)
  assert.equal(demo.canRun('documento'), true)
  assert.equal(demo.canRun('chiavi'), false, 'dopo il reset si ricomincia dal primo passo')
})

test('restoreSigned prima della firma non esplode: dice in italiano che non c e nulla a cui tornare', () => {
  const demo = createDemo()
  const stato = demo.restoreSigned()
  assert.equal(stato.documento, null)
  assert.match(stato.errore.messaggio, /nessun documento firmato/)
  assert.equal(demo.canRun('documento'), true, 'la demo resta navigabile')
})

/* --------------------------------------------------- azioni sincrone MENTRE un passo gira
 *
 * Tre cose sono cliccabili in qualunque momento (docs/contratti-dom.md rende obbligatori
 * [data-passo], [data-azione="ripristina"] e [data-azione="reset"], ed espone window.__demo).
 * Un passo asincrono in volo e un clic sono percio' due scritture che si intrecciano, e il
 * modo di rompersi e' silenzioso: un pannello congelato che racconta un documento diverso da
 * quello che il suo passo ha prodotto, oppure un passo «fatto» senza i suoi effetti.
 */

test('restoreSigned mentre gira un attacco: rifiutato, e il pannello congelato resta quello dell attacco', { timeout: TIMEOUT }, async () => {
  const demo = createDemo()
  for (const passo of ['documento', 'chiavi', 'certificato', 'placeholder', 'impronta', 'cms', 'firma', 'verifica']) {
    await demo.run(passo)
  }

  // Il clic su «ripristina» arriva mentre l'attacco sta ancora girando.
  const inVolo = demo.run('attacco-cifra')
  const durante = demo.restoreSigned()
  assert.equal(durante.errore.passo, 'attacco-cifra')
  assert.match(durante.errore.messaggio, /sta ancora girando: il ripristino si fa a macchina ferma/)
  assert.equal(durante.ripristinato, false, 'un ripristino rifiutato non e un ripristino avvenuto')
  await inVolo

  const stato = demo.getState()
  const pannello = stato.risultati['attacco-cifra']
  const offset = offsets.amount.digitOffset

  // Il pannello dell'attacco e' autosufficiente: byte, verdetto, evidenziazioni e righello
  // sono quelli di QUEL momento, non quelli che un'altra azione ha messo nello stato dopo.
  assert.equal(pannello.verdetto, 'invalid')
  assert.equal(pannello.bytes[offset], 0x39)
  assert.deepEqual(
    pannello.evidenziazioni.map((e) => [e.kind, e.start, e.end]),
    [['changed', offset, offset + 1]],
  )
  assert.equal(pannello.righello.fileLength, pannello.lunghezza)

  // E lo stato corrente e' quello dell'attacco, non un ibrido: il ripristino non e' avvenuto.
  assert.equal(stato.documento.etichetta, 'manomesso-cifra')
  assert.equal(stato.documento.bytes[offset], 0x39)
  assert.equal(stato.verdetto, 'invalid')

  // A macchina ferma il ripristino funziona, ed e' l'unica differenza: il momento.
  const dopo = demo.restoreSigned()
  assert.equal(dopo.ripristinato, true)
  assert.equal(dopo.documento.etichetta, 'firmato')
  assert.equal(dopo.documento.bytes[offset], 0x31)
  assert.deepEqual(
    dopo.risultati['attacco-cifra'].evidenziazioni.map((e) => e.kind),
    ['changed'],
    'il pannello congelato non cambia nemmeno adesso: regola 1',
  )
})

test('reset mentre gira il primo passo: nessun passo «fatto» senza il documento che produce', { timeout: TIMEOUT }, async () => {
  const demo = createDemo()
  const inVolo = demo.run('documento')
  demo.reset()
  await inVolo

  const stato = demo.getState()
  assert.deepEqual(stato.passiFatti, [], 'cio che e stato calcolato appartiene a una demo che non esiste piu')
  assert.equal(stato.passoCorrente, null)
  assert.deepEqual(stato.risultati, {})
  assert.equal(stato.documento, null)
  assert.equal(stato.righello, null)
  assert.equal(stato.inCorso, null)

  // E la demo si ripercorre da capo: nessun vicolo cieco, nessun secondo reset necessario.
  await demo.run('documento')
  assert.equal(demo.getState().documento.etichetta, 'originale')
  assert.deepEqual(demo.getState().passiFatti, ['documento'])
})

test('reset mentre girano le chiavi: si ricomincia davvero, fino a un verdetto valid', { timeout: TIMEOUT }, async () => {
  const demo = createDemo()
  await demo.run('documento')

  // `chiavi` e' il passo piu' lungo (RSA-2048): e' li' che un clic su «ricomincia» capita.
  const inVolo = demo.run('chiavi')
  demo.reset()
  await inVolo

  const dopoIlReset = demo.getState()
  assert.deepEqual(dopoIlReset.passiFatti, [])
  assert.equal(dopoIlReset.chiavi, null)
  assert.deepEqual(dopoIlReset.risultati, {})
  assert.equal(
    dopoIlReset.passiFatti.includes('chiavi'),
    dopoIlReset.chiavi !== null,
    'passiFatti e gli effetti del passo non possono raccontare due storie diverse',
  )
  assert.equal(demo.canRun('documento'), true)
  assert.equal(demo.canRun('chiavi'), false, 'si riparte dal primo passo, non da meta strada')

  // La prova che non e' un vicolo cieco: la demo arriva di nuovo in fondo alla firma.
  for (const passo of ['documento', 'chiavi', 'certificato', 'placeholder', 'impronta', 'cms', 'firma', 'verifica']) {
    const stato = await demo.run(passo)
    assert.equal(stato.errore, null, `il passo «${passo}» dopo un reset a caldo doveva riuscire`)
  }
  assert.equal(demo.getState().verdetto, 'valid')
})

/* ------------------------------------------------------------------ immutabilita' */

test('getState e una istantanea: chi la modifica non tocca la macchina', { timeout: TIMEOUT }, async () => {
  const demo = createDemo()
  await demo.run('documento')

  const primo = demo.getState()
  const secondo = demo.getState()
  assert.notEqual(primo, secondo, 'ogni chiamata restituisce un oggetto nuovo')
  assert.notEqual(primo.documento.bytes, secondo.documento.bytes)
  assert.ok(Object.isFrozen(primo))
  assert.ok(Object.isFrozen(primo.documento))
  assert.ok(Object.isFrozen(primo.risultati.documento))
  assert.ok(Object.isFrozen(primo.evidenziazioni))

  // Scritture di ogni genere sull'istantanea: la macchina non se ne accorge.
  primo.documento.bytes[0] = 0
  primo.documento.bytes[1] = 0
  try {
    primo.passoCorrente = 'firma'
    primo.passiFatti.push('firma')
    primo.risultati.documento.lunghezza = 42
    delete primo.righello
  } catch {
    // in modulo ES le scritture su un oggetto congelato lanciano: va benissimo lo stesso
  }

  const dopo = demo.getState()
  assert.equal(dopo.passoCorrente, 'documento')
  assert.deepEqual(dopo.passiFatti, ['documento'])
  assert.equal(dopo.risultati.documento.lunghezza, offsets.fileLength)
  assert.equal(dopo.documento.bytes[0], 0x25, 'i byte della macchina sono intatti')
  assert.equal(dopo.documento.bytes[1], 0x50)
  assert.notEqual(dopo.righello, undefined)
})

/* ------------------------------------------------------------------ abbonati */

test('subscribe riceve ogni cambio, unsubscribe smette di riceverli', { timeout: TIMEOUT }, async () => {
  const demo = createDemo()
  const visti = []
  const unsubscribe = demo.subscribe((stato) => visti.push(stato.inCorso ?? stato.passoCorrente))

  await demo.run('documento')
  // due notifiche: una all'avvio del passo (inCorso), una alla fine
  assert.deepEqual(visti, ['documento', 'documento'])
  assert.equal(typeof unsubscribe, 'function')

  visti.length = 0
  unsubscribe()
  await demo.run('chiavi')
  assert.deepEqual(visti, [], 'dopo unsubscribe non arriva piu niente')
  unsubscribe() // idempotente: chiamarla due volte non lancia

  assert.throws(() => demo.subscribe('non una funzione'), TypeError)
})

test('l istantanea passata all abbonato e gia quella nuova', { timeout: TIMEOUT }, async () => {
  const demo = createDemo()
  let ultima = null
  demo.subscribe((stato) => {
    ultima = stato
  })
  await demo.run('documento')
  assert.equal(ultima.passoCorrente, 'documento')
  assert.equal(ultima.documento.lunghezza, offsets.fileLength)
  assert.ok(Object.isFrozen(ultima))
})

test('un abbonato che lancia non ferma la macchina ne gli altri abbonati', { timeout: TIMEOUT }, async () => {
  const demo = createDemo()
  let arrivate = 0
  demo.subscribe(() => {
    throw new Error('io lancio sempre')
  })
  demo.subscribe(() => {
    arrivate++
  })

  const errori = []
  const originale = console.error
  console.error = (...argomenti) => errori.push(argomenti)
  try {
    await demo.run('documento')
  } finally {
    console.error = originale
  }

  assert.equal(demo.getState().passoCorrente, 'documento')
  assert.equal(arrivate, 2)
  assert.equal(errori.length, 2, "l'errore dell abbonato si vede, non viene inghiottito")
})

/* ------------------------------------------------------------------ percorso d'errore */

test('un passo che fallisce mette un errore in italiano e lascia la demo navigabile', { timeout: TIMEOUT }, async () => {
  // Un documento che non e' un PDF: la catena regge fino a dove puo', poi il placeholder si
  // ferma perche' non trova la struttura che gli serve.
  const demo = createDemo({ pdfBytes: ascii('non sono un PDF, e non lo sono mai stato\n') })
  await demo.run('documento')
  await demo.run('chiavi')
  await demo.run('certificato')

  const stato = await demo.run('placeholder')
  assert.equal(stato.errore.passo, 'placeholder')
  assert.match(stato.errore.messaggio, /Il passo «placeholder» non e' riuscito/)
  assert.ok(stato.errore.messaggio.length > 40, "l'errore spiega, non si limita a un codice")

  // Lo stato di prima e' intatto e la demo si puo' ancora usare.
  assert.deepEqual(stato.passiFatti, ['documento', 'chiavi', 'certificato'])
  assert.equal(stato.passoCorrente, 'certificato')
  assert.equal(stato.documento.etichetta, 'originale')
  assert.equal(stato.byteRange, null)
  assert.notEqual(stato.chiavi, null)
  assert.notEqual(stato.certificato, null)
  assert.equal(stato.inCorso, null)

  // Un passo fallito non risulta fatto: si puo' ritentare (e rifallire, senza esplodere).
  assert.equal(demo.canRun('placeholder'), true)
  const secondoTentativo = await demo.run('placeholder')
  assert.equal(secondoTentativo.errore.passo, 'placeholder')

  // E il reset rimette tutto in piedi.
  assert.deepEqual(demo.reset().passiFatti, [])
})

test('regola 4 fino in fondo: nemmeno uno stepId ostile fa uscire un eccezione', async () => {
  const demo = createDemo()
  const ostili = [
    null,
    undefined,
    42,
    { toString() { throw new Error('boom') } },
    { [Symbol.toPrimitive]() { throw new Error('boom') } },
    Symbol('firma'),
    ['firma'],
  ]
  for (const ostile of ostili) {
    assert.equal(demo.canRun(ostile), false, 'canRun non deve lanciare, deve dire di no')
    const stato = await demo.run(ostile)
    assert.equal(stato.errore.passo, null, 'non e uno dei dodici passi: nessun passo da incolpare')
    assert.match(stato.errore.messaggio, /non e' uno dei dodici passi della demo\./)
  }
  assert.equal(demo.canRun('documento'), true, 'la demo resta navigabile')
})

test('i byte passati a createDemo restano del chiamante: la macchina ne tiene una copia', { timeout: TIMEOUT }, async () => {
  const miei = samplePdfBytes()
  const demo = createDemo({ pdfBytes: miei })
  await demo.run('documento')

  const offset = offsets.amount.digitOffset
  miei[offset] = 0x39 // il chiamante scrive sul SUO array, dopo

  const stato = demo.getState()
  assert.equal(stato.documento.bytes[offset], 0x31, 'il documento della demo non si cambia da fuori')
  assert.equal(stato.risultati.documento.bytes[offset], 0x31)
})

test('un documento vuoto non passa il primo passo, e lo dice', async () => {
  const demo = createDemo({ pdfBytes: new Uint8Array(0) })
  const stato = await demo.run('documento')
  assert.equal(stato.errore.passo, 'documento')
  assert.equal(stato.documento, null)
  assert.deepEqual(stato.passiFatti, [])
})

/* ------------------------------------------------------------------ il righello */

test('il righello si rifa a ogni cambio dei byte e tassella sempre l intero file', { timeout: TIMEOUT }, async () => {
  const { dopo } = await demoPercorsa()
  for (const passo of STEP_IDS) {
    const stato = dopo[passo]
    assert.notEqual(stato.righello, null, `il righello manca dopo il passo ${passo}`)
    assert.equal(stato.righello.fileLength, stato.documento.lunghezza)
    verificaTassellatura(stato.righello, stato.documento.lunghezza)
  }
})

test('sul file firmato il righello completa da se cio che nessun oggetto rivendica', { timeout: TIMEOUT }, async () => {
  const { dopo } = await demoPercorsa()
  const righello = dopo.firma.righello
  const lunghezza = dopo.firma.documento.lunghezza

  // Le sezioni congelate coprono i primi 1285 byte; il file firmato e' molto piu' lungo.
  assert.ok(lunghezza > offsets.fileLength)
  const oltre = righello.segments.filter((s) => s.start >= offsets.fileLength)
  assert.ok(oltre.length > 0, 'la parte appesa dalla firma deve avere i suoi segmenti')
  assert.equal(oltre[0].start, offsets.fileLength, 'nessun buco fra il campione e cio che segue')
  assert.equal(oltre[oltre.length - 1].end, lunghezza)

  // Il buco /Contents e' li dentro, non coperto, e taglia in due il blocco appeso.
  const buco = righello.segments.filter((s) => s.kind === 'hole')
  assert.equal(buco.length, 1)
  assert.equal(buco[0].covered, false)
  assert.equal(buco[0].start, dopo.placeholder.contentsStart)
  assert.equal(buco[0].end, dopo.placeholder.byteRange[2])

  // I due assi restano separati: la copertura si legge da `covered`, non dal `kind`.
  assert.equal(
    righello.segments.some((s) => s.kind === 'covered'),
    false,
  )
  const copertiPerSegmento = righello.segments
    .filter((s) => s.covered)
    .reduce((totale, s) => totale + (s.end - s.start), 0)
  assert.equal(copertiPerSegmento, righello.coverage.coveredBytes)
  assert.equal(copertiPerSegmento, dopo.verifica.verifica.coverage.coveredBytes)
})

test('dopo l attacco 1b la mappa anatomica trasla dei tre byte inseriti', { timeout: TIMEOUT }, async () => {
  const { dopo } = await demoPercorsa()
  const primaDi = (righello, id) => righello.segments.find((s) => s.id === id)

  const integro = primaDi(dopo.firma.righello, 'obj5')
  const rotto = primaDi(dopo['attacco-lettere'].righello, 'obj5')
  assert.equal(integro.start, offsets.objects[4].start)
  assert.equal(
    rotto.start,
    integro.start + 3,
    'l oggetto 5 e davvero tre byte piu avanti: la mappa non deve mentire',
  )
  assert.equal(primaDi(dopo['attacco-lettere'].righello, 'obj4').start, integro.start - 701)
})

/* -------------------------------------------------- il contratto in cima al file dice il vero
 *
 * Il commento di machine.js e' il documento che leggono le due direzioni visive. Se invecchia
 * senza che nessuno se ne accorga, le due pagine disegnano due demo diverse e il disallineamento
 * si scopre all'integrazione. Questi test tengono ferme le affermazioni che si possono misurare.
 */

test('i kind delle evidenziazioni sono quelli elencati nel contratto, passo per passo', { timeout: TIMEOUT }, async () => {
  const { dopo } = await demoPercorsa()
  const atteso = {
    documento: ['object', 'object'],
    chiavi: [],
    certificato: [],
    placeholder: ['hole'],
    impronta: ['hole'],
    cms: [],
    firma: ['hole'],
    verifica: ['hole'],
    'attacco-cifra': ['changed'],
    'attacco-lettere': ['changed', 'structure'],
    'attacco-coda': ['tail'],
    chiusura: ['tail'], // ereditate dal passo prima: la chiusura non tocca byte
  }
  const visto = {}
  for (const passo of STEP_IDS) visto[passo] = dopo[passo].evidenziazioni.map((e) => e.kind)
  assert.deepEqual(visto, atteso)

  // `target` sta SOLO nei bersagli, `changed` solo dopo un attacco, `covered` non e un kind.
  const kindDelleEvidenziazioni = new Set(Object.values(visto).flat())
  assert.equal(kindDelleEvidenziazioni.has('target'), false)
  assert.equal(kindDelleEvidenziazioni.has('covered'), false)
  for (const passo of ['documento', 'chiavi', 'certificato', 'placeholder', 'impronta', 'cms', 'firma', 'verifica']) {
    assert.equal(visto[passo].includes('changed'), false, `«${passo}» non ha ancora niente di cambiato`)
  }
})

test('contentsStart e DICHIARATO: dopo l attacco 1b il buco vero e tre byte piu avanti', { timeout: TIMEOUT }, async () => {
  const { dopo } = await demoPercorsa()
  const firmato = dopo.verifica
  const rotto = dopo['attacco-lettere']
  const delta = rotto.risultati['attacco-lettere'].deltaLunghezza

  // Sul firmato integro l'invariante del contratto vale: li' comincia davvero il buco.
  assert.equal(firmato.documento.bytes[firmato.contentsStart], 0x3c, '«<» sul firmato integro')

  // Dopo 1b no: il numero dichiarato resta fermo, i byte sono slittati in avanti di delta.
  assert.equal(rotto.contentsStart, firmato.contentsStart, 'il documento continua a DICHIARARE lo stesso offset')
  assert.notEqual(rotto.documento.bytes[rotto.contentsStart], 0x3c)
  assert.equal(rotto.documento.bytes[rotto.contentsStart + delta], 0x3c, 'il buco vero e slittato di delta')

  // E il modo di accorgersene senza rimisurare niente e' gia' calcolato da verify().
  assert.equal(rotto.verifica.coverage.gapMatchesContents, false)
  for (const passo of ['verifica', 'attacco-cifra', 'attacco-coda']) {
    assert.equal(
      dopo[passo].verifica.coverage.gapMatchesContents,
      true,
      `«${passo}» non allunga il file dal di dentro`,
    )
  }
})

test('le due code non sono la stessa cosa: lo slittamento di 1b e l append dell attacco 2', { timeout: TIMEOUT }, async () => {
  const { dopo } = await demoPercorsa()
  const rotto = dopo['attacco-lettere']
  const conCoda = dopo['attacco-coda']

  const codaDi = (righello) => righello.segments.filter((s) => s.kind === 'tail')

  // 1b: una coda di tre byte che nessuno ha appeso, ed e' il fondo del file spinto in avanti.
  const codaFinta = codaDi(rotto.righello)
  assert.equal(codaFinta.length, 1)
  assert.equal(rotto.righello.coverage.tailBytes, rotto.risultati['attacco-lettere'].deltaLunghezza)
  assert.equal(rotto.verifica.coverage.gapMatchesContents, false, 'il file e cresciuto dal di dentro')

  // Attacco 2: la coda vera, appesa dopo la firma, e il buco e rimasto dov era.
  const codaVera = codaDi(conCoda.righello)
  assert.equal(codaVera.length, 1)
  assert.equal(conCoda.righello.coverage.tailBytes, conCoda.risultati['attacco-coda'].byteAppesi)
  assert.equal(conCoda.verifica.coverage.gapMatchesContents, true, 'i byte sono arrivati DOPO, non in mezzo')

  assert.ok(
    codaVera[0].end - codaVera[0].start > codaFinta[0].end - codaFinta[0].start,
    'sono due fenomeni diversi, e chi disegna deve poterli distinguere',
  )
})

test('la forma di verifica e quella trascritta nel contratto, campo per campo', { timeout: TIMEOUT }, async () => {
  const { dopo } = await demoPercorsa()
  for (const passo of ['verifica', 'attacco-cifra', 'attacco-lettere', 'attacco-coda']) {
    const esito = dopo[passo].verifica
    assert.deepEqual(Object.keys(esito).sort(), [
      'coverage', 'digest', 'error', 'identity', 'multipleSignatures', 'reason', 'signature',
      'signatures', 'verdict',
    ])
    assert.deepEqual(Object.keys(esito.coverage).sort(), [
      'byteRange', 'complete', 'coveredBytes', 'fileLength', 'gapMatchesContents', 'uncoveredTail',
    ])
    assert.deepEqual(Object.keys(esito.digest).sort(), ['actual', 'expected', 'match'])
    assert.deepEqual(Object.keys(esito.signature).sort(), ['ok'])
    assert.deepEqual(Object.keys(esito.identity).sort(), [
      'fingerprint', 'issuerCN', 'selfSigned', 'subjectCN',
    ])
    // Nei dodici passi la verifica arriva sempre in fondo ai tre controlli: nessun intoppo.
    assert.equal(esito.reason, null, `«${passo}» non deve avere un reason`)
    assert.equal(esito.error, null)
    assert.equal(esito.signatures.length, 1)
    assert.equal(esito.multipleSignatures, false)
  }

  // «Le due impronte a confronto» sono queste due, e non stato.impronta.hex.
  const verde = dopo.verifica.verifica
  assert.equal(verde.digest.match, true)
  assert.equal(verde.digest.expected, verde.digest.actual)
  const rosso = dopo['attacco-cifra'].verifica
  assert.equal(rosso.digest.match, false)
  assert.notEqual(rosso.digest.expected, rosso.digest.actual)
  assert.equal(
    rosso.digest.expected,
    verde.digest.expected,
    'expected e scritto DENTRO la firma: l attacco non lo puo cambiare',
  )
})

test('«impronta» e' + " un nome per due cose diverse, e il contratto lo dice", { timeout: TIMEOUT }, async () => {
  const { finale } = await demoPercorsa()

  // Stesso valore, due nomi in due lingue: e' l'impronta del CERTIFICATO.
  assert.equal(finale.certificato.impronta, finale.verifica.identity.fingerprint)

  // E non e' l'impronta del DOCUMENTO, che e' un'altra cosa con lo stesso nome.
  assert.notEqual(finale.impronta.hex, finale.certificato.impronta)
  assert.equal(finale.impronta.hex, dopoIlPercorso(finale).digest.expected)
  assert.equal(finale.impronta.hex.length, 64)
  assert.equal(finale.certificato.impronta.length, 64)
})

/** L'esito congelato del passo `verifica`, quello del documento firmato integro. */
function dopoIlPercorso(finale) {
  return finale.risultati.verifica.esito
}

/* ------------------------------------------------------------------ materiale per le viste */

test('le evidenziazioni sono accettate da buildHexWindow, kind compresi', { timeout: TIMEOUT }, async () => {
  const { dopo, finale } = await demoPercorsa()
  for (const passo of STEP_IDS) {
    const stato = dopo[passo]
    const finestra = buildHexWindow(stato.documento.bytes, 577, 128, stato.evidenziazioni)
    assert.ok(Array.isArray(finestra.rows))
    for (const evidenziazione of stato.risultati[passo].evidenziazioni ?? []) {
      assert.equal(typeof evidenziazione.id, 'string')
      assert.ok(evidenziazione.end > evidenziazione.start)
      assert.ok(evidenziazione.end <= stato.documento.lunghezza)
    }
  }
  for (const bersaglio of Object.values(finale.bersagli).flat()) {
    assert.equal(bersaglio.kind, 'target')
  }
  // Il bersaglio dell'attacco 1a e' proprio il byte che poi cambia.
  const finestra = buildHexWindow(
    dopo.verifica.documento.bytes,
    offsets.amount.digitOffset,
    64,
    finale.bersagli['attacco-cifra'],
  )
  const cella = finestra.rows
    .flatMap((r) => r.cells)
    .find((c) => c.offset === offsets.amount.digitOffset)
  assert.deepEqual(cella.highlightIds, ['bersaglio-cifra'])
  assert.equal(cella.char, '1')
})

test('il DER del certificato e quello del CMS sono nello stato e buildAsn1Tree li legge', { timeout: TIMEOUT }, async () => {
  const { finale } = await demoPercorsa()
  const certificato = buildAsn1Tree(finale.certificato.der)
  assert.equal(certificato.ok, true)
  assert.equal(certificato.error, null)
  const cms = buildAsn1Tree(finale.cms.der)
  assert.equal(cms.ok, true)
  assert.equal(cms.flat.some((n) => n.oidLabel === 'messageDigest'), true)
  assert.equal(cms.flat.some((n) => n.oidLabel === 'signing-certificate-v2'), true)

  // L'identita' e' materiale, non una promessa: impronta del certificato e nome coincidono
  // con cio' che la verifica ha letto dai byte del file.
  assert.equal(finale.certificato.impronta, finale.risultati.verifica.esito.identity.fingerprint)
  assert.equal(finale.certificato.autofirmato, true)
})

test('chiavi, impronta e cms restano coerenti fra loro lungo tutta la catena', { timeout: TIMEOUT }, async () => {
  const { finale } = await demoPercorsa()
  assert.equal(finale.chiavi.modulusBits, 2048)
  assert.equal(finale.chiavi.algoritmo, 'RSASSA-PKCS1-v1_5')
  assert.equal(finale.chiavi.hash, 'SHA-256')
  assert.equal(finale.impronta.digest.length, 32)
  assert.equal(finale.impronta.hex.length, 64)
  assert.equal(
    finale.impronta.hex,
    finale.risultati.verifica.esito.digest.expected,
    "l'impronta calcolata al passo 5 e' quella che la firma dichiara",
  )
  assert.equal(
    finale.impronta.byteCoperti,
    finale.byteRange[1] + finale.byteRange[3],
  )
  assert.equal(finale.impronta.byteNonCoperti, finale.byteRange[2] - finale.byteRange[0] - finale.byteRange[1])
  assert.equal(finale.cms.lunghezza, finale.cms.der.length)
  assert.equal(finale.risultati.firma.zeriDiRiempimento, 4096 - finale.cms.lunghezza)
  assert.ok(finale.risultati.firma.zeriDiRiempimento > 0, 'il buco deve avanzare, non stringere')
})

test('la chiusura mette in fila i quattro verdetti misurati', { timeout: TIMEOUT }, async () => {
  const { finale } = await demoPercorsa()
  const riepilogo = finale.risultati.chiusura.riepilogo
  assert.deepEqual(
    riepilogo.map((r) => [r.passo, r.verdetto]),
    [
      ['verifica', 'valid'],
      ['attacco-cifra', 'invalid'],
      ['attacco-lettere', 'invalid'],
      ['attacco-coda', 'extended'],
    ],
  )
  const coda = riepilogo.find((r) => r.passo === 'attacco-coda')
  assert.equal(coda.improntaTorna, true)
  assert.equal(coda.firmaTorna, true)
  assert.equal(coda.copertaTutta, false)
})

/* ------------------------------------------------------------------ opzioni */

test('createDemo accetta opzioni senza cambiare firma, e senza opzioni funziona', { timeout: TIMEOUT }, async () => {
  const quando = new Date('2026-08-11T09:30:00.000Z')
  const demo = createDemo({
    subjectCN: 'Mario Bianchi',
    padding: 3000,
    nuovoImporto: '2.000 euro (duemila euro)',
    adesso: () => quando,
  })
  for (const passo of ['documento', 'chiavi', 'certificato', 'placeholder', 'impronta', 'cms', 'firma', 'verifica']) {
    await demo.run(passo)
  }
  const stato = demo.getState()
  assert.equal(stato.verdetto, 'valid')
  assert.equal(stato.certificato.subjectCN, 'Mario Bianchi')
  assert.equal(stato.verifica.identity.subjectCN, 'Mario Bianchi')
  assert.equal(stato.cms.signingTime.getTime(), quando.getTime())
  assert.equal(stato.risultati.firma.capacitaBuco, 3000)

  const conCoda = await demo.run('attacco-coda')
  assert.equal(conCoda.errore.passo, 'attacco-coda')
  assert.match(conCoda.errore.messaggio, /Prima del passo/)
})

/* ------------------------------------------------------------------ attrezzi */

/** L'invariante del righello: i segmenti tassellano [0, fileLength), senza buchi ne sovrapposizioni. */
function verificaTassellatura(righello, lunghezza) {
  let cursore = 0
  for (const segmento of righello.segments) {
    assert.equal(segmento.start, cursore, `segmento "${segmento.id}" non contiguo`)
    assert.ok(segmento.end > segmento.start, `segmento "${segmento.id}" vuoto`)
    cursore = segmento.end
  }
  assert.equal(cursore, lunghezza)
}
