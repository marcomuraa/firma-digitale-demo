/**
 * La pagina della direzione A — «Protocollo».
 *
 * Monta la macchina, la espone come `window.__demo` (docs/contratti-dom.md sezione 1) e disegna
 * il registro: una fascia di protocollo in testa che non se ne va mai, e sotto un fascicolo che
 * si ingrossa un atto per volta.
 *
 * I PANNELLI SI IMPILANO E NON SI CANCELLANO — e' la decisione Q5 dell'intervista, ed e' anche
 * il motivo per cui questo file non ridisegna mai un foglio gia' scritto: quando un atto compare
 * in `passiFatti`, si costruisce il suo foglio con il materiale CONGELATO di quel momento e non
 * lo si tocca piu'. Un ripristino o un attacco successivo non possono riscriverlo, esattamente
 * come in un registro non si cancella.
 *
 * Cio' che invece si aggiorna a ogni cambio di stato e' solo il «presente»: il righello, il
 * timbro del verdetto, l'allegato, la rubrica dei comandi e i marcatori sul <body>.
 *
 * I marcatori: `data-modalita`, `data-passo-corrente`, `data-verdetto`. Li scrive questo file,
 * a ogni notifica, perche' la macchina fornisce i valori e non tocca il DOM.
 */

import './protocollo.css'

import { createDemo } from '../../ui/machine.js'
import { COPY, THEORY_IDS } from '../../ui/copy.it.js'
import { STEP_IDS } from '../../ui/steps.js'
import { aggiungi, el, romano, svuota } from './dom.js'
import { COMANDI, MODALITA, TESTATA, VUOTO } from './lessico.js'
import { creaRighello } from './righello.js'
import { creaAllegato } from './allegato.js'
import { creaFoglioAtto, creaFoglioNota } from './pannelli.js'

/** La modalita' di partenza. Vedi la nota nel rapporto: e' una scelta, non un default. */
const MODALITA_INIZIALE = 'studio'

/**
 * Monta la pagina dentro la radice indicata.
 *
 * @param {HTMLElement} radice
 * @returns {object} la macchina, gia' esposta come window.__demo
 */
