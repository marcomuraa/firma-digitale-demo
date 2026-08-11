/**
 * La scheda di ogni atto: cio' che il passo ha davvero prodotto, messo in modulistica.
 *
 * Tutto quello che si legge qui viene da `stato.risultati[stepId]`, cioe' dal materiale
 * CONGELATO dalla macchina al momento del passo. Nessun numero viene ricalcolato e nessuno viene
 * riletto dallo stato corrente: e' questo che permette al pannello dell'attacco 1a di continuare
 * a raccontare l'attacco 1a dieci passi dopo, anche dopo un ripristino.
 *
 * Le etichette dei campi stanno in lessico.js — sono modulistica, non contenuto. Il contenuto
 * e' in src/ui/copy.it.js e non si riscrive.
 */

import { STEP_IDS } from '../../ui/steps.js'
import { COPY } from '../../ui/copy.it.js'
import { byteInEsadecimale, dataOra, el, numero, raggruppa } from './dom.js'
import { CAMPI, COMANDI, RIEPILOGO, VERDETTO } from './lessico.js'
import { disegnaDump } from './esadecimale.js'
import { disegnaAlbero } from './asn1.js'
import { confrontoImpronte, tabellaControlli, timbroVerdetto } from './verdetto.js'

/**
 * Il contenuto specifico di un atto: schede, prove, apri-e-chiudi.
 *
 * @param {string} stepId
 * @param {object} stato   l'istantanea della macchina
 * @returns {Node[]}
 */
export function contenutoDelPasso(stepId, stato) {
  const risultato = stato.risultati?.[stepId]
  if (!risultato) return []
  const costruttore = CONTENUTI[stepId]
  return costruttore ? costruttore(risultato, stato).filter(Boolean) : []
}

/* ------------------------------------------------------------------ i dodici atti */

