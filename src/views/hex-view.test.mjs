import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildHexWindow } from './hex-view.js'

/** Byte finti ma deterministici: il valore di ogni byte e il suo offset modulo 256. */
function ramp(length) {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) out[i] = i & 0xff
  return out
}

/** Tutte le celle della finestra, in ordine: comodo per le asserzioni cella per cella. */
function allCells(view) {
  return view.rows.flatMap((row) => row.cells)
}

function cellAt(view, offset) {
  return allCells(view).find((cell) => cell.offset === offset)
}

test('la finestra e sempre allineata a 16, anche con centerOffset dispari', () => {
  const view = buildHexWindow(ramp(1024), 577, 64, [])

  assert.equal(view.start % 16, 0)
  assert.equal(view.end % 16, 0)
  assert.equal(view.end - view.start, 64)
  assert.equal(view.bytesPerRow, 16)
  assert.equal(view.fileLength, 1024)
  assert.equal(view.rows.length, 4)
  assert.deepEqual(
    view.rows.map((row) => row.offset),
    [544, 560, 576, 592],
  )
  assert.equal(view.rows[0].offsetHex, '00000220')
  // centerOffset dispari resta comunque dentro la finestra
  assert.ok(view.start <= 577 && 577 < view.end)
  for (const row of view.rows) {
    assert.equal(row.offset % 16, 0)
    assert.equal(row.cells.length, 16)
    assert.equal(row.cells[0].offset, row.offset)
  }
})

test('lo span viene allargato al multiplo di 16, mai ristretto', () => {
  const bytes = ramp(1024)
  assert.equal(buildHexWindow(bytes, 512, 20, []).end - buildHexWindow(bytes, 512, 20, []).start, 32)
  assert.equal(buildHexWindow(bytes, 512, 1, []).rows.length, 1)
  // span assente o assurdo non fa lanciare: resta una riga
  assert.equal(buildHexWindow(bytes, 512, 0, []).rows.length, 1)
  assert.equal(buildHexWindow(bytes, 512, -100, []).rows.length, 1)
  assert.equal(buildHexWindow(bytes, 512, undefined, []).rows.length, 1)
})

test('finestra a cavallo dell inizio: niente offset negativi, contesto conservato', () => {
  const view = buildHexWindow(ramp(300), 4, 64, [])

  assert.equal(view.start, 0)
  assert.equal(view.end, 64)
  assert.equal(view.rows[0].offsetHex, '00000000')
  assert.deepEqual(view.truncated, { before: false, after: true })
  assert.ok(allCells(view).every((cell) => cell.offset >= 0))
})

test('finestra a cavallo della fine: celle fuori dal file con byte === null, riga sempre di 16', () => {
  const view = buildHexWindow(ramp(300), 298, 64, [])

  assert.equal(view.start, 240)
  assert.equal(view.end, 304) // 300 portato al multiplo di 16 successivo
  assert.deepEqual(view.truncated, { before: true, after: false })

  const lastRow = view.rows[view.rows.length - 1]
  assert.equal(lastRow.offset, 288)
  assert.equal(lastRow.cells.length, 16)

  const ultimoDelFile = cellAt(view, 299)
  assert.equal(ultimoDelFile.byte, 299 & 0xff)
  assert.equal(ultimoDelFile.hex, '2b')

  for (const offset of [300, 301, 302, 303]) {
    const cell = cellAt(view, offset)
    assert.equal(cell.byte, null)
    assert.equal(cell.hex, null)
    assert.equal(cell.char, null)
    assert.equal(cell.printable, false)
    assert.deepEqual(cell.highlightIds, [])
  }
})

test('span piu grande del file intero: si vede tutto il file, una volta sola', () => {
  const view = buildHexWindow(ramp(40), 20, 4096, [])

  assert.equal(view.start, 0)
  assert.equal(view.end, 48)
  assert.equal(view.rows.length, 3)
  assert.deepEqual(view.truncated, { before: false, after: false })
  assert.equal(cellAt(view, 39).byte, 39)
  assert.equal(cellAt(view, 40).byte, null)
  assert.equal(cellAt(view, 47).byte, null)
})

test('file vuoto: nessuna riga, nessuna eccezione', () => {
  const view = buildHexWindow(new Uint8Array(0), 0, 256, [])

  assert.equal(view.fileLength, 0)
  assert.deepEqual(view.rows, [])
  assert.deepEqual(view.truncated, { before: false, after: false })
  assert.deepEqual(view.highlights, [])
})

