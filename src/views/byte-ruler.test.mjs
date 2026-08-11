import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildRuler } from './byte-ruler.js'

/* ------------------------------------------------------------------ dati di prova reali */

/**
 * Il PDF campione, congelato e validato: 1285 byte, dieci sezioni che tassellano il file.
 * Lo leggo dal JSON invece di ricopiarlo, cosi il righello viene provato sugli offset veri.
 */
const offsets = JSON.parse(
  readFileSync(fileURLToPath(new URL('../assets/sample-offsets.json', import.meta.url)), 'utf8'),
)
const CAMPIONE = { fileLength: offsets.fileLength, sezioni: offsets.sections }

/**
 * Lo stesso campione dopo il placeholder PAdES appeso come incremental update.
 * Il buco /Contents e 8194 byte = 2 x 4096 esadecimali piu le due parentesi angolari, e la
 * copertura arriva esattamente alla fine del file: prima dell'attacco 2 non c'e coda.
 */
const FIRMATO = {
  fileLength: 10687,
  byteRange: [0, 1489, 9683, 1004],
  uncoveredTail: 0,
}
const HOLE_START = 1489
const HOLE_END = 9683
const COVER_END = 10687

/** Sezioni del file firmato: le dieci del campione piu quelle dell'incremental update. */
const SEZIONI_FIRMATO = [
  ...CAMPIONE.sezioni,
  { id: 'sig-dict', label: 'Oggetto 6 - Dizionario della firma', start: 1285, end: 9750 },
  { id: 'sig-annot', label: 'Oggetto 7 - Annotazione della firma', start: 9750, end: 9900 },
  { id: 'acroform', label: 'Oggetto 8 - AcroForm', start: 9900, end: 10000 },
  { id: 'xref2', label: 'Seconda tabella xref', start: 10000, end: 10200 },
  { id: 'trailer2', label: 'Secondo trailer', start: 10200, end: 10600 },
  { id: 'startxref2', label: 'Secondo startxref', start: 10600, end: 10681 },
  { id: 'eof2', label: 'Secondo %%EOF', start: 10681, end: 10687 },
]

/** Dopo l'attacco 2: 612 byte appesi in coda, /ByteRange immutato. */
const DOPO_ATTACCO_2 = {
  fileLength: 11299,
  byteRange: [0, 1489, 9683, 1004],
  uncoveredTail: 612,
}

/* ------------------------------------------------------------------ invariante centrale */

/** L'asse 1 del righello, chiuso: `covered`, `target` e `changed` non sono qui dentro. */
const KIND_DEL_RIGHELLO = ['object', 'structure', 'hole', 'tail']

/**
 * I confini della copertura, ricavati dal /ByteRange come li ricava chi guarda il disegno.
 * Due intervalli contigui (buco lungo zero) si fondono: fra loro la copertura non cambia, e
 * quindi li non c'e nessun confine da disegnare.
 */
function copertura(byteRange) {
  if (!byteRange) return []
  const [a, b, c, d] = byteRange
  const intervalli = [[a, a + b], [c, c + d]].filter(([inizio, fine]) => fine > inizio)
  const fusi = []
  for (const [inizio, fine] of intervalli) {
    const ultimo = fusi[fusi.length - 1]
    if (ultimo && inizio <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], fine)
    else fusi.push([inizio, fine])
  }
  return fusi
}

const sommaCoperti = (vm) =>
  vm.segments.filter((s) => s.covered).reduce((tot, s) => tot + (s.end - s.start), 0)

/**
 * L'invariante dell'asse 2, quello che il collaudo ha visto rompersi: `covered` e uniforme su
 * ogni segmento e i segmenti coperti sommano esattamente a `coverage.coveredBytes`. Se i due
 * assi non tornano, il righello disegna una copertura diversa da quella che dichiara.
 */
