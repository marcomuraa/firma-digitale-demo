// Il righello dei byte: l'elemento firma condiviso fra le due direzioni visive, e in questa
// l'unica cosa che ATTRAVERSA la spaccatura. E' l'asse che le due letture hanno in comune:
// la fascia rappresenta l'intero file a scala reale, dal primo byte all'ultimo, e passa sopra
// la meta' chiara e la meta' scura senza interrompersi.
//
// DUE ASSI, NON UNO (docs/contratti-ui.md). Qui si disegnano con due canali diversi:
//
//   asse 2, `segment.covered`  ->  il RIEMPIMENTO. Pieno = firmato, quasi vuoto = non firmato.
//                                  Si legge SOLO da `covered`, mai da `kind`: il vocabolario
//                                  dei kind non contiene «firmato», e chi colora per kind fa
//                                  sparire i byte coperti.
//   asse 1, `segment.kind`     ->  la TESSITURA e la tinta. `hole` e' un vuoto tratteggiato,
//                                  `tail` e' rigato in diagonale, `object` e `structure` sono
//                                  pieni lisci di due tinte diverse.
//
// Nessuna larghezza minima: un segmento di 15 byte su 10.741 e' largo due pixel, e deve
// restarlo. Un righello che ingrandisce i pezzi piccoli per farli vedere non e' piu' in scala,
// e allora non dimostra piu' niente sulla forma del file.

import { el, aggiungi } from './dom.js'
import { numero } from './formato.js'

/** Le tacche, tutte e tre, sono quelle che buildRuler mette in `marks`. */
export function creaRighello() {
  const banda = el('div', { classe: 'righello__banda' })
  const tacche = el('div', { classe: 'righello__tacche' })
  const didascalia = el('p', { classe: 'righello__didascalia' })
  const nodo = el('div', { classe: 'righello', dati: { righello: true } }, [
    banda,
    tacche,
    didascalia,
  ])

  return {
    nodo,
    /**
     * @param {?object} righello  il RulerViewModel della macchina, mai ricalcolato qui
     * @param {object} contesto   { indicato, tailBytes, gapMatchesContents, lunghezza }
     */
    aggiorna(righello, contesto = {}) {
      if (!righello) {
        banda.replaceChildren(el('span', { classe: 'righello__vuoto' }))
        banda.setAttribute('role', 'img')
        banda.setAttribute('aria-label', 'Nessun documento: il righello si accende al primo passo.')
        tacche.replaceChildren()
        // Anche la seconda riga di tacche va disdetta. Sembra un dettaglio e non lo e': lo spazio
        // per due righe resta prenotato, la fascia degli strumenti resta alta 47 px piu' del
        // dovuto, e dopo un «Ricomincia» la pagina non e' piu' quella del caricamento — con
        // --plancia-h che vale per tutto il resto, dallo scorrimento all'appensione del banco.
        tacche.dataset.fitte = 'no'
        didascalia.textContent = 'Nessun documento aperto.'
        nodo.dataset.stato = 'vuoto'
        return
      }

      nodo.dataset.stato = 'pieno'
      const { fileLength, segments, coverage, marks } = righello

      banda.replaceChildren(
        ...segments.map((segmento) =>
          el('span', {
            classe: 'seg',
            dati: {
              segmento: segmento.id,
              kind: segmento.kind,
              coperto: segmento.covered ? 'si' : 'no',
            },
            stile: { '--f': String(segmento.fraction) },
            title: descriviSegmento(segmento),
          }),
        ),
      )

      // Il bersaglio indicato dalla meta' chiara: un ponte che scavalca la spaccatura e
      // finisce esattamente sui byte accesi nel dump.
      if (contesto.indicato) {
        const { start, end } = contesto.indicato
        banda.append(
          el('span', {
            classe: 'righello__indicato',
            'aria-hidden': 'true',
            stile: {
              '--da': String(Math.max(0, start) / fileLength),
              '--larghezza': String(Math.max(1, end - start) / fileLength),
            },
          }),
        )
      }

      banda.setAttribute('role', 'img')
      banda.setAttribute('aria-label', descriviBanda(righello))

      // Due tacche vicine si sovrappongono e diventano illeggibili proprio dove la storia si
      // fa interessante: dopo l'attacco 2 «Fine della copertura» e «Fine del file» distano
      // l'otto per cento del file. Chi non ci sta sulla prima riga scende sulla seconda —
      // nessuna informazione buttata via, che e' la ragione per cui non se ne nasconde una.
      let ultimaX = -1
      let fitte = false
      tacche.replaceChildren(
        ...marks.map((tacca) => {
          const x = tacca.offset / fileLength
          const seconda = ultimaX >= 0 && x - ultimaX < 0.2
          if (seconda) fitte = true
          else ultimaX = x
          return el(
            'span',
            {
              classe: 'tacca',
              dati: {
                kind: tacca.kind,
                riga: seconda ? '2' : '1',
                ancora: x < 0.12 ? 'sinistra' : x > 0.88 ? 'destra' : 'centro',
              },
              stile: { '--x': String(x) },
            },
            [
              el('i', { classe: 'tacca__asta', 'aria-hidden': 'true' }),
              el('b', { classe: 'tacca__nome', testo: tacca.label }),
              el('em', { classe: 'tacca__offset', testo: numero(tacca.offset) }),
            ],
          )
        }),
      )
      tacche.dataset.fitte = fitte ? 'si' : 'no'

      didascalia.replaceChildren()
      aggiungi(didascalia, voci(coverage, fileLength, contesto))
    },
  }
}

