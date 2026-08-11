// Le due letture di ogni passo.
//
// Per ogni passo eseguito la pila aggiunge tre elementi alla stessa griglia a due colonne:
//   - una TRACCIA che attraversa la spaccatura, con il numero del passo sul chiaro e
//     l'etichetta dei byte sullo scuro;
//   - la lettura UMANA a sinistra: occhiello, titolo e paragrafi di src/ui/copy.it.js, che qui
//     si leggono e basta — non si riscrivono e non se ne incorporano di nuovi;
//   - la lettura MACCHINA a destra: i valori che quel passo ha prodotto, presi dal blocco
//     congelato `risultati[stepId]`, che nessun passo successivo riscrive. Per questo un
//     pannello resta vero dieci passi dopo, anche dopo un ripristino.
//
// I campi marcati `secondario` spariscono in modalita' presentazione: da tre metri si leggono
// due numeri, non dodici.

import { COPY } from '../../ui/copy.it.js'
import { el, aggiungi } from './dom.js'
import { creaAlbero } from './asn1.js'
import {
  PAROLE_VERDETTO,
  anteprimaByte,
  etichetta as etichettaDetta,
  gruppi,
  gruppiArray,
  numero,
  quando,
} from './formato.js'

/* ------------------------------------------------------------------ mattoni */

/** Un elenco di campi: nome a sinistra, valore a destra, in monospazio. */
function campi(righe) {
  const lista = el('dl', { classe: 'campi' })
  for (const riga of righe) {
    if (!riga) continue
    const { k, v, secondario = false, nodo = null } = riga
    lista.append(
      el('dt', { classe: 'campi__nome', testo: k, dati: { secondario: secondario ? 'si' : null } }),
      aggiungi(
        el('dd', { classe: 'campi__valore', dati: { secondario: secondario ? 'si' : null } }),
        nodo ?? document.createTextNode(v === null || v === undefined ? '—' : String(v)),
      ),
    )
  }
  return lista
}

/**
 * Il segno di un controllo. Tre FORME diverse, non tre colori: cerchio per «si», triangolo per
 * «attenzione», quadrato per «no». Un daltonico in aula deve poter distinguere valida da estesa,
 * e il colore da solo non basta.
 */
function segno(tipo, parola) {
  const glifi = { si: '✓', forse: '!', no: '✕' }
  return el('span', { classe: 'segno', dati: { segno: tipo } }, [
    el('i', { classe: 'segno__forma', 'aria-hidden': 'true', testo: glifi[tipo] }),
    el('span', { classe: 'segno__parola', testo: parola }),
  ])
}

/** Una riga di controllo: nome del controllo, esito con forma e parola, dettaglio numerico. */
function controllo(nome, tipo, parola, dettaglio) {
  return el('div', { classe: 'controllo' }, [
    el('span', { classe: 'controllo__nome', testo: nome }),
    segno(tipo, parola),
    dettaglio ? el('span', { classe: 'controllo__dettaglio', testo: dettaglio }) : null,
  ])
}

/** Un blocco di byte in esadecimale, per le impronte e per le chiavi. */
function blocco(testo, dati = {}) {
  return el('code', { classe: 'blocco', testo, dati })
}

/* ------------------------------------------------------------------ il verdetto */

/**
 * Il verdetto e i tre controlli che lo producono.
 *
 * Le due impronte a confronto sono `digest.expected` (scritta DENTRO la firma) contro
 * `digest.actual` (i byte che si hanno in mano adesso). Non e' `stato.impronta.hex`, che e'
 * una terza cosa: l'impronta calcolata al passo 5, prima di firmare.
 *
 * L'identita' mostrata e' `verifica.identity`, cioe' quella RILETTA dal file — non il
 * certificato che la demo ha costruito. Su un documento integro dicono la stessa cosa; e'
 * quando non coincidono che la differenza conta.
 */
