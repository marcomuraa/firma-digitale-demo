/**
 * machine.js — la macchina a stati della demo.
 *
 * QUESTO FILE E' UN CONTRATTO. Lo leggono le due direzioni visive, che disegnano la stessa
 * demo in due modi diversi e non devono calcolare niente due volte. Se qui una parola e'
 * ambigua, le due pagine divergono e il righello dei byte racconta due storie.
 *
 * La macchina esegue i dodici passi chiamando il motore di src/core/. Non disegna niente:
 * NESSUN DOM. Niente `document`, niente `window`, niente `canvas`, niente `localStorage`.
 * Gira in node esattamente come nel browser, e i test lo dimostrano percorrendo la demo
 * intera senza pagina. Il rendering del PDF sta in src/ui/pdf-render.js, che questo modulo
 * NON importa: pdf.js pesa 1,6 MB e non deve entrare nei test della logica.
 *
 * ============================================================================
 * L'API
 * ============================================================================
 *
 *   createDemo(opzioni?) -> {
 *     getState(),                    istantanea immutabile dello stato
 *     subscribe(fn) -> unsubscribe,  fn(istantanea) a ogni cambio di stato
 *     steps,                         gli stepId in ordine (da src/ui/steps.js), congelato
 *     canRun(stepId), run(stepId),   run e' asincrona e avanza lo stato
 *     restoreSigned(),               torna al PDF firmato integro, fra un attacco e l'altro.
 *                                    Sincrona, e a macchina ferma: mentre un passo gira mette
 *                                    `errore` e non tocca niente (vedi la sezione in fondo)
 *     reset(),                       sincrona, e funziona SEMPRE, anche a passo in corso
 *   }
 *
 * `createDemo()` si chiama senza argomenti. Le opzioni, tutte facoltative:
 *
 *   pdfBytes      Uint8Array   i byte del documento di partenza (default: il campione
 *                              incorporato in src/ui/sample-pdf.js). Ne viene tenuta una
 *                              COPIA: l'array resta del chiamante, e scriverci sopra dopo non
 *                              cambia il documento della demo.
 *   subjectCN     string       il Common Name del certificato ('Lorenzo Rossi')
 *   padding       number       byte riservati alla firma nel buco /Contents (4096)
 *   nuovoImporto  string       il testo che l'attacco 2 scrive al posto dell'importo
 *   adesso        () => Date   l'orologio, iniettabile per avere firme riproducibili nei test
 *
 * `run` e `restoreSigned` e `reset` restituiscono l'istantanea nuova (`run` come Promise).
 *
 * ============================================================================
 * LA FORMA DELLO STATO — campo per campo
 * ============================================================================
 *
 * getState() restituisce un oggetto NUOVO a ogni chiamata: i dati semplici sono congelati
 * (`Object.freeze`), i byte sono copie. Chi lo modifica non tocca la macchina, e non tocca
 * nemmeno l'istantanea che riceve la chiamata dopo.
 *
 *   passoCorrente   string|null   l'ultimo passo ESEGUITO CON SUCCESSO, o null se nessuno.
 *                                 Va in `data-passo-corrente` (docs/contratti-dom.md).
 *   passiFatti      string[]      gli stepId gia' eseguiti, nell'ordine in cui sono stati
 *                                 eseguiti (che e' anche quello di steps: si va in ordine).
 *   inCorso         string|null   il passo che sta girando adesso, null se la macchina e'
 *                                 ferma. Diventa non-null PRIMA del lavoro e torna null
 *                                 dopo: chi disegna ci appende lo stato di attesa.
 *
 *   documento       null | {
 *                     bytes:     Uint8Array   i byte correnti del documento
 *                     lunghezza: number       bytes.length, per non doverlo leggere
 *                     etichetta: Etichetta    che cosa sono quei byte (sotto)
 *                   }
 *                   null finche' non si esegue il passo `documento`: prima di cominciare non
 *                   c'e' nessun documento, e la fascia del righello resta vuota. Chi disegna,
 *                   se preferisce partire a fascia piena, chiami run('documento') all'avvio.
 *
 *   Etichetta, elenco chiuso — dice che cosa sono i byte correnti, non come sono andati i
 *   controlli (quello e' `verdetto`):
 *     'originale'           il campione come esce da src/assets/sample.pdf
 *     'con-placeholder'     c'e' il buco /Contents e il /ByteRange, la firma non c'e' ancora
 *     'firmato'             il CMS e' dentro il buco: il documento firmato integro
 *     'manomesso-cifra'     attacco 1a: un byte cambiato dentro la zona coperta
 *     'manomesso-lettere'   attacco 1b: "mille" -> "novemila", tre byte in piu', struttura rotta
 *     'esteso-in-coda'      attacco 2: incremental update appeso dopo la firma
 *
 *   righello        RulerViewModel|null   il ViewModel di buildRuler(), RICALCOLATO A OGNI
 *                                 CAMBIO DEI BYTE. Non ricalcolarlo: e' l'elemento firma
 *                                 condiviso, e due calcoli diversi sono due righelli diversi.
 *                                 Forma in docs/contratti-ui.md. Vale null solo prima del
 *                                 passo `documento`, o se i dati fossero cosi' incoerenti da
 *                                 non permettere un righello (non deve accadere: un test
 *                                 percorre la demo intera e lo pretende non nullo ogni volta).
 *                                 ATTENZIONE ai due assi: la copertura si legge da
 *                                 `segment.covered`, MAI da `segment.kind`.
 *
 *   evidenziazioni  Highlight[]   gli highlight per l'esadecimale pertinenti al passo
 *                                 corrente, gia' pronti per buildHexWindow(). Forma
 *                                 { id, start, end, kind, label }. Offset assoluti, `end`
 *                                 escluso, presi da src/assets/sample-offsets.json e dai
 *                                 risultati veri degli attacchi: nessuna stima.
 *
 *                                 QUALI `kind` ESCONO, passo per passo — misurato percorrendo
 *                                 la demo, non dedotto dal vocabolario. Chi disegna la legenda
 *                                 dei colori la copia da qui invece di indovinarla:
 *
 *                                   documento         object  (importo in cifre e in lettere)
 *                                   chiavi            —  array VUOTO
 *                                   certificato       —  array VUOTO
 *                                   placeholder       hole
 *                                   impronta          hole
 *                                   cms               —  array VUOTO
 *                                   firma             hole
 *                                   verifica          hole
 *                                   attacco-cifra     changed
 *                                   attacco-lettere   changed + structure (il /Length bugiardo)
 *                                   attacco-coda      tail
 *                                   chiusura          quelle del passo prima, mai riscritte
 *
 *                                 Tre passi — chiavi, certificato, cms — non parlano di byte
 *                                 del documento e AZZERANO l'array: il dump resta senza
 *                                 evidenziazioni e senza un offset su cui centrarsi. Decidere
 *                                 se tenere il dump del passo prima o mostrarlo spento e' di
 *                                 chi disegna, ma lo sappia adesso e non a schermo.
 *
 *                                 `changed` compare SOLO dopo un attacco. `target` non compare
 *                                 MAI qui: vive solo in `bersagli`. `covered` non e' un `kind`
 *                                 (docs/contratti-ui.md, i due assi).
 *
 *   bersagli        { [stepId]: Highlight[] }   costante, non cambia mai: il BERSAGLIO di
 *                                 ciascun attacco PRIMA che scatti, con kind 'target'. Serve
 *                                 a chi vuole mostrare dove sta per colpire mentre il
 *                                 documento e' ancora integro. Dopo, gli stessi byte
 *                                 compaiono in `evidenziazioni` con kind 'changed'.
 *                                 bersagli['attacco-coda'] e' VUOTO apposta: l'attacco 2 non
 *                                 tocca un solo byte del documento firmato, e questo e' il
 *                                 suo punto didattico.
 *
 *   chiavi          null | {
 *                     algoritmo: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusBits: 2048,
 *                     modulo:    Uint8Array   i 256 byte del modulo RSA
 *                     esponente: Uint8Array   di norma 01 00 01
 *                     spkiDer:   Uint8Array   SubjectPublicKeyInfo, come lo vuole il certificato
 *                   }
 *                   La coppia CryptoKey NON entra nello stato: non e' clonabile, quindi
 *                   romperebbe l'immutabilita' dell'istantanea, e a chi disegna non serve.
 *                   Resta chiusa dentro la macchina. Cio' che si mostra c'e' tutto.
 *
 *   certificato     null | {
 *                     der:        Uint8Array   il certificato X.509, per buildAsn1Tree()
 *                     subjectCN, issuerCN: string        identici: e' autofirmato
 *                     autofirmato: boolean
 *                     serial:     string       esadecimale minuscolo
 *                     notBefore, notAfter: Date
 *                     impronta:   string       SHA-256 del DER DEL CERTIFICATO, esadecimale.
 *                                              E' l'unica cosa che identifica davvero un
 *                                              certificato: il Common Name, nell'attacco
 *                                              dell'esca, e' uguale.
 *                                              E' LO STESSO NUMERO di verifica.identity
 *                                              .fingerprint — un valore, due nomi, uno in
 *                                              italiano e uno in inglese — e NON HA NIENTE A
 *                                              CHE VEDERE con `stato.impronta`, che e'
 *                                              l'impronta del DOCUMENTO. Due pannelli che
 *                                              mostrassero «l'impronta» pescandola da posti
 *                                              diversi mostrerebbero numeri diversi credendo
 *                                              di mostrare lo stesso.
 *                   }
 *
 *   cms             null | {
 *                     der:            Uint8Array   il SignedData, per buildAsn1Tree()
 *                     signedAttrsDer: Uint8Array   esattamente i byte su cui RSA ha lavorato
 *                     firma:          Uint8Array   i 256 byte della firma
 *                     lunghezza:      number       der.length
 *                     signingTime:    Date         la data DICHIARATA dal firmatario
 *                   }
 *
 *   byteRange       number[]|null   [a, b, c, d] nella convenzione PAdES, dal passo
 *                                   `placeholder` in poi. E' quello che il documento
 *                                   DICHIARA: dopo l'attacco 1b il file cresce e quei numeri
 *                                   restano fermi, ed e' proprio la bugia da mostrare.
 *   contentsStart   number|null     offset della `<` che apre il buco /Contents, DICHIARATO
 *                                   dal placeholder e mai rimisurato dopo. Vale la stessa
 *                                   cautela di `byteRange`, e non e' un dettaglio: l'attacco
 *                                   1b inserisce tre byte a offset 589, cioe' PRIMA del buco,
 *                                   e il buco vero slitta in avanti di tre mentre questo
 *                                   numero resta fermo. Misurato: dopo `attacco-lettere`
 *                                   contentsStart vale 1663 ma la `<` sta a 1666.
 *                                   Quindi «il buco e' [contentsStart, byteRange[2])» e' vero
 *                                   FINCHE' NESSUN ATTACCO ALLUNGA IL FILE DAL DI DENTRO, ed
 *                                   e' il buco DICHIARATO in ogni caso. Chi vuole sapere se
 *                                   coincide ancora con quello vero non deve rimisurarlo: il
 *                                   dato c'e' gia' ed e' calcolato da verify(), si chiama
 *                                   `verifica.coverage.gapMatchesContents` e vale true a ogni
 *                                   passo tranne `attacco-lettere`, dove vale false.
 *
 *   impronta        null | {          l'impronta DEL DOCUMENTO: SHA-256 dei due intervalli
 *                                     coperti dal /ByteRange. Non confonderla con
 *                                     `certificato.impronta`, che e' quella del CERTIFICATO.
 *                     digest: Uint8Array, hex: string,
 *                     intervalli: [[number, number], [number, number]],  i due intervalli coperti
 *                     byteCoperti: number, byteNonCoperti: number
 *                   }
 *
 *   verdetto        'valid'|'extended'|'invalid'|null   l'ultimo esito di verify(). Va in
 *                                   `data-verdetto` (docs/contratti-dom.md); null diventa ''.
 *   verifica        null | risultato completo di verify()   COSI' COM'E', con i suoi nomi
 *                                   inglesi. Il verdetto e' il PEGGIORE fra tutte le firme
 *                                   trovate e `signatures` le contiene tutte (docs/decisioni.md).
 *
 *                                   La forma, trascritta qui perche' i pannelli della fase 5
 *                                   la disegnano e non devono andarsela a cercare in
 *                                   src/core/verify.js:
 *
 *                                     verdict   'valid' | 'extended' | 'invalid'
 *                                     coverage  null | { byteRange: number[], fileLength,
 *                                               coveredBytes, uncoveredTail,
 *                                               complete: boolean, gapMatchesContents: boolean }
 *                                     digest    null | { expected: hex, actual: hex|null,
 *                                                        match: boolean }
 *                                     signature null | { ok: boolean }
 *                                     identity  null | { selfSigned: boolean,
 *                                                        subjectCN: string|null,
 *                                                        issuerCN: string|null,
 *                                                        fingerprint: hex }
 *                                     reason    string|null   codice breve, elenco chiuso
 *                                     error     string|null   la frase in italiano corrispondente
 *                                     signatures[]  una voce per OGNI dizionario di firma
 *                                               trovato, in ordine di file: { index, byteRange,
 *                                               contentsStart, coverage, digest, signature,
 *                                               identity, verdict, reason, error }
 *                                     multipleSignatures  boolean
 *
 *                                   LE DUE IMPRONTE A CONFRONTO, quelle che il pannello della
 *                                   verifica mette una sopra l'altra, sono `digest.expected`
 *                                   (quella scritta DENTRO la firma, che l'attaccante non puo'
 *                                   cambiare senza rompere la firma) contro `digest.actual`
 *                                   (quella dei byte che si hanno in mano adesso). Non e'
 *                                   `stato.impronta.hex`, che e' una terza cosa: l'impronta
 *                                   calcolata dalla demo al passo 5, prima di firmare.
 *
 *                                   L'IDENTITA' DEL FIRMATARIO ha due sorgenti con nomi
 *                                   diversi e non sono intercambiabili: `stato.certificato` e'
 *                                   il certificato che la demo ha COSTRUITO, `verifica.identity`
 *                                   e' quello che verify() ha RILETTO dal file. Su un documento
 *                                   integro dicono la stessa cosa; nell'attacco dell'esca
 *                                   sarebbero due certificati diversi con lo stesso Common Name,
 *                                   ed e' li' che la differenza conta. Il pannello del verdetto
 *                                   mostri `verifica.identity`, che e' cio' che un verificatore
 *                                   vede davvero.
 *
 *                                   I `reason` sono un ELENCO CHIUSO di dodici codici, scritto
 *                                   in src/core/verify.js, sezione «I `reason` possibili»:
 *                                   input-non-valido · nessuna-firma · byterange-illeggibile ·
 *                                   contents-illeggibile · firma-non-riempita · cms-illeggibile ·
 *                                   certificato-assente · certificato-illeggibile ·
 *                                   algoritmo-non-supportato · copertura-fuori-dal-file ·
 *                                   firma-non-verificabile · errore-interno.
 *                                   Vale null quando il verdetto viene dai tre controlli e non
 *                                   da un intoppo, ed e' il caso normale della demo: nei dodici
 *                                   passi `reason` ed `error` sono sempre null.
 *
 *   errore          null | { passo: string|null, messaggio: string }
 *                                   Un passo che fallisce NON lancia: mette qui una frase in
 *                                   italiano e lascia la demo navigabile. Si azzera al primo
 *                                   passo che riesce, e con reset().
 *
 *   ripristinato    boolean         vero quando l'ultimo movimento e' stato restoreSigned():
 *                                   il documento e' tornato integro ma il pannello
 *                                   dell'attacco e' ancora in pagina. Torna falso appena si
 *                                   esegue un altro passo.
 *
 *   risultati       { [stepId]: Risultato }   IL MATERIALE CONGELATO, un blocco per passo
 *                                   eseguito. Nessun passo successivo lo riscrive: e' questo
 *                                   che permette ai pannelli di impilarsi invece di
 *                                   cancellarsi. Dopo l'attacco 1a, risultati['verifica']
 *                                   contiene ancora il verdetto verde, il suo righello e le
 *                                   sue evidenziazioni, esattamente come erano.
 *
 * ----------------------------------------------------------------------------
 * risultati[stepId] — che cosa trova gia' pronto chi disegna un pannello
 * ----------------------------------------------------------------------------
 * Ogni risultato ha sempre `passo` (lo stepId). I passi che cambiano i byte hanno sempre
 * anche `bytes`, `etichetta`, `righello` e `evidenziazioni` DI QUEL MOMENTO: un pannello e'
 * autosufficiente e resta vero anche dieci passi dopo.
 *
 *   documento        bytes, etichetta, lunghezza, sha256, testo (le righe del documento,
 *                    da sample-offsets.json), righello, evidenziazioni
 *   chiavi           algoritmo, hash, modulusBits, modulo, esponente, spkiDer
 *   certificato      der, subjectCN, issuerCN, autofirmato, serial, notBefore, notAfter, impronta
 *   placeholder      bytes, etichetta, lunghezza, byteRange, contentsStart, contentsEnd,
 *                    padding, lunghezzaPrima, crescita, signingTime, righello, evidenziazioni
 *   impronta         digest, hex, intervalli, byteCoperti, byteNonCoperti, algoritmo,
 *                    righello, evidenziazioni
 *   cms              der, signedAttrsDer, firma, lunghezza, signingTime
 *   firma            bytes, etichetta, lunghezza, byteCms, capacitaBuco, zeriDiRiempimento,
 *                    righello, evidenziazioni
 *   verifica         verdetto, esito (il risultato di verify() per intero), righello,
 *                    evidenziazioni
 *   attacco-cifra    bytes, etichetta, lunghezza, offset, da, a, deltaLunghezza (0),
 *                    testoDopo, verdetto, esito, righello, evidenziazioni
 *   attacco-lettere  bytes, etichetta, lunghezza, offset, da, a, deltaLunghezza (+3),
 *                    lunghezzaRotta, xrefRotta, prove (i disallineamenti misurati),
 *                    ilRendererApreLoStesso (true: MISURATO, vedi sotto), testoDopo,
 *                    verdetto, esito, righello, evidenziazioni
 *   attacco-coda     bytes, etichetta, lunghezza, appendedFrom, byteAppesi, testoNuovo,
 *                    verdetto, esito, righello, evidenziazioni
 *   chiusura         riepilogo: una riga per ciascuno dei quattro verdetti misurati
 *                    ({ passo, etichetta, lunghezza, verdetto, improntaTorna, firmaTorna,
 *                    codaNonCoperta, copertaTutta })
 *
 * Cio' che invece chi disegna calcola da se', perche' dipende da come ha deciso di disegnare:
 *   - la finestra esadecimale: buildHexWindow(bytes, centro, ampiezza, evidenziazioni) —
 *     e' lui a scegliere dove centrarla e quanto larga;
 *   - l'albero ASN.1: buildAsn1Tree(certificato.der) e buildAsn1Tree(cms.der) — funzione
 *     pura, il DER sta gia' nello stato;
 *   - i testi: src/ui/copy.it.js, per panelId. La macchina non produce nessuna frase
 *     destinata all'occhio, tranne le etichette brevi degli highlight e il messaggio di
 *     `errore`;
 *   - il rendering del documento: renderPdfToCanvas(documento.bytes, canvas) di
 *     src/ui/pdf-render.js.
 *
 * ============================================================================
 * LE REGOLE, e perche' sono queste
 * ============================================================================
 *
 * 1. I PANNELLI SI IMPILANO, NON SI CANCELLANO. Decisione presa nell'intervista (Q5). La
 *    conseguenza tecnica e' `risultati`: ogni passo congela il suo materiale e nessuno lo
 *    riscrive mai. Da qui discende anche la regola dell'ordine qui sotto.
 *
 * 2. OGNI PASSO SI ESEGUE UNA VOLTA SOLA. canRun(stepId) e' vero quando: lo stepId esiste,
 *    nessun altro passo sta girando, tutti i passi precedenti sono fatti, e QUESTO non lo e'
 *    ancora. Il motivo del divieto di ripetere: rieseguire `verifica` dopo un attacco
 *    riscriverebbe risultati['verifica'] con un verdetto rosso, cioe' cancellerebbe il
 *    pannello verde che deve restare in pagina. Per ricominciare c'e' reset().
 *    Un passo FALLITO non risulta fatto: si puo' ritentare.
 *
 * 3. GLI ATTACCHI PARTONO SEMPRE DAL FIRMATO INTEGRO, mai dal documento corrente. Cosi' i
 *    tre attacchi sono indipendenti e ripetibili nell'ordine che si vuole, e non si formano
 *    ibridi (1a + 1b insieme) che nessuno ha mai misurato. restoreSigned() resta comunque
 *    l'azione che riporta a schermo il documento integro fra un attacco e l'altro: e' un
 *    fatto della narrazione, non un prerequisito tecnico.
 *
 * 4. NIENTE ESPLODE. Da run() non esce mai un'eccezione: un passo che fallisce mette
 *    `errore` con una frase in italiano, non finisce in `passiFatti`, e tutto il resto dello
 *    stato resta com'era. La demo continua a essere navigabile.
 *
 * 5. L'ATTACCO 1b NON FA FALLIRE IL RENDERING. Misurato, non supposto (docs/stato.md punto
 *    2): il file e' davvero incoerente — /Length dichiara 650 e i byte sono 653, startxref
 *    dichiara 1026 e la tabella e' a 1029 — ma sia pdf.js sia poppler lo ricostruiscono e
 *    disegnano «1.000 euro (novemila euro)». Qui non c'e' nessun codice che aspetti un
 *    rifiuto: il passo riesce, il verdetto e' `invalid`, e `prove` porta i disallineamenti
 *    misurati. La morale onesta e' piu' forte di quella pianificata: il renderer perdona,
 *    la firma no.
 *
 * ============================================================================
 * restoreSigned() e reset() rispetto alla storia — scelta esplicita
 * ============================================================================
 *
 * restoreSigned() NON tocca la storia. `passiFatti`, `passoCorrente` e tutto `risultati`
 * restano identici: i pannelli gia' aperti devono restare aperti, compreso quello
 * dell'attacco appena mostrato. Tornano indietro soltanto le cose «correnti»: `documento`
 * ai byte del firmato integro, `righello` ricalcolato su quelli, `verdetto` e `verifica`
 * alla copia congelata del passo `verifica`, `evidenziazioni` a quelle del passo `verifica`
 * (i byte cambiati non ci sono piu': continuare a evidenziarli sarebbe una bugia). In piu'
 * `ripristinato` diventa vero. E' sincrona: non ricalcola niente, ripesca cio' che era gia'
 * stato calcolato e congelato. Chiamarla prima del passo `firma` non fa niente e mette
 * `errore` — non c'e' nessun firmato integro a cui tornare.
 *
 * reset() CANCELLA la storia: si torna esattamente allo stato iniziale, `risultati` vuoto,
 * nessun passo fatto, documento null, chiavi e certificato buttati. E' l'unico modo di
 * rieseguire un passo, ed e' voluto che sia vistoso: mezza demo ripercorsa a caso sarebbe
 * peggio di una demo ricominciata.
 *
 * ============================================================================
 * E se si clicca MENTRE un passo gira — la regola, e perche' e' asimmetrica
 * ============================================================================
 *
 * Tre cose sono cliccabili in qualunque momento: i comandi dei passi, «ripristina» e
 * «ricomincia» (docs/contratti-dom.md li rende obbligatori, ed espone anche `window.__demo`).
 * `chiavi` genera un RSA-2048 e non e' istantaneo: un clic durante un passo non e' un caso di
 * laboratorio, e' quello che succede quando qualcuno si spazientisce davanti al proiettore.
 *
 *   run(altro)      RIFIUTATO mentre un passo gira: «un passo per volta». Era gia' cosi'.
 *   restoreSigned() RIFIUTATO mentre un passo gira, con `errore` in italiano e senza toccare
 *                   niente. Il motivo non e' la purezza: se ripristinasse a meta' di un
 *                   attacco, il passo in volo congelerebbe nel suo pannello il documento
 *                   RIPRISTINATO — un pannello «la cifra falsificata» che mostra il documento
 *                   integro, senza il byte evidenziato, per sempre (regola 1: nessuno lo
 *                   riscrive piu'). A macchina ferma funziona come sempre.
 *   reset()         FUNZIONA SEMPRE, anche a passo in corso: e' il bottone di emergenza, e
 *                   davanti a una sala deve rispondere. Il passo in volo non viene
 *                   aspettato: quando finisce si accorge che la demo di cui faceva parte non
 *                   esiste piu' (un contatore di generazione, incrementato da reset()) e
 *                   scarta in silenzio cio' che ha calcolato. Non finisce in `passiFatti`, non
 *                   scrive in `risultati`, non lascia un errore. Senza questo si otteneva un
 *                   vicolo cieco misurato: passiFatti = ['chiavi'] con stato.chiavi = null,
 *                   cioe' un passo «fatto» privo degli effetti che quel passo produce, e le
 *                   chiavi non piu' rigenerabili se non con un secondo reset().
 *
 * In piu', e vale per ogni passo: cio' che finisce in `risultati` sono i VALORI che l'esecutore
 * ha calcolato, non una rilettura dello stato dopo l'await. Un pannello congelato non puo'
 * cambiare per colpa di quello che succede mentre il suo passo aspetta.
 *
 * ============================================================================
 * Il righello sul file firmato — decisione, e verificata da un test
 * ============================================================================
 *
 * Gli `objects` del righello vengono da `sections[]` di sample-offsets.json, che tassellano
 * i 1285 byte del campione. Dopo il placeholder il file e' lungo ~10.700 byte: dei 9.400 in
 * piu' le sezioni non dicono niente. Non li inventiamo e non li lasciamo scoperti:
 *
 *   - le dieci sezioni del campione restano quelle, con il loro `kind` (header, xref,
 *     trailer, startxref e %%EOF sono 'structure', i cinque oggetti PDF sono 'object':
 *     e' la tabella di docs/contratti-ui.md, non un'invenzione);
 *   - la parte appesa diventa UN oggetto solo, «Aggiornamento incrementale: la firma»,
 *     da 1285 alla fine del file. buildRuler lo fora da se' col buco /Contents e con la
 *     coda dell'attacco 2, quindi si vede la firma spezzata attorno al suo buco;
 *   - tutto cio' che nessuno rivendica lo completa buildRuler come 'structure', ed e' il
 *     suo invariante: i segmenti tassellano [0, fileLength) comunque.
 *
 * Dopo l'attacco 1b il file cresce di tre byte NEL MEZZO (a 589): ogni confine che sta
 * dopo quel punto viene traslato di tre, altrimenti la mappa anatomica indicherebbe
 * l'oggetto 5 tre byte prima di dove sta davvero. La traslazione e' calcolata dal delta
 * misurato, non scritta a mano.
 *
 * ATTENZIONE, perche' e' una tacca che si legge male. Il /ByteRange resta fermo mentre il file
 * si allunga, quindi dopo l'attacco 1b nel righello compaiono anche una CODA `tail` di
 * `deltaLunghezza` byte (tre) e la sua tacca «Fine della copertura», e la copertura risulta
 * incompleta. Quei tre byte NON SONO UN APPEND: nessuno ha appeso niente dopo la firma, e' il
 * fondo del file spinto in avanti dall'inserzione avvenuta a meta' documento. Il vocabolario di
 * docs/contratti-ui.md spiega `tail` come «l'incremental update dell'attacco 2»: chi colora
 * quella banda con la storia dell'attacco 2 al passo 1b racconta al pubblico una cosa falsa.
 *
 * Le due code si distinguono senza indovinare, con dati gia' calcolati:
 *
 *   - lo slittamento di 1b: `coverage.tailBytes` vale `risultati['attacco-lettere']
 *     .deltaLunghezza` (3) e `esito.coverage.gapMatchesContents` e' FALSE — il buco dichiarato
 *     non coincide piu' con quello vero, cioe' il file e' cresciuto dal di dentro;
 *   - l'append vero dell'attacco 2: la coda e' `risultati['attacco-coda'].byteAppesi` (885) e
 *     `gapMatchesContents` resta TRUE — il buco e' dove lo si era lasciato, i byte sono
 *     arrivati dopo.
 *
 * Il righello resta com'e': disegna la copertura DICHIARATA dalla firma, che e' la sola cosa
 * che un verificatore ha. Traslare il byteRange per far tornare i conti nasconderebbe proprio
 * la bugia che la demo deve mostrare.
 *
 * Ambiente: browser e node. Nessun import di node, nessun `Buffer`, nessun `fs`: i byte del
 * campione arrivano da src/ui/sample-pdf.js, che e' un modulo di testo.
 */

