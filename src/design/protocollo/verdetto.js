/**
 * Il verdetto, e i tre controlli che lo producono.
 *
 * IL COLORE NON BASTA, e qui non e' una rifinitura: in aula c'e' sempre qualcuno che il verde e
 * il rosso non li distingue, e la differenza fra «valida» ed «estesa dopo la firma» e' l'intera
 * morale della demo. Quindi ogni verdetto porta tre segnali indipendenti:
 *
 *   verdetto   colore              forma del bordo   segno      parola
 *   valid      verde sigillo       doppio            ✓          Valida e completa
 *   extended   ambra avviso        tratteggiato      ▲          Valida, documento esteso…
 *   invalid    rosso protocollo    pieno e spesso    ✕          Non valida
 *
 * Anche i tre controlli sono segno + parola: «✓ torna», «✕ non torna». In bianco e nero il
 * referto resta leggibile per intero.
 *
 * Le due impronte a confronto sono `digest.expected` (quella scritta DENTRO la firma) contro
 * `digest.actual` (quella dei byte che si hanno in mano adesso). Non e' `stato.impronta.hex`,
 * che e' una terza cosa: l'impronta calcolata al passo 5, prima di firmare.
 *
 * L'identita' mostrata e' `verifica.identity`, cioe' quella RILETTA dal file — non il
 * certificato che la demo ha costruito. Su un documento integro dicono la stessa cosa; e' quando
 * non la dicono che il pannello serve.
 */

import { el, raggruppa } from './dom.js'
import { CAMPI, CONTROLLI, VERDETTO } from './lessico.js'

/**
 * Il timbro del verdetto.
 *
 * `vivo` distingue il timbro sull'allegato — che cambia con il documento corrente e va
 * annunciato — da quelli congelati nei pannelli, che sono storia gia' scritta: se anche quelli
 * fossero `role="status"`, ogni foglio nuovo farebbe rileggere il proprio verdetto a chi usa
 * uno screen reader, e la storia parlerebbe sopra il presente.
 *
 * @param {?string} verdetto  'valid' | 'extended' | 'invalid' | null
 * @param {{vivo?: boolean}} [opzioni]
 * @returns {HTMLElement}
 */
export function timbroVerdetto(verdetto, opzioni = {}) {
  const chiave = verdetto ?? 'assente'
  const voce = VERDETTO[chiave] ?? VERDETTO.assente
  return el(
    'p',
    {
      classe: 'timbro',
      dati: { verdetto: verdetto ?? 'assente' },
      role: opzioni.vivo ? 'status' : null,
      'aria-label': `Verdetto: ${voce.parola}`,
    },
    [
      el('span', { classe: 'timbro__segno', 'aria-hidden': 'true', testo: voce.segno }),
      el('span', { classe: 'timbro__parola', testo: voce.parola }),
    ],
  )
}

/**
 * I tre controlli, con segno e parola. Riceve il risultato di verify() cosi' com'e'.
 *
 * @param {object} esito
 * @returns {HTMLElement}
 */
export function tabellaControlli(esito) {
  const lista = el('ul', { classe: 'controlli' })
  const copertura = esito?.coverage ?? null
  const digest = esito?.digest ?? null
  const firma = esito?.signature ?? null

  lista.append(
    controllo(
      CONTROLLI.copertura,
      copertura ? (copertura.complete ? 'si' : 'parziale') : 'no',
      copertura
        ? copertura.complete
          ? CONTROLLI.completa
          : `${CONTROLLI.incompleta}: ${copertura.uncoveredTail} byte fuori`
        : CONTROLLI.nonTorna,
    ),
    controllo(
      CONTROLLI.integrita,
      digest?.match === true ? 'si' : 'no',
      digest?.match === true ? CONTROLLI.torna : CONTROLLI.nonTorna,
    ),
    controllo(
      CONTROLLI.firma,
      firma?.ok === true ? 'si' : 'no',
      firma?.ok === true ? CONTROLLI.torna : CONTROLLI.nonTorna,
    ),
  )
  return lista
}

function controllo(nome, esito, parola) {
  const segno = esito === 'si' ? '✓' : esito === 'parziale' ? '▲' : '✕'
  return el('li', { classe: 'controllo', dati: { esito } }, [
    el('span', { classe: 'controllo__segno', 'aria-hidden': 'true', testo: segno }),
    el('span', { classe: 'controllo__nome', testo: nome }),
    el('span', { classe: 'controllo__esito', testo: parola }),
  ])
}

/**
 * Le due impronte, una sopra l'altra: quella attesa dalla firma e quella riscontrata adesso.
 *
 * @param {object} esito
 * @returns {?HTMLElement}
 */
export function confrontoImpronte(esito) {
  const digest = esito?.digest ?? null
  if (!digest) return null
  const uguali = digest.match === true ? 'si' : 'no'
  return el('div', { classe: 'confronto', dati: { uguali } }, [
    riga(CAMPI.attesa, digest.expected),
    riga(CAMPI.riscontro, digest.actual),
  ])
}

function riga(etichetta, valore) {
  return el('div', { classe: 'confronto__riga' }, [
    el('span', { classe: 'prestampa', testo: etichetta }),
    el('span', {
      classe: 'confronto__valore',
      testo: typeof valore === 'string' && valore.length > 0 ? raggruppa(valore, 8) : '—',
    }),
  ])
}