export function verdettoBlocco(esito, { compatto = false } = {}) {
  if (!esito) return null
  const copertura = esito.coverage
  const impronta = esito.digest
  const firma = esito.signature
  const identita = esito.identity

  const parti = [
    el('div', { classe: 'verdetto', dati: { verdetto: esito.verdict } }, [
      el('span', { classe: 'verdetto__forma', 'aria-hidden': 'true' }),
      el('strong', { classe: 'verdetto__parola', testo: PAROLE_VERDETTO[esito.verdict] ?? esito.verdict }),
    ]),
  ]

  const controlli = el('div', { classe: 'controlli' })
  if (copertura) {
    controlli.append(
      controllo(
        'Copertura',
        copertura.complete ? 'si' : 'forse',
        copertura.complete ? 'esaurisce il file' : 'incompleta',
        `${numero(copertura.coveredBytes)} byte coperti, ${numero(copertura.uncoveredTail)} fuori`,
      ),
    )
  }
  if (impronta) {
    controlli.append(
      controllo(
        'Impronta',
        impronta.match ? 'si' : 'no',
        impronta.match ? 'coincide' : 'non coincide',
        impronta.actual ? null : 'non ricalcolabile',
      ),
    )
  }
  if (firma) {
    controlli.append(
      controllo('Firma', firma.ok ? 'si' : 'no', firma.ok ? 'confermata' : 'smentita', null),
    )
  }
  if (identita) {
    controlli.append(
      controllo(
        'Identita',
        identita.selfSigned ? 'forse' : 'si',
        identita.selfSigned ? 'autofirmata, nessun terzo garantisce' : 'garantita da un terzo',
        identita.subjectCN ?? null,
      ),
    )
  }
  parti.push(controlli)

  if (esito.error) {
    parti.push(el('p', { classe: 'lettura__guasto', testo: `${esito.error} (${esito.reason})` }))
  }

  // Nel banco il verdetto e' quello VIVO, e sta a schermo insieme a quello congelato del
  // pannello: ripetere sotto gli occhi le stesse due impronte e gli stessi campi sarebbe
  // rumore. Il banco dice l'esito, il pannello lo dimostra.
  if (compatto) return el('div', { classe: 'verdetto__blocco' }, parti)

  if (impronta) parti.push(confrontoImpronte(impronta))

  parti.push(
    campi([
      copertura ? { k: '/ByteRange', v: `[${copertura.byteRange.join(', ')}]`, secondario: true } : null,
      copertura ? { k: 'lunghezza del file', v: `${numero(copertura.fileLength)} B`, secondario: true } : null,
      copertura
        ? {
            k: 'buco dichiarato',
            v: copertura.gapMatchesContents ? 'coincide con quello vero' : 'NON coincide con quello vero',
            secondario: true,
          }
        : null,
      identita
        ? { k: 'soggetto / emittente', v: `${identita.subjectCN ?? '—'} / ${identita.issuerCN ?? '—'}`, secondario: true }
        : null,
      identita
        ? { k: 'impronta del certificato', secondario: true, nodo: blocco(gruppi(identita.fingerprint)) }
        : null,
      {
        k: 'firme trovate nel file',
        v: `${numero(esito.signatures?.length ?? 0)}${esito.multipleSignatures ? ' — il verdetto e il peggiore' : ''}`,
        secondario: true,
      },
    ]),
  )

  return el('div', { classe: 'verdetto__blocco' }, parti)
}

/**
 * Le due impronte, una sopra l'altra, con i gruppi diversi marcati. Un byte cambiato ne cambia
 * a valanga: vederlo e' piu' forte che leggere «non coincide».
 */
function confrontoImpronte(digest) {
  const attesi = gruppiArray(digest.expected)
  const trovati = gruppiArray(digest.actual ?? '')

  const riga = (etichetta, gruppiDi, altri) =>
    el('div', { classe: 'impronta__riga' }, [
      el('span', { classe: 'impronta__nome', testo: etichetta }),
      aggiungi(
        el('code', { classe: 'impronta__valore' }),
        gruppiDi.length === 0
          ? el('span', { classe: 'impronta__gruppo', testo: '—' })
          : gruppiDi.map((g, i) =>
              el('span', {
                classe: 'impronta__gruppo',
                testo: g,
                dati: { diverso: altri[i] !== undefined && altri[i] !== g ? 'si' : null },
              }),
            ),
      ),
    ])

  return el('div', { classe: 'impronta', dati: { coincide: digest.match ? 'si' : 'no' } }, [
    riga('scritta dentro la firma', attesi, trovati),
    riga('ricalcolata sui byte di adesso', trovati, attesi),
  ])
}