test('highlight sovrapposti: highlightIds tiene entrambi, nell ordine in cui sono passati', () => {
  const view = buildHexWindow(ramp(256), 32, 64, [
    { id: 'oggetto', start: 8, end: 40, kind: 'object' },
    { id: 'buco', start: 30, end: 50, kind: 'hole' },
  ])

  assert.deepEqual(cellAt(view, 29).highlightIds, ['oggetto'])
  assert.deepEqual(cellAt(view, 30).highlightIds, ['oggetto', 'buco'])
  assert.deepEqual(cellAt(view, 39).highlightIds, ['oggetto', 'buco'])
  assert.deepEqual(cellAt(view, 40).highlightIds, ['buco'])
  assert.deepEqual(cellAt(view, 50).highlightIds, [])
})

test('l ordine dentro highlightIds e quello di ingresso, non quello di start', () => {
  const view = buildHexWindow(ramp(256), 32, 64, [
    { id: 'dopo', start: 30, end: 50, kind: 'hole' },
    { id: 'prima', start: 8, end: 40, kind: 'structure' },
  ])

  assert.deepEqual(cellAt(view, 35).highlightIds, ['dopo', 'prima'])
  // il ViewModel espone invece gli highlight ordinati per start
  assert.deepEqual(
    view.highlights.map((h) => h.id),
    ['prima', 'dopo'],
  )
})

test('highlight che sborda dalla finestra: clampato ai bordi, e truncated lo segnala', () => {
  const view = buildHexWindow(ramp(1024), 512, 64, [
    { id: 'lungo', start: 100, end: 900, kind: 'object', label: 'tutto il documento' },
  ])

  assert.equal(view.start, 480)
  assert.equal(view.end, 544)
  assert.deepEqual(view.highlights, [
    { id: 'lungo', start: 480, end: 544, kind: 'object', label: 'tutto il documento' },
  ])
  assert.deepEqual(view.truncated, { before: true, after: true })
  assert.ok(allCells(view).every((cell) => cell.highlightIds.length === 1))
})

test('highlight fuori dalla finestra: sparisce dal ViewModel, non marca nulla', () => {
  const view = buildHexWindow(ramp(1024), 512, 64, [
    { id: 'altrove', start: 0, end: 100, kind: 'object' },
    { id: 'qui', start: 500, end: 510, kind: 'changed' },
  ])

  assert.deepEqual(
    view.highlights.map((h) => h.id),
    ['qui'],
  )
  assert.ok(allCells(view).every((cell) => !cell.highlightIds.includes('altrove')))
})

test('highlight degeneri: lunghezza zero o start > end vengono ignorati senza lanciare', () => {
  const view = buildHexWindow(ramp(256), 64, 64, [
    { id: 'vuoto', start: 70, end: 70, kind: 'target' },
    { id: 'rovescio', start: 90, end: 80, kind: 'target' },
    { id: 'senzaNumeri', start: undefined, end: null, kind: 'target' },
    null,
    { id: 'buono', start: 70, end: 72, kind: 'changed' },
  ])

  assert.deepEqual(
    view.highlights.map((h) => h.id),
    ['buono'],
  )
  assert.deepEqual(cellAt(view, 70).highlightIds, ['buono'])
  assert.deepEqual(cellAt(view, 72).highlightIds, [])
  // anche l'assenza completa di highlight e legittima
  assert.deepEqual(buildHexWindow(ramp(64), 0, 16).highlights, [])
  assert.deepEqual(buildHexWindow(ramp(64), 0, 16, null).highlights, [])
})

test('kind fuori dal vocabolario: rifiutato con UNKNOWN_KIND e il colpevole nel messaggio', () => {
  assert.throws(
    () => buildHexWindow(ramp(256), 64, 64, [{ id: 'cifra', start: 70, end: 72, kind: 'objects' }]),
    (errore) => {
      assert.equal(errore.code, 'UNKNOWN_KIND')
      assert.match(errore.message, /"objects"/) // il kind sbagliato, cosi com'e stato scritto
      assert.match(errore.message, /"cifra"/) // e a quale highlight appartiene
      return true
    },
  )
  // stessa scelta del righello, stesso code: le due viste non divergono
  assert.throws(
    () => buildHexWindow(ramp(256), 64, 64, [{ id: 'x', start: 0, end: 8, kind: 'Object' }]),
    { code: 'UNKNOWN_KIND' },
  )
  // un kind mancante e un kind fuori vocabolario: qui e obbligatorio, non ha un default
  assert.throws(
    () => buildHexWindow(ramp(256), 64, 64, [{ id: 'senzaKind', start: 0, end: 8 }]),
    { code: 'UNKNOWN_KIND' },
  )
})

test('covered non e un kind: e l asse 2, e come tale viene rifiutato', () => {
  assert.throws(
    () => buildHexWindow(ramp(256), 64, 64, [{ id: 'copertura', start: 0, end: 64, kind: 'covered' }]),
    { code: 'UNKNOWN_KIND' },
  )
})

test('i sei kind del vocabolario passano tutti, e restano intatti nel ViewModel', () => {
  const kinds = ['object', 'structure', 'hole', 'tail', 'target', 'changed']
  const view = buildHexWindow(
    ramp(256),
    64,
    128,
    kinds.map((kind, i) => ({ id: kind, start: 16 + i * 8, end: 24 + i * 8, kind })),
  )

  assert.deepEqual(
    view.highlights.map((h) => h.kind),
    kinds,
  )
})