const CONTENUTI = {
  documento: (r) => [
    scheda([
      { etichetta: CAMPI.lunghezza, valore: `${numero(r.lunghezza)} byte` },
      { etichetta: CAMPI.sha256, valore: raggruppa(r.sha256, 8), densita: 'studio' },
    ]),
    tenore(r.testo),
    dump(r.bytes, r.evidenziazioni),
  ],

  chiavi: (r) => [
    scheda([
      { etichetta: CAMPI.algoritmo, valore: r.algoritmo },
      { etichetta: CAMPI.hash, valore: r.hash },
      { etichetta: CAMPI.modulusBits, valore: `${numero(r.modulusBits)} bit` },
      { etichetta: CAMPI.esponente, valore: byteInEsadecimale(r.esponente, 8), densita: 'studio' },
      { etichetta: CAMPI.modulo, valore: byteInEsadecimale(r.modulo, 24), densita: 'studio' },
    ]),
    apri(`${COMANDI.apriAsn1} · SubjectPublicKeyInfo`, () => disegnaAlbero(r.spkiDer)),
  ],

  certificato: (r) => [
    scheda([
      { etichetta: CAMPI.soggetto, valore: r.subjectCN },
      { etichetta: CAMPI.emittente, valore: r.issuerCN },
      { etichetta: CAMPI.autofirmato, valore: r.autofirmato ? CAMPI.si : CAMPI.no },
      { etichetta: CAMPI.serial, valore: r.serial, densita: 'studio' },
      { etichetta: CAMPI.validoDa, valore: dataOra(r.notBefore), densita: 'studio' },
      { etichetta: CAMPI.validoA, valore: dataOra(r.notAfter), densita: 'studio' },
      { etichetta: CAMPI.improntaCert, valore: raggruppa(r.impronta, 8) },
    ]),
    apri(`${COMANDI.apriAsn1} · certificato X.509`, () => disegnaAlbero(r.der)),
  ],

  placeholder: (r) => [
    scheda([
      { etichetta: CAMPI.byteRange, valore: `[ ${r.byteRange.map(numero).join('  ')} ]` },
      { etichetta: CAMPI.contentsStart, valore: numero(r.contentsStart) },
      { etichetta: CAMPI.contentsEnd, valore: numero(r.contentsEnd) },
      { etichetta: CAMPI.padding, valore: `${numero(r.padding)} byte`, densita: 'studio' },
      { etichetta: CAMPI.lunghezzaPrima, valore: numero(r.lunghezzaPrima), densita: 'studio' },
      { etichetta: CAMPI.crescita, valore: `+ ${numero(r.crescita)}` },
      { etichetta: CAMPI.lunghezza, valore: `${numero(r.lunghezza)} byte` },
    ]),
    dump(r.bytes, r.evidenziazioni),
  ],

  impronta: (r, stato) => [
    scheda([
      { etichetta: CAMPI.algoritmo, valore: r.algoritmo },
      { etichetta: CAMPI.improntaDoc, valore: raggruppa(r.hex, 8) },
      {
        etichetta: CAMPI.intervalli,
        valore: r.intervalli.map(([da, a]) => `${numero(da)} – ${numero(a)}`).join('   +   '),
        densita: 'studio',
      },
      { etichetta: CAMPI.byteCoperti, valore: numero(r.byteCoperti) },
      { etichetta: CAMPI.byteNonCoperti, valore: numero(r.byteNonCoperti) },
    ]),
    dump(bytesDelPasso('impronta', stato), r.evidenziazioni),
  ],

  cms: (r) => [
    scheda([
      { etichetta: CAMPI.cmsLunghezza, valore: `${numero(r.lunghezza)} byte` },
      { etichetta: CAMPI.signingTime, valore: dataOra(r.signingTime) },
      { etichetta: CAMPI.firmaRsa, valore: byteInEsadecimale(r.firma, 16), densita: 'studio' },
      {
        etichetta: CAMPI.signedAttrs,
        valore: `${numero(r.signedAttrsDer.length)} byte`,
        densita: 'studio',
      },
    ]),
    apri(`${COMANDI.apriAsn1} · CMS SignedData`, () => disegnaAlbero(r.der)),
    apri(`${COMANDI.apriAsn1} · attributi firmati`, () => disegnaAlbero(r.signedAttrsDer)),
  ],

  firma: (r) => [
    scheda([
      { etichetta: CAMPI.byteCms, valore: `${numero(r.byteCms)} byte` },
      { etichetta: CAMPI.capacitaBuco, valore: `${numero(r.capacitaBuco)} byte` },
      { etichetta: CAMPI.zeri, valore: `${numero(r.zeriDiRiempimento)} byte`, densita: 'studio' },
      { etichetta: CAMPI.lunghezza, valore: `${numero(r.lunghezza)} byte` },
    ]),
    dump(r.bytes, r.evidenziazioni),
  ],

  verifica: (r, stato) => [
    timbroVerdetto(r.verdetto),
    tabellaControlli(r.esito),
    confrontoImpronte(r.esito),
    schedaIdentita(r.esito),
    dump(bytesDelPasso('verifica', stato), r.evidenziazioni),
    dumpBersagli(stato),
  ],

  'attacco-cifra': (r) => [
    timbroVerdetto(r.verdetto),
    scheda([
      { etichetta: CAMPI.offsetAttacco, valore: numero(r.offset) },
      { etichetta: CAMPI.daA, valore: `"${r.da}"  →  "${r.a}"` },
      { etichetta: CAMPI.delta, valore: `${r.deltaLunghezza >= 0 ? '+' : ''}${r.deltaLunghezza} byte` },
      { etichetta: CAMPI.testoDopo, valore: citazione(r.testoDopo) },
    ]),
    tabellaControlli(r.esito),
    confrontoImpronte(r.esito),
    dump(r.bytes, r.evidenziazioni),
  ],

  'attacco-lettere': (r) => [
    timbroVerdetto(r.verdetto),
    scheda([
      { etichetta: CAMPI.offsetAttacco, valore: numero(r.offset) },
      { etichetta: CAMPI.daA, valore: `"${r.da}"  →  "${r.a}"` },
      { etichetta: CAMPI.delta, valore: `+${r.deltaLunghezza} byte` },
      r.prove?.length
        ? { etichetta: CAMPI.lengthDichiarato, valore: numero(r.prove.length.declared) }
        : null,
      r.prove?.length
        ? { etichetta: CAMPI.lengthReale, valore: numero(r.prove.length.actual) }
        : null,
      {
        etichetta: CAMPI.xrefRotta,
        valore: `${numero(r.prove?.xref?.length ?? 0)}`,
      },
      {
        etichetta: CAMPI.rendererApre,
        valore: r.ilRendererApreLoStesso ? CAMPI.si : CAMPI.no,
      },
      // La riga che distingue questa coda da quella dell'attacco 2. Qui il file e' cresciuto
      // DAL DI DENTRO: il /ByteRange resta fermo, il fondo del file slitta di tre byte e nel
      // righello compare una coda `tail` che NON e' un append. Il dato che lo dice senza
      // indovinare e' `gapMatchesContents`, e vale false solo qui.
      { etichetta: CAMPI.bucoCoincide, valore: coincide(r.esito) },
      { etichetta: CAMPI.testoDopo, valore: citazione(r.testoDopo) },
    ]),
    disallineamenti(r.prove?.xref),
    tabellaControlli(r.esito),
    confrontoImpronte(r.esito),
    dump(r.bytes, r.evidenziazioni),
  ],

  'attacco-coda': (r) => [
    timbroVerdetto(r.verdetto),
    scheda([
      { etichetta: CAMPI.appendedFrom, valore: numero(r.appendedFrom) },
      { etichetta: CAMPI.byteAppesi, valore: `${numero(r.byteAppesi)} byte` },
      { etichetta: CAMPI.lunghezza, valore: `${numero(r.lunghezza)} byte` },
      // Vale `sì`, e messo accanto a quello dell'attacco 1b spiega la differenza fra le due code:
      // qui il buco e' dove lo si era lasciato, i byte sono arrivati dopo.
      { etichetta: CAMPI.bucoCoincide, valore: coincide(r.esito) },
      { etichetta: CAMPI.testoDopo, valore: citazione(r.testoNuovo) },
    ]),
    tabellaControlli(r.esito),
    confrontoImpronte(r.esito),
    dump(r.bytes, r.evidenziazioni),
  ],

  chiusura: (r) => [riepilogo(r.riepilogo)],
}

