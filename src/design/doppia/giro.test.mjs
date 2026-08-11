// Le prove della direzione «Doppia esposizione».
//
// Girano in node senza DOM e senza browser, perche' il modulo sotto prova e' puro: e' proprio per
// poterle scrivere che `pianoDellaPila` e `centroDump` sono state tolte da app.js. Il caso che
// conta e' il quinto e il sesto — «Ricomincia» — dove la pagina teneva in vita i pannelli del giro
// precedente: era un bloccante trovato a mano, e da qui in poi e' un test che si rompe da solo.
//
// Cio' che queste prove NON possono vedere — il banco opaco, il pannello che finisce sotto il
// bordo, il fuoco da tastiera nascosto sotto la mobilia appesa — sta in
// scripts/anteprima/copioni/regressioni-doppia.json, che ha bisogno di un browser vero.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pianoDellaPila, centroDump } from './giro.js'

const DODICI = [
  'documento',
  'chiavi',
  'certificato',
  'placeholder',
  'impronta',
  'cms',
  'firma',
  'verifica',
  'attacco-cifra',
  'attacco-lettere',
  'attacco-coda',
  'chiusura',
]

/* ------------------------------------------------------------------ il piano della pila */

test('pagina appena caricata: niente in pila, niente da fare', () => {
  assert.deepEqual(pianoDellaPila([], []), { azzera: false, daAggiungere: [] })
})

test('un passo nuovo in coda: si aggiunge quello e basta', () => {
  const piano = pianoDellaPila(['documento'], ['documento', 'chiavi'])
  assert.deepEqual(piano, { azzera: false, daAggiungere: ['chiavi'] })
})

test('due passi arrivati in una notifica sola: si aggiungono nell ordine della storia', () => {
  const piano = pianoDellaPila(['documento'], ['documento', 'chiavi', 'certificato'])
  assert.deepEqual(piano, { azzera: false, daAggiungere: ['chiavi', 'certificato'] })
})

test('restoreSigned non tocca la storia: niente da aggiungere e SOPRATTUTTO niente da azzerare', () => {
  const piano = pianoDellaPila(DODICI, DODICI)
  assert.equal(piano.azzera, false, 'i pannelli degli attacchi devono restare in pagina')
  assert.deepEqual(piano.daAggiungere, [])
})

test('reset dopo i dodici passi: si azzera, e non si ridisegna niente', () => {
  const piano = pianoDellaPila(DODICI, [])
  assert.deepEqual(piano, { azzera: true, daAggiungere: [] })
})

test('reset e poi tre passi nuovi: si azzera E si ridisegnano i tre, non i dodici di prima', () => {
  const piano = pianoDellaPila(DODICI, ['documento', 'chiavi', 'certificato'])
  assert.equal(piano.azzera, true)
  assert.deepEqual(piano.daAggiungere, ['documento', 'chiavi', 'certificato'])
})

test('una storia divergente della stessa lunghezza si azzera: prefisso, non conteggio', () => {
  const piano = pianoDellaPila(['documento', 'chiavi'], ['documento', 'certificato'])
  assert.equal(piano.azzera, true)
  assert.deepEqual(piano.daAggiungere, ['documento', 'certificato'])
})

test('gli elenchi ricevuti non vengono toccati, e quello restituito non e un alias', () => {
  const disegnati = ['documento']
  const fatti = ['documento', 'chiavi']
  const piano = pianoDellaPila(disegnati, fatti)
  piano.daAggiungere.push('intruso')
  assert.deepEqual(disegnati, ['documento'])
  assert.deepEqual(fatti, ['documento', 'chiavi'])

  const azzerato = pianoDellaPila(DODICI, fatti)
  azzerato.daAggiungere.push('intruso')
  assert.deepEqual(fatti, ['documento', 'chiavi'])
})

/* ------------------------------------------------------------------ il centro del dump */

test('il punto indicato sulla carta vince su tutto il resto', () => {
  const stato = { evidenziazioni: [{ start: 900 }], contentsStart: 500 }
  assert.equal(centroDump(stato, { start: 42 }), 42)
})

test('senza punto indicato comanda la prima evidenziazione del passo', () => {
  const stato = { evidenziazioni: [{ start: 900 }, { start: 20 }], contentsStart: 500 }
  assert.equal(centroDump(stato, null), 900)
})

test('senza evidenziazioni si torna al buco della firma', () => {
  assert.equal(centroDump({ evidenziazioni: [], contentsStart: 500 }, null), 500)
})

test('niente di niente vuol dire «lascia il dump dov era», cioe null', () => {
  assert.equal(centroDump({ evidenziazioni: [], contentsStart: null }, null), null)
  assert.equal(centroDump({}, null), null)
})

test('offset zero e un centro valido, non un valore mancante', () => {
  assert.equal(centroDump({ evidenziazioni: [], contentsStart: 0 }, null), 0)
  assert.equal(centroDump({ evidenziazioni: [{ start: 0 }] }, null), 0)
})
