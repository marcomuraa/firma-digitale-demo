/**
 * I vincoli del copione, resi eseguibili.
 *
 * Un copione parlato e un testo: senza test, «niente esadecimale», «niente frasi lunghe» e
 * «cinque minuti» restano buoni propositi che la prima riscrittura si porta via. Qui invece
 * falliscono in rosso.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SCRIPT,
  STEP_IDS as STEP_IDS_DAL_COPIONE,
  MAPPA_FONETICA,
  PAROLE_AL_MINUTO,
  contaParole,
  applicaMappaFonetica,
  stimaDurataSecondi,
} from './script.it.js'
// I dodici passi si controllano contro l'unica sorgente, non contro una copia locale: che
// quella sorgente sia a sua volta quella del contratto lo verifica `copy.it.test.mjs`.
import { STEP_IDS } from './steps.js'

const segmenti = () => STEP_IDS.map((id) => [id, SCRIPT[id]])

/** Ogni pezzo di testo che finisce in un orecchio: sottotitolo e voce, per ogni segmento. */
const tuttiITesti = () =>
  segmenti().flatMap(([id, seg]) => [
    [`${id}.testo`, seg.testo],
    [`${id}.testoFonetico`, seg.testoFonetico],
  ])

test('gli stepId sono i dodici dell unica sorgente, in quell ordine', () => {
  assert.equal(STEP_IDS.length, 12)
  assert.deepEqual(Object.keys(SCRIPT), STEP_IDS)
  // Riesportato, non ricopiato: due liste uguali oggi sono due liste diverse domani.
  assert.equal(STEP_IDS_DAL_COPIONE, STEP_IDS, 'script.it deve riesportare steps.js')
})

test('ogni segmento ha i tre campi del contratto, e nientaltro', () => {
  for (const [id, seg] of segmenti()) {
    assert.ok(seg, `manca il segmento ${id}`)
    assert.deepEqual(Object.keys(seg), ['testo', 'testoFonetico', 'durataStimata'], id)
    assert.equal(typeof seg.testo, 'string', id)
    assert.equal(typeof seg.testoFonetico, 'string', id)
    assert.equal(typeof seg.durataStimata, 'number', id)
    assert.ok(seg.testo.trim().length > 0, id)
  }
})

test('testo e testo semplice: niente markup, niente a capo', () => {
  for (const [dove, testo] of tuttiITesti()) {
    assert.ok(!/[<>]/.test(testo), `${dove} contiene markup`)
    assert.ok(!/\n/.test(testo), `${dove} va a capo: say vuole una riga sola`)
    assert.equal(testo, testo.trim(), `${dove} ha spazi ai bordi`)
  }
})