import offsets from '../assets/sample-offsets.json' with { type: 'json' }
import { sha256, toHex } from '../core/bytes.js'
import {
  appendIncrementalUpdate,
  tamperDigit,
  tamperWords,
} from '../core/attacks.js'
import { buildSelfSigned } from '../core/certificate.js'
import { buildSignedData } from '../core/cms.js'
import { KEY_PARAMS, describePublicKey, exportPublicKeySpki, generateKeyPair } from '../core/keys.js'
import { addPlaceholder, digestCovered, injectSignature } from '../core/pades.js'
import { verify } from '../core/verify.js'
import { buildRuler } from '../views/byte-ruler.js'
import { STEP_IDS } from './steps.js'
import { samplePdfBytes } from './sample-pdf.js'

/* ------------------------------------------------------------------ costanti della demo */

/**
 * Le sezioni del campione che sono STRUTTURA e non oggetti PDF, secondo la tabella dei
 * `kind` di docs/contratti-ui.md: «header, xref, trailer, startxref, %%EOF». Gli id sono
 * quelli congelati in sample-offsets.json; tutto il resto e' 'object'.
 */
const SEZIONI_STRUTTURALI = new Set(['header', 'xref', 'trailer', 'startxref', 'eof'])

/** L'etichetta del blocco appeso dal placeholder: un oggetto solo, quello che la firma aggiunge. */
const ETICHETTA_AGGIORNAMENTO = 'Aggiornamento incrementale: la firma'

