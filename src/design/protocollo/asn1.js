/**
 * L'albero ASN.1, dietro un apri-e-chiudi ma vero.
 *
 * `buildAsn1Tree(der)` di src/views/ e' una funzione pura e non lancia mai: un DER malformato
 * torna `ok: false` con la ragione. Qui si rende `flat`, che e' la stessa gerarchia in ordine
 * di visita — l'indentazione la porta `depth`.
 *
 * Perche' la lista piatta e non `<details>` annidati: un certificato X.509 ha una quarantina di
 * nodi e un SignedData qualche decina di piu'. Aperti tutti in una lista rientrata si leggono in
 * un colpo d'occhio come si legge un `openssl asn1parse -i`, che e' lo strumento con cui chi
 * guarda confrontera' — e il confronto e' il punto.
 */

import { buildAsn1Tree } from '../../views/asn1-view.js'
import { el, numero } from './dom.js'

/**
 * @param {Uint8Array} der
 * @returns {HTMLElement}
 */
export function disegnaAlbero(der) {
  const albero = buildAsn1Tree(der)
  if (!albero.ok) {
    return el('p', {
      classe: 'asn1__guasto',
      testo: albero.error ?? 'Questi byte non sono un DER leggibile.',
    })
  }

  const box = el('div', { classe: 'asn1' })
  const frammento = document.createDocumentFragment()
  for (const nodo of albero.flat) {
    const testo = el('div', {
      classe: 'asn1__nodo',
      stile: { paddingLeft: `${nodo.depth * 1.6}ch` },
    })
    testo.append(el('span', { classe: 'asn1__tag', testo: nodo.tagLabel }))
    if (nodo.valuePreview) {
      // `valuePreview` di un OID contiene gia' il nome quando la vista lo conosce
      // («contentType (1.2.840.113549.1.9.3)»): ristamparlo accanto lo raddoppierebbe. Qui si
      // cambia solo il colore, che e' l'unica cosa che il ViewModel non puo' decidere.
      testo.append(
        ' ',
        el('span', { classe: nodo.oid ? 'asn1__oid' : 'asn1__valore', testo: nodo.valuePreview }),
      )
    }
    testo.append(
      ' ',
      el('span', { classe: 'asn1__misura', testo: `(${numero(nodo.length)} byte)` }),
    )
    frammento.append(
      el('div', { classe: 'asn1__riga' }, [
        el('span', { classe: 'asn1__offset', testo: String(nodo.offset) }),
        testo,
      ]),
    )
  }
  box.append(frammento)
  return box
}