/* ------------------------------------------------------------------ mattoni */

/** Una scheda a due colonne: etichetta prestampata, valore in monospazio. */
function scheda(righe) {
  const lista = el('dl', { classe: 'scheda' })
  for (const riga of righe) {
    if (!riga) continue
    lista.append(
      el('dt', {
        classe: 'prestampa',
        testo: riga.etichetta,
        dati: { densita: riga.densita },
      }),
      el(
        'dd',
        { dati: { densita: riga.densita } },
        typeof riga.valore === 'string' ? [document.createTextNode(riga.valore)] : [riga.valore],
      ),
    )
  }
  return lista
}

/** Il tenore dell'atto: le righe del documento, in serif, come si legge sulla carta. */
function tenore(righe) {
  if (!Array.isArray(righe) || righe.length === 0) return null
  return el('div', {}, [
    el('p', { classe: 'prestampa', testo: CAMPI.tenore, stile: { margin: '1rem 0 0' } }),
    el('blockquote', { classe: 'tenore', testo: righe.join('\n') }),
  ])
}

/** Una citazione dal documento: si legge nel carattere del documento, non in quello dei dati. */
function citazione(testo) {
  return el('span', { classe: 'citazione', testo: testo ?? '—' })
}

/**
 * Il buco dichiarato dal /ByteRange coincide ancora con il buco vero del /Contents?
 * E' `verifica.coverage.gapMatchesContents`, gia' calcolato: falso solo dopo l'attacco 1b, dove
 * tre byte inseriti a meta' documento hanno spostato il buco lasciando fermi i numeri.
 */
function coincide(esito) {
  const valore = esito?.coverage?.gapMatchesContents
  if (valore === undefined || valore === null) return '—'
  return valore ? CAMPI.si : CAMPI.no
}

/** L'identita' RILETTA dal file, che e' quella che un verificatore vede davvero. */
function schedaIdentita(esito) {
  const identita = esito?.identity
  if (!identita) return null
  const righe = [
    { etichetta: CAMPI.soggetto, valore: identita.subjectCN ?? '—' },
    { etichetta: CAMPI.emittente, valore: identita.issuerCN ?? '—' },
    { etichetta: CAMPI.autofirmato, valore: identita.selfSigned ? CAMPI.si : CAMPI.no },
    { etichetta: CAMPI.fingerprint, valore: raggruppa(identita.fingerprint, 8), densita: 'studio' },
    {
      etichetta: CAMPI.firmeTrovate,
      valore: numero(esito.signatures?.length ?? 0),
      densita: 'studio',
    },
  ]
  if (esito.reason) righe.push({ etichetta: CAMPI.ragione, valore: esito.error ?? esito.reason })
  return el('div', {}, [
    el('p', { classe: 'prestampa', testo: CAMPI.identita, stile: { margin: '1rem 0 0' } }),
    scheda(righe),
  ])
}

