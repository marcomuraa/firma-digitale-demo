/**
 * Il dump esadecimale, dietro un apri-e-chiudi ma vero: byte reali, offset reali, evidenziazioni
 * reali. Quando si apre deve reggere lo sguardo di chi sa leggerlo.
 *
 * Il ViewModel lo fa `buildHexWindow(bytes, centro, ampiezza, evidenziazioni)` di src/views/:
 * qui si sceglie soltanto DOVE centrare la finestra e QUANTO larga, che e' una decisione di
 * disegno, e si rende il risultato.
 *
 * LA LEGENDA SI COPIA, NON SI INDOVINA: le etichette dei colori sono le `label` che la macchina
 * mette dentro ogni evidenziazione, non frasi scritte qui. Se un giorno cambiasse il testo di
 * un'evidenziazione, la legenda cambierebbe con lui.
 *
 * Quando due evidenziazioni si sovrappongono sulla stessa cella, il ViewModel non decide chi
 * vince — lo decide il rendering (docs/contratti-ui.md). Qui vince la piu' specifica: cio' che
 * un attacco ha CAMBIATO batte cio' che stava per colpire, che batte una zona strutturale.
 */

import { buildHexWindow } from '../../views/hex-view.js'
import { el, numero } from './dom.js'

/** Byte mostrati: sedici righe. Larga abbastanza da vedere il contesto, corta da restare in pagina. */
const AMPIEZZA = 256

/** Chi vince quando una cella appartiene a piu' evidenziazioni. */
const PRIORITA = { changed: 6, target: 5, tail: 4, hole: 3, structure: 2, object: 1 }

/**
 * Il segno di «qui non c'e' un carattere».
 *
 * Il ViewModel mette un punto fermo, che pero' e' anche un carattere STAMPABILE vero (0x2e):
 * nella colonna ASCII i due casi finivano identici e a distinguerli restava solo il colore —
 * un grigio a 1,76:1, cioe' niente. Un punto medio li separa per forma, e il colore torna a
 * essere un'attenuazione invece che l'unica informazione.
 */
const NON_STAMPABILE = '·'

/**
 * Disegna la finestra esadecimale.
 *
 * @param {Uint8Array} bytes
 * @param {Array<{id,start,end,kind,label}>} evidenziazioni
 * @param {object} [opzioni]
 * @param {?number} [opzioni.centro]  offset su cui centrare; se manca lo si deduce
 * @returns {HTMLElement}
 */
