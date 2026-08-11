/**
 * Il righello dei byte: l'elemento firma della pagina.
 *
 * Una fascia che rappresenta l'intero file a scala reale. Gli intervalli coperti dalla firma
 * sono pieni, il buco /Contents e vuoto, e dopo l'attacco 2 la coda spunta fuori dalla parte
 * coperta. Sullo stesso righello vive la mappa anatomica del documento: ogni oggetto PDF e un
 * segmento etichettabile.
 *
 * DUE ASSI, NON UNO (docs/contratti-ui.md, correzione del 10 agosto 2026):
 *  - asse 1, `kind`: che cosa *sono* quei byte. Nel righello vale solo `object`, `structure`,
 *    `hole`, `tail`, e i quattro tassellano il file. `target` e `changed` sono strati che si
 *    accendono sopra l'esadecimale e qui non compaiono mai;
 *  - asse 2, `covered`: se quei byte sono *firmati*. Deriva SOLO dal /ByteRange, mai dal kind.
 *
 * Tenerli su un asse solo e l'errore che rendeva invisibile proprio la cosa da mostrare: sul
 * campione firmato vero i segmenti pesavano `object` 2493 e `hole` 8194 con zero segmenti
 * coperti, mentre `coverage.coveredBytes` valeva 2493. Chi colorava per `segment.kind` non
 * vedeva nessuna banda firmata.
 *
 * `covered` e uniforme su ogni segmento: dove un confine della copertura cade in mezzo a un
 * oggetto il segmento SI SPEZZA in due, stesso `kind` e stessa `label`, `covered` diverso. E
 * quel confine il punto in cui l'attacco 2 diventa visibile, quindi deve cadere al byte giusto.
 *
 * Funzione pura: nessun DOM, nessun accesso a window, nessuno stato, nessun import — nemmeno
 * di sample-offsets.json, che resta un parametro (`objects`) e un parametro deve restare.
 *
 * L'invariante che tiene in piedi tutto: `segments` tassella [0, fileLength) senza buchi ne
 * sovrapposizioni, anche quando gli `objects` in ingresso non lo fanno. Un righello che mente
 * sulla forma del file non puo dimostrare niente sull'integrita del file.
 *
 * @typedef {'object'|'structure'|'hole'|'tail'} Kind
 * @typedef {{ id: string, label: string, start: number, end: number, fraction: number, kind: Kind, covered: boolean }} Segment
 * @typedef {{ offset: number, label: string, kind: Kind }} Mark
 */

/**
 * L'asse 1, chiuso: i quattro kind che tassellano il righello.
 *
 * `covered` NON e qui dentro, e non e una dimenticanza: e l'asse 2, un boolean derivato dal
 * /ByteRange. `target` e `changed` esistono nel vocabolario condiviso ma vivono solo
 * nell'esadecimale (docs/contratti-ui.md, colonna "Dove"): un righello che li accettasse
 * emetterebbe segmenti con un kind che chi disegna la fascia non sa colorare.
 */
const KINDS = new Set(['object', 'structure', 'hole', 'tail'])

/** Etichette generiche dei segmenti che il righello genera da se. */
const LABELS = {
  hole: 'Buco /Contents',
  tail: 'Coda non coperta dalla firma',
  structure: 'Struttura del file',
}

/** Etichette dei confini notevoli. */
const MARK_LABELS = {
  holeStart: 'Inizio del buco /Contents',
  coverageEnd: 'Fine della copertura',
  fileEnd: 'Fine del file',
}

/**
 * Costruisce il ViewModel del righello.
 *
 * @param {object} input
 * @param {number} input.fileLength      lunghezza totale del file in byte, intero positivo
 * @param {?number[]} [input.byteRange]  [a, b, c, d] PAdES, oppure null/assente se non firmato
 * @param {?number} [input.uncoveredTail] byte oltre c+d; se dato deve concordare con fileLength
 * @param {Array<{id: string, label?: string, start: number, end: number, kind?: Kind}>} [input.objects]
 * @returns {{ fileLength: number, segments: Segment[], coverage: object, byteRange: ?number[], marks: Mark[] }}
 */
