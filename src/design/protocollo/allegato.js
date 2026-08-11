/**
 * L'allegato: il documento come lo vede un lettore PDF, adesso.
 *
 * E' la meta' della dimostrazione che non si puo' chiedere a nessuno di credere sulla parola.
 * L'attacco 2 non tocca un byte firmato e il documento a schermo cambia lo stesso: senza vederlo
 * cambiare, quella frase resta un'affermazione. Quindi qui c'e' un canvas vero, disegnato da
 * pdf.js sui BYTE CORRENTI, e accanto il timbro del verdetto — perche' il punto e' proprio che
 * le due cose non coincidono.
 *
 * UN SOLO CANVAS, ed e' una scelta. `docs/contratti-dom.md` fissa `[data-canvas-pdf]` come «il
 * canvas in cui pdf.js disegna», al singolare: chi pilota la pagina dall'esterno deve poter
 * dire «guarda quello» senza chiedersi quale. Un canvas per pannello avrebbe dato un confronto
 * affiancato piu' ricco, ma avrebbe reso ambiguo proprio il gancio che serve a dimostrare il
 * cambiamento. Il confronto resta possibile scorrendo i pannelli, dove ogni atto conserva il
 * testo che il documento diceva in quel momento (`testoDopo`, congelato dalla macchina).
 *
 * `renderPdfToCanvas` prende possesso del canvas SINCRONAMENTE e serializza i disegni: due
 * chiamate di fila senza await in mezzo sono lecite, vince la piu' recente e la precedente torna
 * con `annullato: true`. Un disegno annullato NON e' un guasto e non si mostra come tale.
 */

import { renderPdfToCanvas } from '../../ui/pdf-render.js'
import { el, numero, svuota } from './dom.js'
import { ALLEGATO } from './lessico.js'
import { timbroVerdetto } from './verdetto.js'

/**
 * @returns {{ nodo: HTMLElement, aggiorna: (stato: object) => void }}
 */
export function creaAllegato() {
  const stato = el('p', { classe: 'allegato__stato', testo: ALLEGATO.nessuno })
  const misura = el('p', { classe: 'allegato__misura' })
  const canvas = el('canvas', { classe: 'allegato__canvas', 'data-canvas-pdf': true, hidden: true })
  const vuoto = el('p', { classe: 'allegato__vuoto', testo: ALLEGATO.attesa })
  const guasto = el('p', { classe: 'allegato__guasto', hidden: true })
  const avvisi = el('div', { classe: 'allegato__avvisi', hidden: true })
  const verdetto = el('div', { classe: 'allegato__verdetto' }, timbroVerdetto(null, { vivo: true }))

  const nodo = el('section', { classe: 'allegato', 'aria-label': ALLEGATO.titolo }, [
    el('div', { classe: 'allegato__testata' }, [
      el('p', { classe: 'prestampa', testo: ALLEGATO.titolo }),
      stato,
      misura,
    ]),
    verdetto,
    el('div', { classe: 'allegato__foglio' }, [canvas, vuoto, guasto]),
    avvisi,
  ])

  /** L'ultimo documento disegnato: etichetta e lunghezza bastano a distinguere i sei stati. */
  let disegnato = null

  function aggiorna(istantanea) {
    svuota(verdetto).append(timbroVerdetto(istantanea.verdetto, { vivo: true }))

    const documento = istantanea.documento
    if (!documento) {
      disegnato = null
      canvas.hidden = true
      vuoto.hidden = false
      guasto.hidden = true
      avvisi.hidden = true
      stato.textContent = ALLEGATO.nessuno
      misura.textContent = ''
      return
    }

    stato.textContent = ALLEGATO.etichette[documento.etichetta] ?? documento.etichetta
    misura.textContent = `${numero(documento.lunghezza)} byte`

    const chiave = `${documento.etichetta}:${documento.lunghezza}`
    if (chiave === disegnato) return
    disegnato = chiave
    vuoto.hidden = true

    renderPdfToCanvas(documento.bytes, canvas).then((esito) => {
      // Superato da un disegno piu' recente: il canvas appartiene gia' a un altro documento.
      if (esito.annullato) return
      canvas.hidden = !esito.ok
      guasto.hidden = esito.ok
      if (!esito.ok) {
        guasto.textContent = `${ALLEGATO.guasto}: ${esito.error ?? ''}`
        vuoto.hidden = true
      }
      mostraAvvisi(esito.avvisi)
    })
  }

  function mostraAvvisi(elenco) {
    svuota(avvisi)
    if (!Array.isArray(elenco) || elenco.length === 0) {
      avvisi.hidden = true
      return
    }
    avvisi.hidden = false
    avvisi.append(
      el('p', { classe: 'prestampa', testo: ALLEGATO.avvisi }),
      el(
        'ul',
        {},
        elenco.map((testo) => el('li', { testo })),
      ),
    )
  }

  return { nodo, aggiorna }
}