/** Valori predefiniti delle opzioni di createDemo(). */
const PREDEFINITI = Object.freeze({
  subjectCN: 'Lorenzo Rossi', // il nome che il documento stesso porta scritto
  padding: 4096, // 4096 byte = ~2 KB di CMS piu' aria: gli 8192 di default allungano il dump
  nuovoImporto: '1.000.000 euro (un milione di euro)',
})

/* ------------------------------------------------------------------ la macchina */

/**
 * Costruisce la macchina a stati della demo.
 *
 * @param {object} [opzioni]
 * @param {Uint8Array} [opzioni.pdfBytes]  documento di partenza (default: il campione)
 * @param {string} [opzioni.subjectCN]
 * @param {number} [opzioni.padding]
 * @param {string} [opzioni.nuovoImporto]
 * @param {() => Date} [opzioni.adesso]
 * @returns {{ getState: Function, subscribe: Function, steps: string[],
 *             canRun: Function, run: Function, restoreSigned: Function, reset: Function }}
 */
export function createDemo(opzioni = {}) {
  const configurazione = {
    // Una COPIA dei byte ricevuti: se il chiamante tenesse il suo array e ci scrivesse sopra
    // dopo, cambierebbe il documento della demo da fuori. Cio' che non e' un Uint8Array passa
    // di qui intatto, perche' sia il passo `documento` a rifiutarlo con la sua frase.
    pdfBytes:
      opzioni.pdfBytes instanceof Uint8Array
        ? new Uint8Array(opzioni.pdfBytes)
        : (opzioni.pdfBytes ?? samplePdfBytes()),
    subjectCN: opzioni.subjectCN ?? PREDEFINITI.subjectCN,
    padding: opzioni.padding ?? PREDEFINITI.padding,
    nuovoImporto: opzioni.nuovoImporto ?? PREDEFINITI.nuovoImporto,
    adesso: typeof opzioni.adesso === 'function' ? opzioni.adesso : () => new Date(),
  }

  /** Cio' che non entra nell'istantanea: le CryptoKey e i byte da cui ripartono gli attacchi. */
  let segreti = statoSegretoVuoto()
  /** Lo stato vero, mutabile, che nessuno vede dall'esterno se non come istantanea. */
  let stato = statoIniziale()
  /**
   * Il numero della demo corrente. reset() lo incrementa e butta via lo stato; un passo
   * partito prima lo confronta quando torna dall'await e, se e' cambiato, scarta in silenzio
   * cio' che ha calcolato. Senza questo contatore l'esecutore in volo continuerebbe a scrivere
   * negli OGGETTI vecchi mentre run() registra il passo nella VARIABILE nuova: passiFatti
   * direbbe «chiavi» e stato.chiavi sarebbe null, e la demo finirebbe in un vicolo cieco.
   */
  let generazione = 0
  const abbonati = new Set()

  const macchina = {
    /** @returns {object} istantanea immutabile, nuova a ogni chiamata */
    getState() {
      return istantanea(stato)
    },

    subscribe(fn) {
      if (typeof fn !== 'function') {
        throw new TypeError('subscribe vuole una funzione da chiamare a ogni cambio di stato')
      }
      abbonati.add(fn)
      return function unsubscribe() {
        abbonati.delete(fn)
      }
    },

    steps: Object.freeze([...STEP_IDS]),

    canRun(stepId) {
      return motivoDelRifiuto(stato, stepId) === null
    },

    async run(stepId) {
      const rifiuto = motivoDelRifiuto(stato, stepId)
      if (rifiuto !== null) {
        stato.errore = { passo: STEP_IDS.includes(stepId) ? stepId : null, messaggio: rifiuto }
        avvisa()
        return macchina.getState()
      }

      // L'oggetto di stato e il numero di demo di QUESTA corsa, fissati adesso: da qui in poi
      // le variabili di chiusura possono cambiare sotto i piedi (reset() le riassegna).
      const mio = stato
      const miaGenerazione = generazione

      mio.inCorso = stepId
      avvisa()

      let risultato = null
      let problema = null
      try {
        risultato = await ESECUTORI[stepId]({ stato: mio, segreti, configurazione })
      } catch (guasto) {
        problema = guasto
      }

      // reset() durante il passo: cio' che abbiamo calcolato appartiene a una demo che non
      // esiste piu'. Si scarta in silenzio, senza scrivere niente: registrarlo nello stato
      // nuovo darebbe un passo «fatto» privo degli effetti che quel passo produce.
      if (generazione !== miaGenerazione) return macchina.getState()

      mio.inCorso = null
      if (problema === null) {
        mio.risultati[stepId] = { passo: stepId, ...risultato }
        mio.passiFatti = [...mio.passiFatti, stepId]
        mio.passoCorrente = stepId
        mio.ripristinato = false
        mio.errore = null
      } else {
        // Regola 4: da qui non esce niente. Lo stato resta quello di prima, piu' l'errore.
        mio.errore = {
          passo: stepId,
          messaggio: `Il passo «${stepId}» non e' riuscito: ${messaggioDi(problema)}`,
        }
      }

      avvisa()
      return macchina.getState()
    },

    restoreSigned() {
      // A macchina in moto no: il passo in volo scriverebbe `documento`, `righello` e
      // `evidenziazioni` dopo di noi, e il pannello che sta per congelare mostrerebbe il
      // documento ripristinato al posto di quello attaccato. E' la stessa regola di run().
      if (stato.inCorso !== null) {
        stato.errore = {
          passo: stato.inCorso,
          messaggio:
            `Il passo «${stato.inCorso}» sta ancora girando: il ripristino si fa a macchina ` +
            'ferma.',
        }
        avvisa()
        return macchina.getState()
      }

      const firmato = segreti.firmatoIntegro
      const verificaCongelata = stato.risultati.verifica ?? null
      if (!firmato || !verificaCongelata) {
        stato.errore = {
          passo: null,
          messaggio:
            "Non c'e nessun documento firmato a cui tornare: il ripristino serve fra un " +
            "attacco e l'altro, e prima vanno eseguiti i passi «firma» e «verifica».",
        }
        avvisa()
        return macchina.getState()
      }

      stato.documento = { bytes: firmato, lunghezza: firmato.length, etichetta: 'firmato' }
      stato.righello = costruisciRighello(stato)
      stato.evidenziazioni = verificaCongelata.evidenziazioni
      stato.verdetto = verificaCongelata.verdetto
      stato.verifica = verificaCongelata.esito
      stato.ripristinato = true
      stato.errore = null
      avvisa()
      return macchina.getState()
    },

    reset() {
      // Funziona SEMPRE, anche mentre un passo gira: e' il bottone di emergenza, e davanti a
      // una sala deve rispondere. Il passo in volo continua a scrivere negli oggetti
      // vecchi — che qui vengono buttati — e quando torna vede `generazione` cambiata e si
      // scarta da solo.
      generazione += 1
      stato = statoIniziale()
      segreti = statoSegretoVuoto()
      avvisa()
      return macchina.getState()
    },
  }

  /** Notifica gli abbonati. Uno che lancia non ferma gli altri e non ferma la macchina. */
  function avvisa() {
    for (const abbonato of [...abbonati]) {
      try {
        abbonato(macchina.getState())
      } catch (problema) {
        // Un errore di chi disegna non e' un errore della demo: non finisce in `errore`,
        // ma non viene nemmeno inghiottito in silenzio.
        console.error('machine: un abbonato ha lanciato durante la notifica', problema)
      }
    }
  }

  return macchina
}

