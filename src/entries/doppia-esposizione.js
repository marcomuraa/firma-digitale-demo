/* global __NARRATED__ */

// Entry della direzione visiva C — «Doppia esposizione».
// Produce due output: dist/doppia-esposizione.html (muto) e
// dist/doppia-esposizione-narrata.html.
// La differenza fra i due e solo __NARRATED__, costante iniettata da vite.config.js.

import { applicaMarcatori } from './marcatori.js'
import { montaDoppia } from '../design/doppia/app.js'

const DIREZIONE = {
  id: 'doppia-esposizione',
  nome: 'Doppia esposizione',
  sommario:
    'Pagina spaccata: a sinistra il documento come lo vede un umano, a destra ' +
    'lo stesso file come lo vede la macchina.',
}

// Prima i marcatori, poi il disegno: se il disegno si rompesse, chi guarda la pagina da fuori
// deve comunque poter dire quale delle quattro combinazioni ha davanti.
applicaMarcatori(DIREZIONE)

const radice = document.getElementById('app')
if (radice) montaDoppia(radice)

// Stessa struttura dell altra entry: la narrazione e una variante di build,
// non un terzo codice. Vedi il commento in protocollo.js.
if (__NARRATED__) {
  const { attivaNarrazione } = await import('./narration-placeholder.js')
  attivaNarrazione(DIREZIONE)
}
