# 01 · Fase 5 — la macchina a stati e le due direzioni visive

> **ESEGUITO E CHIUSO — 11 agosto 2026. Non rilanciare questo prompt.** Resta agli atti per com'era
> stato scritto: i numeri qui dentro (`src/design/` vuota, 221 test) sono la fotografia di *prima*.
> Lo stato di adesso sta in `docs/stato.md`, il prossimo passo in `docs/prompt/README.md`.

Lavori dalla radice del repository. **Leggi prima `docs/stato.md`**, poi
`docs/contratti-ui.md`, `docs/decisioni.md`, `spikes/pdfjs/RECIPE.md`. Il piano originale non fa
parte del repository: ciò che la sua sezione «Design» chiedeva è riassunto qui sotto.

Il motore, le viste e i testi esistono e sono verdi. **`src/design/` è vuota**: nessuna delle due
direzioni visive esiste. Questo è il pezzo più grosso rimasto.

Usa agenti e workflow. Altre sessioni possono lavorare in parallelo su `scripts/narration/`,
`scripts/collaudo/` e `docs/vulnerabilita.md`: **non toccare quei percorsi.**

---

## Struttura del lavoro

Tre stadi, in quest'ordine. Il primo è una barriera vera.

### Stadio 1 — un agente da solo: ciò che le due direzioni hanno in comune e non ha aspetto

File: `src/ui/machine.js`, `src/ui/machine.test.mjs`, `src/ui/pdf-render.js`.

Il piano dà la macchina a stati per già esistente. **Non esiste.** Se la scrivessero le due
direzioni, la scriverebbero due volte e in due modi diversi, e il righello finirebbe per
raccontare due storie.

```js
createDemo() -> {
  getState(),                   // istantanea immutabile
  subscribe(fn) -> unsubscribe, // notificata a ogni cambio
  steps,                        // gli stepId in ordine, da src/ui/steps.js
  canRun(stepId), run(stepId),  // run è asincrono e avanza lo stato
  restoreSigned(),              // torna al PDF firmato integro, fra un attacco e l'altro
  reset(),
}
```

Lo stato contiene almeno: passo corrente, passi già fatti, byte correnti del documento con
un'etichetta di cosa sono (originale / con placeholder / firmato / manomesso in un certo modo),
chiavi certificato e CMS quando esistono, `byteRange` e `contentsStart`, ultimo esito di
`verify()`, e un campo errore. **Documenta la forma dello stato in cima al file, in italiano**: è
il documento che leggeranno le due direzioni.

I dodici passi sono in `docs/contratti-ui.md` e in `src/ui/steps.js`. La macchina li esegue
chiamando il motore già scritto: leggilo, non indovinare le firme.

**Regola ferrea: nessun DOM.** Niente `document`, niente `window` — a parte ciò che pdf.js stesso
richiede dentro `pdf-render.js`, che riceve un canvas dall'esterno e non lo crea. La macchina deve
essere testabile in node, e i test lo dimostrano.

Due cose che decidono se la demo regge in pubblico:

1. **I pannelli si impilano, non si cancellano.** Eseguire un passo non cancella ciò che si è
   visto prima: lo stato conserva la storia. È una decisione presa nell'intervista, non un
   dettaglio.
2. **Niente esplode.** Un passo che fallisce mette lo stato in errore con un messaggio in
   italiano, e la demo resta navigabile. L'attacco 1b produce un documento strutturalmente
   incoerente: il rendering fallirà o darà un risultato strano, e la macchina deve reggerlo.

`src/ui/pdf-render.js` — il ponte verso pdf.js, uno solo per tutto il progetto:

```js
renderPdfToCanvas(bytes, canvas, { scale }) -> Promise<{ ok, pages, error }>
```

Segui **alla lettera** `spikes/pdfjs/RECIPE.md`: quella ricetta è stata verificata in Chrome
headless da `file://` ed è l'unico modo noto che funziona senza rete. Non improvvisare una
variante. Non deve mai lanciare: un PDF rotto torna `{ ok:false, error }` con una frase in
italiano. È il pezzo che rende dimostrabile l'attacco 2 — il documento cambia davvero sotto gli
occhi — quindi la sua robustezza vale quanto la sua correttezza.

I test percorrono la demo intera in node, senza DOM, e verificano i cinque esiti veri: firmato
valido e completo; attacco 1a non valido; attacco 1b non valido e senza eccezioni; attacco 2
valido ma esteso; ripristino che riporta al documento firmato integro.

### Stadio 2 — due agenti in parallelo: le direzioni visive

**Prima di scrivere una riga di CSS, ogni agente invoca la skill `frontend-design:frontend-design`
e la segue.** Questo è design, non markup. La domanda a cui la pagina deve saper rispondere è
*«sembra generato da un template?»*. Se la risposta è sì, è da rifare.

**Direzione A — «Protocollo»** · possiede `src/design/protocollo/**`,
`src/entries/protocollo.html`, `src/entries/protocollo.js`

Registro dell'atto notarile italiano. È una demo su una promessa di pagamento: la pagina deve
avere la serietà della carta bollata, non l'allegria di una landing page. Carta grigio-protocollo
`#E8E6DF`, inchiostro `#16202B`, accento blu-timbro `#2B3A8F`; verdetti verde sigillo, ambra
avviso, rosso protocollo. Serif libraria per i titoli, monospace di sistema per byte e ASN.1.
Pannelli pieni impilati: si scorre verso il basso e la storia resta tutta lì, come un fascicolo
che si ingrossa. Margini generosi, gerarchia tipografica netta, poche regole applicate con
disciplina. Nessuna ombra morbida, nessun gradiente, nessun angolo molto arrotondato: quella è
un'altra estetica e non è questa.

