// La meta' chiara del banco: il documento come lo vede un umano, e i punti che si possono
// indicare per accendere i byte corrispondenti nella meta' scura.
//
// IL LEGAME FRA LE DUE META' E' QUI. Gli offset non si stimano: arrivano da
// src/assets/sample-offsets.json, congelati e verificati sui byte veri.
//
// L'unico caso in cui vanno spostati e' l'attacco 1b, che inserisce tre byte a offset 589 —
// cioe' in mezzo al documento — e spinge in avanti tutto cio' che viene dopo. La regola e'
// `x <= inserzione ? x : x + delta` e NON quella che usa la macchina per le sezioni
// (`x >= inserzione ? x + delta : x`): le due differiscono esattamente sul confine, e li'
// sta il tratto che l'attacco riscrive. Con la regola delle sezioni l'ancora delle lettere
// partirebbe tre byte dopo l'inizio della parola nuova.
// Controprova sui numeri misurati: «mille» sta in [589, 594), «novemila» e' lungo 8, quindi
// dopo l'attacco il tratto e' [589, 597) — ed e' esattamente l'evidenziazione `lettere-cambiate`
// che la macchina calcola per conto suo.

import offsets from '../../assets/sample-offsets.json' with { type: 'json' }
import { renderPdfToCanvas } from '../../ui/pdf-render.js'
import { el, bottone } from './dom.js'
import { etichetta as etichettaDetta, numero, testoDeiByte } from './formato.js'

const ancoraDi = (id) => offsets.anchors.find((a) => a.id === id)

/**
 * La scala a cui pdf.js rasterizza la pagina. Non e' l'1,5 dello spike: con la lente accesa il
 * ritaglio della riga dell'importo viene mostrato a circa tre volte, e a 1,5 sarebbe un
 * ingrandimento di pixel invece che di lettere. A 2,6 il ritaglio arriva a schermo circa uno a
 * uno sul proiettore, e la pagina intera ci arriva rimpicciolita, che e' il verso buono.
 */
const SCALA_DISEGNO = 2.6

/** Gli stati in cui i byte non sono piu' quelli firmati: e' li' che la lente serve. */
const BYTE_MANOMESSI = new Set(['manomesso-cifra', 'manomesso-lettere', 'esteso-in-coda'])

/**
 * I punti indicabili. `mostraTesto` distingue cio' che si legge (l'importo) da cio' che e'
 * geometria o testo lungo, dove il conteggio dei byte dice di piu' di un'anteprima.
 */
const PUNTI = [
  { id: 'ind-cifre', nome: 'Importo in cifre', start: offsets.amount.digitsStart, end: offsets.amount.digitsEnd, mostraTesto: true, sullaRiga: true },
  { id: 'ind-lettere', nome: 'Importo in lettere', start: offsets.amount.wordsStart, end: offsets.amount.wordsEnd, mostraTesto: true, sullaRiga: true },
  { id: 'ind-riga', nome: 'Riga dell’importo', start: offsets.amount.lineStart, end: offsets.amount.lineEnd, mostraTesto: false, sullaRiga: true },
  { id: 'ind-titolo', nome: 'Titolo', start: ancoraDi('title').start, end: ancoraDi('title').end, mostraTesto: false },
  { id: 'ind-marcatura', nome: 'Marcatura legale', start: ancoraDi('disclaimer').start, end: ancoraDi('disclaimer').end, mostraTesto: false },
  { id: 'ind-firma', nome: 'Firma autografa', start: offsets.signatureDrawing.start, end: offsets.signatureDrawing.end, mostraTesto: false },
]

/**
 * @param {object} opzioni
 * @param {(punto: ?object) => void} opzioni.alIndicare  il punto acceso, o null per spegnere
 * @param {() => void} [opzioni.alDisegno]  chiamata quando pdf.js ha finito: gli avvisi del
 *   lettore arrivano solo allora, e chi li mostra deve poterli rileggere
 */