/* ------------------------------------------------------------------ la lettura umana */

/**
 * Il pannello di testo. In presentazione si vedono occhiello, titolo e SOLO il primo paragrafo;
 * in studio tutti. La distinzione e' gia' scritta nei testi: il primo paragrafo regge da solo.
 */
export function letturaUmana(panelId, extra = null) {
  const testi = COPY[panelId]
  if (!testi) return el('div', { classe: 'testo' })
  return el('div', { classe: 'testo' }, [
    el('p', { classe: 'occhiello', testo: testi.occhiello }),
    el('h3', { classe: 'titolo', testo: testi.titolo }),
    el(
      'div',
      { classe: 'corpo' },
      testi.corpo.map((paragrafo) => el('p', { testo: paragrafo })),
    ),
    extra,
  ])
}

/** Il testo che si legge nel documento dopo un attacco: e' il fatto, non un commento. */
function testoRisultante(intestazione, valore) {
  return el('div', { classe: 'citazione' }, [
    el('span', { classe: 'citazione__nome', testo: intestazione }),
    el('q', { classe: 'citazione__testo', testo: valore }),
  ])
}

/* ------------------------------------------------------------------ la lettura macchina */

/** Un costruttore per passo. Riceve il risultato congelato e lo stato corrente. */
const MACCHINA = {
  documento(r) {
    return [
      campi([
        { k: 'lunghezza', v: `${numero(r.lunghezza)} B` },
        { k: 'etichetta', v: etichettaDetta(r.etichetta) },
        { k: 'righe di testo', v: numero(r.testo.length), secondario: true },
      ]),
      el('div', { classe: 'lettura__blocco' }, [
        el('span', { classe: 'lettura__nome', testo: 'SHA-256 del file intero' }),
        blocco(gruppi(r.sha256)),
      ]),
    ]
  },

  chiavi(r) {
    return [
      campi([
        { k: 'algoritmo', v: r.algoritmo },
        { k: 'impronta usata', v: r.hash },
        { k: 'modulo', v: `${numero(r.modulusBits)} bit` },
        { k: 'esponente', v: anteprimaByte(r.esponente, 8), secondario: true },
        { k: 'SubjectPublicKeyInfo', v: `${numero(r.spkiDer.length)} B di DER`, secondario: true },
      ]),
      el('div', { classe: 'lettura__blocco' }, [
        el('span', { classe: 'lettura__nome', testo: 'modulo RSA, primi byte' }),
        blocco(anteprimaByte(r.modulo, 24)),
      ]),
      creaAlbero(r.spkiDer, 'chiave pubblica'),
    ]
  },

  certificato(r) {
    return [
      campi([
        { k: 'soggetto', v: r.subjectCN },
        { k: 'emittente', v: r.issuerCN },
        { k: 'autofirmato', v: r.autofirmato ? 'si — nessun terzo garantisce' : 'no' },
        { k: 'numero di serie', v: r.serial, secondario: true },
        { k: 'valido dal', v: quando(r.notBefore), secondario: true },
        { k: 'valido fino al', v: quando(r.notAfter), secondario: true },
        { k: 'DER', v: `${numero(r.der.length)} B`, secondario: true },
      ]),
      el('div', { classe: 'lettura__blocco' }, [
        el('span', { classe: 'lettura__nome', testo: 'impronta SHA-256 del certificato' }),
        blocco(gruppi(r.impronta)),
      ]),
      creaAlbero(r.der, 'certificato X.509'),
    ]
  },

  placeholder(r) {
    return [
      campi([
        { k: '/ByteRange', v: `[${r.byteRange.join(', ')}]` },
        { k: 'buco /Contents', v: `da ${numero(r.contentsStart)} a ${numero(r.contentsEnd)}` },
        { k: 'capienza del buco', v: `${numero(r.padding)} B` },
        { k: 'il file cresce di', v: `${numero(r.crescita)} B`, secondario: true },
        { k: 'da / a', v: `${numero(r.lunghezzaPrima)} B → ${numero(r.lunghezza)} B`, secondario: true },
        { k: 'ora dichiarata di firma', v: quando(r.signingTime), secondario: true },
      ]),
    ]
  },

  impronta(r) {
    return [
      campi([
        { k: 'algoritmo', v: r.algoritmo },
        { k: 'byte coperti', v: numero(r.byteCoperti) },
        { k: 'byte saltati', v: `${numero(r.byteNonCoperti)} — il buco` },
        {
          k: 'intervalli',
          v: r.intervalli.map(([a, b]) => `${numero(a)}–${numero(b)}`).join('  +  '),
          secondario: true,
        },
      ]),
      el('div', { classe: 'lettura__blocco' }, [
        el('span', { classe: 'lettura__nome', testo: 'impronta del documento' }),
        blocco(gruppi(r.hex)),
      ]),
    ]
  },

  cms(r) {
    return [
      campi([
        { k: 'SignedData', v: `${numero(r.lunghezza)} B di DER` },
        { k: 'attributi firmati', v: `${numero(r.signedAttrsDer.length)} B` },
        { k: 'firma RSA', v: `${numero(r.firma.length)} B` },
        { k: 'ora dichiarata', v: quando(r.signingTime), secondario: true },
      ]),
      el('div', { classe: 'lettura__blocco' }, [
        el('span', { classe: 'lettura__nome', testo: 'i byte su cui RSA ha lavorato, primi 24' }),
        blocco(anteprimaByte(r.signedAttrsDer, 24)),
      ]),
      creaAlbero(r.der, 'CMS SignedData'),
      creaAlbero(r.signedAttrsDer, 'attributi firmati'),
    ]
  },

  firma(r) {
    return [
      campi([
        { k: 'CMS scritto nel buco', v: `${numero(r.byteCms)} B` },
        { k: 'capienza del buco', v: `${numero(r.capacitaBuco)} B` },
        { k: 'riempimento a zero', v: `${numero(r.zeriDiRiempimento)} B` },
        { k: 'lunghezza del file', v: `${numero(r.lunghezza)} B`, secondario: true },
        { k: 'etichetta', v: etichettaDetta(r.etichetta), secondario: true },
      ]),
    ]
  },

  verifica(r) {
    return [verdettoBlocco(r.esito)]
  },

  'attacco-cifra'(r) {
    return [
      campi([
        { k: 'byte toccato', v: `offset ${numero(r.offset)}` },
        { k: 'da / a', v: `"${r.da}" → "${r.a}"` },
        { k: 'lunghezza del file', v: `${numero(r.lunghezza)} B, invariata` },
      ]),
      verdettoBlocco(r.esito),
    ]
  },

  'attacco-lettere'(r) {
    const prove = Array.isArray(r.prove) ? r.prove : []
    const lunghezza = prove.find((p) => p.id === 'length')
    const xref = prove.find((p) => p.id === 'xref')
    const startxref = prove.find((p) => p.id === 'startxref')
    return [
      campi([
        { k: 'byte toccati', v: `da ${numero(r.offset)}` },
        { k: 'da / a', v: `"${r.da}" → "${r.a}"` },
        { k: 'il file cresce di', v: `${numero(r.deltaLunghezza)} B, in mezzo al documento` },
      ]),
      el('div', { classe: 'prove' }, [
        el('h4', { classe: 'prove__titolo', testo: 'La struttura non torna piu' }),
        campi([
          lunghezza
            ? { k: '/Length', v: `dichiara ${numero(lunghezza.declared)}, lo stream ne contiene ${numero(lunghezza.actual)}` }
            : null,
          startxref
            ? { k: 'startxref', v: `dichiara ${numero(startxref.declared)}, la tabella e a ${numero(startxref.actual)}` }
            : null,
          xref
            ? { k: 'voci xref sbagliate', v: (xref.entries ?? []).map((e) => `oggetto ${e.num}: dichiara ${numero(e.declaredOffset)}, sta a ${numero(e.actualOffset)}`).join(' · ') }
            : null,
        ]),
        controllo(
          'Il lettore apre lo stesso',
          r.ilRendererApreLoStesso ? 'forse' : 'no',
          r.ilRendererApreLoStesso ? 'si, ricostruendo la tabella' : 'no',
          'misurato, non previsto',
        ),
      ]),
      verdettoBlocco(r.esito),
    ]
  },

  'attacco-coda'(r) {
    return [
      campi([
        { k: 'byte gia scritti toccati', v: 'nessuno' },
        { k: 'appeso da', v: `offset ${numero(r.appendedFrom)}` },
        { k: 'byte appesi', v: numero(r.byteAppesi) },
        { k: 'lunghezza del file', v: `${numero(r.lunghezza)} B`, secondario: true },
      ]),
      verdettoBlocco(r.esito),
    ]
  },

  chiusura(r) {
    const righe = r.riepilogo ?? []
    const tabella = el('table', { classe: 'riepilogo' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { testo: 'passo', scope: 'col' }),
        el('th', { testo: 'verdetto', scope: 'col' }),
        el('th', { testo: 'impronta', scope: 'col' }),
        el('th', { testo: 'firma', scope: 'col' }),
        el('th', { testo: 'coda', scope: 'col' }),
      ])),
      el(
        'tbody',
        {},
        righe.map((riga) =>
          el('tr', { dati: { verdetto: riga.verdetto } }, [
            el('th', { scope: 'row', testo: etichettaDetta(riga.etichetta) }),
            el('td', {}, segno(
              riga.verdetto === 'valid' ? 'si' : riga.verdetto === 'extended' ? 'forse' : 'no',
              PAROLE_VERDETTO[riga.verdetto] ?? riga.verdetto,
            )),
            el('td', { testo: riga.improntaTorna ? 'torna' : 'non torna' }),
            el('td', { testo: riga.firmaTorna ? 'torna' : 'non torna' }),
            el('td', { testo: riga.codaNonCoperta === null ? '—' : `${numero(riga.codaNonCoperta)} B` }),
          ]),
        ),
      ),
    ])
    // La tabella scorre dentro il suo riquadro. Misurato a 390 px in studio, dove le cinque
    // colonne chiedono 472 px: senza il riquadro spingevano il documento intero, e la pagina
    // scorreva di lato — 96 px di scorrimento orizzontale al passo dodici, cioe' l'unico difetto
    // di questo genere che restasse. In presentazione le colonne mostrate sono due e non succede.
    return [el('div', { classe: 'riepilogo__riquadro' }, tabella)]
  },
}

