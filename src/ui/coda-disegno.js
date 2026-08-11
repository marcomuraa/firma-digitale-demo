/**
 * coda-disegno.js — chi disegna su un canvas, e quando.
 *
 * Modulo minuscolo, senza DOM e senza pdf.js, estratto da src/ui/pdf-render.js per una ragione
 * sola: e' la parte che si rompe, ed e' l'unica che si puo' provare in node. Il ponte verso
 * pdf.js pesa 1,6 MB e non entra nei test; questa manciata di righe si.
 *
 * ============================================================================
 * I due guasti che questo modulo esiste per non avere
 * ============================================================================
 *
 * 1. LO SCHERMO CHE MENTE. La prima stesura registrava «chi possiede il canvas» DOPO due await
 *    (l'apertura del documento e la lettura della pagina). Due richieste partite nello stesso
 *    tick trovavano entrambe la mappa vuota, nessuna annullava l'altra, e la seconda moriva
 *    dentro pdf.js con «Cannot use the same canvas during multiple render() operations».
 *    Misurato in Chrome: chiesto il documento manomesso, sul canvas restava il documento
 *    INTEGRO e l'errore compariva altrove. In una demo sulla falsificazione e' il modo di
 *    rompersi che non ci si puo' permettere.
 *    Qui la proprieta' del canvas si prende SINCRONAMENTE, dentro `prenota()`, prima che il
 *    chiamante possa cedere il controllo: chi arriva dopo trova sempre chi c'era prima.
 *
 * 2. GLI AVVISI SCAMBIATI. pdf.js emette i suoi warning su `console.warn`, che e' una sola per
 *    tutta la pagina: due rendering sovrapposti si copiano gli avvisi a vicenda. Misurato: il
 *    documento firmato INTEGRO, disegnato in parallelo con l'attacco 1b, si prendeva il
 *    «Indexing all PDF objects» dell'altro — cioe' «il lettore ha dovuto riparare il file per
 *    aprirlo» detto di un documento sano. Quell'avviso e' l'appiglio onesto con cui la demo
 *    racconta l'attacco 1b (RECIPE.md sezione 6, docs/stato.md punto 2): attribuito male, il
 *    pannello direbbe una cosa falsa.
 *    Non c'e' modo di distinguere per provenienza — con il fake worker tutto gira sul thread
 *    principale — quindi la cura e' non sovrapporli: UN LAVORO PER VOLTA, in tutta la pagina.
 *    Con la coda, il raccoglitore attivo e' sempre uno solo e l'attribuzione torna vera.
 *
 * ============================================================================
 * L'API
 * ============================================================================
 *
 *   creaCodaDiDisegno() -> { prenota(canvas, lavoro) -> Promise }
 *
 * `prenota(canvas, lavoro)`:
 *
 *   - prende SUBITO, prima di restituire, la proprieta' di `canvas`. Se qualcuno ce l'aveva,
 *     il suo gettone viene segnato `annullato` e la sua `annulla()` viene chiamata: vince il
 *     piu' recente, che e' cio' che l'utente ha appena chiesto;
 *   - mette `lavoro` in fila. La fila e' UNA per tutta la coda, non una per canvas: due canvas
 *     diversi non disegnano mai insieme, ed e' il punto 2 qui sopra;
 *   - quando e' il turno, chiama `lavoro(gettone)` e restituisce quello che restituisce lui.
 *     `lavoro` viene chiamato SEMPRE, anche se il gettone e' gia' annullato: solo chi chiama
 *     sa che forma deve avere la risposta, e questo modulo non la inventa;
 *   - la fila non si spezza mai: un `lavoro` che lancia fa fallire la sua promessa e basta,
 *     quello dopo parte lo stesso.
 *
 * Il gettone passato a `lavoro`:
 *
 *   annullato  boolean          vero quando una richiesta piu' recente ha preso lo stesso
 *                               canvas. Va riletto DOPO OGNI await: e' l'unico modo di
 *                               accorgersi che quello che si sta per disegnare non serve piu'.
 *   annulla    (() => void)|null  scrivici la funzione che interrompe il lavoro in corso (per
 *                               pdf.js: `renderTask.cancel`). Viene chiamata al massimo una
 *                               volta, quando arriva una richiesta piu' recente sullo stesso
 *                               canvas, e viene ignorata se lancia.
 *
 * `canvas` serve solo come chiave: e' una WeakMap, quindi un canvas rimosso dal DOM non resta
 * appeso. Qualunque oggetto va bene, ed e' cio' che rende provabile questo modulo senza DOM.
 *
 * Ambiente: browser e node. Nessun import.
 */

/**
 * Costruisce una coda di disegno. Se ne fa UNA per tutta la pagina: due code sarebbero due
 * turni indipendenti, e i lavori tornerebbero a sovrapporsi.
 *
 * @returns {{ prenota: (canvas: object, lavoro: (gettone: {annullato: boolean, annulla: (() => void)|null}) => any) => Promise<any> }}
 */
export function creaCodaDiDisegno() {
  /** L'ultima richiesta arrivata per ciascun canvas. Weak: non trattiene i canvas. */
  const ultimaRichiesta = new WeakMap()
  /** La fila: una sola, per tutta la coda. Non viene mai rifiutata, quindi non si spezza. */
  let fila = Promise.resolve()

  function prenota(canvas, lavoro) {
    const gettone = { annullato: false, annulla: null }

    // SINCRONO, prima di qualunque await del chiamante: e' tutta la riparazione del guasto 1.
    const precedente = ultimaRichiesta.get(canvas)
    if (precedente) {
      precedente.annullato = true
      const interrompi = precedente.annulla
      precedente.annulla = null // una volta sola
      if (typeof interrompi === 'function') {
        try {
          interrompi()
        } catch {
          /* aveva gia' finito: non e' un guasto */
        }
      }
    }
    ultimaRichiesta.set(canvas, gettone)

    const esegui = async () => {
      try {
        return await lavoro(gettone)
      } finally {
        gettone.annulla = null
        if (ultimaRichiesta.get(canvas) === gettone) ultimaRichiesta.delete(canvas)
      }
    }

    // Il turno viene dopo quello di prima, che sia andato bene o male.
    const mio = fila.then(esegui, esegui)
    fila = mio.then(niente, niente)
    return mio
  }

  return { prenota }
}

function niente() {}