/* ------------------------------------------------------------------ stato iniziale */

function statoIniziale() {
  return {
    passoCorrente: null,
    passiFatti: [],
    inCorso: null,
    documento: null,
    righello: null,
    evidenziazioni: [],
    bersagli: BERSAGLI,
    chiavi: null,
    certificato: null,
    cms: null,
    byteRange: null,
    contentsStart: null,
    impronta: null,
    verdetto: null,
    verifica: null,
    errore: null,
    ripristinato: false,
    risultati: {},
  }
}

function statoSegretoVuoto() {
  return { coppia: null, firmatoIntegro: null, signingTime: null }
}

/* ------------------------------------------------------------------ ordine dei passi */

/**
 * Perche' un passo non si puo' eseguire adesso, in italiano, oppure null se si puo'.
 * E' una funzione sola perche' canRun() e run() devono rispondere alla stessa domanda: se
 * divergessero, un comando abilitato a schermo fallirebbe al clic.
 */
function motivoDelRifiuto(stato, stepId) {
  if (typeof stepId !== 'string' || !STEP_IDS.includes(stepId)) {
    return `«${comeSiChiama(stepId)}» non e' uno dei dodici passi della demo.`
  }
  if (stato.inCorso !== null) {
    return `Il passo «${stato.inCorso}» sta ancora girando: un passo per volta.`
  }
  if (stato.passiFatti.includes(stepId)) {
    return (
      `Il passo «${stepId}» e' gia' stato eseguito, e i pannelli non si riscrivono: ` +
      'per ripercorrere la demo si ricomincia con reset().'
    )
  }
  const mancanti = STEP_IDS.slice(0, STEP_IDS.indexOf(stepId)).filter(
    (passo) => !stato.passiFatti.includes(passo),
  )
  if (mancanti.length > 0) {
    return `Prima del passo «${stepId}» ne mancano altri: ${mancanti.join(', ')}.`
  }
  return null
}

