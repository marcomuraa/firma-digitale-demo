// Il dump esadecimale: il file come lo legge la macchina, a sedici byte per riga.
//
// Sta a PIENA LARGHEZZA e non dentro la meta' scura, perche' a meta' schermo sedici byte per
// riga piu' la colonna ASCII non ci stanno in modo leggibile. E' l'unico pezzo di questa pagina
// che scavalca la spaccatura oltre al righello — e non e' un'eccezione arbitraria: righello e
// dump sono lo STESSO oggetto a due ingrandimenti, il file intero in scala e il file intero
// byte per byte.
//
// Sta dietro un aprire-e-chiudere, ma quando si apre e' vero: byte veri, offset veri,
// evidenziazioni che arrivano dalla macchina con i `kind` misurati passo per passo
// (docs/contratti-ui.md, tabella passo -> kind). La legenda dei colori si copia da li'.

import { buildHexWindow } from '../../views/hex-view.js'
import { el, aggiungi, bottone } from './dom.js'
import { numero } from './formato.js'

/** Quanti byte per finestra. In presentazione se ne mostrano meno, ma piu' grandi. */
const AMPIEZZA = { presentazione: 256, studio: 512 }

/**
 * Il `kind` che vince quando una cella appartiene a piu' evidenziazioni.
 * La vista non decide chi vince (docs/contratti-ui.md): lo decide il rendering, cioe' qui.
 * L'ordine e' quello dell'urgenza: un byte cambiato da un attacco batte tutto il resto.
 */
const PRIORITA = ['changed', 'target', 'tail', 'hole', 'structure', 'object']

export function creaDump({ leggiModalita, alCambio = () => {} }) {
  const corpo = el('div', { classe: 'dump__corpo' })
  const legenda = el('div', { classe: 'dump__legenda' })
  const barra = el('div', { classe: 'dump__barra' })
  const regione = el(
    'div',
    { classe: 'dump__regione', id: 'dump-esadecimale', hidden: true },
    [barra, corpo, legenda],
  )

  const interruttore = bottone('Apri il dump esadecimale', {
    classe: 'comando comando--largo',
    'aria-expanded': 'false',
    'aria-controls': 'dump-esadecimale',
  })

  const nodo = el('section', { classe: 'dump', 'aria-label': 'Il file byte per byte' }, [
    interruttore,
    regione,
  ])

  let aperto = false
  let ultimo = null // { bytes, evidenziazioni, centroAuto }
  let scorrimento = 0 // spostamento manuale rispetto al centro automatico
  let centroAuto = 0

  interruttore.addEventListener('click', () => {
    aperto = !aperto
    applica()
  })

  const indietro = bottone('◂ indietro', { classe: 'comando comando--minuto' })
  const avanti = bottone('avanti ▸', { classe: 'comando comando--minuto' })
  const alCentro = bottone('torna all’evidenziazione', { classe: 'comando comando--minuto' })
  const posizione = el('span', { classe: 'dump__posizione' })

  indietro.addEventListener('click', () => {
    scorrimento -= passo()
    disegna()
  })
  avanti.addEventListener('click', () => {
    scorrimento += passo()
    disegna()
  })
  alCentro.addEventListener('click', () => {
    scorrimento = 0
    disegna()
  })
  aggiungi(barra, [indietro, alCentro, avanti, posizione])

  // Il marcatore `body[data-dump]` si dichiara subito, chiuso. Prima nasceva al primo clic, e
  // finche' non c'era la pagina appena caricata e quella appena azzerata differivano per un
  // attributo — cioe' l'invariante «dopo Ricomincia si e' come al caricamento» non era
  // verificabile, e il CSS che commuta su quel marcatore lavorava sull'assenza invece che su un
  // valore.
  applica()

  function passo() {
    return Math.floor(AMPIEZZA[leggiModalita()] / 2)
  }

  function applica() {
    interruttore.setAttribute('aria-expanded', aperto ? 'true' : 'false')
    interruttore.textContent = aperto ? 'Chiudi il dump esadecimale' : 'Apri il dump esadecimale'
    regione.hidden = !aperto
    nodo.dataset.aperto = aperto ? 'si' : 'no'
    // Aperto, il dump e' piu' alto della finestra: il banco non puo' piu' restare appeso in
    // cima, e il marcatore sul <body> e' cio' su cui il CSS commuta.
    document.body.dataset.dump = aperto ? 'aperto' : 'chiuso'
    if (aperto) disegna()
    alCambio(aperto)
  }

  function disegna() {
    if (!aperto || !ultimo) return
    const { bytes, evidenziazioni, indicato } = ultimo
    const ampiezza = AMPIEZZA[leggiModalita()]
    const centro = Math.max(0, Math.min(bytes.length, centroAuto + scorrimento))
    const tutte = indicato ? [...evidenziazioni, indicato] : evidenziazioni
    const vista = buildHexWindow(bytes, centro, ampiezza, tutte)

    corpo.replaceChildren(...righe(vista, indicato, centro))
    centraLaRiga(corpo)
    posizione.textContent =
      `byte ${numero(vista.start)}–${numero(Math.min(vista.end, vista.fileLength) - 1)}` +
      ` di ${numero(vista.fileLength)}`
    indietro.disabled = !vista.truncated.before
    avanti.disabled = !vista.truncated.after
    alCentro.disabled = scorrimento === 0

    legenda.replaceChildren(...vociLegenda(tutte))
  }

  return {
    nodo,
    /**
     * @param {Uint8Array} bytes
     * @param {Array} evidenziazioni  quelle della macchina, gia' pronte per buildHexWindow
     * @param {?object} indicato      il punto indicato dalla meta' chiara
     * @param {?number} centro        dove centrarsi: null lascia dov'era
     */
    aggiorna(bytes, evidenziazioni, indicato, centro) {
      const nuovoCentro = Number.isFinite(centro) ? centro : centroAuto
      if (nuovoCentro !== centroAuto) {
        centroAuto = nuovoCentro
        scorrimento = 0
      }
      ultimo = { bytes, evidenziazioni, indicato }
      if (aperto) disegna()
    },
    apri() {
      if (aperto) return
      aperto = true
      applica()
    },
    /**
     * Ricominciare. Non basta chiudersi: `ultimo` tiene i byte dell'altro giro, e con il dump
     * aperto e la macchina appena azzerata `aggiorna()` non arriva nemmeno — chi disegna non
     * chiama piu' nessuno quando non c'e' un documento. Restava a schermo la finestra
     * esadecimale di un file da 11.158 byte accanto alla scritta «nessun byte in mano».
     */
    azzera() {
      aperto = false
      ultimo = null
      scorrimento = 0
      centroAuto = 0
      corpo.replaceChildren()
      legenda.replaceChildren()
      posizione.textContent = ''
      applica()
    },
    get aperto() {
      return aperto
    },
    ridisegna: disegna,
  }
}

