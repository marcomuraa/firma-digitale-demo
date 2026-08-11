// Direzione visiva C — «Doppia esposizione».
//
// L'IDEA, in una riga: lo stesso file, esposto due volte. A sinistra, sulla carta, il documento
// come lo vede un umano; a destra, sulla lastra, gli stessi byte come li vede la macchina. La
// firma vive nella seconda lettura, e la demo consiste nel guardarle insieme.
//
// COME E' FATTA LA PAGINA, dall'alto:
//
//   la BASE      una fascia scura a piena larghezza — testata, righello dei byte, i dodici
//                comandi. E' il supporto su cui le due esposizioni sono state fatte, quindi non
//                appartiene a nessuna delle due meta' e non e' spaccata. Ci sta il righello,
//                che rappresenta l'intero file a scala reale e che è l'unica cosa che
//                attraversa la spaccatura per tutta la sua lunghezza.
//   il BANCO     la prima riga della spaccatura: il documento disegnato da pdf.js e i punti che
//                si possono indicare (chiaro), il verdetto e i numeri correnti (scuro), e sotto,
//                a piena larghezza, il dump esadecimale.
//   la PILA      un blocco per passo eseguito, sempre due letture affiancate. I pannelli si
//                impilano e non si cancellano: e' `risultati` della macchina a renderlo
//                possibile, perche' nessun passo riscrive quello di prima.
//   la TEORIA    i tre pannelli che non hanno un passo. Occupano la sola colonna chiara, e la
//                colonna scura resta vuota apposta: sulla catena di fiducia, sul valore legale
//                e sulla differenza da una firma scansionata la macchina non ha niente da
//                misurare. E' la stessa distinzione che i testi fanno a parole.
//
// I ganci di docs/contratti-dom.md ci sono tutti e non sono decorazione: sono il modo in cui
// questa pagina viene pilotata dall'anteprima, dai critici e dalle fasi che verranno.

import './impianto.css'
import './parti.css'

import { createDemo } from '../../ui/machine.js'
import { STEP_IDS } from '../../ui/steps.js'
import { COPY, THEORY_IDS } from '../../ui/copy.it.js'
import { el, aggiungi, bottone, portaInVista } from './dom.js'
import { pianoDellaPila, centroDump } from './giro.js'
import { creaRighello } from './righello.js'
import { creaDump } from './dump.js'
import { creaDocumento } from './documento.js'
import { letture, letturaUmana, verdettoBlocco } from './letture.js'
import { NOMI_PASSI, etichetta as etichettaDetta, numero, ordinale } from './formato.js'

/** La modalita' di partenza: questa demo nasce per essere proiettata. */
const MODALITA_INIZIALE = 'presentazione'

/**
 * I tre passi la cui prova sta nei byte e non nelle parole. Quando scattano, il dump si apre da
 * se' e la pagina torna al banco invece di scendere al pannello nuovo: al momento dell'attacco
 * cio' che deve stare a schermo insieme e' il documento cambiato, il righello, il verdetto e i
 * byte accesi. Il pannello che lo spiega e' subito sotto, e ci si arriva scorrendo.
 */
const ATTACCHI = new Set(['attacco-cifra', 'attacco-lettere', 'attacco-coda'])

/**
 * I passi in cui il banco resta APPESO sotto la fascia degli strumenti, cioe' quelli in cui le
 * due letture vanno guardate insieme: il verdetto e i tre attacchi. Negli altri otto scorre via
 * come tutto il resto.
 *
 * Il perche' e' una misura. Appeso sempre, il banco lasciava 143 px di finestra a 1280x900 in
 * presentazione — il 16 % dello schermo — al pannello che si sta leggendo, mentre il piu' corto
 * dei pannelli ne chiede 213: nessuno stava mai a schermo insieme al banco, e il testo che
 * spiega si leggeva da una feritoia. Tenere il documento sotto gli occhi vale il suo prezzo
 * quando c'e' qualcosa da confrontare; negli altri sette passi il prezzo lo paga la spiegazione,
 * e non e' un baratto che convenga.
 */
const BANCO_APPESO = new Set(['verifica', 'attacco-cifra', 'attacco-lettere', 'attacco-coda'])