export function buildRuler(input = {}) {
  if (input === null || typeof input !== 'object') {
    fail('INVALID_INPUT', 'buildRuler vuole un oggetto { fileLength, byteRange, uncoveredTail, objects }.')
  }
  const { fileLength, byteRange = null, uncoveredTail = null, objects = [] } = input

  requireInteger(fileLength, 'fileLength', 1)
  const range = normalizeByteRange(byteRange, fileLength)
  checkUncoveredTail(uncoveredTail, range, fileLength)

  // La maschera della copertura: l'unica sorgente dell'asse 2. Senza byteRange e vuota, e tutto
  // il righello risulta covered:false — una mappa anatomica valida, solo senza copertura.
  const coveredMask = mergeIntervals(range ? range.intervals : [])
  const coverageEdges = new Set()
  for (const [from, to] of coveredMask) {
    coverageEdges.add(from)
    coverageEdges.add(to)
  }

  /** @type {Array<{baseId: ?string, label: string, start: number, end: number, kind: Kind}>} */
  const pieces = []

  // 1. Il buco e la coda vengono dal /ByteRange, non dagli objects, e vincono su di essi:
  //    sono i due fatti che il righello deve mostrare anche quando l'anatomia li ignora.
  if (range && range.holeEnd > range.holeStart) {
    pieces.push({ baseId: 'hole', label: LABELS.hole, start: range.holeStart, end: range.holeEnd, kind: 'hole' })
  }
  if (range && fileLength > range.coverEnd) {
    pieces.push({ baseId: 'tail', label: LABELS.tail, start: range.coverEnd, end: fileLength, kind: 'tail' })
  }
  const blockers = pieces.map((piece) => [piece.start, piece.end]).sort((x, y) => x[0] - y[0])

  // 2. Gli oggetti, ritagliati al file e forati da buco e coda.
  for (const object of normalizeObjects(objects, fileLength)) {
    for (const [start, end] of subtractRanges([object.start, object.end], blockers)) {
      pieces.push({ baseId: object.id, label: object.label, start, end, kind: object.kind })
    }
  }

  // 3. Cio che nessuno ha rivendicato e struttura del file, coperta o no che sia: l'asse 1 non
  //    guarda il /ByteRange. E questo passo che rende il righello una tassellatura.
  pieces.sort(byStart)
  for (const [start, end] of complementRanges(pieces, fileLength)) {
    pieces.push({ baseId: null, label: LABELS.structure, start, end, kind: 'structure' })
  }
  pieces.sort(byStart)

  // 4. Lo spezzamento dell'asse 2: ogni pezzo viene tagliato sui confini della copertura, cosi
  //    `covered` e uniforme su ognuno e il confine cade al byte giusto. I due tronconi tengono
  //    kind e label dell'originale — restano lo stesso oggetto, letto con l'altra domanda.
  const segments = []
  const counters = new Map()
  for (const piece of pieces) {
    for (const [start, end] of splitOnEdges(piece.start, piece.end, coverageEdges)) {
      segments.push({
        id: piece.baseId === null ? `${piece.kind}-${start}` : nextPieceId(counters, piece.baseId),
        label: piece.label,
        start,
        end,
        fraction: (end - start) / fileLength,
        kind: piece.kind,
        covered: isCovered(start, coveredMask),
      })
    }
  }

  const coveredBytes = coveredMask.reduce((total, [from, to]) => total + (to - from), 0)
  const holeBytes = range ? range.holeEnd - range.holeStart : 0
  const tailBytes = range ? fileLength - range.coverEnd : 0
  assertTiling(segments, fileLength, coveredBytes)

  return {
    fileLength,
    segments,
    coverage: {
      coveredBytes,
      holeBytes,
      tailBytes,
      coveredFraction: coveredBytes / fileLength,
      complete: coveredBytes + holeBytes === fileLength,
    },
    byteRange: range ? [range.a, range.b, range.c, range.d] : null,
    marks: buildMarks(range, fileLength),
  }
}

/* ------------------------------------------------------------------ validazione */

function fail(code, message) {
  const error = new Error(`buildRuler: ${message}`)
  error.code = code
  throw error
}

function describe(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.join(', ')}]`
  return String(value)
}

function requireInteger(value, name, min = 0) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    fail('INVALID_INPUT', `${name} deve essere un intero >= ${min}, ricevuto ${describe(value)}.`)
  }
  return value
}

/**
 * Normalizza il /ByteRange PAdES. Restituisce null quando il documento non e ancora firmato:
 * il righello resta una mappa anatomica valida, solo senza copertura.
 */
function normalizeByteRange(byteRange, fileLength) {
  if (byteRange === null || byteRange === undefined) return null
  if (!Array.isArray(byteRange) || byteRange.length !== 4) {
    fail('INVALID_BYTE_RANGE', `byteRange deve essere un array di quattro interi [a, b, c, d] oppure null, ricevuto ${describe(byteRange)}.`)
  }
  const [a, b, c, d] = byteRange.map((value, index) => requireInteger(value, `byteRange[${index}]`))
  const holeStart = a + b
  const coverEnd = c + d
  if (holeStart > c) {
    fail('INVALID_BYTE_RANGE', `byteRange incoerente: il primo intervallo finisce a ${holeStart}, oltre l'inizio del secondo (${c}).`)
  }
  if (coverEnd > fileLength) {
    fail('INVALID_BYTE_RANGE', `byteRange incoerente: la copertura finisce a ${coverEnd}, oltre la fine del file (${fileLength}).`)
  }
  const intervals = [[a, holeStart], [c, coverEnd]].filter(([start, end]) => end > start)
  return { a, b, c, d, holeStart, holeEnd: c, coverEnd, intervals }
}