export function creaDocumento({ alIndicare, alDisegno = () => {} }) {
  const tela = el('canvas', { classe: 'documento__tela', dati: { canvasPdf: true } })
  const cornice = el('div', { classe: 'documento__cornice', dati: { vista: 'intera' } }, tela)
  const stato = el('p', { classe: 'documento__stato', role: 'status' })
  const figura = el('figure', { classe: 'documento' }, [
    cornice,
    el('figcaption', { classe: 'documento__didascalia' }, stato),
  ])

  const chip = new Map()
  const elenco = el('div', { classe: 'punti__elenco' })
  const nota = el('p', { classe: 'punti__nota' })
  const punti = el('div', { classe: 'punti' }, [
    el('h3', { classe: 'punti__titolo', testo: 'Indica un punto del documento' }),
    elenco,
    nota,
  ])

  let acceso = null
  let ultimaChiave = null
  let generazione = 0
  let avvisiUltimoDisegno = []
  let ritaglio = null

  for (const punto of PUNTI) {
    const b = bottone('', {
      classe: 'chip',
      'aria-pressed': 'false',
      dati: { punto: punto.id },
    })
    b.append(
      el('span', { classe: 'chip__nome', testo: punto.nome }),
      el('span', { classe: 'chip__valore' }),
    )
    b.addEventListener('click', () => {
      acceso = acceso === punto.id ? null : punto.id
      sincronizza()
      aggiornaVista()
      alIndicare(acceso ? tratto(PUNTI.find((p) => p.id === acceso), ultimoStato) : null)
    })
    chip.set(punto.id, b)
    elenco.append(b)
  }

  let ultimoStato = null

  function sincronizza() {
    for (const [id, b] of chip) b.setAttribute('aria-pressed', id === acceso ? 'true' : 'false')
  }

  const nodo = el('div', { classe: 'banco__documento' }, [figura, punti])

  return {
    nodo,
    /** Il tratto acceso adesso, gia' nella forma che buildHexWindow accetta. */
    get indicato() {
      if (!acceso || !ultimoStato) return null
      return tratto(
        PUNTI.find((p) => p.id === acceso),
        ultimoStato,
      )
    },
    aggiorna(s) {
      ultimoStato = s
      aggiornaPunti(s)
      aggiornaTela(s)
      aggiornaVista()
    },
    /**
     * Ricominciare: si spegne il punto indicato, si dimentica il disegno di prima e si scarta un
     * disegno ancora in volo. Quel `generazione` in piu' non e' prudenza: `reset()` funziona
     * anche a passo in corso, e senza di lui il pdf.js del giro vecchio avrebbe disegnato la sua
     * pagina sulla tela del giro nuovo, con la lente tarata su un ritaglio che non c'e' piu'.
     */
    azzera() {
      acceso = null
      sincronizza()
      generazione += 1
      avvisiUltimoDisegno = []
      ritaglio = null
      ultimaChiave = null
      ultimoStato = null
      aggiornaVista()
    },
    get avvisi() {
      return avvisiUltimoDisegno
    },
  }

  /* ---------------------------------------------------------------- i punti */

  function aggiornaPunti(s) {
    const bytes = s.documento?.bytes ?? null
    for (const punto of PUNTI) {
      const b = chip.get(punto.id)
      const t = tratto(punto, s)
      const valore = b.querySelector('.chip__valore')
      if (!bytes) {
        valore.textContent = '—'
        b.disabled = true
        continue
      }
      b.disabled = false
      valore.textContent = punto.mostraTesto
        ? `«${testoDeiByte(bytes, t.start, t.end)}»`
        : `${numero(t.end - t.start)} B`
      b.title = `byte ${numero(t.start)}–${numero(t.end - 1)}`
    }

    // Dopo l'attacco 2 il lettore mostra la revisione appesa, mentre questi byte — quelli
    // coperti dalla firma — sono rimasti quelli di prima. E' il cuore dell'attacco, e va detto
    // esattamente dove si indicano i byte.
    if (bytes && s.documento?.etichetta === 'esteso-in-coda') {
      const t = tratto(PUNTI[2], s)
      nota.textContent =
        `Il lettore disegna la revisione appesa in coda. Questi byte, coperti dalla firma, ` +
        `dicono ancora «${dentroLaParentesi(testoDeiByte(bytes, t.start, t.end))}».`
      nota.hidden = false
    } else {
      nota.textContent = ''
      nota.hidden = true
    }
  }

  /* ---------------------------------------------------------------- la tela */

  function aggiornaTela(s) {
    if (!s.documento) {
      stato.textContent = 'Nessun documento: si apre al primo passo.'
      figura.dataset.stato = 'vuoto'
      ultimaChiave = null
      ritaglio = null
      return
    }
    const chiave = `${s.documento.etichetta}:${s.documento.lunghezza}:${s.ripristinato ? 'r' : ''}`
    if (chiave === ultimaChiave) return
    ultimaChiave = chiave
    figura.dataset.stato = 'disegno'
    stato.textContent = didascalia(s)

    const mio = ++generazione
    // Due chiamate di fila senza await in mezzo sono lecite: vince la piu' recente, e chi e'
    // stato superato lo dice con `annullato: true` invece di sembrare un guasto.
    renderPdfToCanvas(s.documento.bytes, tela, { scale: SCALA_DISEGNO }).then((esito) => {
      if (mio !== generazione) return
      avvisiUltimoDisegno = esito.avvisi ?? []
      if (esito.ok) {
        figura.dataset.stato = 'disegnato'
        // Il ritaglio si misura sui pixel appena disegnati, non sui precedenti: dopo l'attacco
        // 1b la riga e' piu' lunga di tre lettere e la lente deve allargarsi con lei.
        ritaglio = misuraRitaglio(tela, s.documento.bytes)
        aggiornaVista()
        alDisegno()
        return
      }
      if (esito.annullato) return // superato da un disegno piu' recente: non e' un guasto
      figura.dataset.stato = 'guasto'
      ritaglio = null
      cornice.dataset.vista = 'intera'
      stato.textContent = esito.error ?? 'Il documento non si e potuto disegnare.'
      alDisegno()
    })
  }

  /** Che cosa si sta guardando: quali byte, quanti, e se la lente e' accesa. */
  function didascalia(s) {
    if (!s?.documento) return 'Nessun documento: si apre al primo passo.'
    const pezzi = [`${etichettaDetta(s.documento.etichetta)} · ${numero(s.documento.lunghezza)} byte`]
    if (avvisiUltimoDisegno.length > 0) pezzi.push('il lettore ha dovuto riparare il file')
    if (lenteAccesa(s) && ritaglio) pezzi.push('riga dell’importo, ingrandita')
    return pezzi.join(' · ')
  }

  /**
   * Quando la lente si accende.
   *
   * IL PERCHE'. La meta' umana della doppia esposizione, disegnata per intero, ha inchiostro
   * alto 8 px a 1920 in presentazione e 4 px con il dump aperto — cioe' proprio durante i tre
   * attacchi, quando la battuta e' «guarda che il documento e' cambiato». Misurato sui pixel,
   * non stimato. E ingrandire la pagina intera non basta: perche' il corpo 15 di questo PDF
   * arrivi a 16 px servirebbe una tela alta 1350 px, che su uno schermo condiviso con il
   * righello, i comandi e la lettura macchina non c'e' e non ci sara' mai.
   *
   * Allora la carta fa quello che la lastra fa da sempre: apre una FINESTRA sul punto che conta
   * invece di mostrare tutto piccolo. Il dump non mostra 10.273 byte, ne mostra 256 attorno
   * all'evidenziazione; la carta non mostra tutta la pagina, mostra la riga dell'importo. E' la
   * stessa mossa sui due lati della spaccatura, ed e' per questo che appartiene a questa
   * direzione invece di essere una toppa.
   *
   * QUANDO. Dal verdetto in poi — cioe' da quando esiste qualcosa da confrontare — e in tutti
   * gli stati manomessi. Il confronto e' il motivo per cui la lente esiste, e un confronto ha
   * due termini: se il «prima» resta illeggibile, il «dopo» leggibile non dimostra niente. Nei
   * sette passi che precedono il verdetto la lente resta spenta, perche' li' il soggetto e' la
   * pagina intera — il documento, il suo testo e i suoi byte.
   *
   * Un punto indicato ha sempre l'ultima parola: sui tre che stanno sulla riga dell'importo la
   * accende, sugli altri tre — titolo, marcatura, firma autografa — la spegne, perche' li' la
   * domanda e' DOVE stanno quei byte e la risposta e' la mappa, non il dettaglio. E' anche la
   * via d'uscita dalla lente, senza aggiungere nessun comando.
   */
  function lenteAccesa(s) {
    const punto = acceso ? PUNTI.find((p) => p.id === acceso) : null
    if (punto) return punto.sullaRiga === true
    return BYTE_MANOMESSI.has(s?.documento?.etichetta) || Boolean(s?.verifica)
  }

  function aggiornaVista() {
    const accesa = lenteAccesa(ultimoStato) && ritaglio !== null
    cornice.dataset.vista = accesa ? 'dettaglio' : 'intera'
    if (figura.dataset.stato === 'disegnato') stato.textContent = didascalia(ultimoStato)
    if (!accesa) return
    const { x, y, larghezza, altezza, pagina } = ritaglio
    cornice.style.setProperty('--ritaglio-rapporto', String(larghezza / altezza))
    cornice.style.setProperty('--ritaglio-zoom-x', String(pagina.larghezza / larghezza))
    cornice.style.setProperty('--ritaglio-zoom-y', String(pagina.altezza / altezza))
    cornice.style.setProperty('--ritaglio-x', String(x / larghezza))
    cornice.style.setProperty('--ritaglio-y', String(y / altezza))
  }
}