function assertDueAssi(vm) {
  const intervalli = copertura(vm.byteRange)
  const coperto = (offset) => intervalli.some(([inizio, fine]) => offset >= inizio && offset < fine)
  const confini = intervalli.flat()

  for (const segmento of vm.segments) {
    assert.equal(typeof segmento.covered, 'boolean', `"${segmento.id}" senza covered booleano`)
    assert.ok(
      KIND_DEL_RIGHELLO.includes(segmento.kind),
      `"${segmento.id}" ha kind "${segmento.kind}", fuori dall asse 1 del righello`,
    )
    assert.equal(segmento.covered, coperto(segmento.start), `covered sbagliato su "${segmento.id}"`)
    assert.equal(
      segmento.covered,
      coperto(segmento.end - 1),
      `"${segmento.id}" e coperto a meta: il segmento andava spezzato`,
    )
    for (const confine of confini) {
      assert.ok(
        !(confine > segmento.start && confine < segmento.end),
        `il confine della copertura ${confine} cade dentro "${segmento.id}" invece di spezzarlo`,
      )
    }
  }
  assert.equal(
    sommaCoperti(vm),
    vm.coverage.coveredBytes,
    'i segmenti con covered:true non sommano a coverage.coveredBytes',
  )
  assert.equal(vm.coverage.coveredFraction, vm.coverage.coveredBytes / vm.fileLength)
}

/**
 * L'invariante del contratto: i segmenti tassellano [0, fileLength), in ordine, senza buchi.
 * Chiude con `assertDueAssi`, cosi ogni caso di questo file — comprese le mille combinazioni
 * casuali in fondo — verifica anche l accordo fra kind e covered.
 */
function assertTassella(vm) {
  let cursore = 0
  for (const segmento of vm.segments) {
    assert.equal(segmento.start, cursore, `salto o sovrapposizione prima di "${segmento.id}"`)
    assert.ok(segmento.end > segmento.start, `segmento vuoto "${segmento.id}"`)
    assert.equal(segmento.fraction, (segmento.end - segmento.start) / vm.fileLength)
    cursore = segmento.end
  }
  assert.equal(cursore, vm.fileLength, 'i segmenti non arrivano alla fine del file')
  const ids = vm.segments.map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length, 'id di segmento duplicati')
  const somma = vm.segments.reduce((tot, s) => tot + s.fraction, 0)
  assert.ok(Math.abs(somma - 1) < 1e-12, `le frazioni sommano a ${somma}`)
  assertDueAssi(vm)
}

const segmento = (vm, id) => vm.segments.find((s) => s.id === id)
const diKind = (vm, kind) => vm.segments.filter((s) => s.kind === kind)

/* ------------------------------------------------------------------ prima della firma */

test('prima della firma: mappa anatomica valida, senza copertura', () => {
  const vm = buildRuler({ fileLength: CAMPIONE.fileLength, byteRange: null, objects: CAMPIONE.sezioni })

  assertTassella(vm)
  assert.equal(vm.fileLength, 1285)
  assert.equal(vm.byteRange, null)
  assert.equal(vm.segments.length, CAMPIONE.sezioni.length)
  assert.ok(vm.segments.every((s) => s.kind === 'object'))
  assert.equal(segmento(vm, 'header').label, 'Intestazione')
  assert.equal(segmento(vm, 'eof').end, 1285)

  assert.deepEqual(vm.coverage, {
    coveredBytes: 0,
    holeBytes: 0,
    tailBytes: 0,
    coveredFraction: 0,
    complete: false,
  })
  assert.deepEqual(vm.marks, [{ offset: 1285, label: 'Fine del file', kind: 'structure' }])
})

test('byteRange assente vale byteRange null', () => {
  const conNull = buildRuler({ fileLength: 1285, byteRange: null, objects: CAMPIONE.sezioni })
  const senzaChiave = buildRuler({ fileLength: 1285, objects: CAMPIONE.sezioni })
  assert.deepEqual(senzaChiave, conNull)
})

test('senza objects e senza byteRange il file e tutto struttura', () => {
  const vm = buildRuler({ fileLength: 1285 })
  assertTassella(vm)
  assert.deepEqual(vm.segments, [
    // covered:false anche qui: senza byteRange non c'e niente di firmato da mostrare.
    { id: 'structure-0', label: 'Struttura del file', start: 0, end: 1285, fraction: 1, kind: 'structure', covered: false },
  ])
})

/* ------------------------------------------------------------------ dopo la firma */

