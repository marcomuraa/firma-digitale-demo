/**
 * Il foglio: un atto del registro, oppure una nota a margine.
 *
 * FORMA DEL FOGLIO, e da dove viene. La carta protocollo italiana ha una doppia rigatura
 * verticale che stacca un margine stretto sulla sinistra: li' si scrivono il numero dell'atto e
 * le annotazioni. Qui quel margine c'e' davvero, e porta il numero di repertorio in cifre romane.
 *
 * IL NUMERO NON E' DECORAZIONE. I dodici passi SONO una sequenza: l'atto V non ha senso prima
 * del IV, e la macchina lo impone (`canRun`). Numerarli dice una cosa vera. I tre pannelli
 * teorici invece non hanno un passo, quindi non hanno numero: nel margine portano la parola
 * «Nota», ed e' la stessa distinzione che fa docs/contratti-ui.md.
 *
 * DOPPIA MODALITA'. Il testo arriva da src/ui/copy.it.js gia' scritto per le due modalita':
 * `occhiello` + `titolo` + il PRIMO paragrafo si leggono da tre metri, il resto e' per lo
 * studio. Qui si mettono in pagina tutti i paragrafi e li nasconde il CSS su
 * `body[data-modalita]` — un attributo, non due fogli di stile.
 */

import { COPY } from '../../ui/copy.it.js'
import { el, romano } from './dom.js'
import { COMANDI, MARGINE } from './lessico.js'
import { contenutoDelPasso } from './dati.js'

/**
 * Il foglio di un atto: un passo eseguito, con la sua scheda.
 *
 * @param {string} stepId
 * @param {number} numeroAtto  1..12
 * @param {object} stato
 * @returns {HTMLElement}
 */
export function creaFoglioAtto(stepId, numeroAtto, stato) {
  const testi = COPY[stepId]
  const corpo = el('div', { classe: 'foglio__corpo' }, [
    testata(testi, stepId),
    el('hr', { classe: 'foglio__filetto' }),
    prosa(testi),
  ])
  for (const nodo of contenutoDelPasso(stepId, stato)) corpo.append(nodo)

  return el(
    'article',
    {
      classe: 'foglio',
      dati: { pannello: stepId, tipo: 'atto', atto: numeroAtto },
      'aria-labelledby': `titolo-${stepId}`,
      tabindex: '-1',
    },
    [
      el('div', { classe: 'foglio__margine' }, [
        el('b', { classe: 'foglio__numero', testo: romano(numeroAtto) }),
        el('span', { classe: 'foglio__marca prestampa', testo: MARGINE.atto }),
      ]),
      corpo,
    ],
  )
}

/**
 * Il foglio di una nota teorica: nessun numero, e il corpo si apre a richiesta.
 *
 * @param {string} panelId
 * @returns {HTMLElement}
 */
export function creaFoglioNota(panelId) {
  const testi = COPY[panelId]
  const dettagli = el('details', { classe: 'apri' }, [
    el('summary', { testo: COMANDI.apriNota }),
    el('div', { classe: 'apri__contenuto' }, prosa(testi)),
  ])

  return el(
    'article',
    {
      classe: 'foglio',
      dati: { pannello: panelId, tipo: 'nota' },
      'aria-labelledby': `titolo-${panelId}`,
    },
    [
      el('div', { classe: 'foglio__margine' }, [
        el('b', { classe: 'foglio__numero', testo: '§' }),
        el('span', { classe: 'foglio__marca prestampa', testo: MARGINE.nota }),
      ]),
      el('div', { classe: 'foglio__corpo' }, [
        testata(testi, panelId),
        el('hr', { classe: 'foglio__filetto' }),
        dettagli,
      ]),
    ],
  )
}

/* ------------------------------------------------------------------ pezzi comuni */

function testata(testi, id) {
  return el('header', { classe: 'foglio__testata' }, [
    el('p', { classe: 'occhiello prestampa', testo: testi.occhiello }),
    el('h2', { classe: 'titolo', testo: testi.titolo, id: id ? `titolo-${id}` : null }),
  ])
}

function prosa(testi) {
  return el(
    'div',
    { classe: 'corpo' },
    testi.corpo.map((paragrafo) => el('p', { testo: paragrafo })),
  )
}