/**
 * Come nominare, dentro un messaggio, qualcosa che non e' uno stepId.
 *
 * `String(x)` su un oggetto chiama il suo `toString`, e un oggetto ostile puo' lanciare da li'
 * — facendo uscire un'eccezione da run() e da canRun(), cioe' proprio cio' che la regola 4
 * vieta. Sugli oggetti quindi non si chiama niente: si dice il tipo e basta.
 */
function comeSiChiama(stepId) {
  if (typeof stepId === 'string') return stepId
  if (stepId === null) return 'null'
  const tipo = typeof stepId
  if (tipo === 'undefined' || tipo === 'number' || tipo === 'boolean' || tipo === 'bigint') {
    return String(stepId)
  }
  if (tipo === 'symbol') return 'un simbolo'
  return `un valore di tipo ${tipo}`
}

/* ------------------------------------------------------------------ i dodici passi */

/**
 * Un esecutore riceve { stato, segreti, configurazione }, fa il suo lavoro chiamando
 * src/core/, aggiorna i campi «correnti» dello stato e restituisce il materiale da
 * congelare in `risultati`. Se lancia, run() lo cattura: qui dentro si puo' lanciare, ed e'
 * il modo giusto di dire «questo passo non e' riuscito».
 */
const ESECUTORI = {
  async documento({ stato, configurazione }) {
    const bytes = configurazione.pdfBytes
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      throw new Error(
        'il documento di partenza deve essere un Uint8Array non vuoto: senza byte non c\'e' +
          ' niente da firmare',
      )
    }
    stato.documento = { bytes, lunghezza: bytes.length, etichetta: 'originale' }
    stato.byteRange = null
    stato.contentsStart = null
    const vista = aggiornaVista(stato, evidenziazioniImporto())

    return {
      bytes,
      etichetta: 'originale',
      lunghezza: bytes.length,
      sha256: toHex(await sha256(bytes)),
      testo: offsets.text.lines,
      righello: vista.righello,
      evidenziazioni: vista.evidenziazioni,
    }
  },

  async chiavi({ stato, segreti }) {
    const coppia = await generateKeyPair()
    const spkiDer = await exportPublicKeySpki(coppia.publicKey)
    const descrizione = await describePublicKey(coppia.publicKey)
    segreti.coppia = coppia

    stato.chiavi = {
      algoritmo: KEY_PARAMS.name,
      hash: KEY_PARAMS.hash,
      modulusBits: descrizione.modulusBits,
      modulo: descrizione.modulus,
      esponente: descrizione.exponent,
      spkiDer,
    }
    stato.evidenziazioni = []
    return { ...stato.chiavi }
  },

  async certificato({ stato, segreti, configurazione }) {
    if (!segreti.coppia) throw new Error('mancano le chiavi: il passo «chiavi» non ha prodotto niente')
    const { certDer, notBefore, notAfter, serial } = await buildSelfSigned({
      publicKey: segreti.coppia.publicKey,
      privateKey: segreti.coppia.privateKey,
      subjectCN: configurazione.subjectCN,
      now: configurazione.adesso(),
    })

    stato.certificato = {
      der: certDer,
      subjectCN: configurazione.subjectCN,
      issuerCN: configurazione.subjectCN, // autofirmato: emittente e soggetto sono lo stesso nome
      autofirmato: true,
      serial,
      notBefore,
      notAfter,
      impronta: toHex(await sha256(certDer)),
    }
    stato.evidenziazioni = []
    return { ...stato.certificato }
  },

  async placeholder({ stato, segreti, configurazione }) {
    const originale = stato.risultati.documento.bytes
    const signingTime = configurazione.adesso()
    const { pdfWithHole, byteRange, contentsStart } = addPlaceholder(originale, {
      padding: configurazione.padding,
      signingTime,
    })
    segreti.signingTime = signingTime

    stato.documento = {
      bytes: pdfWithHole,
      lunghezza: pdfWithHole.length,
      etichetta: 'con-placeholder',
    }
    stato.byteRange = byteRange
    stato.contentsStart = contentsStart
    const vista = aggiornaVista(stato, evidenziazioniBuco(stato, 'Buco /Contents: qui andra\' la firma'))

    return {
      bytes: pdfWithHole,
      etichetta: 'con-placeholder',
      lunghezza: pdfWithHole.length,
      byteRange,
      contentsStart,
      contentsEnd: byteRange[2], // il buco e' [contentsStart, byteRange[2])
      padding: configurazione.padding,
      lunghezzaPrima: originale.length,
      crescita: pdfWithHole.length - originale.length,
      signingTime,
      righello: vista.righello,
      evidenziazioni: vista.evidenziazioni,
    }
  },

  async impronta({ stato }) {
    // I byte non cambiano: il righello resta quello del placeholder. Lo si prende PRIMA
    // dell'await, cosi' il pannello e' quello di questo momento e non di un altro.
    const righello = stato.righello
    const [a, b, c, d] = stato.byteRange
    const digest = await digestCovered(stato.documento.bytes, stato.byteRange)
    const intervalli = [
      [a, a + b],
      [c, c + d],
    ]

    stato.impronta = {
      digest,
      hex: toHex(digest),
      intervalli,
      byteCoperti: b + d,
      byteNonCoperti: c - (a + b),
    }
    const evidenziazioni = evidenziazioniBuco(
      stato,
      "Buco /Contents: l'unica parte che l'impronta non copre",
    )
    stato.evidenziazioni = evidenziazioni
    return {
      ...stato.impronta,
      algoritmo: 'SHA-256',
      righello,
      evidenziazioni,
    }
  },

  async cms({ stato, segreti }) {
    if (!segreti.coppia) throw new Error('mancano le chiavi: il passo «chiavi» non ha prodotto niente')
    const signingTime = segreti.signingTime ?? new Date()
    const { cmsDer, signedAttrsDer, signature } = await buildSignedData({
      messageDigest: stato.impronta.digest,
      certDer: stato.certificato.der,
      privateKey: segreti.coppia.privateKey,
      signingTime,
    })

    stato.cms = {
      der: cmsDer,
      signedAttrsDer,
      firma: signature,
      lunghezza: cmsDer.length,
      signingTime,
    }
    stato.evidenziazioni = []
    return { ...stato.cms }
  },

  async firma({ stato, segreti, configurazione }) {
    const conBuco = stato.risultati.placeholder.bytes
    const firmato = injectSignature(conBuco, stato.contentsStart, stato.cms.der)
    segreti.firmatoIntegro = firmato

    stato.documento = { bytes: firmato, lunghezza: firmato.length, etichetta: 'firmato' }
    const vista = aggiornaVista(stato, evidenziazioniBuco(stato, 'La firma CMS, dentro il /Contents'))

    return {
      bytes: firmato,
      etichetta: 'firmato',
      lunghezza: firmato.length,
      byteCms: stato.cms.lunghezza,
      capacitaBuco: configurazione.padding,
      zeriDiRiempimento: configurazione.padding - stato.cms.lunghezza,
      righello: vista.righello,
      evidenziazioni: vista.evidenziazioni,
    }
  },

  async verifica({ stato }) {
    // Il righello e' quello del passo `firma`: i byte non cambiano. Preso prima dell'await.
    const righello = stato.righello
    const esito = await verify(stato.documento.bytes)
    stato.verdetto = esito.verdict
    stato.verifica = esito
    const evidenziazioni = evidenziazioniBuco(stato, 'Il buco /Contents, escluso dalla copertura')
    stato.evidenziazioni = evidenziazioni

    return {
      verdetto: esito.verdict,
      esito,
      righello,
      evidenziazioni,
    }
  },

  async 'attacco-cifra'({ stato, segreti }) {
    const { bytes, offset, from, to } = tamperDigit(daFirmatoIntegro(segreti))
    const { esito, righello, evidenziazioni } = await applicaAttacco(
      stato,
      bytes,
      'manomesso-cifra',
      [
        {
          id: 'cifra-cambiata',
          start: offset,
          end: offset + 1,
          kind: 'changed',
          label: `La cifra "${from}" e' diventata "${to}"`,
        },
      ],
    )

    return {
      bytes,
      etichetta: 'manomesso-cifra',
      lunghezza: bytes.length,
      offset,
      da: from,
      a: to,
      deltaLunghezza: 0,
      testoDopo: offsets.attacks.tamperDigit.textAfter,
      verdetto: esito.verdict,
      esito,
      righello,
      evidenziazioni,
    }
  },

  async 'attacco-lettere'({ stato, segreti }) {
    const manomesso = tamperWords(daFirmatoIntegro(segreti))
    const da = offsets.attacks.tamperWords.from
    const a = offsets.attacks.tamperWords.to

    const daEvidenziare = [
      {
        id: 'lettere-cambiate',
        start: manomesso.offset,
        end: manomesso.offset + a.length,
        kind: 'changed',
        label: `"${da}" e' diventato "${a}"`,
      },
    ]
    // Il /Length non e' piu' quello vero: sono i byte che raccontano la struttura rotta, e
    // le loro posizioni escono dalla rilettura del file manomesso, non da una costante.
    const lunghezza = manomesso.evidence?.length
    if (lunghezza && Number.isInteger(lunghezza.valueStart) && Number.isInteger(lunghezza.valueEnd)) {
      daEvidenziare.push({
        id: 'length-incoerente',
        start: lunghezza.valueStart,
        end: lunghezza.valueEnd,
        kind: 'structure',
        label: `/Length dichiara ${lunghezza.declared}, lo stream ne contiene ${lunghezza.actual}`,
      })
    }

    const { esito, righello, evidenziazioni } = await applicaAttacco(
      stato,
      manomesso.bytes,
      'manomesso-lettere',
      daEvidenziare,
      { at: manomesso.offset, delta: manomesso.deltaLength },
    )

    return {
      bytes: manomesso.bytes,
      etichetta: 'manomesso-lettere',
      lunghezza: manomesso.bytes.length,
      offset: manomesso.offset,
      da,
      a,
      deltaLunghezza: manomesso.deltaLength,
      lunghezzaRotta: manomesso.brokenLength,
      xrefRotta: manomesso.brokenXref,
      prove: manomesso.evidence,
      // MISURATO, non supposto: pdf.js ricostruisce l'xref e disegna lo stesso.
      ilRendererApreLoStesso: offsets.attacks.tamperWords.renderersOpenAfter === true,
      testoDopo: offsets.attacks.tamperWords.textAfter,
      verdetto: esito.verdict,
      esito,
      righello,
      evidenziazioni,
    }
  },

  async 'attacco-coda'({ stato, segreti, configurazione }) {
    const { bytes, appendedFrom } = appendIncrementalUpdate(daFirmatoIntegro(segreti), {
      newText: configurazione.nuovoImporto,
    })
    const { esito, righello, evidenziazioni } = await applicaAttacco(
      stato,
      bytes,
      'esteso-in-coda',
      [
        {
          id: 'coda-appesa',
          start: appendedFrom,
          end: bytes.length,
          kind: 'tail',
          label: 'Aggiunto dopo la firma, fuori dalla copertura',
        },
      ],
    )

    return {
      bytes,
      etichetta: 'esteso-in-coda',
      lunghezza: bytes.length,
      appendedFrom,
      byteAppesi: bytes.length - appendedFrom,
      testoNuovo: configurazione.nuovoImporto,
      verdetto: esito.verdict,
      esito,
      righello,
      evidenziazioni,
    }
  },

  async chiusura({ stato }) {
    // Nessun byte cambia e nessuna evidenziazione si spegne: la chiusura raccoglie i quattro
    // verdetti gia' misurati e li mette in fila. Se un attacco non e' stato eseguito, la sua
    // riga non c'e': si racconta cio' che si e' fatto, non cio' che si sarebbe potuto fare.
    const riepilogo = []
    for (const passo of ['verifica', 'attacco-cifra', 'attacco-lettere', 'attacco-coda']) {
      const risultato = stato.risultati[passo]
      if (!risultato?.esito) continue
      const esito = risultato.esito
      riepilogo.push({
        passo,
        etichetta: risultato.etichetta ?? 'firmato',
        lunghezza: risultato.lunghezza ?? stato.risultati.firma?.lunghezza ?? null,
        verdetto: esito.verdict,
        improntaTorna: esito.digest?.match === true,
        firmaTorna: esito.signature?.ok === true,
        codaNonCoperta: esito.coverage?.uncoveredTail ?? null,
        copertaTutta: esito.coverage?.complete === true,
      })
    }
    return { riepilogo }
  },
}