/**
 * `uncoveredTail` e ridondante: la coda si ricava da fileLength e byteRange. Quando i due dati
 * non concordano il righello si ferma invece di disegnare una coda che non esiste — e proprio
 * quel numero che regge il verdetto "esteso dopo la firma".
 */
function checkUncoveredTail(uncoveredTail, range, fileLength) {
  if (uncoveredTail === null || uncoveredTail === undefined) return
  requireInteger(uncoveredTail, 'uncoveredTail')
  const derived = range ? fileLength - range.coverEnd : 0
  if (uncoveredTail !== derived) {
    fail('TAIL_MISMATCH', range
      ? `uncoveredTail dichiarato ${uncoveredTail}, ma da byteRange e fileLength risulta ${derived}.`
      : `uncoveredTail dichiarato ${uncoveredTail} senza byteRange: senza copertura non esiste una coda.`)
  }
}

/**
 * Ritaglia gli oggetti al file, ne verifica la forma e rifiuta le sovrapposizioni.
 * Due oggetti che si sovrappongono sono un errore dei dati in ingresso: segnalarlo e meglio
 * che tagliarne uno a caso e mostrare una mappa anatomica plausibile ma falsa.
 */
function normalizeObjects(objects, fileLength) {
  if (objects === null || objects === undefined) return []
  if (!Array.isArray(objects)) {
    fail('INVALID_INPUT', `objects deve essere un array, ricevuto ${describe(objects)}.`)
  }
  const seen = new Map()
  const clipped = []
  objects.forEach((object, index) => {
    if (object === null || typeof object !== 'object') {
      fail('INVALID_OBJECT', `objects[${index}] non e un oggetto: ${describe(object)}.`)
    }
    const { id } = object
    if (typeof id !== 'string' || id.length === 0) {
      fail('INVALID_OBJECT', `objects[${index}] non ha un id valido: ${describe(id)}.`)
    }
    if (seen.has(id)) {
      fail('DUPLICATE_OBJECT_ID', `id duplicato "${id}": objects[${seen.get(id)}] e objects[${index}] lo condividono.`)
    }
    seen.set(id, index)
    const start = requireInteger(object.start, `objects[${index}].start`)
    const end = requireInteger(object.end, `objects[${index}].end`)
    if (end < start) {
      fail('INVALID_OBJECT', `objects[${index}] ("${id}") ha end ${end} prima di start ${start}.`)
    }
    const kind = object.kind === undefined || object.kind === null ? 'object' : object.kind
    if (!KINDS.has(kind)) {
      fail('UNKNOWN_KIND', `objects[${index}] ("${id}") ha kind ${describe(kind)}, fuori dal vocabolario del righello (${[...KINDS].join(', ')}). "covered" non e un kind ma l'asse 2 (covered: boolean, derivato dal byteRange); "target" e "changed" vivono solo nell'esadecimale.`)
    }
    const label = typeof object.label === 'string' && object.label.length > 0 ? object.label : id
    const from = Math.min(Math.max(start, 0), fileLength)
    const to = Math.min(Math.max(end, 0), fileLength)
    if (to <= from) return // interamente fuori dal file, oppure vuoto: non e un segmento
    clipped.push({ id, label, kind, start: from, end: to })
  })
  clipped.sort(byStart)
  for (let i = 1; i < clipped.length; i++) {
    const previous = clipped[i - 1]
    const current = clipped[i]
    if (current.start < previous.end) {
      fail('OVERLAPPING_OBJECTS', `objects sovrapposti: "${previous.id}" [${previous.start}, ${previous.end}) e "${current.id}" [${current.start}, ${current.end}) si accavallano su [${current.start}, ${Math.min(previous.end, current.end)}).`)
    }
  }
  return clipped
}

/* ------------------------------------------------------------------ intervalli */

function byStart(x, y) {
  return x.start - y.start || x.end - y.end
}

/** Toglie da un intervallo i pezzi coperti dai blockers (disgiunti e ordinati). */
function subtractRanges([start, end], blockers) {
  let pieces = [[start, end]]
  for (const [blockStart, blockEnd] of blockers) {
    const next = []
    for (const [from, to] of pieces) {
      if (blockEnd <= from || blockStart >= to) {
        next.push([from, to])
        continue
      }
      if (from < blockStart) next.push([from, blockStart])
      if (blockEnd < to) next.push([blockEnd, to])
    }
    pieces = next
  }
  return pieces
}

