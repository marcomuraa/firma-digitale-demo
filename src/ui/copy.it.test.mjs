// Invarianti che il rendering dà per scontati.
// Il modulo sotto test è puro: nessun import di moduli node dentro copy.it.js.
// Qui invece siamo in un test, quindi leggere dal disco è lecito: gli offset congelati
// del PDF campione servono a verificare che i testi citino numeri VERI e non plausibili.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { COPY, STEP_IDS, THEORY_IDS } from './copy.it.js'
import { PANEL_IDS, STEP_IDS as STEP_IDS_SORGENTE } from './steps.js'

const offsets = JSON.parse(
  readFileSync(fileURLToPath(new URL('../assets/sample-offsets.json', import.meta.url)), 'utf8'),
)

// Limiti di leggibilità da tre metri: l'occhiello e il titolo sono composti grandi, e
// oltre questa soglia su un proiettore vanno a capo tre volte.
const MAX_OCCHIELLO = 32
const MAX_TITOLO = 40
// La modalità presentazione mostra SOLO il primo paragrafo, a corpo grande.
const MAX_PRIMO_PARAGRAFO = 240
const MIN_PARAGRAFO = 40

// Ricopiati a mano da docs/contratti-ui.md: e questo l'unico punto in cui l'elenco viene
// riscritto, e serve a confrontare col contratto l'unica sorgente (src/ui/steps.js).
const PANEL_IDS_ATTESI = [
  // i dodici passi, nell'ordine della tabella di docs/contratti-ui.md
  'documento',
  'chiavi',
  'certificato',
  'placeholder',
  'impronta',
  'cms',
  'firma',
  'verifica',
  'attacco-cifra',
  'attacco-lettere',
  'attacco-coda',
  'chiusura',
  // i tre pannelli teorici
  'teoria-certificato',
  'teoria-scansionata',
  'teoria-eidas',
]

const pannelli = () => Object.entries(COPY)
const testo = (id) => COPY[id].corpo.join('\n')

test('l unica sorgente degli identificatori e quella del contratto', () => {
  assert.deepEqual(PANEL_IDS, PANEL_IDS_ATTESI)
})

test('gli identificatori sono esattamente quelli attesi, ne piu ne meno', () => {
  assert.deepEqual(Object.keys(COPY), PANEL_IDS)
  assert.equal(Object.keys(COPY).length, 15)
})

test('STEP_IDS e THEORY_IDS partizionano COPY e rispettano l ordine dei passi', () => {
  // Riesportato, non ricopiato: se qualcuno riscrivesse la lista dentro copy.it.js,
  // l identita fallirebbe anche a liste uguali.
  assert.equal(STEP_IDS, STEP_IDS_SORGENTE, 'copy.it deve riesportare steps.js')
  assert.equal(STEP_IDS.length, 12)
  assert.equal(THEORY_IDS.length, 3)
  assert.deepEqual([...STEP_IDS, ...THEORY_IDS], PANEL_IDS)
  assert.deepEqual(new Set([...STEP_IDS, ...THEORY_IDS]).size, 15, 'nessun id ripetuto')
  for (const id of [...STEP_IDS, ...THEORY_IDS]) {
    assert.ok(Object.hasOwn(COPY, id), `manca il pannello ${id}`)
  }
})

test('ogni pannello ha occhiello, titolo e almeno un paragrafo, e nessun altro campo', () => {
  for (const [id, p] of pannelli()) {
    assert.deepEqual(Object.keys(p).sort(), ['corpo', 'occhiello', 'titolo'], `campi di ${id}`)
    assert.equal(typeof p.occhiello, 'string', `occhiello di ${id}`)
    assert.equal(typeof p.titolo, 'string', `titolo di ${id}`)
    assert.ok(p.occhiello.length > 0, `occhiello vuoto in ${id}`)
    assert.ok(p.titolo.length > 0, `titolo vuoto in ${id}`)
    assert.ok(Array.isArray(p.corpo), `corpo di ${id} deve essere un array`)
    assert.ok(p.corpo.length >= 1, `corpo di ${id} deve avere almeno un paragrafo`)
  }
})

test('il corpo e un array di stringhe: niente numeri, niente annidamenti, niente vuoti', () => {
  for (const [id, p] of pannelli()) {
    p.corpo.forEach((par, i) => {
      assert.equal(typeof par, 'string', `${id} corpo[${i}] non e una stringa`)
      assert.ok(par.length >= MIN_PARAGRAFO, `${id} corpo[${i}] troppo corto: ${par.length}`)
    })
  }
})