/** I byte del firmato integro, o un errore che dice perche' non ci sono. */
function daFirmatoIntegro(segreti) {
  if (!segreti.firmatoIntegro) {
    throw new Error('non c\'e\' nessun documento firmato da attaccare: il passo «firma» non e\' riuscito')
  }
  return segreti.firmatoIntegro
}

/**
 * Il tratto comune ai tre attacchi: i byte nuovi diventano il documento corrente, il
 * righello si rifa' su quelli, la verifica ridice il verdetto. `inserzione` serve solo
 * all'attacco 1b, l'unico che allunga il file dal di dentro.
 */
async function applicaAttacco(stato, bytes, etichetta, evidenziazioni, inserzione = null) {
  stato.documento = { bytes, lunghezza: bytes.length, etichetta }
  const vista = aggiornaVista(stato, evidenziazioni, inserzione)
  const esito = await verify(bytes)
  stato.verdetto = esito.verdict
  stato.verifica = esito
  // Il righello e le evidenziazioni tornano indietro come VALORI: chi congela il pannello non
  // deve rileggerli dallo stato dopo l'await. Vedi aggiornaVista().
  return { esito, righello: vista.righello, evidenziazioni: vista.evidenziazioni }
}

/* ------------------------------------------------------------------ righello ed evidenziazioni */

