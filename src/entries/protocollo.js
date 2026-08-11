/* global __NARRATED__ */

// Entry della direzione visiva A — «Protocollo».
// Produce due output: dist/protocollo.html (muto) e dist/protocollo-narrato.html.
// La differenza fra i due e solo __NARRATED__, costante iniettata da vite.config.js.
//
// Qui dentro non c'e' disegno: ci sono i marcatori di avvio, che sono un contratto
// (docs/contratti-dom.md sezione 2, scripts/build/check-selfcontained.mjs), e il montaggio
// della pagina, che vive sotto src/design/protocollo/.

import { applicaMarcatori } from './marcatori.js'
import { montaProtocollo } from '../design/protocollo/pagina.js'

const DIREZIONE = {
  id: 'protocollo',
  nome: 'Protocollo',
}

applicaMarcatori(DIREZIONE)
montaProtocollo(document.getElementById('app') ?? document.body)

// La narrazione entra nel bundle solo qui, dietro la costante di compilazione.
// Nella variante muta `__NARRATED__` diventa letteralmente `false`, il ramo e
// codice morto e l'import dinamico non viene nemmeno risolto: driver e blob
// audio restano fuori dal file. L'await al livello superiore serve a far
// completare il caricamento della pagina solo a narrazione montata, cosi il
// controllo con Chrome headless trova il marcatore.
if (__NARRATED__) {
  const { attivaNarrazione } = await import('./narration-placeholder.js')
  attivaNarrazione(DIREZIONE)
}