test('firmato: buco e copertura vengono dal byteRange, e la copertura e completa', () => {
  const vm = buildRuler({ ...FIRMATO, objects: SEZIONI_FIRMATO })
  assertTassella(vm)

  const buco = segmento(vm, 'hole')
  assert.deepEqual(
    { start: buco.start, end: buco.end, kind: buco.kind },
    { start: HOLE_START, end: HOLE_END, kind: 'hole' },
  )
  assert.equal(buco.end - buco.start, 8194)
  assert.equal(diKind(vm, 'hole').length, 1)
  assert.equal(diKind(vm, 'tail').length, 0)

  assert.equal(vm.coverage.coveredBytes, 1489 + 1004)
  assert.equal(vm.coverage.holeBytes, 8194)
  assert.equal(vm.coverage.tailBytes, 0)
  assert.equal(vm.coverage.coveredFraction, 2493 / 10687)
  assert.equal(vm.coverage.complete, true, 'prima dell attacco 2 la copertura e completa')
  assert.deepEqual(vm.byteRange, [0, 1489, 9683, 1004])

  // La tacca della fine copertura non e piu kind 'covered': nel righello `covered` non e un
  // kind ma l'asse 2. Una tacca prende il kind di cio che comincia li, e qui non comincia
  // niente — la copertura finisce dove finisce il file — quindi struttura.
  assert.deepEqual(vm.marks, [
    { offset: HOLE_START, label: 'Inizio del buco /Contents', kind: 'hole' },
    { offset: COVER_END, label: 'Fine della copertura', kind: 'structure' },
  ])
})

test('il buco fora l oggetto che lo contiene, in due pezzi con id distinti', () => {
  const vm = buildRuler({ ...FIRMATO, objects: SEZIONI_FIRMATO })
  const primo = segmento(vm, 'sig-dict')
  const secondo = segmento(vm, 'sig-dict#2')

  assert.deepEqual([primo.start, primo.end], [1285, HOLE_START])
  assert.deepEqual([secondo.start, secondo.end], [HOLE_END, 9750])
  assert.equal(secondo.label, primo.label, 'i due pezzi restano lo stesso oggetto')
  assert.equal(primo.kind, 'object')
})

test('dopo l attacco 2 la coda spunta fuori e la copertura non e piu completa', () => {
  const vm = buildRuler({ ...DOPO_ATTACCO_2, objects: SEZIONI_FIRMATO })
  assertTassella(vm)

  const coda = vm.segments[vm.segments.length - 1]
  assert.equal(coda.id, 'tail')
  assert.equal(coda.kind, 'tail')
  assert.deepEqual([coda.start, coda.end], [COVER_END, 11299])
  assert.equal(coda.fraction, 612 / 11299)

  assert.equal(vm.coverage.tailBytes, 612)
  assert.equal(vm.coverage.coveredBytes, 2493)
  assert.equal(vm.coverage.complete, false, 'dopo l attacco 2 la copertura non e piu completa')
  // Anche qui la tacca non e piu kind 'covered': prende il kind di cio che comincia a quel
  // byte, ed e la coda. E la tacca in cui l attacco 2 diventa visibile.
  assert.deepEqual(vm.marks, [
    { offset: HOLE_START, label: 'Inizio del buco /Contents', kind: 'hole' },
    { offset: COVER_END, label: 'Fine della copertura', kind: 'tail' },
    { offset: 11299, label: 'Fine del file', kind: 'structure' },
  ])
})

test('la coda vince sugli oggetti che finiscono dentro di essa', () => {
  const vm = buildRuler({
    ...DOPO_ATTACCO_2,
    objects: [
      ...SEZIONI_FIRMATO,
      { id: 'obj-coda', label: 'Oggetto appeso dall attacco', start: 11299 - 400, end: 11299 },
    ],
  })
  assertTassella(vm)
  assert.equal(segmento(vm, 'obj-coda'), undefined, 'la coda copre per intero l oggetto appeso')
  const coda = segmento(vm, 'tail')
  assert.deepEqual([coda.start, coda.end], [COVER_END, 11299])
})

/* ------------------------------------------------------------------ i due assi */

/**
 * Il caso reale che ha scoperto il difetto, con gli offset veri del campione firmato.
 * Prima della correzione i segmenti pesavano `object` 2493 e `hole` 8194 con ZERO segmenti
 * coperti, mentre coverage.coveredBytes valeva 2493: chi colorava per segment.kind non vedeva
 * nessuna banda firmata. Questa e l asserzione che il difetto faceva fallire.
 */
