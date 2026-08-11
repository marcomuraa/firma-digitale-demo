/**
 * La fascia di repertorio: il righello dei byte, l'elemento firma condiviso fra le due
 * direzioni visive.
 *
 * IL VIEWMODEL NON SI RICALCOLA. Arriva gia' fatto da `stato.righello` (buildRuler chiamato una
 * volta sola dentro src/ui/machine.js): qui si disegna e basta. Due calcoli diversi sarebbero
 * due righelli diversi, e il righello e' proprio la cosa che deve raccontare la stessa storia
 * nelle due pagine.
 *
 * I DUE ASSI, tenuti separati come vuole docs/contratti-ui.md:
 *   - `segment.kind`  che cosa SONO quei byte    -> data-kind
 *   - `segment.covered` se sono FIRMATI          -> data-coperto
 * La copertura si legge da `covered`, MAI da `kind`: il vocabolario dei kind non contiene
 * «firmato», e chi colora la fascia per kind fa sparire i byte coperti.
 *
 * Come si legge la fascia, e perche' cosi':
 *   - firmato   -> tratto PIENO (inchiostro per gli oggetti, inchiostro medio per la struttura:
 *                  l'anatomia resta leggibile dentro la massa firmata);
 *   - non firmato -> casella VUOTA, come un campo non compilato. Prima della firma tutta la
 *                  fascia e' vuota, e al passo `firma` si riempie di inchiostro: e' il momento
 *                  in cui la firma prende possesso del file, ed e' giusto che si veda;
 *   - buco /Contents -> tratteggiato: e' un vuoto, non un colore in piu';
 *   - coda -> spunta FUORI dalla fascia, sotto il filo dell'inchiostro. E' la richiesta letterale
 *             del committente ed e' anche la lettura giusta: quei byte stanno fuori dalla
 *             copertura, non dentro con un altro colore.
 */

import { el, numero, percento, svuota } from './dom.js'
import { RIGHELLO } from './lessico.js'

/**
 * Costruisce il righello e restituisce il nodo piu' la sua funzione di aggiornamento.
 *
 * @returns {{ nodo: HTMLElement, aggiorna: (righello: object|null) => void }}
 */
export function creaRighello() {
  const conti = el('p', { classe: 'righello__conti prestampa' })
  const barra = el('div', {
    classe: 'righello__barra',
    role: 'img',
    'aria-label': RIGHELLO.nome,
  })
  const tacche = el('div', { classe: 'righello__tacche' })
  const legenda = el('div', { classe: 'righello__legenda' })

  // La legenda sta SOPRA la fascia, al posto di un titolo: dire come si legge la fascia serve
  // piu' che ripeterne il nome, che comunque resta nell'aria-label per chi non la vede.
  const nodo = el('section', { classe: 'righello', 'data-righello': true }, [
    el('div', { classe: 'righello__intestazione' }, [legenda, conti]),
    barra,
    tacche,
  ])

  disegnaLegenda(legenda)

  function aggiorna(righello) {
    if (!righello) {
      svuota(barra)
      svuota(tacche)
      nodo.dataset.vuoto = 'si'
      conti.textContent = RIGHELLO.vuoto
      conti.classList.add('righello__vuoto')
      barra.setAttribute('aria-label', `${RIGHELLO.nome}. ${RIGHELLO.vuoto}`)
      return
    }
    delete nodo.dataset.vuoto
    conti.classList.remove('righello__vuoto')

    const { fileLength, segments, coverage, marks } = righello

    // --- i segmenti ---------------------------------------------------------
    const nuovi = document.createDocumentFragment()
    for (const segmento of segments) {
      nuovi.append(
        el('div', {
          classe: 'segmento',
          dati: { segmento: segmento.id, kind: segmento.kind, coperto: segmento.covered ? 'si' : 'no' },
          title: descriviSegmento(segmento),
          stile: {
            left: percento(segmento.start / fileLength),
            // Mezzo pixel in piu': due segmenti contigui dello stesso colore cadono spesso a
            // meta' pixel, e l'antialiasing lasciava una cucitura chiara che sembrava un buco
            // nell'inchiostro. La tacca dei confini resta al byte esatto, e la disegna altrove.
            width: `calc(${percento((segmento.end - segmento.start) / fileLength)} + 0.5px)`,
          },
        }),
      )
    }
    svuota(barra).append(nuovi)

    // --- le tacche ----------------------------------------------------------
    const righe = document.createDocumentFragment()
    marks.forEach((tacca, indice) => {
      const frazione = tacca.offset / fileLength
      const bordo = frazione > 0.88 ? 'destro' : frazione < 0.06 ? 'sinistro' : null
      righe.append(
        el(
          'span',
          {
            classe: 'tacca',
            dati: { kind: tacca.kind, bordo, riga: indice % 2 },
            stile: { left: percento(frazione) },
          },
          [
            el('i', { classe: 'tacca__asta', 'aria-hidden': 'true' }),
            el('span', { classe: 'tacca__riga' }, [
              el('b', { classe: 'tacca__numero', testo: numero(tacca.offset) }),
              el('em', { classe: 'tacca__nome', testo: tacca.label }),
            ]),
          ],
        ),
      )
    })
    svuota(tacche).append(righe)

    // --- i conti ------------------------------------------------------------
    svuota(conti).append(
      voce(RIGHELLO.coperti, coverage.coveredBytes),
      voce(RIGHELLO.buco, coverage.holeBytes),
      voce(RIGHELLO.coda, coverage.tailBytes),
      voce(RIGHELLO.file, fileLength, true),
    )
    barra.setAttribute('aria-label', descriviFascia(righello))
  }

  return { nodo, aggiorna }
}

/** Un conto: «FIRMATI 2.079». L'ultimo senza separatore. */
function voce(nome, valore, ultimo = false) {
  const frammento = document.createDocumentFragment()
  frammento.append(`${nome} `, el('b', { testo: numero(valore) }))
  if (!ultimo) frammento.append('  ·  ')
  return frammento
}

function disegnaLegenda(contenitore) {
  for (const voceLegenda of RIGHELLO.legenda) {
    contenitore.append(
      el('span', { classe: 'legenda__voce' }, [
        el('i', {
          classe: 'legenda__campione',
          'aria-hidden': 'true',
          dati: { kind: voceLegenda.kind, coperto: voceLegenda.coperto ? 'si' : 'no' },
        }),
        el('span', { classe: 'prestampa', testo: voceLegenda.testo }),
      ]),
    )
  }
}

/** Il titolo di un segmento: nome anatomico, intervallo, e se e' firmato. */
function descriviSegmento(segmento) {
  const copertura = segmento.covered ? 'firmato' : 'non firmato'
  return `${segmento.label} · ${numero(segmento.start)}–${numero(segmento.end)} · ${copertura}`
}

/** La stessa fascia, detta a parole: e' l'unico modo in cui la sente chi non la vede. */
function descriviFascia(righello) {
  const { coverage, fileLength } = righello
  const parti = [
    `${RIGHELLO.nome}.`,
    `File di ${numero(fileLength)} byte.`,
    `Firmati ${numero(coverage.coveredBytes)}.`,
  ]
  if (coverage.holeBytes > 0) parti.push(`Buco /Contents di ${numero(coverage.holeBytes)} byte.`)
  if (coverage.tailBytes > 0) {
    parti.push(`Coda fuori dalla copertura di ${numero(coverage.tailBytes)} byte.`)
  }
  parti.push(coverage.complete ? 'Copertura completa.' : 'Copertura incompleta.')
  return parti.join(' ')
}
