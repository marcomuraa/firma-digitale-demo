// Costruttore di elementi, minimo e senza dipendenze.
//
// Serve a una cosa sola: scrivere il DOM in JavaScript senza innerHTML. Tutto il testo che
// finisce a schermo passa da `textContent`, quindi non esiste nessun punto in cui una stringa
// possa diventare markup — ne quelle di copy.it.js, ne le etichette che arrivano dalla macchina.

/**
 * @param {string} tag
 * @param {object} [opzioni]  classe · testo · dati (dataset) · su (eventi) · stile · qualunque attributo
 * @param {Node|Node[]|null} [figli]
 * @returns {HTMLElement}
 */
export function el(tag, opzioni = {}, figli = null) {
  const nodo = document.createElement(tag)
  for (const [chiave, valore] of Object.entries(opzioni)) {
    if (valore === null || valore === undefined || valore === false) continue
    if (chiave === 'classe') nodo.className = valore
    else if (chiave === 'testo') nodo.textContent = String(valore)
    else if (chiave === 'dati') {
      for (const [nome, v] of Object.entries(valore)) {
        if (v !== null && v !== undefined && v !== false) nodo.dataset[nome] = v === true ? '' : String(v)
      }
    } else if (chiave === 'stile') {
      for (const [nome, v] of Object.entries(valore)) nodo.style.setProperty(nome, String(v))
    } else if (chiave === 'su') {
      for (const [evento, fn] of Object.entries(valore)) nodo.addEventListener(evento, fn)
    } else {
      nodo.setAttribute(chiave, valore === true ? '' : String(valore))
    }
  }
  aggiungi(nodo, figli)
  return nodo
}

/** Appende figli saltando null e undefined: cosi i rami condizionali restano espressioni. */
export function aggiungi(nodo, figli) {
  if (figli === null || figli === undefined) return nodo
  for (const figlio of Array.isArray(figli) ? figli : [figli]) {
    if (figlio === null || figlio === undefined || figlio === false) continue
    nodo.append(figlio)
  }
  return nodo
}

/** Un bottone vero, sempre: il contratto del DOM pretende elementi raggiungibili con Tab. */
export function bottone(testo, opzioni = {}) {
  return el('button', { type: 'button', testo, ...opzioni })
}

/** Rispetta prefers-reduced-motion sul serio: qui si legge, non si dichiara soltanto. */
export function menoMovimento() {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

/** Porta un elemento in vista, senza scorrimento animato se chi guarda lo ha chiesto. */
export function portaInVista(nodo, blocco = 'start') {
  if (!nodo || typeof nodo.scrollIntoView !== 'function') return
  nodo.scrollIntoView({ behavior: menoMovimento() ? 'auto' : 'smooth', block: blocco })
}
