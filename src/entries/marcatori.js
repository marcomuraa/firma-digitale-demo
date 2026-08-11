/* global __NARRATED__ */

import urlSondaAsset from './probe-asset.txt?url'

// ---------------------------------------------------------------------------
// I marcatori di avvio, condivisi dalle due direzioni visive.
//
// E' l'unico pezzo di boot che le due pagine hanno in comune e che non ha aspetto: dice al
// mondo esterno CHE COSA e' questa pagina, e non disegna niente. Il disegno comincia dopo,
// sotto src/design/, e ognuna delle due direzioni lo fa a modo suo.
//
// Viene da src/entries/boot-scaffold.js, che in fase 1 montava anche il segnaposto della pagina.
// Quel file e' stato cancellato a fine fase 5, quando le due direzioni hanno preso il suo posto:
// qui resta solo la parte che serve per sempre.
//
// I MARCATORI SONO UN CONTRATTO, non una comodita'. Li pretendono, con questi nomi e con
// questi valori:
//
//   - scripts/build/check-selfcontained.mjs, che apre i quattro HTML in Chrome headless e
//     fallisce se un marcatore manca o sbaglia valore. E' quella la specifica: leggila prima
//     di cambiare una stringa qui dentro;
//   - docs/contratti-dom.md sezione 2, che li elenca per chi deve pilotare la pagina
//     dall'esterno senza sapere quale delle due direzioni ha davanti.
//
//   data-boot="ok"                 il JavaScript della pagina e' partito davvero. Se il bundle
//                                  si rompe, questo marcatore non c'e', e il controllo se ne
//                                  accorge invece di fotografare una pagina bianca.
//   data-direzione="<id>"          protocollo | doppia-esposizione
//   data-narrato="si" | "no"       il valore di __NARRATED__ a tempo di build
//   data-variante="<id-variante>"  la combinazione in una stringa sola: "<direzione>" oppure
//                                  "<direzione>-narrato"
//   data-asset-inline="ok" | "ko"  sonda: un asset importato con `?url` e' diventato un data
//                                  URI invece di restare un file affiancato. E' il meccanismo
//                                  da cui dipende tutto l'inlining, quindi si misura a ogni
//                                  avvio invece di darlo per buono.
//
// Li aggiunge chi disegna, a ogni cambio di stato (docs/contratti-dom.md sezione 2):
//   data-modalita, data-passo-corrente, data-verdetto.
// Non li scrive questo modulo: cambiano nel tempo, questi no.
//
// Il modulo di narrazione, quando presente, aggiunge da se' data-narrazione.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Direzione
 * @property {string} id    identificatore tecnico: 'protocollo' | 'doppia-esposizione'
 * @property {string} nome  nome leggibile, quello che finisce nel titolo della finestra
 */

/**
 * Scrive il titolo del documento e i marcatori su `<body>`.
 *
 * Va chiamata una volta sola, all'avvio, prima di qualunque disegno: il titolo e i marcatori
 * devono esserci anche se il resto della pagina fallisce, altrimenti chi la osserva da fuori
 * non riesce nemmeno a dire quale delle quattro combinazioni sta guardando.
 *
 * @param {Direzione} direzione
 * @returns {{ narrato: boolean, variante: string }}
 */
export function applicaMarcatori({ id, nome }) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('applicaMarcatori vuole l identificatore della direzione visiva')
  }
  if (typeof nome !== 'string' || nome.length === 0) {
    throw new Error('applicaMarcatori vuole il nome leggibile della direzione visiva')
  }

  const narrato = __NARRATED__
  const variante = narrato ? `${id}-narrato` : id

  // La forma esatta del titolo e' quella che check-selfcontained.mjs confronta stringa per
  // stringa: "Firma digitale PAdES — <Nome> — versione muta" oppure "… — versione narrata".
  document.title = `Firma digitale PAdES — ${nome} — versione ${narrato ? 'narrata' : 'muta'}`

  const body = document.body
  body.dataset.boot = 'ok'
  body.dataset.direzione = id
  body.dataset.narrato = narrato ? 'si' : 'no'
  body.dataset.variante = variante
  // Se l'asset importato non fosse stato inlineato, qui ci sarebbe un percorso relativo verso
  // un file che nell'HTML autoconsistente non esiste.
  body.dataset.assetInline = urlSondaAsset.startsWith('data:') ? 'ok' : 'ko'

  return { narrato, variante }
}