test('campione firmato vero: i segmenti covered sommano esattamente a coverage.coveredBytes', () => {
  const vm = buildRuler({ ...FIRMATO, objects: SEZIONI_FIRMATO })
  assertTassella(vm)

  const coperti = vm.segments.filter((s) => s.covered)
  assert.ok(coperti.length > 0, 'nessun segmento coperto: la demo perde la cosa che deve mostrare')
  assert.equal(sommaCoperti(vm), 2493, 'i byte firmati sono b + d = 1489 + 1004')
  assert.equal(sommaCoperti(vm), vm.coverage.coveredBytes)
  assert.equal(vm.coverage.coveredBytes, 2493)

  // Il complemento torna: tutto il resto del file e il buco /Contents.
  const scoperti = vm.segments.filter((s) => !s.covered)
  assert.equal(scoperti.reduce((tot, s) => tot + (s.end - s.start), 0), 8194)
  assert.equal(vm.fileLength, 2493 + 8194)

  // E la copertura resta anatomia: sono oggetti veri, non una banda anonima.
  assert.ok(coperti.some((s) => s.kind === 'object'), 'la copertura ha perso la mappa anatomica')
  assert.equal(diKind(vm, 'covered').length, 0, '"covered" non e un kind: e l asse 2')
  assert.ok(vm.segments.every((s) => KIND_DEL_RIGHELLO.includes(s.kind)))
})

test('un confine della copertura dentro un oggetto lo spezza in due, stesso kind e stessa label', () => {
  // Copertura [200, 500) + [600, 1000), buco [500, 600): l oggetto comincia prima di `a`, quindi
  // il confine della copertura gli cade in mezzo, a 200.
  const vm = buildRuler({
    fileLength: 1000,
    byteRange: [200, 300, 600, 400],
    objects: [{ id: 'obj9', label: 'Oggetto 9 - a cavallo del confine', start: 100, end: 450 }],
  })
  assertTassella(vm)

  const primo = segmento(vm, 'obj9')
  const secondo = segmento(vm, 'obj9#2')
  assert.deepEqual([primo.start, primo.end, primo.covered], [100, 200, false])
  assert.deepEqual([secondo.start, secondo.end, secondo.covered], [200, 450, true])
  assert.equal(secondo.label, primo.label, 'i due tronconi sono lo stesso oggetto')
  assert.equal(secondo.kind, primo.kind, 'lo spezzamento e sull asse 2, il kind non cambia')
  assert.equal(primo.kind, 'object')

  // Insieme coprono esattamente l originale, senza avanzi ne sovrapposizioni.
  assert.equal(primo.end, secondo.start)
  assert.deepEqual([primo.start, secondo.end], [100, 450])
  assert.equal((primo.end - primo.start) + (secondo.end - secondo.start), 450 - 100)
  assert.equal(primo.fraction + secondo.fraction, 350 / 1000)
})

test('dopo l attacco 2 la coda ha covered:false e la copertura non e completa', () => {
  const vm = buildRuler({ ...DOPO_ATTACCO_2, objects: SEZIONI_FIRMATO })
  assertTassella(vm)

  const coda = segmento(vm, 'tail')
  assert.equal(coda.covered, false, 'la coda e appesa dopo la firma: non puo essere firmata')
  assert.equal(coda.kind, 'tail')
  assert.equal(vm.coverage.complete, false)

  // L attacco appende, non firma: i byte coperti restano quelli di prima, e nessuno di essi
  // sta oltre la fine della copertura.
  assert.equal(sommaCoperti(vm), 2493)
  assert.equal(vm.coverage.coveredBytes, 2493)
  assert.ok(
    vm.segments.filter((s) => s.covered).every((s) => s.end <= COVER_END),
    'un segmento coperto oltre la fine della copertura',
  )
  assert.equal(vm.segments.filter((s) => !s.covered).at(-1), coda)
})