/**
 * Ricalcola il righello sui byte correnti e sostituisce le evidenziazioni.
 *
 * RESTITUISCE cio' che ha appena calcolato, e gli esecutori usano QUEL valore invece di
 * rileggere `stato.righello` e `stato.evidenziazioni` dopo un await. Sembra un dettaglio ed
 * e' la regola 1: cio' che finisce in `risultati` non deve poter cambiare per colpa di
 * un'azione sincrona arrivata mentre il passo aspettava — altrimenti il pannello congelato di
 * un attacco puo' ritrovarsi il righello e le evidenziazioni del documento integro.
 */
function aggiornaVista(stato, evidenziazioni, inserzione = null) {
  const righello = costruisciRighello(stato, inserzione)
  stato.righello = righello
  stato.evidenziazioni = evidenziazioni
  return { righello, evidenziazioni }
}

/**
 * Il ViewModel del righello per i byte correnti. Lo calcola la macchina, una volta sola:
 * se lo calcolassero le due pagine, i suoi ingressi divergerebbero.
 *
 * Non lancia mai. Se i dati fossero cosi' incoerenti da non permettere un righello — non
 * deve accadere, e un test lo pretende non nullo lungo tutta la demo — restituisce null
 * invece di far fallire il passo: una fascia mancante e' meglio di una demo ferma.
 */