export function montaProtocollo(radice) {
  const demo = createDemo()
  // Il gancio piu' importante: la STESSA istanza che pilota la pagina, non una copia.
  window.__demo = demo

  let modalita = MODALITA_INIZIALE

  /* --------------------------------------------------------- la fascia di protocollo */

  const righello = creaRighello()

  const bottoneModalita = el('button', {
    type: 'button',
    classe: 'bottone bottone--modalita',
    'data-azione': 'modalita',
    su: {
      click: () => {
        modalita = modalita === 'presentazione' ? 'studio' : 'presentazione'
        rendi(demo.getState())
      },
    },
  })

  const bottoneRipristina = el('button', {
    type: 'button',
    classe: 'bottone',
    'data-azione': 'ripristina',
    testo: COMANDI.ripristinaBreve,
    title: COMANDI.ripristina,
    'aria-label': COMANDI.ripristina,
    su: { click: () => demo.restoreSigned() },
  })

  const bottoneReset = el('button', {
    type: 'button',
    classe: 'bottone',
    'data-azione': 'reset',
    testo: COMANDI.resetBreve,
    title: COMANDI.reset,
    'aria-label': COMANDI.reset,
    su: { click: () => demo.reset() },
  })

  const attiRubrica = new Map()
  const indice = el('div', {
    classe: 'rubrica__indice',
    role: 'group',
    'aria-label': COMANDI.indice,
  })
  STEP_IDS.forEach((stepId, i) => {
    const bottone = el('button', {
      type: 'button',
      classe: 'atto',
      'data-passo': stepId,
      testo: romano(i + 1),
      'aria-label': `Atto ${romano(i + 1)} — ${COPY[stepId].titolo}`,
      title: `${romano(i + 1)} — ${COPY[stepId].titolo}`,
      su: { click: () => void demo.run(stepId) },
    })
    attiRubrica.set(stepId, bottone)
    indice.append(bottone)
  })

  const comandoAzione = el('span', { classe: 'comando__azione' })
  const comandoTitolo = el('span', { classe: 'comando__titolo' })
  const comando = el(
    'button',
    {
      type: 'button',
      classe: 'comando',
      su: {
        click: () => {
          const prossimo = STEP_IDS.find((stepId) => demo.canRun(stepId))
          if (prossimo) void demo.run(prossimo)
        },
      },
    },
    [comandoAzione, comandoTitolo],
  )

  const errore = el('p', { classe: 'errore', role: 'alert', hidden: true })

  const fascia = el('header', { classe: 'fascia' }, [
    el('div', { classe: 'testata' }, [
      el('p', { classe: 'testata__ente prestampa', testo: TESTATA.ente }),
      el('h1', { classe: 'testata__titolo', testo: TESTATA.titolo }),
      el('div', { classe: 'testata__comandi' }, [bottoneModalita, bottoneRipristina, bottoneReset]),
    ]),
    righello.nodo,
    el('div', { classe: 'rubrica' }, [indice, comando]),
    errore,
  ])

  /* --------------------------------------------------------- il banco */

  const allegato = creaAllegato()
  const vuoto = el('p', { classe: 'vuoto', testo: VUOTO })
  // `tabindex="-1"` sul bersaglio del salto: senza, in Chrome il fuoco resta sul documento e chi
  // usa la tastiera «salta al fascicolo» e poi si ritrova a tabulare di nuovo dalla fascia.
  const fascicolo = el('div', { classe: 'fascicolo', id: 'fascicolo', tabindex: '-1' }, [vuoto])

  // Le tre note teoriche stanno in fondo dall'inizio: non hanno un passo, si aprono a richiesta.
  const note = THEORY_IDS.map((panelId) => creaFoglioNota(panelId))
  aggiungi(fascicolo, note)
  const primaNota = note[0] ?? null

  // <main>: il banco e' il contenuto della pagina, la fascia e' la cornice. Serve a chi naviga
  // per regioni, e la pagina non ne aveva nessuna.
  const banco = el('main', { classe: 'banco' }, [
    el('div', { classe: 'allegato-colonna' }, allegato.nodo),
    fascicolo,
  ])

  svuota(radice).append(
    el('a', { classe: 'salta', href: '#fascicolo', testo: COMANDI.salta }),
    fascia,
    banco,
  )

  /* --------------------------------------------------------- l'altezza della fascia */

  // Serve a due cose: la colonna appiccicata dell'allegato e lo scroll-margin dei fogli, che
  // altrimenti finirebbero sotto la fascia quando li si porta a vista.
  const misuraFascia = () => {
    document.documentElement.style.setProperty('--fascia-h', `${Math.ceil(fascia.offsetHeight)}px`)
  }
  misuraFascia()
  if (typeof ResizeObserver === 'function') new ResizeObserver(misuraFascia).observe(fascia)
  window.addEventListener('resize', misuraFascia)

  /* --------------------------------------------------------- la fascia si asciuga */

  // Su una colonna sola la fascia appiccicata misurava 430 px su 844: meta' schermo occupata per
  // tutta la lettura. Dopo il primo scorrimento il CSS le toglie testata, indice, legenda e
  // conti (vedi protocollo.css, «LA FASCIA SI ASCIUGA») e le lascia il righello e il comando.
  // Due soglie diverse, non una: con una sola, la pagina che si accorcia al momento del collasso
  // potrebbe riportare lo scorrimento appena sotto la soglia e far lampeggiare la fascia.
  const SOGLIA_GIU = 120
  const SOGLIA_SU = 40
  let scorso = false
  const guardaScorrimento = () => {
    const y = window.scrollY ?? document.documentElement.scrollTop ?? 0
    const nuovo = scorso ? y > SOGLIA_SU : y > SOGLIA_GIU
    if (nuovo === scorso) return
    scorso = nuovo
    if (scorso) document.body.dataset.scorso = 'si'
    else delete document.body.dataset.scorso
    misuraFascia()
  }
  window.addEventListener('scroll', guardaScorrimento, { passive: true })
  guardaScorrimento()

  /* --------------------------------------------------------- il disegno */

  /** I fogli gia' scritti: stepId -> nodo. Un foglio scritto non si riscrive mai. */
  const fogli = new Map()

  function rendi(stato) {
    const corpo = document.body
    corpo.dataset.modalita = modalita
    // La stessa modalita' anche sulla RADICE, e non e' una ridondanza: tutto il foglio di stile
    // misura in rem, e rem risolve su :root. Finche' la scala della presentazione stava sul
    // <body> ingrandiva solo cio' che aveva una regola dedicata, e le etichette prestampate, i
    // byte del dump e le tacche del righello restavano a 11 px in tutte e due le modalita'.
    // Il marcatore del contratto (docs/contratti-dom.md) resta quello sul <body>: questo si
    // aggiunge, non lo sostituisce.
    document.documentElement.dataset.modalita = modalita
    corpo.dataset.passoCorrente = stato.passoCorrente ?? ''
    corpo.dataset.verdetto = stato.verdetto ?? ''
    if (stato.inCorso) corpo.dataset.inCorso = stato.inCorso
    else delete corpo.dataset.inCorso

    // --- interruttore della doppia modalita' ---
    svuota(bottoneModalita).append(
      el('b', { testo: modalita === 'presentazione' ? MODALITA.presentazione : MODALITA.studio }),
      el('span', {
        testo: `⇄ ${modalita === 'presentazione' ? MODALITA.studio : MODALITA.presentazione}`,
      }),
    )
    bottoneModalita.setAttribute('aria-label', MODALITA.descrizione[modalita])
    bottoneModalita.title = MODALITA.descrizione[modalita]

    // --- righello e allegato: il presente ---
    righello.aggiorna(stato.righello)
    allegato.aggiorna(stato)

    // --- rubrica e comandi ---
    const prossimo = STEP_IDS.find((stepId) => demo.canRun(stepId)) ?? null
    for (const [stepId, bottone] of attiRubrica) {
      const fatto = stato.passiFatti.includes(stepId)
      const inCorso = stato.inCorso === stepId
      bottone.dataset.stato = inCorso
        ? 'corso'
        : fatto
          ? 'fatto'
          : stepId === prossimo
            ? 'prossimo'
            : 'attesa'
      bottone.disabled = !demo.canRun(stepId)
    }

    if (stato.inCorso) {
      comando.disabled = true
      comandoAzione.textContent = COMANDI.inCorso
      comandoTitolo.textContent = COPY[stato.inCorso].titolo
    } else if (prossimo) {
      comando.disabled = false
      comandoAzione.textContent = `${COMANDI.registra} ${romano(STEP_IDS.indexOf(prossimo) + 1)}`
      comandoTitolo.textContent = COPY[prossimo].titolo
    } else {
      comando.disabled = true
      comandoAzione.textContent = COMANDI.completo
      comandoTitolo.textContent = ''
    }

    bottoneRipristina.disabled = stato.inCorso !== null || !stato.risultati.verifica
    bottoneReset.disabled = false

    // --- l'errore, dove si sta guardando ---
    if (stato.errore) {
      errore.hidden = false
      errore.textContent = stato.errore.messaggio
    } else {
      errore.hidden = true
      errore.textContent = ''
    }

    // --- il fascicolo: si aggiungono i fogli nuovi, non si tocca nessun foglio vecchio ---
    if (stato.passiFatti.length === 0 && fogli.size > 0) {
      for (const nodo of fogli.values()) nodo.remove()
      fogli.clear()
    }
    let ultimoNuovo = null
    for (const stepId of stato.passiFatti) {
      if (fogli.has(stepId)) continue
      const foglio = creaFoglioAtto(stepId, STEP_IDS.indexOf(stepId) + 1, stato)
      fogli.set(stepId, foglio)
      fascicolo.insertBefore(foglio, primaNota)
      ultimoNuovo = foglio
    }
    vuoto.hidden = fogli.size > 0

    if (ultimoNuovo) {
      // La fascia cambia altezza quando il righello prende le tacche: si rimisura PRIMA di
      // portare a vista, altrimenti lo `scroll-margin-top` del foglio e' quello di un attimo fa
      // e il titolo finisce sotto la fascia.
      misuraFascia()
      portaAVista(ultimoNuovo)
    }
  }

  demo.subscribe(rendi)
  rendi(demo.getState())

  return demo
}

/**
 * Porta a vista il foglio appena scritto. Lo scorrimento morbido si spegne DAVVERO quando il
 * sistema lo chiede: qui si interroga la preferenza al momento della chiamata, invece di
 * fidarsi di una `scroll-behavior` nel CSS che questa API scavalcherebbe comunque.
 */
function portaAVista(nodo) {
  const fermo = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  try {
    nodo.scrollIntoView({ block: 'start', behavior: fermo ? 'auto' : 'smooth' })
  } catch {
    nodo.scrollIntoView()
  }
}