test('la tassellatura regge dopo lo spezzamento: nessun buco, nessuna sovrapposizione', () => {
  // Un caso che spezza su tutti i fronti: confine della copertura dentro il primo oggetto,
  // buco dentro il secondo, coda dentro il terzo.
  const vm = buildRuler({
    fileLength: 1200,
    byteRange: [150, 250, 700, 300],
    uncoveredTail: 200,
    objects: [
      { id: 'a', label: 'Oggetto A', start: 0, end: 500 },
      { id: 'b', label: 'Oggetto B', start: 500, end: 800 },
      { id: 'c', label: 'Oggetto C', start: 800, end: 1100 },
    ],
  })
  assertTassella(vm)

  assert.deepEqual(
    vm.segments.map((s) => [s.id, s.start, s.end, s.kind, s.covered]),
    [
      ['a', 0, 150, 'object', false],
      ['a#2', 150, 400, 'object', true],
      ['hole', 400, 700, 'hole', false],
      ['b', 700, 800, 'object', true],
      ['c', 800, 1000, 'object', true],
      ['tail', 1000, 1200, 'tail', false],
    ],
  )
  assert.equal(segmento(vm, 'a#2').label, segmento(vm, 'a').label)
  assert.equal(sommaCoperti(vm), 250 + 300)
  assert.equal(vm.coverage.coveredBytes, 550)
  assert.equal(vm.coverage.complete, false)
  assert.deepEqual(vm.marks, [
    { offset: 400, label: 'Inizio del buco /Contents', kind: 'hole' },
    { offset: 1000, label: 'Fine della copertura', kind: 'tail' },
    { offset: 1200, label: 'Fine del file', kind: 'structure' },
  ])
})

test('senza byteRange nessun segmento e coperto, e il righello resta una mappa anatomica', () => {
  const vm = buildRuler({ fileLength: CAMPIONE.fileLength, objects: CAMPIONE.sezioni })
  assertTassella(vm)
  assert.ok(vm.segments.every((s) => s.covered === false), 'copertura inventata senza byteRange')
  assert.equal(sommaCoperti(vm), 0)
  assert.equal(vm.coverage.coveredBytes, 0)
  assert.equal(vm.segments.length, CAMPIONE.sezioni.length, 'nessuno spezzamento senza confini')
  assert.ok(vm.segments.every((s) => s.kind === 'object'))
})

/* ------------------------------------------------------------------ objects incompleti */

test('objects vuoto: restano copertura, buco e coda, e il righello tassella lo stesso', () => {
  // Le zone senza oggetto sono kind 'structure' anche quando sono firmate: il fatto di essere
  // firmate sta sull asse 2 (covered), non sull asse 1. Prima erano kind 'covered', ed e
  // esattamente la confusione che rendeva invisibile la copertura sui file con oggetti.
  const vm = buildRuler({ ...FIRMATO, objects: [] })
  assertTassella(vm)
  assert.deepEqual(
    vm.segments.map((s) => [s.kind, s.covered, s.start, s.end]),
    [
      ['structure', true, 0, HOLE_START],
      ['hole', false, HOLE_START, HOLE_END],
      ['structure', true, HOLE_END, COVER_END],
    ],
  )
  assert.equal(vm.coverage.complete, true)

  const attaccato = buildRuler({ ...DOPO_ATTACCO_2, objects: [] })
  assertTassella(attaccato)
  assert.deepEqual(
    attaccato.segments.map((s) => [s.kind, s.covered, s.start, s.end]),
    [
      ['structure', true, 0, HOLE_START],
      ['hole', false, HOLE_START, HOLE_END],
      ['structure', true, HOLE_END, COVER_END],
      ['tail', false, COVER_END, 11299],
    ],
  )
  assert.equal(attaccato.coverage.complete, false)
})

test('objects parziali: le zone scoperte diventano segmenti, coperti o di struttura', () => {
  const vm = buildRuler({
    ...FIRMATO,
    objects: [
      { id: 'obj3', label: 'Oggetto 3 - Pagina', start: 115, end: 253 },
      { id: 'obj4', label: 'Oggetto 4 - Contenuto della pagina', start: 253, end: 954 },
    ],
  })
  assertTassella(vm)
  // Le zone scoperte dagli oggetti sono struttura, coperta o no che sia: l id e l etichetta
  // vengono dall asse 1, la copertura dall asse 2. Prima kind ed id dicevano 'covered'.
  assert.deepEqual(
    vm.segments.map((s) => [s.id, s.start, s.end, s.kind, s.covered]),
    [
      ['structure-0', 0, 115, 'structure', true],
      ['obj3', 115, 253, 'object', true],
      ['obj4', 253, 954, 'object', true],
      ['structure-954', 954, HOLE_START, 'structure', true],
      ['hole', HOLE_START, HOLE_END, 'hole', false],
      ['structure-9683', HOLE_END, COVER_END, 'structure', true],
    ],
  )
  assert.equal(vm.segments[0].label, 'Struttura del file')
})