/* ================================================================== la lente */

/**
 * Dove sta, sulla PAGINA, la riga dell'importo. Non si stima: si legge negli operatori che la
 * disegnano, subito prima dei byte congelati in `sample-offsets.json`. Il content stream del
 * campione e' ASCII per costruzione e dice, per esteso:
 *
 *     BT  /F1 15 Tf  110 636 Td  (1.000 euro (mille euro)) Tj  ET
 *
 * cioe' corpo 15, linea di base a (110, 636) in coordinate della pagina, origine in basso a
 * sinistra. I byte fra `contentStream.dataStart` e `amount.lineStart` sono identici in OGNI
 * stato della demo, ed e' per questo che la lettura vale sempre: il placeholder e l'attacco 2
 * appendono in coda, l'attacco 1a non cambia la lunghezza, l'attacco 1b inserisce a 589 —
 * dopo — e l'incremental update dell'attacco 2 riscrive soltanto il letterale fra parentesi
 * (src/core/attacks.js), lasciando `Td` e `Tf` dov'erano.
 *
 * Se qualcosa non torna si restituisce `null` e la lente semplicemente non si accende: una
 * pagina intera e' un ripiego onesto, un ritaglio nel punto sbagliato no.
 */
function posizioneRigaImporto(bytes) {
  const da = offsets.contentStream.dataStart
  const a = offsets.amount.lineStart
  if (!(bytes instanceof Uint8Array) || bytes.length <= a || a <= da) return null
  let testa = ''
  for (let i = da; i < a; i++) testa += String.fromCharCode(bytes[i])
  const td = [...testa.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Td\b/g)].pop()
  const tf = [...testa.matchAll(/\/[A-Za-z0-9]+\s+(\d+(?:\.\d+)?)\s+Tf\b/g)].pop()
  if (!td || !tf) return null
  const x = Number(td[1])
  const y = Number(td[2])
  const corpo = Number(tf[1])
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(corpo > 0)) return null
  return { x, y, corpo }
}