**Direzione C — «Doppia esposizione»** · possiede `src/design/doppia/**`,
`src/entries/doppia-esposizione.html`, `src/entries/doppia-esposizione.js`

Pagina spaccata in due: a sinistra, chiara, il documento come lo vede un umano; a destra, scura,
lo stesso file come lo vede la macchina. È la tesi del progetto resa in layout — lo stesso
oggetto, due letture, e la firma vive nella seconda. Il legame fra le due metà è il punto:
evidenziando una parola a sinistra si accendono i byte corrispondenti a destra. **Gli offset per
farlo ci sono già**, congelati in `src/assets/sample-offsets.json` (riga dell'importo, cifre,
lettere, tratto della firma autografa): usali, non stimarli. Il dump completo resta a piena
larghezza in un pannello dedicato, perché a metà schermo non ci stanno 16 byte per riga in modo
leggibile. Attenzione al punto in cui questa direzione può rompersi: su schermo stretto la
spaccatura non regge — decidi come si comporta, ma decidilo esplicitamente e verificalo, non
lasciarlo al caso del flexbox.

**Vincoli comuni a entrambe.**

- **Il righello dei byte è l'elemento firma condiviso**: fascia fissa in cima che rappresenta
  l'intero file a scala reale, intervalli coperti pieni, buco `/Contents` vuoto, e dopo l'attacco
  2 la coda che spunta fuori dalla parte colorata. Rendilo con `buildRuler`.
  **Trappola già costata un giro:** la copertura non si legge da `segment.kind`, si legge da
  `segment.covered`. I due assi sono separati apposta — `docs/contratti-ui.md`.
- **Doppia modalità**, interruttore in pagina, classe sul `<body>`: *presentazione* (testi
  collassati, caratteri grandi, alto contrasto, leggibile da tre metri) e *studio* (testi aperti,
  densità normale). In presentazione si vede occhiello + titolo + **primo** paragrafo; in studio
  tutto. I testi vengono da `src/ui/copy.it.js` e sono già scritti per questa distinzione: non
  riscriverli, non incorporarne di nuovi nel markup.
- **Progressive disclosure**: hex e ASN.1 dietro un aprire e chiudere. Ma quando si aprono devono
  essere veri e leggibili, non decorativi.
- **Accessibilità, non come rifinitura finale**: focus da tastiera visibile e ordine di
  tabulazione sensato (chi presenta ha le mani occupate); `prefers-reduced-motion` rispettato
  davvero; contrasto sufficiente anche in modalità presentazione, che è quella proiettata; e **il
  verdetto non deve dipendere dal solo colore** — verde, ambra e rosso vanno accompagnati da forma
  e parola, altrimenti un daltonico in aula non vede la differenza fra valida ed estesa.
- Font di sistema, nessuna incorporazione, nessuna risorsa esterna: il file apre offline.
- Se `__NARRATED__` è vero la pagina includerà la narrazione: lascia il gancio dov'è, la fase 5b
  se ne occupa.

Ogni agente verifica il proprio lavoro **prima** di consegnarlo: `npm run build` verde, poi apre
il proprio file di `dist/` con Chrome headless da `file://` con `--dump-dom`, e cattura schermate
con `--screenshot` che **guarda davvero** con lo strumento Read. È l'unico modo che ha di vedere
ciò che ha fatto. Percorrere la demo, non solo il caricamento: schermate agli stati chiave
(firmato, attacco 1a, attacco 2).

### Stadio 3 — una critica di design per direzione

Critici indipendenti, che non hanno scritto la pagina e non devono difenderla. Non modificano
nulla: refertano. Costruiscono, aprono con Chrome headless, catturano a 1920 / 1280 / 800 / 390
e **guardano le schermate**. Poi giudicano, con numeri e non con impressioni:

1. leggibilità proiettata in modalità presentazione, corpi misurati in pixel;
2. contrasto, rapporti veri calcolati sulle coppie usate, in entrambe le modalità: segnalare tutto
   sotto 4.5:1 per il testo e 3:1 per gli elementi grafici;
3. gerarchia: cosa vede per primo l'occhio, ed è la cosa giusta?
4. **il verdetto senza colore**: valida, estesa e non valida restano distinguibili? Se la
   differenza è solo cromatica, è un rilievo grave;
5. focus da tastiera: ordine sensato, focus sempre visibile;
6. `prefers-reduced-motion`: rispettato davvero o solo dichiarato?
7. responsive a 800 e a 390;
8. **sembra generato da un template?** Se sì, dire esattamente quali dettagli lo tradiscono.
   *«I bottoni hanno il raggio e l'ombra di default»* è utile; *«manca personalità»* non lo è.

I rilievi bloccanti e gravi rientrano come lavoro, non come nota a piè di pagina.

---

## Come si chiude

`npm test` verde (oggi 221, deve solo crescere), `npm run build` verde, quattro file
autoconsistenti in `dist/`. Riferisci: cosa hai costruito, le decisioni di design che un altro
avrebbe potuto prendere diverse, e ciò che i critici hanno lasciato aperto.
