# 03 · Collaudo di sicurezza — cercare le vulnerabilità che diventeranno pannelli

Lavori dalla radice del repository. **Leggi prima `docs/stato.md`**, poi
`docs/decisioni.md` — in particolare le sezioni «`verify()` diventa multi-firma» e «Le
vulnerabilità trovate entrano nella presentazione».

Questo non è un collaudo qualunque. **Ciò che trovi diventa contenuto della demo**, non una nota
a piè di pagina: è una decisione di progetto. Quindi ogni risultato va documentato in modo che un
altro possa raccontarlo e, se interrogato, riprodurlo dal vivo.

Puoi lavorare in parallelo alle altre sessioni. **Scrivi solo in `scripts/collaudo/**` e
`docs/vulnerabilita.md`.** Non modificare nulla sotto `src/`: se trovi un difetto lo referti, non
lo aggiusti — la riparazione è di un'altra sessione, e un verificatore che ripara smette di essere
indipendente.

**Il perimetro si è allargato, e vale la pena saperlo.** Questo prompt fu scritto quando sotto
`src/` c'era solo il motore. Adesso ci sono anche le due pagine, e la fase 5 è chiusa: la demo si
percorre per intero. Quindi la superficie d'attacco non è più solo *«`verify()` si può ingannare?»*
ma anche **«la pagina racconta il vero?»** — un verdetto giusto mostrato male, un'etichetta che
dichiara un intervallo diverso da quello che i byte dicono, un pannello che resta in pagina dopo che
lo stato è cambiato. Sono vulnerabilità della dimostrazione, e in una demo il cui argomento è *non
fidarti di quello che vedi* pesano quanto le altre. Due precedenti veri, trovati in fase 5 e già
riparati, che ti danno la misura del tipo di preda: la legenda del dump stampava gli offset del buco
`/Contents` **clampati alla finestra** (annunciava 1663–1840 per un buco che va da 1663 a 9857, col
numero giusto stampato due centimetri più su nel righello); e «Ricomincia» non ripuliva la pila, così
la pagina mostrava insieme il righello di un file da 1285 byte non firmato e i pannelli di uno
firmato da 10.273, con l'impronta di un certificato che non esisteva più.

Per aprire e pilotare le pagine c'è `scripts/anteprima/anteprima.mjs` (`--aiuto` spiega tutto):
costruisce **una** entry in una cartella propria, la apre da `file://` in Chrome headless, esegue il
JS che gli dai e scatta. Il copione `scripts/anteprima/copioni/demo-intera.json` percorre la demo
pilotando `window.__demo`, quindi vale per tutte e due le direzioni.

---

## Il precedente: l'attacco dell'esca

Il collaudo ha già bucato il verdetto a tre stati una volta, e vale la pena capire come, perché
dà la misura del tipo di lavoro. `verify()` individuava il campo firma con
`lastIndexOf('/ByteRange')`, cioè su byte che stanno **dopo** la firma e che chiunque può
appendere. L'attaccante partiva dal PDF già manomesso con l'attacco 2, e vi appendeva un **secondo
dizionario di firma** con una propria coppia di chiavi e un proprio certificato autofirmato che
dichiarava lo **stesso** Common Name. Quella firma è matematicamente ineccepibile e copre tutto il
file nuovo. Non serviva la chiave del firmatario legittimo: serviva solo che il verificatore guardasse l'ultima
firma invece di tutte, e non dicesse *di chi* fosse.

Lo script è in `scripts/collaudo/firma-reale/esca.mjs`, l'intero collaudo si rilancia con
`sh scripts/collaudo/firma-reale/collauda.sh`. Il buco è **chiuso**: oggi `esca.pdf` dà `extended`
con due firme rilevate. Non riverificarlo se non per confermare la regressione: cerca il prossimo.

## Cosa provare

Sei un verificatore ostile. Il compito non è confermare, è rompere. Per ogni tentativo, confronta
**sempre** il verdetto di `verify()` con quello di `pdfsig` e di `openssl`: una divergenza da uno
strumento terzo è un rilievo anche quando il nostro verdetto sembra più severo.

Piste, e trovane altre:

- contenuto infilato **dentro** il buco `/Contents`, che per costruzione non è firmato: sono 4096
  byte di spazio legittimamente escluso;
- un `/ByteRange` che dichiara di coprire più di quanto copra, o con intervalli sovrapposti, o con
  numeri negativi, o che si estende oltre la fine del file;
- un incremental update che finisce **esattamente** dove finisce il secondo intervallo;
- più di due firme, firme annidate, o un dizionario `/Type /Sig` dentro un oggetto mai
  referenziato dal catalogo — una firma fantasma che confonde il conteggio;
- un `/Contents` che contiene un CMS valido ma **di un altro documento**;
- byte aggiunti dopo `%%EOF` che non formano un incremental update valido;
- un file in cui pdf.js mostra una cosa e il testo firmato ne dice un'altra;
- il certificato: `notBefore`/`notAfter` fuori validità, `keyUsage` incoerente, un certificato che
  dichiara di essere una CA;
- **la pagina contro i byte**: porta la demo a uno stato e confronta ciò che la pagina *dice* con
  ciò che `verify()` e gli strumenti terzi dicono sugli stessi byte. Righello (byte coperti, buco,
  coda), impronte affiancate, identità e sua impronta SHA-256, offset dichiarati nelle etichette,
  albero ASN.1 contro `openssl asn1parse`. E gli stati che nessuno percorre mai: dopo «Ricomincia»,
  dopo un ripristino, dopo un passo rifiutato fuori sequenza;
- l'onestà dei nostri stessi attacchi: `tamperDigit` modifica davvero un byte **dentro** un
  intervallo del `/ByteRange`, e il fallimento nasce dal digest ricalcolato e non da una
  scorciatoia a monte che riconosce il file manomesso in qualche altro modo? Costruisci un file
  manomesso in un modo **diverso ma equivalente** e verifica che fallisca per la stessa ragione.
  Se la demo simulasse i propri fallimenti, mentirebbe proprio nel punto che vuole dimostrare.

## Cosa consegnare

**`docs/vulnerabilita.md`**, che è la materia prima dei pannelli della fase 6b. Per ogni attacco
provato, riuscito **o fallito**:

| Voce | Contenuto |
|---|---|
| Nome | breve, in italiano, memorabile |
| L'idea | due righe: cosa credeva di poter fare l'attaccante |
| Cosa ho eseguito | il comando o lo script, riproducibile |
| Esito misurato | verdetto nostro, verdetto `pdfsig`, verdetto `openssl`, byte alla mano |
| Cosa dimostra | la lezione, in una frase, per chi ascolta e non conosce il PDF |
| Gravità | bloccante / grave / minore / nota |

**Gli attacchi falliti valgono quanto quelli riusciti**, e vanno documentati con la stessa cura: è
il fallimento a dimostrare che il controllo esiste davvero, invece di essere raccontato.

Regola di onestà, e vale come criterio di accettazione: **solo attacchi eseguiti e misurati, con
la prova accanto.** Nessuna vulnerabilità teorica, nessun «si potrebbe anche». Se non è stato
provato, non entra — altrimenti in sede di presentazione la prima domanda scomoda smonta il pannello.

Chiudi con una sezione **«Cosa resta indifendibile per costruzione»**: i limiti che nessuna
riparazione può togliere, perché discendono dalle scelte dichiarate del progetto — certificato
autofirmato senza ancoraggio di fiducia, nessuna marca temporale, nessun controllo di revoca. Non
sono difetti: sono il confine del discorso, ed è più forte dichiararlo che farselo trovare.
