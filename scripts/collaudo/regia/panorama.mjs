/**
 * panorama.mjs — il corpus intero, passato ai tre verificatori in un colpo solo.
 *
 * Il collaudo si e svolto per famiglie, ognuna nella sua cartella. Questo script non attacca
 * niente: prende TUTTI i PDF che il collaudo ha depositato, ovunque stiano, e li fa giudicare
 * dagli stessi tre verificatori con lo stesso metro. Serve a due cose che nessuna famiglia
 * puo fare da sola:
 *
 *   1. la LINEA DI BASE del documento finale. Le tabelle di docs/vulnerabilita.md devono poter
 *      essere rigenerate da un comando solo, altrimenti fra un mese nessuno sapra piu se quei
 *      numeri erano veri;
 *   2. le DIVERGENZE, che si vedono solo guardando tutto insieme. Un file su cui noi diciamo
 *      `valid` e pdfsig «Not total document signed» e un rilievo; un file su cui noi contiamo
 *      due firme e pdfsig una sola e un rilievo; e nessuno dei due si nota leggendo una
 *      famiglia per volta.
 *
 *   node scripts/collaudo/regia/panorama.mjs             tutto il corpus
 *   node scripts/collaudo/regia/panorama.mjs --solo buco  solo una famiglia
 */

import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pareri } from '../comune/terzi.mjs'

const QUI = dirname(fileURLToPath(import.meta.url))
const COLLAUDO = join(QUI, '..')
const RADICE = join(QUI, '../../..')
const OUT = join(QUI, 'out')
mkdirSync(OUT, { recursive: true })

const filtro = process.argv.includes('--solo') ? process.argv[process.argv.indexOf('--solo') + 1] : null

/** Ogni PDF depositato da una qualunque famiglia del collaudo, in ordine di cartella e di nome. */
function corpus() {
  const trovati = []
  for (const famiglia of readdirSync(COLLAUDO).sort()) {
    if (famiglia === 'comune' || famiglia === 'regia') continue
    if (filtro && famiglia !== filtro) continue
    const cartella = join(COLLAUDO, famiglia, 'out')
    let voci
    try {
      voci = readdirSync(cartella).sort()
    } catch {
      continue // una famiglia senza out/: non ha depositato niente
    }
    for (const nome of voci) {
      if (!nome.endsWith('.pdf')) continue
      const percorso = join(cartella, nome)
      if (!statSync(percorso).isFile()) continue
      trovati.push({ famiglia, nome, percorso })
    }
  }
  return trovati
}

const file = corpus()
console.log(`${file.length} PDF nel corpus del collaudo\n`)

const righe = []
for (const { famiglia, nome, percorso } of file) {
  let p
  try {
    p = await pareri(percorso)
  } catch (problema) {
    righe.push({ famiglia, nome, errore: String(problema?.message ?? problema) })
    console.log(`${famiglia}/${nome}: ERRORE ${problema?.message ?? problema}`)
    continue
  }

  const riga = {
    famiglia,
    nome,
    file: relative(RADICE, percorso),
    lunghezza: p.lunghezza,
    nostro: p.nostro.verdetto,
    nostroFirme: p.nostro.firme,
    nostroCompleta: p.nostro.copertura?.complete ?? null,
    nostroGap: p.nostro.copertura?.gapMatchesContents ?? null,
    nostroCoda: p.nostro.copertura?.uncoveredTail ?? null,
    nostroDigest: p.nostro.digest?.match ?? null,
    nostroRsa: p.nostro.firma ?? null,
    nostroReason: p.nostro.reason,
    nostroCN: p.nostro.identita?.subjectCN ?? null,
    nostroImpronta: p.nostro.identita?.fingerprint?.slice(0, 16) ?? null,
    pdfsigFirme: p.pdfsig.quante,
    pdfsigValidazione: p.pdfsig.firme[0]?.validazione ?? null,
    pdfsigCopreTutto: p.pdfsig.copreTutto,
    pdfsigIntervalli: p.pdfsig.intervalli.join(' | ') || null,
    opensslPrima: p.openssl.firme[0]?.verifica ?? null,
    opensslSintesi: p.openssl.sintesi,
    certScaduto: p.openssl.firme[0]?.certificato?.scadutoAdesso ?? null,
    certKeyUsage: p.openssl.firme[0]?.certificato?.keyUsage ?? null,
    certBasicConstraints: p.openssl.firme[0]?.certificato?.basicConstraints ?? null,
    lettoreApre: p.lettore.apre,
    lettoreImporto: p.lettore.importo,
    divergenze: p.divergenze,
  }
  righe.push(riga)

  console.log(
    [
      `${famiglia}/${nome}`.padEnd(52),
      String(riga.nostro).padEnd(9),
      `pdfsig=${riga.pdfsigFirme}f/${riga.pdfsigCopreTutto === null ? '?' : riga.pdfsigCopreTutto ? 'tot' : 'NON'}`.padEnd(14),
      `openssl=${riga.opensslPrima === null ? '?' : riga.opensslPrima ? 'ok' : 'NO'}`.padEnd(12),
      riga.divergenze.length ? `DIVERGE(${riga.divergenze.length})` : '',
    ].join(' '),
  )
}

// Il nome porta il filtro: un giro parziale non deve cancellare il panorama intero.
const rapporto = join(OUT, filtro ? `panorama-${filtro}.json` : 'panorama.json')
writeFileSync(rapporto, JSON.stringify(righe, null, 2))

/* --- Le divergenze, raccolte -------------------------------------------------------------- */

const conDivergenza = righe.filter((r) => (r.divergenze?.length ?? 0) > 0)
console.log(`\n${conDivergenza.length} file su ${righe.length} su cui i verificatori NON dicono la stessa cosa:\n`)
for (const r of conDivergenza) {
  for (const d of r.divergenze) {
    console.log(
      `  ${r.famiglia}/${r.nome}`.padEnd(54) +
        `«${d.su}»  nostro=${d.nostro}  ` +
        (d.pdfsig !== undefined ? `pdfsig=${d.pdfsig}` : `openssl=${d.openssl}`),
    )
  }
}

/* --- I file su cui l'attacco ha ottenuto qualcosa ------------------------------------------ */

const passati = righe.filter((r) => r.nostro === 'valid')
console.log(`\n${passati.length} file che il NOSTRO verificatore giudica ancora «valid»:`)
for (const r of passati) console.log(`  ${r.famiglia}/${r.nome}  (${r.lunghezza} byte, legge «${r.lettoreImporto}»)`)

const bugiardi = righe.filter((r) => r.lettoreImporto && !/mille/i.test(r.lettoreImporto) && r.nostro === 'valid')
if (bugiardi.length > 0) {
  console.log(`\nATTENZIONE — file «valid» che a un lettore umano dicono un importo DIVERSO dall'originale:`)
  for (const r of bugiardi) console.log(`  ${r.famiglia}/${r.nome}: «${r.lettoreImporto}»`)
}

console.log(`\nrapporto: ${rapporto}`)