test('senza copertura le zone scoperte sono struttura, non copertura', () => {
  const vm = buildRuler({
    fileLength: 1285,
    objects: [{ id: 'obj4', label: 'Oggetto 4', start: 253, end: 954 }],
  })
  assertTassella(vm)
  assert.deepEqual(
    vm.segments.map((s) => [s.id, s.start, s.end, s.kind]),
    [
      ['structure-0', 0, 253, 'structure'],
      ['obj4', 253, 954, 'object'],
      ['structure-954', 954, 1285, 'structure'],
    ],
  )
  assert.equal(vm.segments[0].label, 'Struttura del file')
})

test('un intervallo coperto che comincia dopo l inizio del file lascia una testa di struttura', () => {
  const vm = buildRuler({ fileLength: 1000, byteRange: [100, 300, 500, 500], objects: [] })
  assertTassella(vm)
  // Tutta struttura sull asse 1: a distinguere la testa dal resto e covered, non il kind.
  assert.deepEqual(
    vm.segments.map((s) => [s.kind, s.covered, s.start, s.end]),
    [
      ['structure', false, 0, 100],
      ['structure', true, 100, 400],
      ['hole', false, 400, 500],
      ['structure', true, 500, 1000],
    ],
  )
  assert.equal(vm.coverage.complete, false, 'i byte prima di a non sono ne coperti ne buco')
})

test('objects fuori dal file: ritagliati o scartati, il righello resta valido', () => {
  const vm = buildRuler({
    fileLength: 1285,
    objects: [
      { id: 'header', label: 'Intestazione', start: 0, end: 0 },
      { id: 'coda', label: 'A cavallo della fine', start: 1279, end: 4000 },
      { id: 'dopo', label: 'Tutto dopo', start: 5000, end: 6000 },
      { id: 'lontano', label: 'Comincia dove finisce il file', start: 1285, end: 1300 },
    ],
  })
  assertTassella(vm)
  assert.deepEqual(
    vm.segments.map((s) => [s.id, s.start, s.end]),
    [['structure-0', 0, 1279], ['coda', 1279, 1285]],
  )
})

test('offset negativi: rifiutati, un byte non sta prima dell inizio del file', () => {
  assert.throws(
    () => buildRuler({ fileLength: 1285, objects: [{ id: 'prima', label: 'Prima', start: -20, end: 9 }] }),
    { code: 'INVALID_INPUT' },
  )
})

/* ------------------------------------------------------------------ conflitti dichiarati */

test('objects sovrapposti: conflitto esplicito, non un righello sbagliato in silenzio', () => {
  const sovrapposti = [
    { id: 'obj4', label: 'Oggetto 4', start: 253, end: 954 },
    { id: 'obj5', label: 'Oggetto 5', start: 900, end: 1026 },
  ]
  assert.throws(
    () => buildRuler({ fileLength: 1285, objects: sovrapposti }),
    (errore) => {
      assert.equal(errore.code, 'OVERLAPPING_OBJECTS')
      assert.match(errore.message, /"obj4".*"obj5".*\[900, 954\)/)
      return true
    },
  )
})

test('objects sovrapposti dentro il buco: segnalati lo stesso', () => {
  assert.throws(
    () => buildRuler({
      ...FIRMATO,
      objects: [
        { id: 'a', label: 'A', start: 2000, end: 3000 },
        { id: 'b', label: 'B', start: 2500, end: 3500 },
      ],
    }),
    { code: 'OVERLAPPING_OBJECTS' },
  )
})

test('objects con id duplicato: rifiutati, gli id servono al rendering', () => {
  assert.throws(
    () => buildRuler({
      fileLength: 1285,
      objects: [
        { id: 'obj4', label: 'Uno', start: 0, end: 100 },
        { id: 'obj4', label: 'Due', start: 100, end: 200 },
      ],
    }),
    { code: 'DUPLICATE_OBJECT_ID' },
  )
})

