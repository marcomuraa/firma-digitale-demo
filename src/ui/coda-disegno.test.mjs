/**
 * Prove della coda di disegno.
 *
 * Provano in node cio' che in Chrome era costato una schermata falsa: due richieste partite
 * nello stesso tick sullo stesso canvas, e due rendering che si sovrappongono e si scambiano
 * gli avvisi. Il canvas qui e' un oggetto qualunque — alla coda serve solo come chiave — ed e'
 * per questo che src/ui/coda-disegno.js e' un modulo separato da src/ui/pdf-render.js: quello
 * trascina 1,6 MB di pdf.js e non si puo' importare qui.
 *
 * Si esegue con:  npm test        (node --test dalla radice; `node --test <cartella>` no)
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { creaCodaDiDisegno } from './coda-disegno.js'

/** Un canvas finto: alla coda serve solo un oggetto da usare come chiave. */
function canvasFinto(nome) {
  return { nome }
}

const respiro = () => new Promise((ok) => setTimeout(ok, 0))

test('due richieste nello stesso tick sullo stesso canvas: la prima si accorge di essere superata', async () => {
  const coda = creaCodaDiDisegno()
  const canvas = canvasFinto('uno')
  const visto = []

  // Nessun await fra le due: e' esattamente la finestra in cui il guasto viveva.
  const primo = coda.prenota(canvas, async (gettone) => {
    visto.push(['primo', gettone.annullato])
    return 'primo'
  })
  const secondo = coda.prenota(canvas, async (gettone) => {
    visto.push(['secondo', gettone.annullato])
    return 'secondo'
  })

  assert.deepEqual(await Promise.all([primo, secondo]), ['primo', 'secondo'])
  assert.deepEqual(visto, [
    ['primo', true],
    ['secondo', false],
  ])
})

test('vince il piu recente: e l ultimo prenotato a disegnare per ultimo', async () => {
  const coda = creaCodaDiDisegno()
  const canvas = canvasFinto('uno')
  let schermo = 'vuoto'

  const lavori = ['a', 'b', 'c'].map((nome) =>
    coda.prenota(canvas, async (gettone) => {
      if (gettone.annullato) return null // superato: non tocca lo schermo
      await respiro()
      schermo = nome
      return nome
    }),
  )

  assert.deepEqual(await Promise.all(lavori), [null, null, 'c'])
  assert.equal(schermo, 'c', 'sullo schermo resta cio che e stato chiesto per ultimo')
})

test('un lavoro per volta, anche su canvas diversi: e cio che rende veri gli avvisi', async () => {
  const coda = creaCodaDiDisegno()
  let dentro = 0
  let massimo = 0
  const ordine = []

  const lavoro = (nome) => async () => {
    dentro += 1
    massimo = Math.max(massimo, dentro)
    ordine.push(`${nome} entra`)
    await respiro()
    await respiro()
    ordine.push(`${nome} esce`)
    dentro -= 1
    return nome
  }

  await Promise.all([
    coda.prenota(canvasFinto('a'), lavoro('a')),
    coda.prenota(canvasFinto('b'), lavoro('b')),
    coda.prenota(canvasFinto('c'), lavoro('c')),
  ])

  assert.equal(massimo, 1, 'due lavori insieme si copierebbero gli avvisi a vicenda')
  assert.deepEqual(ordine, ['a entra', 'a esce', 'b entra', 'b esce', 'c entra', 'c esce'])
})

test('canvas diversi non si annullano a vicenda', async () => {
  const coda = creaCodaDiDisegno()
  const annullati = []

  const a = coda.prenota(canvasFinto('a'), async (gettone) => {
    await respiro()
    annullati.push(['a', gettone.annullato])
    return 'a'
  })
  const b = coda.prenota(canvasFinto('b'), async (gettone) => {
    annullati.push(['b', gettone.annullato])
    return 'b'
  })

  await Promise.all([a, b])
  assert.deepEqual(annullati, [
    ['a', false],
    ['b', false],
  ])
})

test('una richiesta piu recente interrompe il lavoro gia in corso sullo stesso canvas', async () => {
  const coda = creaCodaDiDisegno()
  const canvas = canvasFinto('uno')
  let interruzioni = 0

  const primo = coda.prenota(canvas, async (gettone) => {
    // Il lavoro lungo registra come lo si interrompe, come fa pdf.js con renderTask.cancel.
    let fermo = null
    gettone.annulla = () => {
      interruzioni += 1
      fermo?.()
    }
    await new Promise((ok) => {
      fermo = ok
      setTimeout(ok, 5_000)
    })
    return gettone.annullato ? 'interrotto' : 'finito'
  })

  await respiro() // il primo e gia' partito: siamo dentro il suo await
  const secondo = coda.prenota(canvas, async (gettone) => (gettone.annullato ? 'superato' : 'ok'))

  assert.equal(await primo, 'interrotto')
  assert.equal(interruzioni, 1, 'annulla() viene chiamata una volta sola')
  assert.equal(await secondo, 'ok')
})

test('annulla() che lancia non fa saltare la prenotazione che l ha chiamata', async () => {
  const coda = creaCodaDiDisegno()
  const canvas = canvasFinto('uno')

  const primo = coda.prenota(canvas, async (gettone) => {
    gettone.annulla = () => {
      throw new Error('era gia finito')
    }
    await respiro()
    return 'primo'
  })
  await respiro()
  const secondo = coda.prenota(canvas, async () => 'secondo')

  assert.deepEqual(await Promise.all([primo, secondo]), ['primo', 'secondo'])
})

test('un lavoro che lancia non spezza la fila: quello dopo parte lo stesso', async () => {
  const coda = creaCodaDiDisegno()
  const scoppiato = coda.prenota(canvasFinto('a'), async () => {
    throw new Error('scoppiato')
  })
  const dopo = coda.prenota(canvasFinto('b'), async () => 'dopo')

  await assert.rejects(scoppiato, /scoppiato/)
  assert.equal(await dopo, 'dopo')

  // E la coda continua a funzionare anche dopo, non solo per il lavoro immediatamente seguente.
  assert.equal(await coda.prenota(canvasFinto('c'), async () => 'ancora'), 'ancora')
})

test('a lavoro finito il canvas torna libero: la richiesta dopo non risulta superata', async () => {
  const coda = creaCodaDiDisegno()
  const canvas = canvasFinto('uno')

  assert.equal(await coda.prenota(canvas, async (g) => g.annullato), false)
  assert.equal(
    await coda.prenota(canvas, async (g) => g.annullato),
    false,
    'la prenotazione precedente era finita: non deve annullare la nuova',
  )
})

test('due code sono due turni diversi: se ne fa una sola per pagina', async () => {
  const primaCoda = creaCodaDiDisegno()
  const secondaCoda = creaCodaDiDisegno()
  let dentro = 0
  let massimo = 0

  const lavoro = async () => {
    dentro += 1
    massimo = Math.max(massimo, dentro)
    await respiro()
    dentro -= 1
  }

  await Promise.all([
    primaCoda.prenota(canvasFinto('a'), lavoro),
    secondaCoda.prenota(canvasFinto('b'), lavoro),
  ])
  assert.equal(massimo, 2, 'e la ragione per cui pdf-render.js ne costruisce una sola')
})