function costruisciRighello(stato, inserzione = null) {
  if (!stato.documento) return null
  const fileLength = stato.documento.lunghezza
  try {
    return buildRuler({
      fileLength,
      byteRange: stato.byteRange,
      uncoveredTail: stato.byteRange ? Math.max(0, fileLength - (stato.byteRange[2] + stato.byteRange[3])) : null,
      objects: oggettiDelRighello(fileLength, inserzione),
    })
  } catch (problema) {
    console.error('machine: righello non costruibile su questi byte', problema)
    return null
  }
}

/**
 * La mappa anatomica da dare a buildRuler: le sezioni congelate del campione, traslate se
 * un attacco ha allungato il file dal di dentro, piu' il blocco appeso dalla firma.
 *
 * @param {number} fileLength
 * @param {?{at: number, delta: number}} inserzione  byte inseriti a `at` (attacco 1b)
 */
function oggettiDelRighello(fileLength, inserzione) {
  const trasla = (offset) =>
    inserzione && offset >= inserzione.at ? offset + inserzione.delta : offset

  const oggetti = offsets.sections.map((sezione) => ({
    id: sezione.id,
    label: sezione.label,
    start: trasla(sezione.start),
    end: trasla(sezione.end),
    kind: SEZIONI_STRUTTURALI.has(sezione.id) ? 'structure' : 'object',
  }))

  // Tutto cio' che sta oltre il campione e' l'aggiornamento incrementale della firma: un
  // blocco solo. buildRuler lo fora da se' col buco /Contents e con la coda dell'attacco 2.
  const finePrimaParte = trasla(offsets.fileLength)
  if (fileLength > finePrimaParte) {
    oggetti.push({
      id: 'aggiornamento-firma',
      label: ETICHETTA_AGGIORNAMENTO,
      start: finePrimaParte,
      end: fileLength,
      kind: 'object',
    })
  }
  return oggetti
}

/** Le due scritture dell'importo, in cifre e in lettere: e' li' che si giochera' tutto. */
function evidenziazioniImporto() {
  return [
    {
      id: 'importo-cifre',
      start: offsets.amount.digitsStart,
      end: offsets.amount.digitsEnd,
      kind: 'object',
      label: `Importo in cifre: ${offsets.amount.digits}`,
    },
    {
      id: 'importo-lettere',
      start: offsets.amount.wordsStart,
      end: offsets.amount.wordsEnd,
      kind: 'object',
      label: `Importo in lettere: ${offsets.amount.words}`,
    },
  ]
}

/** Il buco /Contents, con l'etichetta che serve al passo che lo sta raccontando. */
function evidenziazioniBuco(stato, label) {
  if (stato.contentsStart === null || stato.byteRange === null) return []
  return [
    { id: 'buco-contents', start: stato.contentsStart, end: stato.byteRange[2], kind: 'hole', label },
  ]
}

/**
 * I bersagli degli attacchi, costanti e calcolati dagli offset congelati: dove ciascun
 * attacco colpira', da mostrare mentre il documento e' ancora integro. Valgono anche sul
 * documento firmato, perche' il placeholder e' un append puro e non sposta un byte.
 */
const BERSAGLI = Object.freeze({
  documento: Object.freeze([]),
  chiavi: Object.freeze([]),
  certificato: Object.freeze([]),
  placeholder: Object.freeze([]),
  impronta: Object.freeze([]),
  cms: Object.freeze([]),
  firma: Object.freeze([]),
  verifica: Object.freeze([]),
  'attacco-cifra': Object.freeze([
    Object.freeze({
      id: 'bersaglio-cifra',
      start: offsets.attacks.tamperDigit.offset,
      end: offsets.attacks.tamperDigit.offset + 1,
      kind: 'target',
      label: `Il bersaglio: la cifra "${offsets.attacks.tamperDigit.from}"`,
    }),
  ]),
  'attacco-lettere': Object.freeze([
    Object.freeze({
      id: 'bersaglio-lettere',
      start: offsets.attacks.tamperWords.start,
      end: offsets.attacks.tamperWords.end,
      kind: 'target',
      label: `Il bersaglio: la parola "${offsets.attacks.tamperWords.from}"`,
    }),
  ]),
  // Vuoto apposta: l'attacco 2 non tocca nessun byte gia' scritto, e per questo la firma
  // continua a verificare. Non e' una dimenticanza, e' la lezione.
  'attacco-coda': Object.freeze([]),
  chiusura: Object.freeze([]),
})

/* ------------------------------------------------------------------ istantanea */

/**
 * Copia profonda e congelata dello stato.
 *
 * Perche' una copia nuova a ogni getState(), invece di congelare una volta e riusarla: i
 * Uint8Array NON si possono congelare (Object.freeze su una vista con elementi lancia), e
 * un array condiviso resterebbe scrivibile. Copiandolo, chi ci scrive sopra danneggia solo
 * la propria istantanea. A demo finita sono 71 KB di byte e ~0,1 ms per chiamata, misurati:
 * il prezzo e' trascurabile e la garanzia e' totale. Chi disegna puo' chiamare getState()
 * quante volte vuole, ma la strada normale e' subscribe(), che l'istantanea la porta gia'.
 *
 * Le Date sono copie ma NON risultano congelate, e non e' una dimenticanza: Object.freeze non
 * ferma setTime(), che scrive in uno slot interno e non in una proprieta'. Congelarle sarebbe
 * teatro. Cio' che conta e' che siano copie, e lo sono: chi le sposta sposta le sue.
 */
function istantanea(valore) {
  if (valore === null || typeof valore !== 'object') return valore
  if (valore instanceof Uint8Array) return new Uint8Array(valore)
  if (ArrayBuffer.isView(valore)) return new Uint8Array(valore.buffer.slice(0))
  if (valore instanceof Date) return new Date(valore.getTime())
  if (Array.isArray(valore)) return Object.freeze(valore.map(istantanea))
  const copia = {}
  for (const [chiave, contenuto] of Object.entries(valore)) copia[chiave] = istantanea(contenuto)
  return Object.freeze(copia)
}

function messaggioDi(problema) {
  if (problema instanceof Error) return problema.message
  return String(problema)
}
