// Come si scrivono i numeri e i byte in questa pagina.
//
// Un solo posto, perche' due formattazioni diverse dello stesso valore sembrano due valori
// diversi: 10741 e 10.741 messi in due pannelli vicini fanno dubitare chi guarda.

const LOCALE = 'it-IT'

/** 10741 -> "10.741". Il separatore delle migliaia serve: si legge da tre metri. */
export function numero(valore) {
  if (!Number.isFinite(valore)) return '—'
  return valore.toLocaleString(LOCALE)
}

/** 10741 -> "10.741 byte", con il singolare giusto. */
export function byte(valore) {
  if (!Number.isFinite(valore)) return '—'
  return `${numero(valore)} ${valore === 1 ? 'byte' : 'byte'}`
}

/** Una data leggibile: giorno e ora, perche' signingTime senza ora non dimostra niente. */
export function quando(valore) {
  if (!(valore instanceof Date) || Number.isNaN(valore.getTime())) return '—'
  return valore.toLocaleString(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * Un'impronta esadecimale spezzata in gruppi di quattro caratteri.
 * Sessantaquattro caratteri di fila non si confrontano a occhio; a gruppi si.
 */
export function gruppi(hex, ampiezza = 4) {
  if (typeof hex !== 'string' || hex.length === 0) return '—'
  return hex.match(new RegExp(`.{1,${ampiezza}}`, 'g')).join(' ')
}

/** I gruppi come array, per poterli confrontare uno a uno fra impronta attesa e ricalcolata. */
export function gruppiArray(hex, ampiezza = 4) {
  if (typeof hex !== 'string' || hex.length === 0) return []
  return hex.match(new RegExp(`.{1,${ampiezza}}`, 'g')) ?? []
}

/** I primi byte di un blocco binario, in esadecimale, con i puntini se ne restano. */
export function anteprimaByte(bytes, quanti = 16) {
  if (!bytes || typeof bytes.length !== 'number' || bytes.length === 0) return '—'
  const testa = Array.from(bytes.slice(0, quanti), (b) => b.toString(16).padStart(2, '0')).join(' ')
  return bytes.length > quanti ? `${testa} …` : testa
}

/** Il testo ASCII di un tratto di file. I byte non stampabili diventano un punto medio. */
export function testoDeiByte(bytes, start, end) {
  if (!bytes || typeof bytes.length !== 'number') return ''
  const da = Math.max(0, Math.min(start | 0, bytes.length))
  const a = Math.max(da, Math.min(end | 0, bytes.length))
  let fuori = ''
  for (let i = da; i < a; i++) {
    const b = bytes[i]
    fuori += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '·'
  }
  return fuori
}

/** L'etichetta dei byte correnti, detta in italiano invece che con l'identificatore. */
const ETICHETTE = {
  originale: 'originale',
  'con-placeholder': 'con il buco /Contents',
  firmato: 'firmato',
  'manomesso-cifra': 'manomesso nella cifra',
  'manomesso-lettere': 'manomesso nelle lettere',
  'esteso-in-coda': 'esteso in coda',
}

export function etichetta(valore) {
  return ETICHETTE[valore] ?? valore ?? '—'
}

/** I nomi brevi dei dodici passi: sono etichette di comandi, non testo di contenuto. */
export const NOMI_PASSI = {
  documento: 'Documento',
  chiavi: 'Chiavi',
  certificato: 'Certificato',
  placeholder: 'Placeholder',
  impronta: 'Impronta',
  cms: 'CMS',
  firma: 'Firma',
  verifica: 'Verifica',
  'attacco-cifra': 'Attacco 1a',
  'attacco-lettere': 'Attacco 1b',
  'attacco-coda': 'Attacco 2',
  chiusura: 'Chiusura',
}

/** Le tre parole del verdetto. Accanto al colore e alla forma, mai da sole. */
export const PAROLE_VERDETTO = {
  valid: 'Valida e completa',
  extended: 'Firma valida, documento esteso dopo la firma',
  invalid: 'Non valida',
}

/** Versione corta, per la fascia in cima dove non c'e' spazio per una frase. */
export const PAROLE_VERDETTO_CORTE = {
  valid: 'Valida',
  extended: 'Estesa dopo la firma',
  invalid: 'Non valida',
}

/** Il numero d'ordine di un passo, a due cifre: i dodici passi sono una sequenza vera. */
export function ordinale(indice) {
  return String(indice + 1).padStart(2, '0')
}
