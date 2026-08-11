// ---------------------------------------------------------------------------
// SEGNAPOSTO — da sostituire in fase 5b.
//
// Qui arrivera il driver di narrazione vero: src/ui/narrator.js,
// `createNarrator(segments, machine) -> { play, pause, seek, onSegmentEnd }`,
// piu i segmenti audio Opus generati a tempo di build e inlineati in base64.
//
// Perche questo file esiste adesso: le entry devono gia importare la narrazione
// dietro `if (__NARRATED__)`, cosi che la struttura del bundle sia quella
// definitiva fin dalla fase 1 e le varianti mute dimostrino oggi che il ramo
// narrato viene eliminato dal tree-shaking. Il controllo automatico verifica
// proprio questo cercando la sentinella qui sotto: deve comparire nei due HTML
// narrati e mancare nei due muti.
//
// Chi lavora alla fase 5b: sostituisci il corpo di `attivaNarrazione` con il
// vero driver, tieni la firma della funzione e tieni la sentinella (o aggiorna
// di conseguenza SENTINELLA_NARRAZIONE in
// scripts/build/check-selfcontained.mjs).
// ---------------------------------------------------------------------------

/** Sentinella cercata dal controllo di autoconsistenza. Non rinominare alla leggera. */
export const SENTINELLA_NARRAZIONE = 'SEGNAPOSTO_NARRAZIONE_FASE_5B'

/**
 * Attiva la narrazione per la direzione indicata.
 * In fase 1 si limita a marcare il DOM: serve a provare che il ramo narrato
 * e stato davvero incluso nel bundle ed eseguito.
 *
 * @param {{ id: string, nome: string }} direzione
 */
export function attivaNarrazione(direzione) {
  document.body.dataset.narrazione = SENTINELLA_NARRAZIONE

  const scaffold = document.getElementById('scaffold')
  if (scaffold) {
    const riga = document.createElement('p')
    riga.className = 'riga'
    riga.textContent =
      `Driver di narrazione: segnaposto attivo per la direzione ${direzione.nome}. ` +
      'La voce italiana arriva in fase 5b.'
    scaffold.append(riga)
  }
}