export function disegnaDump(bytes, evidenziazioni = [], opzioni = {}) {
  const evidenze = Array.isArray(evidenziazioni) ? evidenziazioni.filter(Boolean) : []
  const centro = Number.isFinite(opzioni.centro) ? opzioni.centro : centroPredefinito(evidenze, bytes)
  const vista = buildHexWindow(bytes, centro, AMPIEZZA, evidenze)

  // Gli estremi VERI di ogni evidenziazione, presi dall'ingresso e non dal ViewModel.
  // `buildHexWindow` clampa `start` ed `end` ai bordi della finestra — deve farlo, perche' quelli
  // servono a colorare le celle — ma un confine clampato e' il bordo dello SCHERMO, non il bordo
  // del buco. Segnarlo come inizio del buco /Contents sarebbe un disegno che mente.
  const estremi = new Map()
  for (const evidenza of evidenze) {
    if (evidenza.id !== undefined && evidenza.id !== null) {
      estremi.set(evidenza.id, { start: evidenza.start, end: evidenza.end })
    }
  }

  const contenitore = el('div', { classe: 'dump' })

  if (vista.highlights.length > 0) contenitore.append(legenda(vista.highlights, estremi))

  if (vista.truncated.before) {
    contenitore.append(
      el('p', { classe: 'dump__troncato', testo: `… ${numero(vista.start)} byte prima` }),
    )
  }

  // Un solo indice per cella: quale evidenziazione la marca, se ne ha piu' d'una.
  const vincitore = new Map()
  for (const evidenza of vista.highlights) {
    for (let offset = evidenza.start; offset < evidenza.end; offset++) {
      const attuale = vincitore.get(offset)
      if (!attuale || (PRIORITA[evidenza.kind] ?? 0) >= (PRIORITA[attuale.kind] ?? 0)) {
        vincitore.set(offset, evidenza)
      }
    }
  }

  /**
   * I marcatori di una cella: quale evidenziazione la vince, e se e' il primo o l'ultimo byte
   * di quell'evidenziazione. Gli estremi sono quelli veri; se cadono fuori dalla finestra, la
   * cella semplicemente non li porta.
   */
  const marcatura = (marca, offset) => {
    if (!marca) return null
    const vero = estremi.get(marca.id) ?? marca
    return {
      hl: marca.kind,
      inizio: offset === vero.start ? 'si' : null,
      fine: offset === vero.end - 1 ? 'si' : null,
    }
  }

  const griglia = el('div', { classe: 'dump__griglia' })
  const frammento = document.createDocumentFragment()
  for (const riga of vista.rows) {
    frammento.append(el('span', { classe: 'dump__offset', testo: riga.offsetHex }))
    for (const cella of riga.cells) {
      const marca = vincitore.get(cella.offset)
      frammento.append(
        el('span', {
          classe: 'dump__cella',
          testo: cella.hex ?? '  ',
          dati: marcatura(marca, cella.offset),
          title: marca ? marca.label : null,
        }),
      )
    }
    frammento.append(el('span', { 'aria-hidden': 'true', testo: ' ' }))
    for (const cella of riga.cells) {
      const marca = vincitore.get(cella.offset)
      const marcatori = marcatura(marca, cella.offset) ?? {}
      frammento.append(
        el('span', {
          classe: 'dump__ascii',
          testo: cella.byte === null ? ' ' : cella.printable ? cella.char : NON_STAMPABILE,
          dati: {
            ...marcatori,
            hl: marca ? marca.kind : null,
            stampabile: cella.byte === null || cella.printable ? null : 'no',
          },
        }),
      )
    }
  }
  griglia.append(frammento)
  contenitore.append(griglia)

  if (vista.truncated.after) {
    contenitore.append(
      el('p', {
        classe: 'dump__troncato',
        testo: `… ${numero(vista.fileLength - vista.end)} byte dopo`,
      }),
    )
  }

  return contenitore
}

/**
 * La legenda: un bollo e l'etichetta che l'evidenziazione porta con se'.
 *
 * Gli offset scritti qui sono quelli VERI, non quelli clampati alla finestra: la legenda dice
 * dove sta quella zona NEL FILE, e il bordo dello schermo non e' un dato del file. Su un buco
 * /Contents da ottomila byte, che nessuna finestra da 256 contiene, i numeri clampati erano
 * semplicemente i due bordi della finestra.
 */
function legenda(evidenze, estremi) {
  const box = el('div', { classe: 'dump__legenda' })
  const visti = new Set()
  for (const evidenza of evidenze) {
    if (visti.has(evidenza.id)) continue
    visti.add(evidenza.id)
    const vero = estremi.get(evidenza.id) ?? evidenza
    box.append(
      el('span', { classe: 'dump__voce' }, [
        el('i', { classe: 'dump__bollo', 'aria-hidden': 'true', dati: { hl: evidenza.kind } }),
        el('span', {
          classe: 'dump__testo',
          testo: `${evidenza.label ?? evidenza.id} · ${numero(vero.start)}–${numero(vero.end)}`,
        }),
      ]),
    )
  }
  return box
}

/** Dove guardare quando nessuno lo dice: la prima evidenziazione, altrimenti l'inizio del file. */
function centroPredefinito(evidenze, bytes) {
  if (evidenze.length > 0) {
    const prima = evidenze.reduce((minore, e) => (e.start < minore.start ? e : minore))
    return prima.start + Math.min(64, Math.max(0, prima.end - prima.start) / 2)
  }
  return Math.min(AMPIEZZA / 2, (bytes?.length ?? 0) / 2)
}