/* ------------------------------------------------------------------ le righe */

/**
 * La finestra e' piu' alta del riquadro che la contiene, e la riga che conta non e' la prima:
 * senza questo, il byte cambiato da un attacco finisce sotto il bordo e la prova non si vede.
 * Si sposta solo lo scorrimento INTERNO del riquadro: la pagina non si muove.
 */
function centraLaRiga(corpo) {
  const riga = corpo.querySelector('.dump__riga[data-fuoco="si"]')
  if (!riga) {
    corpo.scrollTop = 0
    return
  }
  const dentro = riga.getBoundingClientRect().top - corpo.getBoundingClientRect().top
  corpo.scrollTop += dentro - (corpo.clientHeight - riga.offsetHeight) / 2
}

function righe(vista, indicato, centro) {
  const idIndicato = indicato ? indicato.id : null
  const rigaDelFuoco = Math.floor(centro / vista.bytesPerRow) * vista.bytesPerRow
  return vista.rows.map((riga) =>
    el('div', { classe: 'dump__riga', dati: { fuoco: riga.offset === rigaDelFuoco ? 'si' : null } }, [
      el('span', { classe: 'dump__offset', testo: riga.offsetHex }),
      el(
        'span',
        { classe: 'dump__celle' },
        riga.cells.map((cella) => {
          if (cella.byte === null) return el('span', { classe: 'ottetto ottetto--fuori', testo: '  ' })
          return el('span', {
            classe: 'ottetto',
            testo: cella.hex,
            dati: {
              kind: vince(cella.highlightIds, vista.highlights),
              indicato: idIndicato && cella.highlightIds.includes(idIndicato) ? 'si' : null,
            },
          })
        }),
      ),
      el(
        'span',
        { classe: 'dump__testo' },
        riga.cells.map((cella) => {
          if (cella.byte === null) return el('span', { classe: 'ch ch--fuori', testo: ' ' })
          return el('span', {
            classe: 'ch',
            testo: cella.printable ? cella.char : '·',
            dati: {
              kind: vince(cella.highlightIds, vista.highlights),
              indicato: idIndicato && cella.highlightIds.includes(idIndicato) ? 'si' : null,
            },
          })
        }),
      ),
    ]),
  )
}

/** Fra i `kind` che si sovrappongono su una cella, vince quello piu' urgente. */
function vince(ids, highlights) {
  if (!ids || ids.length === 0) return null
  const kinds = new Set()
  for (const id of ids) {
    const trovato = highlights.find((h) => h.id === id)
    if (trovato) kinds.add(trovato.kind)
  }
  for (const kind of PRIORITA) if (kinds.has(kind)) return kind
  return null
}

/**
 * La legenda non e' decorativa: e' l'unico modo per sapere che cosa vuol dire un colore, e i
 * `kind` che compaiono cambiano da un passo all'altro. Si costruisce dalle evidenziazioni vere
 * di questo momento, non da un elenco fisso: cosi' non promette mai un colore che non c'e'.
 */
function vociLegenda(evidenziazioni) {
  const visti = new Map()
  for (const h of evidenziazioni) {
    if (!visti.has(h.kind)) visti.set(h.kind, h.label ?? DESCRIZIONI[h.kind] ?? h.kind)
  }
  if (visti.size === 0) {
    return [el('span', { classe: 'dump__nota', testo: 'Nessuna evidenziazione in questo passo.' })]
  }
  return [...visti.entries()].map(([kind, testo]) =>
    el('span', { classe: 'chiave', dati: { kind } }, [
      el('i', { classe: 'chiave__campione', 'aria-hidden': 'true', dati: { kind } }),
      el('span', { classe: 'chiave__testo', testo }),
    ]),
  )
}

const DESCRIZIONI = {
  object: 'un oggetto del PDF',
  structure: 'struttura del file',
  hole: 'il buco /Contents',
  tail: 'coda fuori dalla copertura',
  target: 'il bersaglio',
  changed: 'byte cambiati',
}