/** I disallineamenti misurati dell'attacco 1b: si mostrano, non si annunciano. */
function disallineamenti(problemi) {
  if (!Array.isArray(problemi) || problemi.length === 0) return null
  return apri(`Apri i ${problemi.length} disallineamenti misurati`, () => {
    const lista = el('ul', { classe: 'controlli' })
    for (const problema of problemi) {
      const parti = [problema.motivo]
      if (Number.isFinite(problema.declared)) {
        parti.push(`dichiarato ${numero(problema.declared)}`)
      }
      if (Number.isFinite(problema.declaredOffset)) {
        parti.push(`dichiarato ${numero(problema.declaredOffset)}`)
      }
      if (Number.isFinite(problema.actual)) parti.push(`reale ${numero(problema.actual)}`)
      if (Number.isFinite(problema.actualOffset)) parti.push(`reale ${numero(problema.actualOffset)}`)
      lista.append(
        el('li', { classe: 'controllo', dati: { esito: 'no' } }, [
          el('span', { classe: 'controllo__segno', 'aria-hidden': 'true', testo: '✕' }),
          el('span', { classe: 'controllo__esito', testo: parti.join(' · ') }),
        ]),
      )
    }
    return lista
  })
}

/**
 * I quattro verdetti misurati, in fila — e la tabella SI SFOGLIA IN SCHEDE quando le sette
 * colonne non ci stanno.
 *
 * Perche', e come si e' misurato. A 1280x900 in presentazione — un portatile attaccato a un
 * proiettore, cioe' il caso piu' probabile — la tabella chiedeva 753 px in un involucro di 601:
 * «Coda» e «Copertura» finivano fuori. A 390 ne restavano fuori cinque su sette e il verdetto si
 * spezzava a meta' parola («✓ Va…», «✕ N…»). E' l'ultima cosa che l'aula vede, quella in cui si
 * tirano le somme: e' il peggior posto in cui perdere informazione, e con `overflow-x: auto` da
 * solo l'informazione spariva senza che si vedesse che era sparita.
 *
 * La riparazione sta nel CSS (protocollo.css, sezione 8) ed e' una container query: sotto una
 * certa larghezza ogni riga diventa una SCHEDA — il titolo dell'atto in testa, sotto le sei
 * misure in modulistica, etichetta prestampata a sinistra e valore a destra, cioe' esattamente la
 * forma che ha gia' la `.scheda` di ogni atto. Niente si tronca e niente sparisce.
 *
 * Qui dentro servono due cose perche' quella riparazione sia possibile e onesta:
 *
 *  1. OGNI CELLA PORTA LA SUA ETICHETTA, in uno `<span>` vero e non in uno `::before`: nella
 *     forma a scheda l'intestazione di colonna non c'e' piu' a fare da chiave, e ogni valore
 *     deve dire da se' che cos'e'. E' `aria-hidden` perche' chi ascolta ha gia' l'intestazione
 *     di colonna e la sentirebbe due volte; nella forma a tabella il CSS lo nasconde.
 *  2. I RUOLI ARIA SONO SCRITTI A MANO. Cambiare il `display` di una tabella le toglie la
 *     semantica di tabella in ogni motore: dichiarare `role="table"` / `rowgroup` / `row` /
 *     `columnheader` / `rowheader` / `cell` gliela restituisce. Nella forma a tabella sono
 *     esattamente i ruoli impliciti, quindi non cambiano niente — sono il prezzo di non
 *     degradare in silenzio per chi non guarda lo schermo.
 */
