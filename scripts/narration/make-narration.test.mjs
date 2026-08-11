/**
 * I vincoli del generatore della narrazione, resi eseguibili.
 *
 * Qui non si sintetizza niente: `say` e `ffmpeg` costano venti secondi e un dispositivo
 * audio, e un test che li chiama smette di girare su qualunque macchina non sia questa.
 * Si provano invece le parti che decidono se l'audio e giusto: la lettura delle misure,
 * la ricetta che stabilisce cosa rifare, e la forma dei due file generati.
 *
 * L'ultimo gruppo di test guarda i prodotti veri, se ci sono: `segments.js` e i .opus su
 * disco. Se la narrazione non e ancora stata generata quei test si saltano invece di
 * mentire — ma quando c'e, e la sola prova che il modulo nel bundle e quell'audio li.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  VOCE,
  FORMATO_DATI,
  BITRATE,
  MIME,
  argomentiSay,
  argomentiFfmpeg,
  ricettaDi,
  impronta,
  analizzaVolumedetect,
  eMuto,
  leggiArgomenti,
  costruisciModulo,
  costruisciPagina,
  segnaFonetica,
} from './make-narration.mjs'
import { SCRIPT, MAPPA_FONETICA } from '../../src/ui/script.it.js'
import { STEP_IDS } from '../../src/ui/steps.js'

const qui = path.dirname(fileURLToPath(import.meta.url))
const radice = path.resolve(qui, '..', '..')
const FILE_MODULO = path.join(radice, 'src', 'assets', 'narrazione', 'segments.js')
const CARTELLA_OUT = path.join(qui, 'out')

const STRUMENTI = { ffmpeg: 'ffmpeg version 8.1.2', macos: '26.0' }

// --- La ricetta: cosa rende un segmento vecchio -------------------------------

test('la catena e quella decisa in docs/decisioni.md, e non passa nessun -r', () => {
  const say = argomentiSay('seg.txt', 'seg.wav')
  assert.deepEqual(say, ['-v', 'Alice', '--file-format=WAVE', '--data-format=LEI16@22050', '-f', 'seg.txt', '-o', 'seg.wav'])
  // Il ritmo e il predefinito di Alice: 160 parole al minuto misurate dalla sonda.
  assert.ok(!say.includes('-r'), 'nessun ritmo esplicito da passare a say')
  assert.equal(VOCE, 'Alice')
  assert.equal(FORMATO_DATI, 'LEI16@22050')

  const ffmpeg = argomentiFfmpeg('seg.wav', 'seg.opus')
  for (const atteso of ['libopus', BITRATE, '-ac', '1']) assert.ok(ffmpeg.includes(atteso), atteso)
  assert.equal(ffmpeg[ffmpeg.length - 1], 'seg.opus')
})

test('senza +bitexact il file Ogg cambia a ogni giro: il flag e parte del contratto', () => {
  // Misurato: senza il flag il muxer Ogg estrae a sorte il numero di serie del flusso
  // (byte 15..18) e scrive la versione di ffmpeg nei tag. Due esecuzioni identiche
  // producono due file diversi, e `segments.js` diventa un diff da 1,6 MB per niente.
  const ffmpeg = argomentiFfmpeg('seg.wav', 'seg.opus')
  const dove = ffmpeg.indexOf('-fflags')
  assert.notEqual(dove, -1, 'manca -fflags')
  assert.equal(ffmpeg[dove + 1], '+bitexact')
})

test('la ricetta cambia impronta se cambia il testo, e solo per quel passo', () => {
  const a = impronta(ricettaDi('impronta', 'Adesso il programma calcola.', STRUMENTI))
  const b = impronta(ricettaDi('impronta', 'Adesso il programma calcola!', STRUMENTI))
  const c = impronta(ricettaDi('impronta', 'Adesso il programma calcola.', STRUMENTI))
  const d = impronta(ricettaDi('cms', 'Adesso il programma calcola.', STRUMENTI))
  assert.notEqual(a, b, 'un testo diverso deve rigenerare')
  assert.equal(a, c, 'stessi ingredienti, stessa impronta: e cosi che si salta il lavoro fatto')
  assert.notEqual(a, d, "l'impronta e legata al passo")
})

test('anche un aggiornamento di ffmpeg rigenera: audio cotto altrove non sopravvive in silenzio', () => {
  const prima = impronta(ricettaDi('cms', 'testo', STRUMENTI))
  const dopo = impronta(ricettaDi('cms', 'testo', { ...STRUMENTI, ffmpeg: 'ffmpeg version 9.0.0' }))
  assert.notEqual(prima, dopo)
})

// --- Le misure: il fallimento muto e silenzioso, quindi si legge bene ----------

test('volumedetect: ffmpeg stampa piu di un riepilogo, e vale l ultimo', () => {
  // Uscita vera, copiata da un .opus di questa narrazione. Il primo blocco ha
  // n_samples: 0 e nient'altro: chi legge quello dichiara muto ogni segmento buono.
  const uscita = [
    '[Parsed_volumedetect_0 @ 0x962824480] n_samples: 0',
    '[Parsed_volumedetect_0 @ 0x962824900] n_samples: 891516',
    '[Parsed_volumedetect_0 @ 0x962824900] mean_volume: -15.7 dB',
    '[Parsed_volumedetect_0 @ 0x962824900] max_volume: -0.0 dB',
    '[Parsed_volumedetect_0 @ 0x962824900] histogram_0db: 102',
  ].join('\n')
  const misura = analizzaVolumedetect(uscita)
  assert.equal(misura.media, -15.7)
  assert.equal(misura.picco, -0)
  assert.equal(misura.campioni, 891516)
  assert.equal(eMuto(misura), false)
})

test('volumedetect: il silenzio perfetto si legge -inf, e non deve passare per numero', () => {
  const misura = analizzaVolumedetect(
    ['[Parsed_volumedetect_0 @ 0x1] n_samples: 441000', '[Parsed_volumedetect_0 @ 0x1] mean_volume: -inf dB', '[Parsed_volumedetect_0 @ 0x1] max_volume: -inf dB'].join('\n'),
  )
  assert.equal(misura.media, -Infinity)
  assert.equal(eMuto(misura), true, 'un file muto e un fallimento, e va visto')
})

test('un file che dura giusto ma non dice niente e comunque un fallimento', () => {
  assert.equal(eMuto({ media: -15, picco: -0.1, campioni: 100 }), false)
  assert.equal(eMuto({ media: -60, picco: -40, campioni: 100 }), true, 'troppo basso: qualcosa e andato storto')
  assert.equal(eMuto({ media: -15, picco: -35, campioni: 100 }), true, 'media plausibile ma nessun picco')
  assert.equal(eMuto({ media: null, picco: null, campioni: null }), true, 'non misurato non e «va bene»')
  assert.equal(eMuto({ media: -15, picco: -1, campioni: 0 }), true, 'zero campioni')
})

test('volumedetect: se manca la riga, il valore e null e non zero', () => {
  const misura = analizzaVolumedetect('nessuna misura qui')
  assert.equal(misura.media, null)
  assert.equal(misura.picco, null)
  assert.equal(misura.campioni, null)
})

// --- Argomenti ----------------------------------------------------------------

test('gli argomenti: un passo che non esiste si ferma qui, non dopo venti secondi di say', () => {
  assert.deepEqual(leggiArgomenti([]), { segmenti: [], forza: false, json: false, aiuto: false })
  assert.deepEqual(leggiArgomenti(['--forza', '--json']).forza, true)
  assert.deepEqual(leggiArgomenti(['--segmento', 'impronta', '--segmento', 'cms']).segmenti, ['impronta', 'cms'])
  assert.throws(() => leggiArgomenti(['--segmento', 'inventato']), /non esistono/)
  assert.throws(() => leggiArgomenti(['--segmento']), /vuole uno stepId/)
  assert.throws(() => leggiArgomenti(['--turbo']), /sconosciuta/)
})

// --- Il modulo generato --------------------------------------------------------

/** Una misura finta con dentro un .opus finto ma coerente: byte, base64 e durata tornano. */
function misuraFinta(stepId, indice) {
  const grezzo = Buffer.from(`OggS-finto-${stepId}-${'x'.repeat(indice)}`)
  const base64 = grezzo.toString('base64')
  return {
    stepId,
    durata: 10 + indice,
    durataStimata: 11 + indice,
    scarto: -1,
    rapporto: 0.9,
    parole: 30 + indice,
    paroleAlMinuto: 168.8,
    byte: grezzo.length,
    byteBase64: base64.length,
    dataUri: `data:${MIME};base64,${base64}`,
    volumeOpus: { media: -15.5, picco: -0.2, campioni: 1000 },
    volumeWav: { media: -15.4, picco: -0.1, campioni: 1000 },
    testo: SCRIPT[stepId].testo,
    testoFonetico: SCRIPT[stepId].testoFonetico,
  }
}

