/**
 * Attrezzi minimi per costruire DOM senza mai passare da innerHTML.
 *
 * Perche' mai innerHTML: i testi arrivano da src/ui/copy.it.js e dai risultati della macchina,
 * e sono testo semplice. Costruirli come nodi invece che come stringhe toglie di mezzo per
 * sempre la domanda «questa stringa e' markup?», che in una demo sulla falsificazione sarebbe
 * una domanda imbarazzante.
 */

/**
 * Crea un elemento.
 *
 * @param {string} tag
 * @param {object} [props]  classe · testo · stile · dati (dataset) · su (listener) ·
 *                          qualunque altra chiave diventa un attributo
 * @param {Node|Node[]|null} [figli]
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, figli = []) {
  const nodo = document.createElement(tag)
  for (const [chiave, valore] of Object.entries(props)) {
    if (valore === null || valore === undefined || valore === false) continue
    if (chiave === 'classe') nodo.className = valore
    else if (chiave === 'testo') nodo.textContent = String(valore)
    else if (chiave === 'stile') Object.assign(nodo.style, valore)
    else if (chiave === 'dati') {
      for (const [k, v] of Object.entries(valore)) {
        if (v !== null && v !== undefined && v !== false) nodo.dataset[k] = String(v)
      }
    } else if (chiave === 'su') {
      for (const [k, v] of Object.entries(valore)) nodo.addEventListener(k, v)
    } else {
      nodo.setAttribute(chiave, valore === true ? '' : String(valore))
    }
  }
  aggiungi(nodo, figli)
  return nodo
}

/** Appende figli, ignorando null e undefined: cosi' le liste condizionali restano leggibili. */
export function aggiungi(nodo, figli) {
  for (const figlio of Array.isArray(figli) ? figli : [figli]) {
    if (figlio === null || figlio === undefined || figlio === false) continue
    nodo.append(figlio)
  }
  return nodo
}

/** Svuota un nodo. */
export function svuota(nodo) {
  nodo.replaceChildren()
  return nodo
}

/* ------------------------------------------------------------------ numeri e testi */

/** 1.285 — con il separatore italiano, che e' il punto. */
export function numero(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('it-IT') : '—'
}

/** Esadecimale a gruppi, perche' 64 cifre di fila non si confrontano a occhio. */
export function raggruppa(hex, ampiezza = 8) {
  if (typeof hex !== 'string' || hex.length === 0) return '—'
  return hex.match(new RegExp(`.{1,${ampiezza}}`, 'g')).join(' ')
}

/** I byte come esadecimale, eventualmente troncati con la coda dichiarata. */
export function byteInEsadecimale(bytes, massimo = 32) {
  if (!bytes || typeof bytes.length !== 'number' || bytes.length === 0) return '—'
  const quanti = Math.min(bytes.length, massimo)
  let esa = ''
  for (let i = 0; i < quanti; i++) esa += bytes[i].toString(16).padStart(2, '0')
  const testa = raggruppa(esa, 8)
  return bytes.length > massimo ? `${testa} …` : testa
}

/** Una data leggibile in italiano, ora compresa: la firma dichiara un istante, non un giorno. */
export function dataOra(valore) {
  const d = valore instanceof Date ? valore : new Date(valore)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** I dodici atti si numerano come si numera un repertorio: I, II, III… */
const ROMANI = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']

export function romano(n) {
  return ROMANI[n] ?? String(n)
}

/** Percentuale con due decimali, per le posizioni sul righello. */
export function percento(frazione) {
  return `${(Math.max(0, Math.min(1, frazione)) * 100).toFixed(4)}%`
}
