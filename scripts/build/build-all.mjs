#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Costruisce i quattro HTML autoconsistenti, uno per combinazione.
//
//   dist/protocollo.html                    direzione A, muta
//   dist/protocollo-narrato.html            direzione A, narrata
//   dist/doppia-esposizione.html            direzione C, muta
//   dist/doppia-esposizione-narrata.html    direzione C, narrata
//
// Perche quattro build separati e non quattro entry in uno solo:
// vite-plugin-singlefile deve inlineare ogni chunk dentro un unico HTML, quindi
// impone `codeSplitting: false` (`inlineDynamicImports` prima di Vite 8). Con
// piu di una entry nello stesso build quella opzione e illegale e il build
// fallisce. Le due sorgenti restano due; la narrazione resta una variante di
// build. Il costo e solo tempo di macchina.
//
// Ogni build gira in un processo Node separato: cosi la configurazione viene
// rivalutata da zero e le variabili d'ambiente non si trascinano fra un build
// e l'altro. E ogni build scrive in una cartella temporanea propria, perche
// Vite nomina l'HTML come la sorgente: le due varianti di «protocollo» si
// chiamerebbero entrambe protocollo.html e la seconda cancellerebbe la prima
// prima ancora di essere rinominata.
//
// Lo script e idempotente: dist/ viene svuotata prima di cominciare e alla fine
// deve contenere esattamente i quattro file. Il controllo di autoconsistenza
// parte in coda e fa uscire il processo con codice non zero se qualcosa non torna.
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const qui = path.dirname(fileURLToPath(import.meta.url))
const radiceProgetto = path.resolve(qui, '..', '..')
const cartellaDist = path.join(radiceProgetto, 'dist')
const viteBin = path.join(radiceProgetto, 'node_modules', 'vite', 'bin', 'vite.js')
const controllo = path.join(qui, 'check-selfcontained.mjs')

/** Le quattro combinazioni. `entry` e la sorgente, `output` il nome finale. */
const VARIANTI = [
  { entry: 'protocollo', narrated: false, output: 'protocollo.html' },
  { entry: 'protocollo', narrated: true, output: 'protocollo-narrato.html' },
  { entry: 'doppia-esposizione', narrated: false, output: 'doppia-esposizione.html' },
  { entry: 'doppia-esposizione', narrated: true, output: 'doppia-esposizione-narrata.html' },
]

function principale() {
  if (!fs.existsSync(viteBin)) {
    errore(`Vite non trovato in ${viteBin}. Le dipendenze devono essere gia installate.`)
  }

  // Pulizia: senza questa il build non sarebbe idempotente e un file avanzato da
  // una versione precedente passerebbe inosservato.
  fs.rmSync(cartellaDist, { recursive: true, force: true })
  fs.mkdirSync(cartellaDist, { recursive: true })

  for (const variante of VARIANTI) {
    const etichetta = variante.narrated ? 'narrata' : 'muta'
    console.log(`\n=== Build: ${variante.entry} — versione ${etichetta} ===`)

    const cartellaTemporanea = fs.mkdtempSync(path.join(os.tmpdir(), 'firma-build-'))
    try {
      execFileSync(process.execPath, [viteBin, 'build'], {
        cwd: radiceProgetto,
        stdio: 'inherit',
        env: {
          ...process.env,
          ENTRY: variante.entry,
          NARRATED: variante.narrated ? '1' : '0',
          OUT_DIR: cartellaTemporanea,
        },
      })

      // Vite nomina l'HTML come la sorgente, perche la radice del build e
      // src/entries/. Dalla cartella temporanea deve uscire quel file e nient'altro:
      // se ne trovassimo altri, l'inlining non sarebbe completo.
      const prodotti = fs.readdirSync(cartellaTemporanea)
      const atteso = `${variante.entry}.html`
      if (!prodotti.includes(atteso)) {
        errore(`Il build non ha prodotto ${atteso} (trovati: ${prodotti.join(', ') || 'niente'}).`)
      }
      if (prodotti.length !== 1) {
        errore(
          `Il build ha prodotto file affiancati oltre a ${atteso}: ` +
            `${prodotti.filter((f) => f !== atteso).join(', ')}. L'inlining non e completo.`,
        )
      }

      fs.copyFileSync(path.join(cartellaTemporanea, atteso), path.join(cartellaDist, variante.output))
    } finally {
      fs.rmSync(cartellaTemporanea, { recursive: true, force: true })
    }
    console.log(`--> dist/${variante.output}`)
  }

  console.log('\n=== Controllo di autoconsistenza ===')
  execFileSync(process.execPath, [controllo], { cwd: radiceProgetto, stdio: 'inherit' })
}

function errore(messaggio) {
  console.error(`\nERRORE: ${messaggio}`)
  process.exit(1)
}

try {
  principale()
} catch (e) {
  // execFileSync con stdio 'inherit' ha gia stampato l'output del comando fallito.
  if (e && typeof e.status === 'number') process.exit(e.status || 1)
  errore(e?.message ?? String(e))
}