const misureFinte = () => STEP_IDS.map((id, i) => misuraFinta(id, i))

test('il modulo dichiara di essere generato e da quale comando', () => {
  const modulo = costruisciModulo(misureFinte())
  assert.match(modulo, /GENERATO da scripts\/narration\/make-narration\.mjs/)
  assert.match(modulo, /--forza/)
  assert.match(modulo, /--segmento <stepId>/)
  assert.match(modulo, /non modificare a mano/)
})

test('il modulo generato e JavaScript vero, con i dodici passi nell ordine della demo', async () => {
  const modulo = costruisciModulo(misureFinte())
  const { SEGMENTS } = await import(`data:text/javascript;base64,${Buffer.from(modulo).toString('base64')}`)
  assert.deepEqual(Object.keys(SEGMENTS), STEP_IDS, 'chiavi e ordine sono quelli di steps.js')
  for (const id of STEP_IDS) {
    assert.deepEqual(Object.keys(SEGMENTS[id]).sort(), ['byte', 'dataUri', 'durata'], `${id}: il contratto`)
    assert.ok(SEGMENTS[id].dataUri.startsWith(`data:${MIME};base64,`), `${id}: prefisso`)
    assert.equal(
      Buffer.from(SEGMENTS[id].dataUri.split(',')[1], 'base64').length,
      SEGMENTS[id].byte,
      `${id}: i byte dichiarati sono quelli del data URI`,
    )
    assert.ok(SEGMENTS[id].durata > 0, `${id}: durata`)
  }
})

