// Gli identificatori della demo, in un posto solo.
//
// Forma fissata da docs/contratti-ui.md:
//   STEP_IDS   i dodici passi, nell'ordine della tabella dei passi
//   PANEL_IDS  STEP_IDS più i tre pannelli teorici
//
// Perché un modulo a sé: `copy.it.js` (che cosa si legge) e `script.it.js` (che cosa si
// sente) hanno bisogno dello stesso elenco chiuso, e finché lo ridichiaravano ognuno per
// conto proprio erano due sorgenti di verità per la stessa cosa. Basta che qualcuno
// riordini un passo in un file solo perché la narrazione apra il pannello sbagliato: un
// disallineamento che nessun test locale al singolo file può vedere.
//
// Qui non ci sono testi: solo nomi. I testi stanno in copy.it.js e script.it.js.
// L'ordine è quello della demo e conta: le viste ci si appoggiano per sapere che cosa
// viene prima e che cosa viene dopo.

/** I dodici passi della demo, nell'ordine della tabella di docs/contratti-ui.md. */
export const STEP_IDS = [
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

/**
 * Gli identificatori dei pannelli: i dodici passi più i tre pannelli teorici, che non hanno
 * un passo narrato e si aprono a richiesta. Elenco chiuso: nessuno in più, nessuno in meno.
 */
export const PANEL_IDS = [
  ...STEP_IDS,
  'teoria-certificato',
  'teoria-scansionata',
  'teoria-eidas',
]