test('apostrofi tipografici, come nei pannelli', () => {
  // I sottotitoli si leggono accanto ai pannelli di `copy.it.js`, che usa l apostrofo
  // tipografico: due segni diversi per la stessa cosa, a schermo insieme, si vedono.
  // Sulla voce non cambia niente: misurato, `say -v Alice` produce lo stesso audio.
  for (const [dove, testo] of tuttiITesti()) {
    assert.ok(!/['"]/.test(testo), `${dove}: apostrofo o virgoletta dritta`)
  }
})

test('testoFonetico si ottiene da testo applicando SOLO la mappa fonetica', () => {
  for (const [id, seg] of segmenti()) {
    assert.equal(
      seg.testoFonetico,
      applicaMappaFonetica(seg.testo),
      `${id}: testoFonetico diverge da testo per qualcosa che non e la mappa`,
    )
  }
})

test('la mappa e davvero lunica sorgente delle forme pronunciate', () => {
  // Se una forma pronunciata comparisse gia dentro `testo`, il test precedente resterebbe
  // verde per il motivo sbagliato: la mappa non avrebbe fatto nulla.
  for (const [id, seg] of segmenti()) {
    for (const [, pronunciato] of MAPPA_FONETICA) {
      assert.ok(
        !seg.testo.includes(pronunciato),
        `${id}: il testo a schermo contiene la forma pronunciata "${pronunciato}"`,
      )
    }
  }
})

test('la mappa fonetica e quella decisa, e sostituisce sul serio', () => {
  assert.deepEqual(MAPPA_FONETICA, [
    ['PAdES', 'pades'],
    ['ByteRange', 'bait reinge'],
  ])
  assert.equal(
    applicaMappaFonetica('Lo standard PAdES definisce il ByteRange, e il ByteRange copre.'),
    'Lo standard pades definisce il bait reinge, e il bait reinge copre.',
  )
  assert.equal(applicaMappaFonetica('nessun termine mappato'), 'nessun termine mappato')
})

test('i due nomi inglesi si pronunciano una volta sola, quando si introducono', () => {
  const occorrenze = (termine) =>
    segmenti().filter(([, seg]) => seg.testo.includes(termine)).map(([id]) => id)

  assert.deepEqual(occorrenze('PAdES'), ['documento'])
  assert.deepEqual(occorrenze('ByteRange'), ['placeholder'])
})

test('nessuna stringa esadecimale, nessun valore di hash pronunciato', () => {
  for (const [dove, testo] of tuttiITesti()) {
    // Una sequenza lunga di caratteri esadecimali che contiene almeno una cifra: nessuna
    // parola italiana ci finisce dentro per caso, un dump di byte sempre.
    for (const pezzo of testo.match(/\b[0-9a-fA-F]{6,}\b/g) ?? []) {
      assert.ok(!/[0-9]/.test(pezzo), `${dove} pronuncia una sequenza esadecimale: ${pezzo}`)
    }
    assert.ok(!/sha\s*-?\s*256/i.test(testo), `${dove} pronuncia il nome della funzione di hash`)
    assert.ok(!/0x[0-9a-fA-F]/.test(testo), `${dove} contiene un letterale esadecimale`)
  }
})

test('nessun numero lungo letto cifra per cifra', () => {
  for (const [dove, testo] of tuttiITesti()) {
    assert.ok(!/\d{5,}/.test(testo), `${dove} contiene un numero di piu di quattro cifre`)
  }
})

test('i numeri sono scritti in lettere: nel copione non compare nessuna cifra', () => {
  // Piu stretto del vincolo minimo, ed e voluto: una voce sintetica legge «mille» meglio di
  // qualunque numerale, e cosi la regola non ha zone grigie da discutere.
  for (const [dove, testo] of tuttiITesti()) {
    assert.ok(!/\d/.test(testo), `${dove} contiene una cifra`)
  }
})

test('nessuna sigla sillabata: niente maiuscole in fila fuori dai due nomi mappati', () => {
  for (const [dove, testo] of tuttiITesti()) {
    const sigle = (testo.match(/\b[A-Z]{2,}\b/g) ?? []).filter((s) => s !== 'PAdES')
    assert.deepEqual(sigle, [], `${dove} contiene una sigla da sillabare`)
  }
})

test('gli accenti italiani ci sono: senza, Alice pronuncia storto', () => {
  const mangiati = /\b(perche|puo|piu|cosi|gia|pero|autorita|proprieta|verita|meta|citta|liberta|vedra|riempira|sara|verra|faro)\b/i
  for (const [dove, testo] of tuttiITesti()) {
    const trovate = testo.match(mangiati)
    assert.equal(trovate, null, `${dove} ha un accento mangiato: ${trovate?.[0]}`)
  }
})

test('scrittura per lorecchio: nessuna frase interminabile', () => {
  // Chi ascolta non puo rileggere. Si spezza dove la voce respira: punto, punto e virgola,
  // due punti, punto interrogativo.
  for (const [dove, testo] of tuttiITesti()) {
    for (const frase of testo.split(/[.?!:;]+/)) {
      const parole = contaParole(frase)
      assert.ok(parole <= 28, `${dove}: frase da ${parole} parole — "${frase.trim()}"`)
    }
  }
})

test('durataStimata e coerente col conteggio parole a 160 parole al minuto', () => {
  assert.equal(PAROLE_AL_MINUTO, 160)
  for (const [id, seg] of segmenti()) {
    const attesa = (contaParole(seg.testo) / PAROLE_AL_MINUTO) * 60
    assert.ok(
      Math.abs(seg.durataStimata - attesa) <= 1,
      `${id}: dichiara ${seg.durataStimata} s, dal conteggio parole ne risultano ${attesa.toFixed(1)} s`,
    )
    assert.equal(seg.durataStimata, stimaDurataSecondi(seg.testo), id)
  }
})

test('la stima vale anche per cio che si pronuncia davvero', () => {
  // `bait reinge` sono due parole dove a schermo ce n'era una: la durata e calcolata sul testo
  // a schermo, come vuole il contratto, e deve restare valida anche per la voce.
  for (const [id, seg] of segmenti()) {
    const scarto = Math.abs(stimaDurataSecondi(seg.testoFonetico) - seg.durataStimata)
    assert.ok(scarto <= 1, `${id}: la stima scarta di ${scarto} s fra testo e pronuncia`)
  }
})

test('il totale sta fra quattro e sei minuti', () => {
  const totale = segmenti().reduce((somma, [, seg]) => somma + seg.durataStimata, 0)
  assert.ok(totale >= 240, `il copione dura ${totale} s: meno di quattro minuti`)
  assert.ok(totale <= 360, `il copione dura ${totale} s: piu di sei minuti`)
})

test('nessun segmento supera i quarantacinque secondi, e nessuno e un lampo', () => {
  for (const [id, seg] of segmenti()) {
    assert.ok(seg.durataStimata <= 45, `${id} dura ${seg.durataStimata} s: chi ascolta si perde`)
    assert.ok(seg.durataStimata >= 12, `${id} dura ${seg.durataStimata} s: non fa in tempo a dire nulla`)
  }
})

test('i passi centrali durano piu di chiavi e certificato', () => {
  // Il ritmo deciso: impronta, cms, firma e verifica sono il cuore; chiavi e certificato
  // sono di servizio. Se il rapporto si ribalta, il copione ha perso il centro.
  const breve = Math.max(SCRIPT.chiavi.durataStimata, SCRIPT.certificato.durataStimata)
  for (const id of ['impronta', 'cms', 'firma', 'verifica']) {
    assert.ok(SCRIPT[id].durataStimata > breve, `${id} non dura piu dei passi di servizio`)
  }
})

test('gli attacchi che seguono un attacco raccontano il ritorno allo stato integro', () => {
  // Fra un attacco e l'altro il documento torna firmato e integro: e un'azione senza passo,
  // e il contratto vuole che il ritorno stia nella prima frase dell'attacco successivo.
  for (const id of ['attacco-lettere', 'attacco-coda']) {
    const primaFrase = SCRIPT[id].testo.split(/[.?!]/)[0].toLowerCase()
    assert.ok(
      /tornat/.test(primaFrase),
      `${id}: la prima frase non dice che il documento e tornato integro — "${primaFrase}"`,
    )
  }
})

test('attacco-lettere racconta la realta misurata: il renderer perdona, la firma no', () => {
  const testo = SCRIPT['attacco-lettere'].testo.toLowerCase()
  // docs/pdf-campione.md §4: pdf.js e poppler aprono il file lo stesso. Dire il contrario
  // sarebbe raccontare una misura che e stata fatta e ha dato l'esito opposto.
  assert.ok(
    /si apre lo stesso|apre lo stesso/.test(testo),
    'manca il fatto misurato: il documento si apre comunque',
  )
  assert.ok(
    !/(non si apre|si rifiuta|smette di aprirsi|illeggibile)/.test(testo),
    'il copione afferma che il documento non si apre: misurato, ed e falso',
  )
})

test('contaParole conta parole, non punteggiatura', () => {
  assert.equal(contaParole('Un byte e bastato.'), 4)
  assert.equal(contaParole('  spazi   larghi  '), 2)
  assert.equal(contaParole('Sì? No — forse ...'), 3)
  assert.equal(contaParole(''), 0)
  assert.equal(stimaDurataSecondi('una parola al secondo'.repeat(1)), 2)
})