test('nessun tag HTML e nessuna entita nei testi', () => {
  const vietati = [
    [/[<>]/, 'parentesi angolari'],
    [/&[a-z]+;/i, 'entita HTML'],
    [/&#\d+;/, 'entita numerica'],
  ]
  for (const [id, p] of pannelli()) {
    for (const s of [p.occhiello, p.titolo, ...p.corpo]) {
      for (const [re, nome] of vietati) {
        assert.ok(!re.test(s), `${id}: ${nome} in "${s.slice(0, 60)}"`)
      }
    }
  }
})

test('nessun markdown nei testi', () => {
  const vietati = [
    [/\*/, 'asterisco'],
    [/`/, 'backtick'],
    [/_/, 'underscore'],
    [/\]\(/, 'link markdown'],
    [/^#/, 'titolo markdown'],
    [/^\s*[-+*]\s/, 'elenco puntato'],
    [/^\s*\d+\.\s/, 'elenco numerato'],
    [/^\s*>/, 'citazione markdown'],
  ]
  for (const [id, p] of pannelli()) {
    for (const s of [p.occhiello, p.titolo, ...p.corpo]) {
      for (const [re, nome] of vietati) {
        assert.ok(!re.test(s), `${id}: ${nome} in "${s.slice(0, 60)}"`)
      }
    }
  }
})

test('i testi sono paragrafi puliti: niente a capo, tabulazioni, spazi doppi o bordi', () => {
  for (const [id, p] of pannelli()) {
    for (const s of [p.occhiello, p.titolo, ...p.corpo]) {
      assert.ok(!/[\n\r\t]/.test(s), `${id}: carattere di controllo in "${s.slice(0, 40)}"`)
      assert.ok(!/ {2}/.test(s), `${id}: spazio doppio in "${s.slice(0, 60)}"`)
      assert.equal(s, s.trim(), `${id}: spazi ai bordi in "${s.slice(0, 40)}"`)
    }
  }
})

test('apostrofi e virgolette sono tipografici, non dritti', () => {
  for (const [id, p] of pannelli()) {
    for (const s of [p.occhiello, p.titolo, ...p.corpo]) {
      assert.ok(!/['"]/.test(s), `${id}: apostrofo o virgoletta dritta in "${s.slice(0, 60)}"`)
    }
  }
})

test('occhiello e titolo restano corti abbastanza per un proiettore', () => {
  for (const [id, p] of pannelli()) {
    assert.ok(
      p.occhiello.length <= MAX_OCCHIELLO,
      `${id}: occhiello di ${p.occhiello.length} caratteri, massimo ${MAX_OCCHIELLO}`,
    )
    assert.ok(
      p.titolo.length <= MAX_TITOLO,
      `${id}: titolo di ${p.titolo.length} caratteri, massimo ${MAX_TITOLO}`,
    )
  }
})

test('il primo paragrafo regge da solo in modalita presentazione', () => {
  for (const [id, p] of pannelli()) {
    const primo = p.corpo[0]
    assert.ok(
      primo.length <= MAX_PRIMO_PARAGRAFO,
      `${id}: primo paragrafo di ${primo.length} caratteri, massimo ${MAX_PRIMO_PARAGRAFO}`,
    )
    // sta in piedi da solo: non comincia con un connettivo che rimanda a un paragrafo assente
    assert.ok(
      !/^(Inoltre|Invece|Quindi|Percio|Perciò|Infatti|Ma |E )/.test(primo),
      `${id}: il primo paragrafo comincia con un connettivo`,
    )
  }
})

test('ogni paragrafo chiude con una punteggiatura terminale', () => {
  for (const [id, p] of pannelli()) {
    p.corpo.forEach((par, i) => {
      assert.match(par, /[.?!]$/, `${id} corpo[${i}] non chiude la frase`)
    })
  }
})

// --- contenuto obbligatorio: decisione 13 del piano -------------------------------

test('teoria-certificato dichiara il self-signed e separa matematica da identita', () => {
  const t = testo('teoria-certificato')
  assert.match(t, /self-signed/)
  assert.match(t, /catena/)
  assert.match(t, /identità non è garantita/)
  assert.match(t, /dimostra un meccanismo, non autentica una persona/)
})

test('teoria-scansionata punta ai byte della firma autografa', () => {
  const t = testo('teoria-scansionata')
  const { start, end } = offsets.signatureDrawing
  assert.match(t, new RegExp(String(start)), 'manca l offset di inizio del disegno')
  assert.match(t, new RegExp(String(end)), 'manca l offset di fine del disegno')
  assert.match(t, new RegExp(`${end - start} byte`), 'manca la dimensione del disegno')
  assert.match(t, /geometria/)
  assert.match(t, /Nessuna immagine/)
})

test('teoria-eidas copre formati e livelli e dichiara dove sta la demo', () => {
  const t = testo('teoria-eidas')
  for (const formato of ['PAdES', 'CAdES', '.p7m', 'XAdES']) {
    assert.ok(t.includes(formato), `manca il formato ${formato}`)
  }
  for (const livello of ['semplice', 'avanzata', 'qualificata']) {
    assert.ok(t.includes(livello), `manca il livello ${livello}`)
  }
  assert.match(t, /self-signed/)
  assert.match(t, /giuridicamente nulla/)
})

// --- realta MISURATA degli attacchi ------------------------------------------------

test('attacco-cifra cita l offset congelato e il testo che resta a schermo', () => {
  const t = testo('attacco-cifra')
  assert.ok(t.includes(String(offsets.amount.digitOffset)), 'manca l offset del byte falsificato')
  assert.ok(t.includes('0x31') && t.includes('0x39'), 'mancano i byte prima e dopo')
  assert.ok(
    t.includes(`9.000 euro (${offsets.amount.words} euro)`),
    'manca l incoerenza visibile fra cifre e lettere',
  )
  assert.match(t, /non valida/)
})

test('attacco-lettere racconta la realta misurata, non quella prevista', () => {
  const t = testo('attacco-lettere')
  const delta = 'novemila'.length - offsets.amount.words.length
  assert.equal(delta, 3)

  // /Length dice un numero, i byte sono un altro
  const dichiarata = offsets.contentStream.declaredLength
  assert.ok(t.includes(`/Length ${dichiarata}`), 'manca la lunghezza dichiarata')
  assert.ok(t.includes(String(dichiarata + delta)), 'manca la lunghezza reale')

  // startxref punta tre byte prima della tabella
  const startxref = offsets.xref.startxrefValue
  assert.ok(t.includes('startxref'), 'manca il rimando alla tabella')
  assert.ok(t.includes(String(startxref)), 'manca il valore dichiarato da startxref')
  assert.ok(t.includes(String(startxref + delta)), 'manca la posizione reale della tabella')
  assert.match(t, /tre byte prima/)

  // il renderer perdona: niente promesse di errore di apertura
  assert.match(t, /renderer perdona, la firma no/)
  assert.match(t, /vedere il documento non è verificarlo/i)
  assert.ok(
    !/non si apre|si rifiuta di|rifiuta di renderizzare/.test(t),
    'non si puo promettere che il documento non si apra: e stato misurato il contrario',
  )
  assert.ok(
    t.includes(`${offsets.amount.digits} euro (novemila euro)`),
    'manca il testo che il visualizzatore mostra davvero',
  )
  assert.match(t, /non valida/)
})

test('attacco-coda spiega copertura incompleta e verdetto intermedio', () => {
  const t = testo('attacco-coda')
  assert.match(t, /\/ByteRange/)
  assert.match(t, /\/Prev/)
  assert.match(t, /documento esteso dopo la firma/)
  assert.match(t, /copertura/)
})

// --- ancoraggio ai numeri congelati del PDF campione --------------------------------

test('il pannello documento cita i numeri veri del campione', () => {
  const t = testo('documento')
  assert.ok(t.includes(String(offsets.fileLength)), 'manca la lunghezza del file')
  assert.ok(t.includes(String(offsets.amount.lineStart)), 'manca l offset della riga dell importo')
  assert.equal(offsets.amount.lineStart % offsets.alignment.row, 0)
  assert.ok(t.includes(String(offsets.objects.length)), 'manca il numero di oggetti')
  assert.match(t, /valore legale/)
})

test('i passi della catena di firma nominano cio che mostrano', () => {
  assert.match(testo('chiavi'), /RSA|2048/)
  assert.match(testo('certificato'), /X\.509/)
  assert.match(testo('placeholder'), /\/Contents/)
  assert.match(testo('placeholder'), /\/ByteRange/)
  assert.match(testo('impronta'), /SHA-256/)
  assert.match(testo('cms'), /messageDigest/)
  assert.match(testo('cms'), /signing-certificate-v2/)
  assert.match(testo('firma'), /\/ByteRange/)
  assert.match(testo('verifica'), /Valida e completa/)
  assert.match(testo('chiusura'), /self-signed/)
})