test('il kind si valida prima della geometria: ne il vuoto ne la distanza lo nascondono', () => {
  // Un highlight degenere o fuori finestra non finisce nel ViewModel, ma il suo kind e comunque
  // codice sbagliato: se tacessimo, l'errore riemergerebbe il giorno in cui l'intervallo si
  // riempie — cioe in scena, davanti a una cella senza colore.
  assert.throws(
    () => buildHexWindow(ramp(256), 64, 64, [{ id: 'vuoto', start: 70, end: 70, kind: 'covered' }]),
    { code: 'UNKNOWN_KIND' },
  )
  assert.throws(
    () => buildHexWindow(ramp(1024), 512, 64, [{ id: 'altrove', start: 0, end: 8, kind: 'boh' }]),
    { code: 'UNKNOWN_KIND' },
  )

  // E il rovescio della stessa regola: la geometria degenere con un kind buono resta un dato,
  // e i dati non si rifiutano.
  assert.doesNotThrow(() =>
    buildHexWindow(ramp(256), 64, 64, [
      { id: 'vuoto', start: 70, end: 70, kind: 'hole' },
      { id: 'rovescio', start: 90, end: 80, kind: 'target' },
      null,
    ]),
  )
})

test('stampabilita: lo spazio si vede, i byte di controllo diventano un punto', () => {
  const bytes = new Uint8Array([0x20, 0x41, 0x7e, 0x0a, 0x00, 0x1f, 0x7f, 0x80, 0xff])
  const view = buildHexWindow(bytes, 0, 16, [])

  assert.equal(cellAt(view, 0).char, ' ')
  assert.equal(cellAt(view, 0).printable, true)
  assert.equal(cellAt(view, 1).char, 'A')
  assert.equal(cellAt(view, 2).char, '~')
  assert.equal(cellAt(view, 2).printable, true)
  for (const offset of [3, 4, 5, 6, 7, 8]) {
    assert.equal(cellAt(view, offset).char, '.')
    assert.equal(cellAt(view, offset).printable, false)
  }
})

test('hex sempre minuscolo e a due cifre', () => {
  const bytes = new Uint8Array([0x00, 0x09, 0x0a, 0x1f, 0xab, 0xff])
  const view = buildHexWindow(bytes, 0, 16, [])

  assert.deepEqual(
    view.rows[0].cells.slice(0, 6).map((cell) => cell.hex),
    ['00', '09', '0a', '1f', 'ab', 'ff'],
  )
  const dump = buildHexWindow(ramp(256), 128, 256, [])
  for (const cell of allCells(dump)) {
    if (cell.byte === null) continue
    assert.match(cell.hex, /^[0-9a-f]{2}$/)
  }
  for (const row of dump.rows) assert.match(row.offsetHex, /^[0-9a-f]{8}$/)
})

test('funzione pura: stessa entrata, stessa uscita, e la sorgente non viene toccata', () => {
  const bytes = ramp(300)
  const copia = bytes.slice()
  const highlights = [{ id: 'a', start: 10, end: 20, kind: 'object' }]
  const primo = buildHexWindow(bytes, 128, 64, highlights)
  const secondo = buildHexWindow(bytes, 128, 64, highlights)

  assert.deepEqual(primo, secondo)
  assert.notEqual(primo.rows, secondo.rows) // strutture nuove, non condivise
  assert.deepEqual(Array.from(bytes), Array.from(copia))
  assert.deepEqual(highlights, [{ id: 'a', start: 10, end: 20, kind: 'object' }])
})

test('sul PDF campione: la finestra sull importo mostra davvero le cifre', () => {
  const base = new URL('../assets/', import.meta.url)
  const pdf = new Uint8Array(readFileSync(new URL('sample.pdf', base)))
  const offsets = JSON.parse(readFileSync(new URL('sample-offsets.json', base), 'utf8'))
  const { digitsStart, digitsEnd, digits } = offsets.amount

  assert.equal(pdf.length, offsets.fileLength)

  const view = buildHexWindow(pdf, digitsStart, 128, [
    { id: 'cifra', start: digitsStart, end: digitsEnd, kind: 'target', label: 'importo in cifre' },
  ])

  const letto = allCells(view)
    .filter((cell) => cell.offset >= digitsStart && cell.offset < digitsEnd)
    .map((cell) => cell.char)
    .join('')
  assert.equal(letto, digits)

  const marcate = allCells(view).filter((cell) => cell.highlightIds.includes('cifra'))
  assert.equal(marcate.length, digitsEnd - digitsStart)
  assert.equal(marcate[0].offset, digitsStart)
  assert.deepEqual(view.truncated, { before: true, after: true })
})