/** Cio che resta di [0, fileLength) dopo aver tolto i pezzi gia rivendicati. */
function complementRanges(taken, fileLength) {
  const gaps = []
  let cursor = 0
  for (const piece of taken) {
    if (piece.start > cursor) gaps.push([cursor, piece.start])
    cursor = Math.max(cursor, piece.end)
  }
  if (cursor < fileLength) gaps.push([cursor, fileLength])
  return gaps
}

/**
 * Fonde gli intervalli coperti in una maschera canonica: ordinata, disgiunta, senza contigui.
 * Fondere i contigui non e cosmesi. Quando il buco /Contents e lungo zero i due intervalli del
 * /ByteRange si toccano, e senza la fusione il righello spezzerebbe un segmento su un confine
 * dove la copertura non cambia: una tacca che non racconta niente.
 */
function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(([from, to]) => to > from)
    .map(([from, to]) => [from, to])
    .sort((x, y) => x[0] - y[0])
  const merged = []
  for (const [from, to] of sorted) {
    const last = merged[merged.length - 1]
    if (last && from <= last[1]) last[1] = Math.max(last[1], to)
    else merged.push([from, to])
  }
  return merged
}

/** Taglia [start, end) sui confini della copertura che gli cadono dentro. */
function splitOnEdges(start, end, edges) {
  const cuts = [...edges].filter((point) => point > start && point < end).sort((x, y) => x - y)
  const points = [start, ...cuts, end]
  const parts = []
  for (let i = 0; i < points.length - 1; i++) parts.push([points[i], points[i + 1]])
  return parts
}

/** Il primo pezzo di un oggetto tiene il suo id, i successivi diventano "id#2", "id#3", ... */
function nextPieceId(counters, baseId) {
  const count = (counters.get(baseId) ?? 0) + 1
  counters.set(baseId, count)
  return count === 1 ? baseId : `${baseId}#${count}`
}

function isCovered(offset, coveredMask) {
  return coveredMask.some(([from, to]) => offset >= from && offset < to)
}

/**
 * Rete di sicurezza sui due invarianti dichiarati dal contratto: la tassellatura e l'accordo fra
 * i due assi. Non deve mai scattare: se scatta, l'errore sta qui dentro e va visto subito, non
 * dieci pannelli piu in la. La seconda meta e proprio il difetto che il collaudo ha scoperto —
 * i segmenti coperti che non sommavano a coverage.coveredBytes.
 */
function assertTiling(segments, fileLength, coveredBytes) {
  let cursor = 0
  let covered = 0
  for (const segment of segments) {
    if (segment.start !== cursor) {
      fail('INTERNAL', `tassellatura rotta: atteso un segmento che parte da ${cursor}, trovato "${segment.id}" a ${segment.start}.`)
    }
    if (segment.end <= segment.start) {
      fail('INTERNAL', `segmento vuoto "${segment.id}" a ${segment.start}.`)
    }
    if (segment.covered) covered += segment.end - segment.start
    cursor = segment.end
  }
  if (cursor !== fileLength) {
    fail('INTERNAL', `tassellatura rotta: i segmenti finiscono a ${cursor}, il file a ${fileLength}.`)
  }
  if (covered !== coveredBytes) {
    fail('INTERNAL', `i due assi non concordano: i segmenti con covered:true sommano ${covered}, coverage.coveredBytes vale ${coveredBytes}.`)
  }
}

/* ------------------------------------------------------------------ confini notevoli */

/**
 * Confini notevoli: inizio del buco, fine della copertura, fine del file. Quando due cadono
 * sullo stesso offset — prima dell'attacco 2 la copertura finisce dove finisce il file — ne
 * resta uno solo: due tacche sovrapposte sono due etichette illeggibili.
 *
 * Il `kind` di una tacca e quello del segmento che comincia li: la tacca sta all'inizio di cio
 * che introduce. Percio la fine della copertura e `tail` quando l'attacco 2 ha appeso qualcosa
 * (ed e la tacca che rende visibile l'attacco) e `structure` quando li finisce anche il file.
 * Non e mai `covered`, che nel righello non e un kind ma l'altro asse.
 */
function buildMarks(range, fileLength) {
  const marks = []
  if (range && range.holeEnd > range.holeStart) {
    marks.push({ offset: range.holeStart, label: MARK_LABELS.holeStart, kind: 'hole' })
  }
  if (range) {
    marks.push({
      offset: range.coverEnd,
      label: MARK_LABELS.coverageEnd,
      kind: fileLength > range.coverEnd ? 'tail' : 'structure',
    })
  }
  marks.push({ offset: fileLength, label: MARK_LABELS.fileEnd, kind: 'structure' })

  const seen = new Set()
  return marks.filter((mark) => {
    if (seen.has(mark.offset)) return false
    seen.add(mark.offset)
    return true
  })
}