/** Le voci della didascalia: numeri, non aggettivi. */
function voci(coverage, fileLength, contesto) {
  const pezzi = [voce(`${numero(fileLength)} byte`, 'totale')]
  if (coverage.coveredBytes > 0) pezzi.push(voce(`${numero(coverage.coveredBytes)} coperti`, 'coperto'))
  if (coverage.holeBytes > 0) pezzi.push(voce(`${numero(coverage.holeBytes)} nel buco`, 'hole'))
  if (coverage.tailBytes > 0) pezzi.push(voce(codaDetta(coverage.tailBytes, contesto), 'tail'))
  return pezzi
}

function voce(testo, tipo) {
  return el('span', { classe: 'righello__voce', dati: { voce: tipo }, testo })
}

/**
 * Le due code si distinguono con dati gia' calcolati, non a intuito (src/ui/machine.js, la
 * sezione sul righello dopo l'attacco 1b):
 *
 *   gapMatchesContents === false  ->  il buco dichiarato non e' piu' dove sta quello vero:
 *                                     il file e' cresciuto DAL DI DENTRO e il fondo e' stato
 *                                     spinto in avanti. Nessuno ha appeso niente.
 *   gapMatchesContents === true   ->  il buco e' dove lo si era lasciato: quei byte sono
 *                                     arrivati DOPO la firma. E' l'attacco 2.
 *
 * Colorare la stessa banda con la stessa storia nei due casi vorrebbe dire raccontare al
 * pubblico una cosa falsa nel passo 1b.
 */
function codaDetta(tailBytes, contesto) {
  if (contesto.gapMatchesContents === false) {
    return `${numero(tailBytes)} fuori copertura: fondo spinto avanti`
  }
  return `${numero(tailBytes)} appesi dopo la firma`
}

function descriviSegmento(segmento) {
  const quanti = numero(segmento.end - segmento.start)
  const stato = segmento.covered ? 'firmato' : 'non firmato'
  return `${segmento.label} · byte ${numero(segmento.start)}–${numero(segmento.end - 1)} · ${quanti} byte · ${stato}`
}

function descriviBanda(righello) {
  const { coverage, fileLength } = righello
  const parti = [`Il file: ${numero(fileLength)} byte.`]
  if (coverage.coveredBytes > 0) {
    parti.push(`${numero(coverage.coveredBytes)} coperti dalla firma.`)
  } else {
    parti.push('Nessun byte ancora coperto da una firma.')
  }
  if (coverage.holeBytes > 0) parti.push(`${numero(coverage.holeBytes)} nel buco /Contents.`)
  if (coverage.tailBytes > 0) parti.push(`${numero(coverage.tailBytes)} fuori dalla copertura.`)
  parti.push(coverage.complete ? 'La copertura esaurisce il file.' : 'La copertura non esaurisce il file.')
  return parti.join(' ')
}
