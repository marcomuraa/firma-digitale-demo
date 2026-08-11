import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// ---------------------------------------------------------------------------
// Configurazione Vite parametrica.
//
// Un solo file di configurazione serve tutte e quattro le combinazioni:
// due direzioni visive (Protocollo, Doppia esposizione) per due varianti
// (muta, narrata). La combinazione da costruire arriva da variabili d'ambiente
// e NON da piu entry contemporanee: vite-plugin-singlefile impone
// `codeSplitting: false` (era `inlineDynamicImports` prima di Vite 8), che
// e incompatibile con piu di una entry nello stesso build.
//
// Per questo scripts/build/build-all.mjs lancia quattro build separate,
// impostando ogni volta:
//
//   ENTRY     protocollo | doppia-esposizione     (default: protocollo)
//   NARRATED  1 | 0                               (default: 0)
//   OUT_DIR   cartella di destinazione            (default: dist/)
//
// e spostando poi l'output al nome finale. OUT_DIR esiste per questo: Vite
// nomina l'HTML come la sorgente, quindi due varianti della stessa sorgente si
// sovrascriverebbero a vicenda dentro dist/. Ogni build scrive in una cartella
// temporanea propria. Vedi anche scripts/build/check-selfcontained.mjs.
// ---------------------------------------------------------------------------

const radiceProgetto = path.dirname(fileURLToPath(import.meta.url))
const cartellaEntry = path.join(radiceProgetto, 'src', 'entries')
const cartellaDist = path.join(radiceProgetto, 'dist')

/** Le due sorgenti. I quattro output nascono da queste due, non da quattro file. */
export const ENTRY_DISPONIBILI = {
  protocollo: 'protocollo.html',
  'doppia-esposizione': 'doppia-esposizione.html',
}

export default defineConfig(() => {
  const entry = process.env.ENTRY ?? 'protocollo'
  const narrated = process.env.NARRATED === '1' || process.env.NARRATED === 'true'

  const cartellaOutput = process.env.OUT_DIR
    ? path.resolve(radiceProgetto, process.env.OUT_DIR)
    : cartellaDist

  const fileEntry = ENTRY_DISPONIBILI[entry]
  if (!fileEntry) {
    throw new Error(
      `ENTRY non riconosciuta: "${entry}". Valori ammessi: ${Object.keys(ENTRY_DISPONIBILI).join(', ')}`,
    )
  }

  return {
    // La radice e la cartella delle entry: cosi l'HTML costruito finisce in
    // dist/<nome>.html e non in dist/src/entries/<nome>.html.
    root: cartellaEntry,

    // Base relativa: nulla nella pagina deve dipendere dal percorso in cui
    // il file viene aperto (i quattro HTML si aprono da file:// con doppio clic).
    base: './',

    // Nessuna cartella public: tutto cio che entra nel bundle passa da un import.
    publicDir: false,

    // La cache di Vite sta fuori dal progetto: la cartella di lavoro e condivisa
    // con altri agenti e node_modules non va toccato.
    cacheDir: path.join(os.tmpdir(), 'vite-cache-firma-digitale'),

    // Costanti di compilazione. `__NARRATED__` diventa letteralmente `true` o
    // `false` nel sorgente, quindi il ramo `if (__NARRATED__) { await import(...) }`
    // sparisce del tutto dalle varianti mute per eliminazione del codice morto:
    // il driver di narrazione e i blob audio non finiscono nel bundle.
    define: {
      __NARRATED__: JSON.stringify(narrated),
    },

    build: {
      outDir: cartellaOutput,
      // La pulizia la fa build-all.mjs: svuota dist/ una volta sola prima dei
      // quattro build e usa una cartella temporanea per ciascuno. Qui va
      // disattivata, o il secondo build cancellerebbe il primo (e Vite avverte
      // comunque perche dist/ sta fuori dalla radice src/entries/).
      emptyOutDir: false,
      target: 'es2022',
      cssCodeSplit: false,
      // Soglia altissima: ogni asset viene inlineato come data URI invece di
      // diventare un file affiancato. (Il plugin singlefile la alza comunque,
      // la dichiariamo esplicitamente perche e un requisito, non un effetto.)
      assetsInlineLimit: 100 * 1024 * 1024,
      assetsDir: '',
      chunkSizeWarningLimit: 100 * 1024 * 1024,
      reportCompressedSize: false,
      sourcemap: false,
      // Niente <link rel="modulepreload"> ne polyfill ne helper di preload:
      // sarebbero riferimenti esterni, e in un file unico non precaricano niente.
      modulePreload: false,
      rollupOptions: {
        input: path.join(cartellaEntry, fileEntry),
      },
    },

    // `removeViteModuleLoader` toglie il caricatore di moduli che Vite inietta
    // quando ci sono import dinamici. Su questo scaffold non cambia un byte, ma
    // e la stessa opzione usata dallo spike pdf.js (spikes/pdfjs/vite.config.mjs),
    // la cui ricetta la fase 5 dovra ricopiare: tenere le due configurazioni
    // allineate evita di scoprire una differenza di comportamento a bundle pieno.
    plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  }
})
