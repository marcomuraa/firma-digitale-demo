// Il giro: che cosa la pagina deve ridisegnare, e dove va centrato il dump.
//
// Sono le due decisioni di questa direzione che NON hanno bisogno del DOM, e stanno qui apposta.
// Il motivo non e' l'ordine: e' che una di loro aveva un difetto che nessuna schermata mostra e
// nessuna prova copriva. La pila si costruiva incrementalmente da un insieme di passi «gia'
// disegnati» che non veniva mai svuotato, quindi dopo un `reset()` la pagina teneva in vita i
// pannelli del giro precedente — l'impronta di un certificato che non esisteva piu', accanto al
// righello di un file appena riaperto — senza nessun segno che una delle due cose fosse vecchia.
// In una demo il cui argomento e' «non fidarti di quello che vedi, guarda i byte» era il difetto
// peggiore possibile.
//
// Estratta dal disegno, quella decisione e' una funzione di due elenchi di stringhe: si prova in
// node in cinque millisecondi (giro.test.mjs), e il caso del reset e' uno dei casi provati invece
// che una cosa da riscoprire al terzo giro.

/**
 * Che cosa fare della pila, confrontando cio' che c'e' in pagina con la storia della macchina.
 *
 * La regola sta in una riga: la pila e' valida finche' cio' che si e' disegnato e' un PREFISSO
 * della storia. `passiFatti` cresce solo in coda (src/ui/machine.js: nessun passo si riesegue,
 * nessun risultato si riscrive), quindi «prefisso» vuol dire «stesso giro, piu' avanti» — e
 * tutto cio' che si deve fare e' aggiungere la coda che manca.
 *
 * Quando NON e' un prefisso, la storia e' un'altra: e' successo un `reset()`, e i pannelli in
 * pagina appartengono a una demo che non esiste piu'. Allora si butta via tutto e si ridisegna da
 * quello che la macchina dice adesso — che dopo un reset e' niente, e dopo «reset piu' tre passi»
 * sono quei tre passi soltanto.
 *
 * `restoreSigned()` non tocca la storia, quindi qui non produce niente: i pannelli degli attacchi
 * restano in pagina, ed e' esattamente cio' che deve succedere.
 *
 * @param {string[]} disegnati   gli stepId gia' in pila, nell'ordine in cui sono stati disegnati
 * @param {string[]} passiFatti  `stato.passiFatti` della macchina
 * @returns {{ azzera: boolean, daAggiungere: string[] }}
 */
export function pianoDellaPila(disegnati, passiFatti) {
  const fatti = Array.isArray(passiFatti) ? passiFatti : []
  const gia = Array.isArray(disegnati) ? disegnati : []
  if (eUnPrefisso(gia, fatti)) return { azzera: false, daAggiungere: fatti.slice(gia.length) }
  return { azzera: true, daAggiungere: [...fatti] }
}

function eUnPrefisso(corto, lungo) {
  if (corto.length > lungo.length) return false
  for (let i = 0; i < corto.length; i++) {
    if (corto[i] !== lungo[i]) return false
  }
  return true
}

/**
 * Dove centrare il dump. L'ordine e' quello dell'interesse: cio' che si e' appena indicato, poi
 * cio' che il passo corrente evidenzia, poi il buco della firma.
 *
 * `null` vuol dire «lascia dov'era», ed e' il caso dei tre passi che AZZERANO le evidenziazioni
 * (chiavi, certificato, cms): non parlano di byte del documento, e far saltare il dump a offset
 * zero sarebbe un movimento senza motivo.
 *
 * @param {object} stato      l'istantanea della macchina
 * @param {?object} indicato  il punto acceso sulla meta' chiara, o null
 * @returns {?number}
 */
export function centroDump(stato, indicato) {
  if (indicato) return indicato.start
  const evidenziazioni = stato?.evidenziazioni
  if (Array.isArray(evidenziazioni) && evidenziazioni.length > 0) return evidenziazioni[0].start
  if (Number.isFinite(stato?.contentsStart)) return stato.contentsStart
  return null
}