export function montaDoppia(radice) {
  const demo = createDemo()
  // Il gancio piu' importante del contratto: la STESSA istanza che pilota la pagina.
  window.__demo = demo

  let modalita = MODALITA_INIZIALE
  const leggiModalita = () => modalita

  /* ---------------------------------------------------------------- i pezzi */

  const righello = creaRighello()
  const dump = creaDump({
    leggiModalita,
    // Aprendosi il dump toglie al banco la sua sospensione: senza questo salto la fascia si
    // riposizionerebbe di colpo fuori dalla finestra, e chi guarda perderebbe il segno.
    alCambio: (aperto) => {
      if (aperto) portaSotto(banco)
    },
  })
  const documento = creaDocumento({
    alIndicare: () => rinfrescaLegame(),
    alDisegno: () => aggiornaSintesi(demo.getState()),
  })

  const sintesi = creaSintesi()
  const pila = el('main', { classe: 'pila', 'aria-label': 'I passi della demo' })
  const teoria = creaTeoria(portaSotto)
  const rail = creaRail(demo, () => teoria.vai())
  const testata = creaTestata()

  // Le due intestazioni stanno DENTRO le rispettive celle, non accanto a loro nella griglia:
  // impilate su schermo stretto devono restare attaccate a cio' che intitolano, e riordinare
  // con `order` vorrebbe dire far leggere a un lettore di schermo un ordine diverso da quello
  // che si vede.
  const banco = el('section', { classe: 'banco', 'aria-label': 'Il documento e i suoi byte' }, [
    el('div', { classe: 'cella cella--positivo positivo' }, [
      el('h2', { classe: 'colonna colonna--positivo', testo: 'Come lo vede un umano' }),
      documento.nodo,
    ]),
    el('div', { classe: 'cella cella--negativo negativo' }, [
      el('h2', { classe: 'colonna colonna--negativo', testo: 'Come lo vede la macchina' }),
      sintesi.nodo,
    ]),
    aggiungi(el('div', { classe: 'banco__dump base' }), dump.nodo),
  ])

  const plancia = el('div', { classe: 'plancia base' }, [testata.nodo, righello.nodo, rail.nodo])
  const pagina = el('div', { classe: 'pagina' }, [plancia, banco, pila, teoria.nodo])

  radice.replaceChildren(pagina)
  applicaModalita()
  const misura = misuraFasce(pagina, plancia, banco)

  /* ---------------------------------------------------------------- la pila */

  /**
   * Gli stepId gia' in pila, NELL'ORDINE in cui sono stati disegnati. Era un insieme, e un
   * insieme non sa dire se cio' che ha dentro appartenga ancora al giro in corso: e' l'elenco
   * che va confrontato con la storia della macchina, e il confronto lo fa `pianoDellaPila`.
   */
  const righeFatte = []

  function aggiungiRighe(daAggiungere, stato) {
    let ultima = null
    let attacco = false
    for (const stepId of daAggiungere) {
      righeFatte.push(stepId)
      const risultato = stato.risultati[stepId]
      if (!risultato) continue
      if (ATTACCHI.has(stepId)) attacco = true
      const { sinistra, destra } = letture(stepId, risultato)
      sinistra.classList.add('cella', 'cella--positivo', 'positivo')
      destra.classList.add('cella', 'cella--negativo', 'negativo')
      const riga = el(
        'article',
        { classe: 'riga', dati: { pannello: stepId } },
        [traccia(stepId, risultato), sinistra, destra],
      )
      pila.append(riga)
      ultima = riga
    }
    if (!ultima) return
    if (attacco) {
      dump.apri()
      portaSotto(banco)
    } else {
      portaSotto(ultima.firstElementChild)
    }
  }

  /**
   * Portare in vista qualunque cosa debba finire SOTTO la mobilia — il banco sotto la fascia
   * degli strumenti, la traccia di un passo sotto tutte e due. Lo scorrimento si appoggia a
   * `scroll-margin-top`, che in CSS e' scritto in funzione di `--plancia-h` e `--banco-h`: se
   * quelle due misure sono vecchie, si scorre verso una posizione che non e' piu' quella giusta.
   *
   * E sono vecchie quasi sempre, perche' cio' che le cambia succede nello stesso fotogramma in
   * cui si vorrebbe scorrere:
   *
   *   - aprire il dump allunga la fascia e il banco;
   *   - all'attacco 2 il righello mette una seconda riga di tacche («fine della copertura» e
   *     «fine del file» distano l'otto per cento del file) e la fascia cresce di una trentina di
   *     pixel;
   *   - al passo «verifica» la lente si accende e il banco si ACCORCIA: misurato a 1280x900,
   *     --banco-h valeva 658 px mentre il banco ne misurava 467, cioe' uno scroll-margin di 896
   *     px in una finestra di 900. Il pannello del verdetto — quello che il pubblico deve
   *     portarsi a casa — finiva a y = 983,7, zero pixel visibili, e a schermo restava il
   *     pannello di prima.
   *
   * Il ResizeObserver che riscrive le due misure gira DOPO il fotogramma, e allora si aspetta il
   * fotogramma e si rimisura a mano subito prima di scorrere. Un solo posto, per ogni scorrimento
   * della pagina: e' la ragione per cui questa funzione esiste invece dei tre `portaInVista`
   * sparsi che c'erano prima.
   */
  function portaSotto(nodo) {
    requestAnimationFrame(() => {
      misura()
      portaInVista(nodo)
    })
  }

  function traccia(stepId, risultato) {
    const indice = STEP_IDS.indexOf(stepId)
    return el('div', { classe: 'traccia' }, [
      el('div', { classe: 'traccia__sinistra positivo' }, [
        el('span', { classe: 'traccia__numero', testo: ordinale(indice) }),
        el('span', { classe: 'traccia__nome', testo: NOMI_PASSI[stepId] ?? stepId }),
      ]),
      el('div', { classe: 'traccia__destra negativo' }, [
        el('span', {
          classe: 'traccia__byte',
          testo: risultato.etichetta
            ? `${etichettaDetta(risultato.etichetta)} · ${numero(risultato.lunghezza)} byte`
            : 'nessun byte cambiato',
        }),
      ]),
    ])
  }

  /* ---------------------------------------------------------------- il giro */

  function rinfrescaLegame() {
    const stato = demo.getState()
    const indicato = documento.indicato
    if (indicato) dump.apri()
    aggiornaAppensione(stato, indicato)
    disegnaRighello(stato, indicato)
    disegnaDump(stato, indicato)
  }

  /**
   * Un punto indicato sulla carta e' il ponte fra le due meta': finche' e' acceso, le due
   * letture devono restare a schermo insieme anche se il passo corrente non lo chiederebbe.
   */
  function aggiornaAppensione(stato, indicato) {
    const serve = BANCO_APPESO.has(stato.passoCorrente) || indicato !== null
    document.body.dataset.appeso = serve ? 'si' : 'no'
  }

  function disegnaRighello(stato, indicato) {
    righello.aggiorna(stato.righello, {
      indicato,
      gapMatchesContents: stato.verifica?.coverage?.gapMatchesContents ?? null,
    })
  }

  function disegnaDump(stato, indicato) {
    if (!stato.documento) return
    dump.aggiorna(stato.documento.bytes, stato.evidenziazioni, indicato, centroDump(stato, indicato))
  }

  function aggiornaSintesi(stato) {
    sintesi.aggiorna(stato, documento.avvisi)
  }

  /**
   * Ricominciare. La macchina fa la sua parte — `reset()` butta via lo stato e lo dice a chi
   * disegna — ma la pagina e' fatta di pezzi che si RICORDANO: la pila si impila apposta, il
   * dump tiene i byte che gli sono stati dati, il documento tiene acceso il punto indicato e la
   * teoria tiene aperti i pannelli che sono stati aperti. Nessuno di quei ricordi appartiene al
   * giro nuovo, e lasciarli in pagina significa affermare due cose incompatibili sullo stesso
   * schermo senza nessun segno che una sia vecchia — in una demo che dice «guarda i byte».
   *
   * Si torna anche in cima, e senza animazione: dopo un reset la pagina sotto gli occhi non
   * esiste piu', quindi non c'e' niente da seguire con lo sguardo. La MODALITA' invece resta
   * com'era: e' una scelta di chi proietta, non un pezzo della demo.
   */
  function azzeraIlGiro() {
    righeFatte.length = 0
    pila.replaceChildren()
    teoria.chiudi()
    dump.azzera()
    documento.azzera()
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function disegna(stato) {
    // Prima di ogni altra cosa, perche' tutto cio' che viene dopo disegna sopra questa decisione.
    const piano = pianoDellaPila(righeFatte, stato.passiFatti)
    if (piano.azzera) azzeraIlGiro()

    const corpo = document.body
    corpo.dataset.modalita = modalita
    corpo.dataset.passoCorrente = stato.passoCorrente ?? ''
    corpo.dataset.verdetto = stato.verdetto ?? ''
    corpo.dataset.avvio = stato.passiFatti.length === 0 ? 'si' : 'no'

    const indicato = documento.indicato
    aggiornaAppensione(stato, indicato)
    disegnaRighello(stato, indicato)
    documento.aggiorna(stato)
    aggiornaSintesi(stato)
    disegnaDump(stato, indicato)
    aggiungiRighe(piano.daAggiungere, stato)
    rail.aggiorna(stato)
    testata.aggiorna(stato)
  }

  demo.subscribe(disegna)
  disegna(demo.getState())

  /* ---------------------------------------------------------------- modalita */

  function applicaModalita() {
    document.body.dataset.modalita = modalita
    testata.aggiornaModalita(modalita)
    dump.ridisegna()
  }

  function cambiaModalita() {
    modalita = modalita === 'presentazione' ? 'studio' : 'presentazione'
    applicaModalita()
  }

  testata.interruttore.addEventListener('click', cambiaModalita)
}

/* ================================================================== le misure */

/**
 * Due altezze che il CSS non puo' conoscere: quella della fascia degli strumenti e quella del
 * banco. Servono a due cose sole — appendere il banco sotto la fascia invece che sotto il bordo
 * della finestra, e portare in vista un passo nuovo sotto tutte e due invece che dietro.
 *
 * Si misurano invece di stimarle perche' cambiano davvero: la modalita' presentazione ingrandisce
 * ogni carattere, i comandi vanno a capo a larghezze diverse, e il documento disegnato da pdf.js
 * cambia altezza a ogni attacco.
 *
 * @returns {() => void} la misura, da rifare a mano quando non si puo' aspettare l'osservatore.
 */
function misuraFasce(pagina, plancia, banco) {
  const scrivi = () => {
    pagina.style.setProperty('--plancia-h', `${Math.round(plancia.getBoundingClientRect().height)}px`)
    pagina.style.setProperty('--banco-h', `${Math.round(banco.getBoundingClientRect().height)}px`)
  }
  scrivi()
  if (typeof ResizeObserver === 'function') {
    const osservatore = new ResizeObserver(scrivi)
    osservatore.observe(plancia)
    osservatore.observe(banco)
  }
  window.addEventListener('resize', scrivi)
  return scrivi
}

/* ================================================================== la testata */

function creaTestata() {
  const interruttore = bottone('Passa a studio', {
    classe: 'comando comando--chiave',
    dati: { azione: 'modalita' },
    'aria-pressed': 'false',
  })

  const nodo = el('header', { classe: 'testata' }, [
    el('div', { classe: 'testata__marchio' }, [
      el('span', { classe: 'testata__occhiello', testo: 'Firma digitale PAdES' }),
      el('span', { classe: 'testata__nome', testo: 'Doppia esposizione' }),
    ]),
    el('div', { classe: 'testata__stato' }, [interruttore]),
  ])

  // Qui non c'e' altro, ed e' una scelta. Il verdetto non si ripete: il banco e' appeso sotto
  // la fascia e lo tiene a schermo, grande, per tutta la demo. I tre pannelli di teoria hanno i
  // loro bottoni col titolo intero nella sezione che li contiene, e nella fascia ne basta uno
  // che ci porti: tre titoli lunghi qui mandavano la testata a capo a ogni larghezza.
  return {
    nodo,
    interruttore,
    aggiorna() {},
    aggiornaModalita(modalita) {
      const presentazione = modalita === 'presentazione'
      interruttore.textContent = presentazione ? 'Passa a studio' : 'Passa a presentazione'
      interruttore.setAttribute('aria-pressed', presentazione ? 'false' : 'true')
    },
  }
}

/* ================================================================== il rail */

/**
 * I dodici comandi, piu' il ripristino e il ricomincia. Sono `<button>` veri: chi presenta ha le
 * mani occupate e li raggiunge con Tab, nell'ordine in cui li userebbe.
 *
 * Il comando grande esegue il PROSSIMO passo possibile. I dodici numerati restano, uno per
 * passo, perche' il contratto del DOM li pretende e perche' servono a saltare.
 */
function creaRail(demo, vaiAllaTeoria) {
  const primario = bottone('', { classe: 'comando comando--primario', dati: { azione: 'prossimo' } })
  const ripristina = bottone('Torna al firmato integro', {
    classe: 'comando',
    dati: { azione: 'ripristina' },
  })
  const ricomincia = bottone('Ricomincia', { classe: 'comando', dati: { azione: 'reset' } })
  const teoria = bottone('Teoria', { classe: 'comando', dati: { azione: 'teoria' } })
  teoria.addEventListener('click', vaiAllaTeoria)

  const passi = STEP_IDS.map((stepId, indice) => {
    const b = bottone('', {
      classe: 'passo',
      dati: { passo: stepId },
      'aria-label': `Passo ${indice + 1}: ${NOMI_PASSI[stepId] ?? stepId}`,
    })
    b.append(
      el('span', { classe: 'passo__numero', testo: ordinale(indice) }),
      el('span', { classe: 'passo__nome', testo: NOMI_PASSI[stepId] ?? stepId }),
    )
    b.addEventListener('click', () => {
      demo.run(stepId)
    })
    return b
  })

  primario.addEventListener('click', () => {
    const stato = demo.getState()
    const prossimo = STEP_IDS.find((id) => demo.canRun(id) && !stato.passiFatti.includes(id))
    if (prossimo) demo.run(prossimo)
  })
  ripristina.addEventListener('click', () => demo.restoreSigned())
  ricomincia.addEventListener('click', () => demo.reset())

  const avviso = el('p', { classe: 'rail__avviso', role: 'status', hidden: true })

  const nodo = el('nav', { classe: 'rail', 'aria-label': 'I dodici passi della demo' }, [
    el('div', { classe: 'rail__comandi' }, [primario, ripristina, ricomincia, teoria]),
    el('ol', { classe: 'rail__passi' }, passi.map((b) => el('li', {}, b))),
    avviso,
  ])

  return {
    nodo,
    aggiorna(stato) {
      for (const [indice, b] of passi.entries()) {
        const stepId = STEP_IDS[indice]
        const fatto = stato.passiFatti.includes(stepId)
        b.dataset.stato = stato.inCorso === stepId ? 'corso' : fatto ? 'fatto' : 'atteso'
        b.disabled = !demo.canRun(stepId)
        b.setAttribute('aria-current', stato.passoCorrente === stepId ? 'step' : 'false')
      }

      const prossimo = STEP_IDS.find((id) => !stato.passiFatti.includes(id))
      if (stato.inCorso) {
        primario.textContent = `${NOMI_PASSI[stato.inCorso]} in corso…`
        primario.disabled = true
        primario.setAttribute('aria-busy', 'true')
      } else if (!prossimo) {
        primario.textContent = 'Tutti e dodici i passi sono fatti'
        primario.disabled = true
        primario.removeAttribute('aria-busy')
      } else {
        const indice = STEP_IDS.indexOf(prossimo)
        primario.textContent = `Esegui ${ordinale(indice)} · ${NOMI_PASSI[prossimo]}`
        primario.disabled = !demo.canRun(prossimo)
        primario.removeAttribute('aria-busy')
      }

      ripristina.disabled = stato.inCorso !== null || !stato.risultati.verifica
      ricomincia.disabled = stato.passiFatti.length === 0 && stato.inCorso === null

      avviso.hidden = stato.errore === null
      avviso.textContent = stato.errore ? stato.errore.messaggio : ''
    },
  }
}

/* ================================================================== la sintesi */

/** La colonna scura del banco: che cosa dice la macchina dei byte che ha in mano adesso. */
function creaSintesi() {
  const dentro = el('div', { classe: 'sintesi' })
  return {
    nodo: dentro,
    aggiorna(stato, avvisi) {
      const pezzi = []
      if (!stato.documento) {
        pezzi.push(
          el('p', {
            classe: 'sintesi__vuoto',
            testo: 'Nessun byte in mano: esegui il primo passo per aprire il documento.',
          }),
        )
      } else {
        if (stato.verifica) pezzi.push(verdettoBlocco(stato.verifica, { compatto: true }))
        const c = stato.verifica?.coverage ?? null
        pezzi.push(
          el('dl', { classe: 'campi' }, [
            el('dt', { classe: 'campi__nome', testo: 'byte in mano' }),
            el('dd', { classe: 'campi__valore', testo: `${numero(stato.documento.lunghezza)} B` }),
            el('dt', { classe: 'campi__nome', testo: 'stato dei byte' }),
            el('dd', { classe: 'campi__valore', testo: etichettaDetta(stato.documento.etichetta) }),
            ...(stato.byteRange
              ? [
                  el('dt', { classe: 'campi__nome', testo: '/ByteRange' }),
                  el('dd', { classe: 'campi__valore', testo: `[${stato.byteRange.join(', ')}]` }),
                ]
              : []),
            ...(c && c.uncoveredTail > 0
              ? [
                  el('dt', { classe: 'campi__nome', testo: 'fuori dalla copertura' }),
                  el('dd', {
                    classe: 'campi__valore',
                    testo: `${numero(c.uncoveredTail)} B — ${
                      c.gapMatchesContents ? 'appesi dopo la firma' : 'fondo spinto avanti da un inserimento'
                    }`,
                  }),
                ]
              : []),
          ]),
        )
        if (stato.ripristinato) {
          pezzi.push(
            el('p', {
              classe: 'sintesi__nota',
              testo: 'Documento riportato al firmato integro. I pannelli degli attacchi restano in pagina.',
            }),
          )
        }
        if (avvisi && avvisi.length > 0) {
          pezzi.push(
            el('div', { classe: 'sintesi__avvisi' }, [
              el('span', { classe: 'lettura__nome', testo: 'il lettore PDF ha avvisato' }),
              ...avvisi.map((a) => el('p', { classe: 'sintesi__avviso', testo: a })),
            ]),
          )
        }
      }
      dentro.replaceChildren(...pezzi)
    },
  }
}

/* ================================================================== la teoria */

function creaTeoria(portaSotto) {
  const regioni = new Map()
  const nodo = el('section', { classe: 'teoria', 'aria-label': 'I tre pannelli di teoria' }, [
    el('div', { classe: 'traccia' }, [
      el('div', { classe: 'traccia__sinistra positivo' }, [
        el('span', { classe: 'traccia__numero', testo: '—' }),
        el('span', { classe: 'traccia__nome', testo: 'Teoria' }),
      ]),
      el('div', { classe: 'traccia__destra negativo' }, [
        el('span', { classe: 'traccia__byte', testo: 'niente da misurare' }),
      ]),
    ]),
  ])

  for (const panelId of THEORY_IDS) {
    const idRegione = `teoria-${panelId}`
    const regione = el('div', { classe: 'apribile__regione', id: idRegione, hidden: true })
    regione.append(letturaUmana(panelId))
    const interruttore = bottone(COPY[panelId].titolo, {
      classe: 'comando comando--largo',
      'aria-expanded': 'false',
      'aria-controls': idRegione,
    })
    interruttore.addEventListener('click', () => scambia(panelId))
    const riga = el(
      'article',
      { classe: 'riga riga--teoria', dati: { pannello: panelId } },
      [el('div', { classe: 'cella cella--positivo positivo' }, [interruttore, regione])],
    )
    nodo.append(riga)
    regioni.set(panelId, { interruttore, regione, riga })
  }

  function scambia(panelId, forzaApertura = false) {
    const voce = regioni.get(panelId)
    if (!voce) return
    const aperto = forzaApertura ? true : voce.regione.hidden
    voce.regione.hidden = !aperto
    voce.interruttore.setAttribute('aria-expanded', aperto ? 'true' : 'false')
    if (aperto) portaSotto(voce.riga.firstElementChild)
  }

  return {
    nodo,
    apri: (panelId) => scambia(panelId, true),
    vai: () => portaSotto(nodo.firstElementChild),
    /** Ricominciare: i tre pannelli tornano chiusi, com'erano al caricamento. */
    chiudi() {
      for (const { interruttore, regione } of regioni.values()) {
        regione.hidden = true
        interruttore.setAttribute('aria-expanded', 'false')
      }
    },
  }
}