test('kind fuori dall asse 1 del righello: rifiutato', () => {
  assert.throws(
    () => buildRuler({ fileLength: 100, objects: [{ id: 'x', label: 'X', start: 0, end: 10, kind: 'objects' }] }),
    { code: 'UNKNOWN_KIND' },
  )

  // I quattro kind del righello passano: sono quelli che tassellano il file.
  for (const kind of KIND_DEL_RIGHELLO) {
    const vm = buildRuler({ fileLength: 100, objects: [{ id: 'x', label: 'X', start: 0, end: 10, kind }] })
    assert.equal(segmento(vm, 'x').kind, kind)
  }

  // 'covered' non e piu un kind: e l asse 2. Chi lo passa come kind sta facendo l errore che
  // la nota del 10 agosto 2026 in docs/contratti-ui.md documenta, e va fermato subito.
  assert.throws(
    () => buildRuler({ fileLength: 100, objects: [{ id: 'x', label: 'X', start: 0, end: 10, kind: 'covered' }] }),
    (errore) => {
      assert.equal(errore.code, 'UNKNOWN_KIND')
      assert.match(errore.message, /asse 2/)
      return true
    },
  )

  // 'target' e 'changed' esistono nel vocabolario condiviso ma vivono solo nell esadecimale:
  // il righello prima li lasciava passare e li riemetteva come kind di un segmento, cioe un
  // colore che chi disegna la fascia non ha. Il contratto dice "nel righello non compaiono mai".
  for (const kind of ['target', 'changed']) {
    assert.throws(
      () => buildRuler({ fileLength: 100, objects: [{ id: 'x', label: 'X', start: 0, end: 10, kind }] }),
      { code: 'UNKNOWN_KIND' },
    )
  }
})

test('uncoveredTail che non concorda con byteRange e fileLength: rifiutato', () => {
  assert.throws(
    () => buildRuler({ fileLength: 11299, byteRange: [0, 1489, 9683, 1004], uncoveredTail: 0, objects: [] }),
    (errore) => {
      assert.equal(errore.code, 'TAIL_MISMATCH')
      assert.match(errore.message, /risulta 612/)
      return true
    },
  )
  assert.throws(
    () => buildRuler({ fileLength: 1285, uncoveredTail: 40, objects: [] }),
    { code: 'TAIL_MISMATCH' },
  )
  // concorde: passa, e uncoveredTail assente e sempre ammesso
  assert.equal(buildRuler({ ...DOPO_ATTACCO_2, objects: [] }).coverage.tailBytes, 612)
  assert.equal(
    buildRuler({ fileLength: 11299, byteRange: [0, 1489, 9683, 1004], objects: [] }).coverage.tailBytes,
    612,
  )
})

test('fileLength e byteRange malformati: rifiutati con messaggio esplicito', () => {
  assert.throws(() => buildRuler({}), { code: 'INVALID_INPUT' })
  assert.throws(() => buildRuler({ fileLength: 0 }), { code: 'INVALID_INPUT' })
  assert.throws(() => buildRuler({ fileLength: -3 }), { code: 'INVALID_INPUT' })
  assert.throws(() => buildRuler({ fileLength: 12.5 }), { code: 'INVALID_INPUT' })
  assert.throws(() => buildRuler({ fileLength: '1285' }), { code: 'INVALID_INPUT' })
  assert.throws(() => buildRuler({ fileLength: 100, objects: {} }), { code: 'INVALID_INPUT' })

  assert.throws(() => buildRuler({ fileLength: 100, byteRange: [0, 10, 20] }), { code: 'INVALID_BYTE_RANGE' })
  assert.throws(() => buildRuler({ fileLength: 100, byteRange: [0, 10, 5, 20] }), { code: 'INVALID_BYTE_RANGE' })
  assert.throws(() => buildRuler({ fileLength: 100, byteRange: [0, 10, 20, 200] }), { code: 'INVALID_BYTE_RANGE' })
  assert.throws(() => buildRuler({ fileLength: 100, byteRange: [0, 10, 20, -1] }), { code: 'INVALID_INPUT' })

  assert.throws(
    () => buildRuler({ fileLength: 100, objects: [{ id: 'x', start: 50, end: 10 }] }),
    { code: 'INVALID_OBJECT' },
  )
  assert.throws(() => buildRuler({ fileLength: 100, objects: [{ start: 0, end: 10 }] }), { code: 'INVALID_OBJECT' })
  assert.throws(() => buildRuler({ fileLength: 100, objects: [null] }), { code: 'INVALID_OBJECT' })
})

/* ------------------------------------------------------------------ casi limite */

test('buco di lunghezza zero: nessun segmento buco e nessuna tacca del buco', () => {
  const vm = buildRuler({ fileLength: 1000, byteRange: [0, 400, 400, 600], objects: [] })
  assertTassella(vm)
  // Un segmento solo, non due: i due intervalli si toccano, e dove la copertura non cambia non
  // c e niente da spezzare. Il kind e 'structure' (asse 1), la firma sta su covered (asse 2).
  assert.deepEqual(vm.segments.map((s) => [s.kind, s.covered, s.start, s.end]), [['structure', true, 0, 1000]])
  assert.equal(vm.coverage.holeBytes, 0)
  assert.equal(vm.coverage.coveredBytes, 1000)
  assert.equal(vm.coverage.complete, true)
  assert.deepEqual(vm.marks, [{ offset: 1000, label: 'Fine della copertura', kind: 'structure' }])
})