test('un identificatore col trattino resta una chiave valida', () => {
  const modulo = costruisciModulo(misureFinte())
  assert.match(modulo, /'attacco-cifra': \{/, 'le chiavi non identificatrici vanno virgolettate')
  assert.match(modulo, /\n {2}documento: \{/, 'quelle valide no')
})

// --- La pagina di ascolto --------------------------------------------------------

test('la pagina di ascolto non puo fare una richiesta di rete nemmeno volendo', () => {
  const pagina = costruisciPagina(misureFinte())
  for (const vietato of ['http://', 'https://', '<script', '<link', '@import', 'url(']) {
    assert.ok(!pagina.includes(vietato), `la pagina contiene ${vietato}`)
  }
})

test('la pagina ha i dodici segmenti in ordine, ognuno col suo lettore e il suo testo', () => {
  const pagina = costruisciPagina(misureFinte())
  let cursore = -1
  for (const id of STEP_IDS) {
    const dove = pagina.indexOf(`<section class="segmento" id="${id}">`)
    assert.ok(dove > cursore, `${id}: fuori ordine o assente`)
    cursore = dove
    assert.ok(pagina.includes(`src="out/${id}.opus"`), `${id}: manca il lettore`)
  }
  // Il testo e quello ortografico, non quello dato in pasto a say.
  assert.ok(pagina.includes('quella dello standard che si chiama'), 'manca il testo del primo segmento')
  assert.ok(!pagina.includes('si chiama pades'), 'a schermo va il testo, non il testoFonetico')
})

test('le due parole che la voce pronuncia diversamente sono marcate, non nascoste', () => {
  const marcato = segnaFonetica('Lo standard PAdES e il ByteRange.', MAPPA_FONETICA)
  assert.match(marcato, /<b class="detto">PAdES<span class="pron">detto «pades»<\/span><\/b>/)
  assert.match(marcato, /<b class="detto">ByteRange<span class="pron">detto «bait reinge»<\/span><\/b>/)
})

test('segnaFonetica non lascia passare HTML dal copione', () => {
  const marcato = segnaFonetica('un <b>grassetto</b> & una "virgoletta"', MAPPA_FONETICA)
  assert.ok(!marcato.includes('<b>grassetto'), 'il markup del testo va scappato')
  assert.match(marcato, /&lt;b&gt;grassetto&lt;\/b&gt; &amp; una &quot;virgoletta&quot;/)
})

test('un testo senza sostituzioni esce identico, solo scappato', () => {
  assert.equal(segnaFonetica('Nessuna parola inglese qui.', MAPPA_FONETICA), 'Nessuna parola inglese qui.')
})

// --- I prodotti veri, se sono stati generati ---------------------------------------

const modulopresente = fs.existsSync(FILE_MODULO)
const saltaSeAssente = {
  skip: modulopresente ? false : 'narrazione non generata: node scripts/narration/make-narration.mjs',
}

test('il modulo consegnato ha i dodici segmenti, e i byte dichiarati sono quelli veri', saltaSeAssente, async () => {
  const { SEGMENTS } = await import(FILE_MODULO)
  assert.deepEqual(Object.keys(SEGMENTS), STEP_IDS)
  for (const id of STEP_IDS) {
    const segmento = SEGMENTS[id]
    assert.deepEqual(Object.keys(segmento).sort(), ['byte', 'dataUri', 'durata'], `${id}`)
    const grezzo = Buffer.from(segmento.dataUri.split(',')[1], 'base64')
    assert.equal(grezzo.length, segmento.byte, `${id}: byte`)
    assert.equal(grezzo.subarray(0, 4).toString('latin1'), 'OggS', `${id}: non e un flusso Ogg`)
    assert.equal(grezzo.subarray(28, 36).toString('latin1'), 'OpusHead', `${id}: non e Opus`)
    assert.ok(segmento.durata > 5, `${id}: durata sospetta (${segmento.durata} s)`)
  }
})

test('il modulo consegnato e esattamente i .opus su disco, non una copia vecchia', saltaSeAssente, async () => {
  const { SEGMENTS } = await import(FILE_MODULO)
  for (const id of STEP_IDS) {
    const suDisco = path.join(CARTELLA_OUT, `${id}.opus`)
    if (!fs.existsSync(suDisco)) continue
    const grezzo = Buffer.from(SEGMENTS[id].dataUri.split(',')[1], 'base64')
    assert.ok(fs.readFileSync(suDisco).equals(grezzo), `${id}: il modulo e il file su disco divergono`)
  }
})

test('cio che e stato dato in pasto a say e esattamente il testoFonetico', saltaSeAssente, () => {
  for (const id of STEP_IDS) {
    const fileTesto = path.join(CARTELLA_OUT, `${id}.txt`)
    if (!fs.existsSync(fileTesto)) continue
    assert.equal(fs.readFileSync(fileTesto, 'utf8'), SCRIPT[id].testoFonetico, `${id}`)
  }
})

test('la durata totale consegnata sta nei cinque minuti previsti dal piano', saltaSeAssente, async () => {
  const { SEGMENTS } = await import(FILE_MODULO)
  const totale = STEP_IDS.reduce((somma, id) => somma + SEGMENTS[id].durata, 0)
  assert.ok(totale > 240 && totale < 390, `durata totale ${totale.toFixed(1)} s, attesi circa 300`)
})
