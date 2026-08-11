# Prompt da eseguire, uno per sessione

Ogni file qui dentro è un prompt autosufficiente: non dipende da nessuna conversazione
precedente. Per lanciarne uno, in una sessione nuova aperta sulla radice del repository,
basta scrivere:

> Esegui il prompt in `docs/prompt/01-fase5-direzioni-visive.md`

Prima di iniziare, ogni sessione deve leggere `docs/stato.md`.

## Ordine e parallelismo

**01 è chiusa.** Restano cinque prompt e un solo vincolo di sequenza vero.

| # | Prompt | Scrive in | Dipende da | Stato |
|---|---|---|---|---|
| 01 | Fase 5 — le due direzioni visive | `src/ui/machine.js` `src/ui/pdf-render.js` `src/design/**` `src/entries/**` | niente | **fatto** |
| 02 | Fase 5b — audio della narrazione | `scripts/narration/**` `src/assets/narrazione/**` | niente | da fare |
| 02b | Fase 5c — driver della narrazione | `src/ui/narrator.js` `src/entries/narration-placeholder.js` `src/design/**` | 01 e **02** | da fare |
| 03 | Collaudo di sicurezza | `scripts/collaudo/**` `docs/vulnerabilita.md` | niente | da fare |
| 04 | Fase 6b — pannelli delle vulnerabilità | `src/ui/copy.it.js` `src/ui/script.it.js` `src/design/**` | 01 e **03** | da fare |
| 05 | Fase 6 — collaudo finale end-to-end | referti, più le riparazioni che ne seguono | tutti | da fare |

**02 e 03 possono girare contemporaneamente**, in due sessioni diverse: toccano directory
disgiunte. La cartella è un repository git: i lavori aperti sono tracciati come issue e due sessioni
parallele possono stare su branch separati, ma due sessioni che toccano gli stessi file devono
comunque coordinarsi. **02b va dopo 02** (senza `src/assets/narrazione/segments.js` la variante narrata non
compila) e **04 va dopo 03** (senza `docs/vulnerabilita.md` non c'è niente da raccontare).

**03 è quello che sblocca**: è l'unico rimasto da cui dipenda un'altra fase.

Attenzione a **02b e 04**: sono le due sessioni che entrano in `src/design/**`, cioè in casa delle
due direzioni già costruite e criticate. **Non lanciarle insieme**, o si sovrascrivono.

Se ne lanci più d'uno insieme, l'unica regola da rispettare è quella scritta in ogni prompt: si
scrive **solo** nei percorsi assegnati. Due sessioni che toccano lo stesso file si sovrascrivono
a vicenda senza accorgersene.

## Nota sul lavoro fatto finora

Le fasi 1, 2, 3, 4 e 5 sono chiuse e verificate: `npm test` dà **303 test verdi** e `npm run build`
produce quattro file autoconsistenti che si avviano da `file://` senza toccare la rete. Tre esiti
misurati hanno cambiato il piano originale — pdf-lib inutilizzabile, l'attacco 1b che non fa fallire
il renderer, e il verdetto a tre stati che era aggirabile. Sono riassunti in `docs/stato.md` e non
vanno riaperti: sono già rientrati come lavoro.

Due strumenti nati in fase 5 che i prompti seguenti danno per acquisiti:
`scripts/anteprima/anteprima.mjs` (costruisce **una** entry, la apre da `file://`, la pilota e
scatta — serve perché `npm run build` svuota `dist/` e due sessioni parallele si cancellerebbero il
lavoro) e `docs/contratti-dom.md` (i ganci nel DOM: `window.__demo`, i marcatori su `<body>`,
`[data-passo]`, `[data-pannello]`, `[data-righello]`, `[data-canvas-pdf]`).