/**
 * Il rettangolo da ingrandire, in coordinate della pagina con l'origine in alto a sinistra —
 * le stesse in cui il canvas e' stato disegnato.
 *
 * La banda VERTICALE viene dagli operatori: linea di base piu' l'ascendente, meno il
 * discendente. Quella ORIZZONTALE viene dai PIXEL: si scandisce la banda alla ricerca della
 * prima e dell'ultima colonna con inchiostro. Non e' pigrizia — e' l'unico modo onesto, perche'
 * la larghezza di una riga di testo dipende dalle metriche del font, che stanno nel font e non
 * nel file; e perche' cosi' il ritaglio segue il testo quando l'attacco 1b lo allunga di tre
 * lettere, invece di tagliarlo.
 */
function misuraRitaglio(tela, bytes) {
  const riga = posizioneRigaImporto(bytes)
  if (!riga || !tela.width || !tela.height) return null
  const pagina = { larghezza: tela.width / SCALA_DISEGNO, altezza: tela.height / SCALA_DISEGNO }
  const su = riga.y + riga.corpo * 1.05
  const giu = riga.y - riga.corpo * 0.4
  const primaRiga = Math.max(0, Math.floor((pagina.altezza - su) * SCALA_DISEGNO))
  const ultimaRiga = Math.min(tela.height, Math.ceil((pagina.altezza - giu) * SCALA_DISEGNO))
  if (ultimaRiga <= primaRiga) return null

  let sinistra = tela.width
  let destra = -1
  try {
    const contesto = tela.getContext('2d', { willReadFrequently: true })
    if (!contesto) return null
    const dati = contesto.getImageData(0, primaRiga, tela.width, ultimaRiga - primaRiga).data
    for (let y = 0; y < ultimaRiga - primaRiga; y++) {
      for (let x = 0; x < tela.width; x++) {
        const i = (y * tela.width + x) * 4
        // Inchiostro = qualunque cosa non sia carta. Il campione e' nero su bianco, ma il
        // tratto della firma autografa e' blu: la soglia guarda i tre canali, non la sola
        // luminanza, perche' un giorno quella riga potrebbe non essere nera.
        if (dati[i] < 170 || dati[i + 1] < 170 || dati[i + 2] < 170) {
          if (x < sinistra) sinistra = x
          if (x > destra) destra = x
        }
      }
    }
  } catch {
    return null // canvas non leggibile: pagina intera, e nessun guasto da mostrare
  }
  if (destra < 0) return null // nessun inchiostro in quella banda: non c'e' niente da ingrandire

  // L'aria attorno al ritaglio. Senza, la lente sembrerebbe una striscia ritagliata col cutter;
  // con, resta un pezzo di pagina — e la pagina e' cio' che questa meta' deve continuare a
  // sembrare.
  const aria = riga.corpo * 0.9
  const x0 = Math.max(0, sinistra / SCALA_DISEGNO - aria)
  const x1 = Math.min(pagina.larghezza, destra / SCALA_DISEGNO + aria)
  const y0 = Math.max(0, pagina.altezza - su - aria * 0.7)
  const y1 = Math.min(pagina.altezza, pagina.altezza - giu + aria * 0.7)
  if (x1 - x0 < 1 || y1 - y0 < 1) return null
  return { x: x0, y: y0, larghezza: x1 - x0, altezza: y1 - y0, pagina }
}

/**
 * La riga dell'importo, nei byte, e' `(1.000 euro (mille euro)) Tj`: una stringa PDF piu'
 * l'operatore che la disegna. Citata dentro una frase, quel `) Tj` sembra un refuso. Si toglie
 * dal testo LETTO nei byte, non si scrive a mano una costante: cosi' la citazione resta vera
 * anche dopo un attacco che quel testo lo cambia.
 */
function dentroLaParentesi(testo) {
  return testo.replace(/^\(/, '').replace(/\)\s*Tj\s*$/, '')
}

/** L'ancora, spostata se un attacco ha allungato il file dal di dentro. */
function tratto(punto, s) {
  const inserzione = s?.risultati?.['attacco-lettere'] ?? null
  const attivo = s?.documento?.etichetta === 'manomesso-lettere' && inserzione
  if (!attivo) return { id: punto.id, start: punto.start, end: punto.end, kind: 'object', label: punto.nome }
  const at = inserzione.offset
  const delta = inserzione.deltaLunghezza
  const sposta = (x) => (x <= at ? x : x + delta)
  return { id: punto.id, start: sposta(punto.start), end: sposta(punto.end), kind: 'object', label: punto.nome }
}