function riepilogo(righe) {
  if (!Array.isArray(righe) || righe.length === 0) return null
  const intestazioni = [
    RIEPILOGO.passo,
    RIEPILOGO.lunghezza,
    RIEPILOGO.verdetto,
    RIEPILOGO.impronta,
    RIEPILOGO.firma,
    RIEPILOGO.coda,
    RIEPILOGO.copertura,
  ]
  const tabella = el('table', { classe: 'riepilogo', role: 'table' })
  tabella.append(
    el(
      'thead',
      { role: 'rowgroup' },
      el(
        'tr',
        { role: 'row' },
        intestazioni.map((testo) => el('th', { scope: 'col', role: 'columnheader', testo })),
      ),
    ),
  )

  /** Una cella: l'etichetta della sua colonna, e il valore. */
  const cella = (indice, testo, dati = null) =>
    el('td', { role: 'cell', dati }, [
      el('span', {
        classe: 'riepilogo__etichetta prestampa',
        'aria-hidden': 'true',
        testo: intestazioni[indice],
      }),
      el('span', { classe: 'riepilogo__valore', testo }),
    ])

  const corpo = el('tbody', { role: 'rowgroup' })
  for (const riga of righe) {
    // Il verdetto si scrive con la parola del lessico, non con il valore dell'enum: `valid`,
    // `invalid` ed `extended` sono nomi interni, e questa e' l'ultima riga che si legge prima
    // delle note teoriche. `data-verdetto` resta il valore vero, perche' e' quello che il CSS e
    // chi misura la pagina leggono.
    const voce = VERDETTO[riga.verdetto] ?? VERDETTO.assente
    corpo.append(
      el('tr', { role: 'row' }, [
        el('th', {
          scope: 'row',
          role: 'rowheader',
          classe: 'riepilogo__atto',
          testo: COPY[riga.passo]?.titolo ?? riga.passo,
        }),
        cella(1, numero(riga.lunghezza)),
        cella(2, `${voce.segno} ${voce.breve}`, { verdetto: riga.verdetto }),
        cella(3, riga.improntaTorna ? '✓ torna' : '✕ no'),
        cella(4, riga.firmaTorna ? '✓ torna' : '✕ no'),
        cella(5, numero(riga.codaNonCoperta)),
        cella(6, riga.copertaTutta ? '✓ completa' : '▲ incompleta'),
      ]),
    )
  }
  tabella.append(corpo)
  return el('div', { classe: 'riepilogo__involucro' }, tabella)
}

/* ------------------------------------------------------------------ apri e chiudi */

/**
 * Un apri-e-chiudi vero: `<details>` nativo, quindi raggiungibile con Tab e apribile con Invio
 * senza una riga di JavaScript. Il contenuto si costruisce alla prima apertura: un dump da 256
 * byte e' un migliaio di nodi, e nel fascicolo finito ce ne sono una decina.
 */
export function apri(titolo, costruisci) {
  const contenuto = el('div', { classe: 'apri__contenuto' })
  const dettagli = el('details', { classe: 'apri' }, [
    el('summary', { testo: titolo }),
    contenuto,
  ])
  let costruito = false
  dettagli.addEventListener('toggle', () => {
    if (!dettagli.open || costruito) return
    costruito = true
    try {
      const nodo = costruisci()
      if (nodo) contenuto.append(nodo)
    } catch (problema) {
      contenuto.append(
        el('p', {
          classe: 'asn1__guasto',
          testo: `Non si e potuto costruire questo contenuto: ${problema?.message ?? problema}`,
        }),
      )
    }
  })
  return dettagli
}

/** Il dump di un passo, dietro l'apri-e-chiudi. */
function dump(bytes, evidenziazioni) {
  if (!bytes || bytes.length === 0) return null
  return apri(COMANDI.apriDump, () => disegnaDump(bytes, evidenziazioni))
}

/**
 * Il dump dei BERSAGLI: dove i due attacchi colpiranno, mentre il documento e' ancora integro.
 * `stato.bersagli` e' costante e porta gia' il kind 'target'. Vale la pena mostrarlo una volta
 * sola, al passo `verifica`, che e' l'ultimo momento in cui il documento e' ancora a posto.
 */
function dumpBersagli(stato) {
  const bersagli = [
    ...(stato.bersagli?.['attacco-cifra'] ?? []),
    ...(stato.bersagli?.['attacco-lettere'] ?? []),
  ]
  if (bersagli.length === 0) return null
  const bytes = bytesDelPasso('verifica', stato)
  if (!bytes) return null
  return apri(`${COMANDI.apriDump} · ${CAMPI.bersaglio}`, () =>
    disegnaDump(bytes, bersagli, { centro: bersagli[0].start }),
  )
}

/**
 * I byte in vigore a un certo passo. Tre passi non toccano i byte del documento e quindi non ne
 * congelano una copia: si risale al passo precedente che l'ha fatto. Non e' una stima — sono
 * esattamente gli stessi byte, perche' in mezzo nessuno li ha cambiati.
 */
export function bytesDelPasso(stepId, stato) {
  const fine = STEP_IDS.indexOf(stepId)
  for (let i = fine; i >= 0; i--) {
    const risultato = stato.risultati?.[STEP_IDS[i]]
    if (risultato?.bytes && risultato.bytes.length > 0) return risultato.bytes
  }
  return null
}