test('objects che tassellano gia il file: nessun segmento generato in piu', () => {
  const vm = buildRuler({ fileLength: 1285, objects: CAMPIONE.sezioni })
  assert.equal(vm.segments.length, 10)
  assert.deepEqual(
    vm.segments.map((s) => s.id),
    CAMPIONE.sezioni.map((s) => s.id),
  )
})

test('oggetto senza label: ripiega sull id invece di restare senza etichetta', () => {
  const vm = buildRuler({ fileLength: 100, objects: [{ id: 'obj7', start: 0, end: 100 }] })
  assert.equal(segmento(vm, 'obj7').label, 'obj7')
})

test('funzione pura: non tocca gli argomenti e non condivide riferimenti', () => {
  const objects = [{ id: 'obj4', label: 'Oggetto 4', start: 253, end: 954 }]
  const copia = structuredClone(objects)
  const byteRange = [...FIRMATO.byteRange]

  const vm = buildRuler({ fileLength: FIRMATO.fileLength, byteRange, uncoveredTail: 0, objects })
  assert.deepEqual(objects, copia, 'objects modificato')
  assert.deepEqual(byteRange, FIRMATO.byteRange, 'byteRange modificato')

  vm.byteRange[0] = 999
  assert.deepEqual(byteRange, FIRMATO.byteRange, 'il byteRange restituito e un alias di quello dato')
  assert.deepEqual(buildRuler({ ...FIRMATO, objects }), buildRuler({ ...FIRMATO, objects }))
})

test('la tassellatura regge su mille combinazioni casuali di file, copertura e oggetti', () => {
  // Generatore deterministico: un fallimento si riproduce rilanciando il test.
  let seme = 20260810
  const casuale = (max) => {
    seme = (seme * 1103515245 + 12345) % 2147483648
    return seme % max
  }

  for (let giro = 0; giro < 1000; giro++) {
    const fileLength = 20 + casuale(4000)

    // byteRange plausibile: due intervalli separati da un buco, coda facoltativa.
    let byteRange = null
    if (casuale(4) > 0) {
      const a = casuale(3) === 0 ? casuale(10) : 0
      const b = casuale(fileLength - a)
      const c = a + b + casuale(fileLength - a - b + 1)
      const d = casuale(fileLength - c + 1)
      byteRange = [a, b, c, d]
    }

    // oggetti disgiunti: partiziono il file e poi ne butto via qualcuno.
    const tagli = [0]
    for (let i = 0; i < casuale(8); i++) tagli.push(casuale(fileLength))
    tagli.push(fileLength)
    tagli.sort((x, y) => x - y)
    const objects = []
    for (let i = 0; i < tagli.length - 1; i++) {
      if (tagli[i + 1] <= tagli[i] || casuale(3) === 0) continue
      objects.push({ id: `o${i}`, label: `Oggetto ${i}`, start: tagli[i], end: tagli[i + 1] })
    }

    const vm = buildRuler({ fileLength, byteRange, objects })
    assertTassella(vm)

    // Il buco e la coda restano quelli del byteRange, qualunque cosa dicano gli oggetti.
    if (byteRange) {
      const [a, b, c, d] = byteRange
      const buco = segmento(vm, 'hole')
      if (c > a + b) assert.deepEqual([buco.start, buco.end], [a + b, c])
      else assert.equal(buco, undefined)
      const coda = segmento(vm, 'tail')
      if (fileLength > c + d) assert.deepEqual([coda.start, coda.end], [c + d, fileLength])
      else assert.equal(coda, undefined)
      assert.equal(vm.coverage.complete, b + d + (c - a - b) === fileLength)
    }
  }
})

test('l ordine degli objects in ingresso non conta', () => {
  const dritti = buildRuler({ ...FIRMATO, objects: SEZIONI_FIRMATO })
  const rovesci = buildRuler({ ...FIRMATO, objects: [...SEZIONI_FIRMATO].reverse() })
  assert.deepEqual(rovesci, dritti)
})
