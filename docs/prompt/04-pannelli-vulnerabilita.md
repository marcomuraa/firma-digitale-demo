# 04 · Fase 6b — i pannelli delle vulnerabilità

**Dipende da 01 (fatto) e da 03.** Non partire se `docs/vulnerabilita.md` non esiste.

Lavori dalla radice del repository. **Leggi prima `docs/stato.md`**, poi
`docs/vulnerabilita.md`, `docs/decisioni.md` (sezione «Le vulnerabilità trovate entrano nella
presentazione»), `docs/contratti-ui.md` e `docs/contratti-dom.md`.

Le due direzioni visive **esistono** e sono state criticate e riparate due volte: entri in casa
d'altri. Prima di aggiungere un pannello, leggi come sono fatti gli altri quattordici in
`src/design/protocollo/pannelli.js` e in `src/design/doppia/letture.js`, e usa i loro stessi pezzi.
Per costruire, pilotare e fotografare una pagina senza svuotare `dist/` c'è
`scripts/anteprima/anteprima.mjs` (`--aiuto` spiega i copioni).

---

## L'idea

Il collaudo avversariale ha trovato cose che nessuno aveva pianificato. Si è deciso che
entrano nella presentazione: sono la parte più interessante del progetto, perché sono le uniche
che non vengono da un piano ma da qualcuno che cercava di rompere.

**Il taglio, e non è un dettaglio di stile: si mostrano gli attacchi provati e il loro esito, non
un elenco di bug.** Tre famiglie:

1. **attacchi che rompono la firma** — l'attacco 1a: il digest non torna, verdetto ❌;
2. **attacchi che non rompono la firma ma cambiano il documento** — l'attacco 2: verdetto ⚠️, ed è
   la ragione per cui il verdetto ha tre stati e non due;
3. **attacchi che ingannano il verificatore** — l'esca, e ciò che il collaudo ha trovato dopo.

La terza famiglia è la più istruttiva, e va messa in valore: sposta la domanda da *«la firma è
valida?»* a **«valida di chi?»**. È il ponte naturale verso il pannello `teoria-eidas`, dove il
certificato qualificato è esattamente la risposta istituzionale a quella domanda. La demo ci
arriva da sola, dopo averci sbattuto contro — che vale molto più che sentirselo dire.

## Cosa fare

**1. Aprire la famiglia `vulnerabilita-*` nel contratto.** L'elenco dei pannelli in
`docs/contratti-ui.md` è dichiarato chiuso ai quindici: aggiungi la famiglia, un pannello per
attacco **documentato in `docs/vulnerabilita.md`**, e aggiorna `src/ui/steps.js`. Non inventare
pannelli per attacchi che nessuno ha eseguito: è la regola di onestà del progetto.

**2. Scrivere i testi** in `src/ui/copy.it.js`, con la stessa forma degli altri pannelli
(`titolo`, `occhiello`, `corpo[]`) e la stessa disciplina: il **primo paragrafo regge da solo** in
modalità presentazione, il resto è per la modalità studio. Registro piano, niente gergo non
spiegato, niente entusiasmo da brochure. Ogni pannello porta con sé la **prova**: i byte, il
verdetto nostro e quello dello strumento terzo. È ciò che distingue una dimostrazione da
un'affermazione.

**3. Renderli** nelle due direzioni visive, rispettandone il linguaggio: «Protocollo» li impila
come gli altri, «Doppia esposizione» può usare la metà scura, che è la sua sede naturale.

**4. La narrazione è facoltativa** — e attenzione, questa riga è stata corretta: i dodici segmenti
parlati **non sono ancora registrati**. Il copione esiste in `src/ui/script.it.js` ed è tarato su
cinque minuti, ma l'audio lo genera la fase 5b e lo suona la 5c, che potrebbero non essere ancora
girate. Se aggiungi voce a questi pannelli aggiungi minuti a un totale che qualcun altro sta ancora
misurando: decidi esplicitamente e dillo nel rapporto, non lasciarlo capitare. In dubbio, lascia
questi pannelli muti e apribili a richiesta — sono materiale da domande, più che da copione.

## Vincolo che viene prima di tutto il resto

Questi pannelli parlano di sicurezza, quindi si applica la regola di onestà senza eccezioni:
**solo ciò che è stato eseguito e misurato, con la prova accanto.** Se `docs/vulnerabilita.md`
non porta una prova per un attacco, quell'attacco non diventa un pannello. E gli attacchi
**falliti** meritano il loro spazio: è il fallimento a dimostrare che il controllo esiste davvero.

## Come si chiude

`npm test` verde, `npm run build` verde, quattro file autoconsistenti. Apri i file di `dist/` con
Chrome headless, cattura le schermate dei nuovi pannelli e **guardale**. Riferisci quali attacchi
sono diventati pannelli, quali no e perché.