/** Che cosa aggiunge, alla lettura umana, il passo che lo produce. */
const UMANA_EXTRA = {
  documento(r) {
    return el(
      'div',
      { classe: 'trascrizione' },
      r.testo.map((riga) => el('p', { classe: 'trascrizione__riga', testo: riga })),
    )
  },
  'attacco-cifra'(r) {
    return testoRisultante('Adesso il documento dice', r.testoDopo)
  },
  'attacco-lettere'(r) {
    return testoRisultante('Adesso il documento dice', r.testoDopo)
  },
  'attacco-coda'(r) {
    return testoRisultante('Adesso il lettore mostra', r.testoNuovo)
  },
}

/**
 * Le due letture di un passo eseguito.
 *
 * @param {string} stepId
 * @param {object} risultato  il blocco congelato di `risultati[stepId]`
 * @returns {{ sinistra: HTMLElement, destra: HTMLElement }}
 */
export function letture(stepId, risultato) {
  const extra = UMANA_EXTRA[stepId] ? UMANA_EXTRA[stepId](risultato) : null
  const costruttore = MACCHINA[stepId]
  const destra = el('div', { classe: 'lettura lettura--macchina' })
  aggiungi(destra, costruttore ? costruttore(risultato) : null)
  return {
    sinistra: el('div', { classe: 'lettura lettura--umana' }, letturaUmana(stepId, extra)),
    destra,
  }
}
