// L'albero ASN.1, dietro un aprire-e-chiudere.
//
// Quando si apre dev'essere VERO: ogni nodo porta il suo offset dentro il DER, la lunghezza,
// il tag, e — dove esiste — il nome dell'OID. Sono gli stessi byte che il pannello mostra nel
// dump, letti con l'altra grammatica.
//
// La costruzione e' di src/views/asn1-view.js, funzione pura che non lancia mai: un DER
// malformato torna `ok: false` con un motivo leggibile, e qui si mostra il motivo invece di
// una lista vuota.

import { buildAsn1Tree } from '../../views/asn1-view.js'
import { el, bottone } from './dom.js'
import { numero } from './formato.js'

let contatore = 0

/**
 * @param {Uint8Array} der
 * @param {string} etichetta  che cosa sono questi byte, per il bottone
 */
export function creaAlbero(der, etichetta) {
  const id = `asn1-${++contatore}`
  const regione = el('div', { classe: 'asn1', id, hidden: true })
  const interruttore = bottone(`Apri l’albero ASN.1 · ${etichetta}`, {
    classe: 'comando comando--largo',
    'aria-expanded': 'false',
    'aria-controls': id,
  })

  let aperto = false
  let costruito = false

  interruttore.addEventListener('click', () => {
    aperto = !aperto
    interruttore.setAttribute('aria-expanded', aperto ? 'true' : 'false')
    interruttore.textContent = aperto
      ? `Chiudi l’albero ASN.1 · ${etichetta}`
      : `Apri l’albero ASN.1 · ${etichetta}`
    regione.hidden = !aperto
    if (aperto && !costruito) {
      costruito = true
      regione.replaceChildren(...corpo(der))
    }
  })

  return el('div', { classe: 'apribile' }, [interruttore, regione])
}

function corpo(der) {
  const albero = buildAsn1Tree(der)
  if (!albero.ok) {
    return [el('p', { classe: 'asn1__guasto', testo: albero.error }), coda(albero)]
  }
  const righe = albero.flat.map((nodo) => {
    const valore = nodo.oidLabel ? `${nodo.oidLabel} — ${nodo.valuePreview}` : nodo.valuePreview
    // Il `title` e' la terza via di recupero, dopo la colonna piu' larga e lo scorrimento
    // orizzontale: il testo intero resta raggiungibile anche senza scorrere e anche a chi
    // guarda da lontano e non puo' toccare la pagina.
    return el(
      'div',
      { classe: 'asn1__riga', stile: { '--livello': String(nodo.depth) }, dati: { tipo: nodo.valueKind } },
      [
        el('span', { classe: 'asn1__offset', testo: numero(nodo.offset) }),
        el('span', { classe: 'asn1__tag', testo: nodo.tagLabel, title: nodo.tagLabel }),
        el('span', { classe: 'asn1__lunghezza', testo: `${numero(nodo.length)} B` }),
        el('span', { classe: 'asn1__valore', testo: valore, title: valore }),
      ],
    )
  })
  return [el('div', { classe: 'asn1__albero' }, righe), coda(albero)]
}

/**
 * I byte dopo l'ultimo elemento non sono un errore: il /Contents e' imbottito di zeri per
 * costruzione, e la differenza fra `totalLength` e la fine della radice e' proprio
 * l'imbottitura. Dirlo evita che sembri un troncamento.
 */
function coda(albero) {
  if (!albero.ok || !albero.root) {
    return el('p', { classe: 'asn1__coda', testo: `${numero(albero.totalLength)} byte in ingresso.` })
  }
  const fine = albero.root.offset + albero.root.length
  const resto = albero.totalLength - fine
  const testo =
    resto > 0
      ? `${numero(albero.totalLength)} byte, di cui ${numero(resto)} dopo l’ultimo elemento.`
      : `${numero(albero.totalLength)} byte, tutti dentro l’albero.`
  return el('p', { classe: 'asn1__coda', testo })
}
