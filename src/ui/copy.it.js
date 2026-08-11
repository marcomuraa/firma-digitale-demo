// Testi italiani dei pannelli — ciò che si LEGGE a schermo.
// La voce (src/ui/script.it.js) è un altro registro e un altro canale: qui si può essere
// precisi e nominare le cose, lì si spiega.
//
// Forma fissata da docs/contratti-ui.md:
//   COPY = { [panelId]: { titolo, occhiello, corpo: string[] } }
//
// occhiello   riga breve sopra il titolo, si legge da tre metri
// titolo      titolo del pannello
// corpo       paragrafi in testo semplice: niente HTML, niente markdown
//
// Doppia modalità, ed è da questa che discende la forma di ogni pannello:
//   presentazione  mostra occhiello + titolo + SOLO il primo paragrafo, corpo grande
//   studio         mostra tutto
// Il primo paragrafo deve quindi reggere da solo ed essere corto.
//
// Gli identificatori sono CHIUSI: i dodici passi della tabella dei contratti più i tre
// pannelli teorici. Nessuno in più, nessuno in meno. Non si dichiarano qui: arrivano da
// `steps.js`, che è l'unica sorgente di verità condivisa con `script.it.js`.

import { PANEL_IDS, STEP_IDS } from './steps.js'

/** I dodici passi della demo: riesportati dall'unica sorgente, non ridichiarati. */
export { STEP_IDS }

/**
 * I tre pannelli teorici: non hanno un passo narrato, si aprono a richiesta.
 * Ricavati per differenza, così restano legati a `PANEL_IDS` invece di essere una lista in più.
 */
export const THEORY_IDS = PANEL_IDS.filter((id) => !STEP_IDS.includes(id))

export const COPY = {
  // ---------------------------------------------------------------- 1. documento
  documento: {
    occhiello: 'Il punto di partenza',
    titolo: 'Un documento e i suoi byte',
    corpo: [
      'Una promessa di pagamento da 1285 byte, scritta a mano e senza compressione: ogni parola che si legge nella pagina si ritrova, in chiaro, nel dump esadecimale.',
      'Il documento dichiara di non avere valore legale e i nomi sono di fantasia: serve a dimostrare un meccanismo, non a impegnare nessuno. L’importo compare due volte, in cifre e in lettere, come su una cambiale: è una difesa antica contro le falsificazioni, e più avanti si vedrà fin dove arriva.',
      'Dentro ci sono cinque oggetti numerati, una tabella xref che dice a quale byte comincia ognuno, un trailer e la riga finale %%EOF. Il testo della pagina sta tutto nell’oggetto 4, il flusso di contenuto, dove gli operatori Tj disegnano una riga per volta.',
      'La riga dell’importo comincia all’offset 576, che è un multiplo di 16: nel dump esadecimale, che si legge a sedici byte per riga, occupa righe intere invece di spezzarsi a metà. Non è un caso: il generatore aggiunge spazi di riempimento finché l’allineamento torna.',
      'Il carattere è Times-Roman, uno dei quattordici di base che ogni lettore PDF possiede già: non è incorporato, e l’oggetto che lo dichiara pesa 72 byte, dall’inizio della riga 5 0 obj all’a capo che chiude endobj. È questo che tiene il file piccolo abbastanza da poterlo guardare per intero.',
    ],
  },

  // ------------------------------------------------------------------- 2. chiavi
  chiavi: {
    occhiello: 'Chi firma',
    titolo: 'La coppia di chiavi',
    corpo: [
      'Il browser genera adesso due chiavi legate fra loro: una privata, che resta qui e firma, e una pubblica, che chiunque può usare per controllare la firma.',
      'Sono chiavi RSA da 2048 bit, e la proprietà che regge tutto vale in una direzione sola: dalla chiave privata si ricava quella pubblica, mentre dalla pubblica non si risale alla privata, perché servirebbe un tempo di calcolo fuori portata.',
      'Firmare vuol dire fare un calcolo che solo chi ha la chiave privata sa fare, e che chiunque abbia quella pubblica sa controllare. È questa asimmetria che rende la firma verificabile senza consegnare a nessuno il segreto.',
      'Le chiavi nascono qui dentro, con le funzioni crittografiche del browser, e non escono dalla pagina: la privata vive nella memoria della scheda e sparisce quando la si chiude. Niente viene inviato in rete, e infatti la pagina funziona anche con la connessione spenta.',
    ],
  },

  // -------------------------------------------------------------- 3. certificato
  certificato: {
    occhiello: 'L’identità dichiarata',
    titolo: 'Il certificato X.509',
    corpo: [
      'Una chiave pubblica, da sola, non dice di chi sia. Il certificato è la chiave più un nome, tenuti insieme da una firma.',
      'Il formato si chiama X.509 ed è lo stesso dei certificati dei siti web. Contiene il soggetto, cioè chi dichiara di essere il titolare della chiave, l’emittente che lo garantisce, un numero di serie, un intervallo di validità, la chiave pubblica e gli algoritmi usati.',
      'Qui il certificato è self-signed, cioè firmato con la stessa chiave che certifica: soggetto ed emittente coincidono e nessun terzo garantisce niente. La firma che ne uscirà sarà matematicamente corretta e non proverà l’identità di nessuno. Il pannello sulla catena di fiducia spiega perché.',
      'Il certificato viene codificato in DER, la forma binaria dello standard ASN.1: è quella sequenza di byte che finirà dentro la firma, e che la vista ad albero mostra campo per campo.',
    ],
  },

  // -------------------------------------------------------------- 4. placeholder
  placeholder: {
    occhiello: 'Fare posto alla firma',
    titolo: 'Il buco e il /ByteRange',
    corpo: [
      'Una firma non può firmare sé stessa. Prima si apre nel file uno spazio vuoto che la ospiterà, poi si dichiara quali byte coprirà: tutti tranne quello spazio.',
      'Lo spazio vuoto è il campo /Contents. Accanto compare /ByteRange, quattro numeri che si leggono a coppie: dall’offset a per b byte, poi dall’offset c per d byte. Il buco sta esattamente in mezzo, fra a più b e c, e resta fuori dalla copertura per costruzione.',
      'In PAdES, che è il profilo di firma pensato per i PDF, la firma non riscrive il documento: si aggiunge in coda come aggiornamento incrementale, cioè una revisione che il lettore sovrappone alla precedente. È il modo in cui il PDF permette di modificare un file senza toccare i byte già scritti.',
      'Lo spazio riservato è più grande della firma che ci andrà. La lunghezza del buco va fissata prima di conoscere la firma, quindi si abbonda: quello che avanza resta a zero e non dà fastidio a nessuno.',
    ],
  },

  // ----------------------------------------------------------------- 5. impronta
  impronta: {
    occhiello: 'Ridurre il file a un numero',
    titolo: 'L’impronta SHA-256',
    corpo: [
      'SHA-256 riduce tutti i byte coperti a 32 byte di impronta. Cambia un solo carattere del documento e l’impronta cambia per intero.',
      'Un’impronta, o hash, è un riassunto di lunghezza fissa: dallo stesso file esce sempre la stessa, da file diversi ne escono di diverse, e dall’impronta non si torna indietro al documento. Nessuno sa costruire due documenti sensati che abbiano la stessa impronta SHA-256.',
      'Il calcolo salta il buco: si prende il primo intervallo di /ByteRange, poi il secondo, e si concatenano come se in mezzo non ci fosse niente. È per questo che la firma, pur stando dentro il file, non deve firmare sé stessa.',
      'Da qui in avanti il documento non serve più: ciò che verrà firmato è l’impronta. Per questo la firma è corta e veloce anche su un file grande, e per questo basta un byte diverso perché non torni più nulla.',
    ],
  },

  // ---------------------------------------------------------------------- 6. cms
  cms: {
    occhiello: 'La busta della firma',
    titolo: 'CMS SignedData e attributi firmati',
    corpo: [
      'La firma non viaggia da sola. Sta dentro una busta standard, il CMS SignedData, che porta con sé il certificato e gli attributi firmati.',
      'CMS, Cryptographic Message Syntax, è il formato con cui si impacchettano dati firmati. Qui la busta è detached, cioè staccata: non contiene una copia del documento, perché il documento è il PDF che la ospita.',
      'Gli attributi firmati sono quattro. Il tipo di contenuto; messageDigest, che è l’impronta calcolata al passo precedente; signingTime, l’ora dichiarata di firma; e signing-certificate-v2, che lega la firma a quel certificato preciso e non a un altro con lo stesso nome dentro. I profili PAdES richiedono quest’ultimo.',
      'Ciò che RSA firma davvero è la forma binaria di questi attributi, non il PDF. La catena è documento, poi impronta, poi attributo messageDigest, poi firma: rompere un anello qualunque fa fallire la verifica, ed è esattamente quello che faranno gli attacchi.',
      'L’ora di firma è dichiarata da chi firma, non attestata da nessuno: chi ha in mano la chiave può scriverci quello che vuole. Renderla credibile richiede una marca temporale, che qui non c’è.',
    ],
  },

  // -------------------------------------------------------------------- 7. firma
  firma: {
    occhiello: 'La firma entra nel file',
    titolo: 'Il CMS dentro /Contents',
    corpo: [
      'La busta firmata viene scritta in esadecimale dentro il buco, e nessun altro byte del file si sposta.',
      'Il buco era stato dimensionato in eccesso: la firma ne occupa una parte, il resto rimane a zero. Se un solo byte fuori dal buco si spostasse, gli offset di /ByteRange non punterebbero più dove dicono e la verifica fallirebbe all’istante.',
      'Scrivere dentro il buco non invalida la firma perché il buco è escluso dalla copertura per costruzione. È l’unica zona del file che può cambiare senza che l’impronta cambi, ed è anche l’ultima: da adesso in poi ogni altro byte è vincolato.',
      'Quello che ne esce è un PDF firmato a tutti gli effetti. Si apre in un lettore qualunque, mostra la stessa pagina di prima, e porta dentro di sé la prova che quella pagina non è più modificabile senza lasciare traccia.',
    ],
  },

  // ------------------------------------------------------------------ 8. verifica
  verifica: {
    occhiello: 'Il verdetto',
    titolo: 'Tre controlli, tre esiti',
    corpo: [
      'Verificare vuol dire rispondere a tre domande: la firma copre tutto il file? l’impronta torna? la chiave pubblica conferma la firma?',
      'Copertura: gli intervalli di /ByteRange più il buco devono esaurire il file. Se restano byte dopo la fine del secondo intervallo, qualcosa è stato aggiunto dopo che la firma era stata apposta.',
      'Integrità: si ricalcola SHA-256 sui byte coperti e lo si confronta con l’impronta scritta negli attributi firmati. Firma: si passa la forma binaria di quegli attributi alla chiave pubblica del certificato, che conferma o smentisce.',
      'Da qui i tre esiti. Valida e completa, quando tutti e tre i controlli passano. Firma valida ma documento esteso dopo la firma, quando impronta e firma tornano e la copertura no. Non valida, quando l’impronta o la firma non tornano.',
      'Nessuno dei tre controlli dice chi ha firmato. Quella domanda dipende dal certificato, non dalla matematica, e qui ha una risposta diversa: nessuno.',
    ],
  },

  // ------------------------------------------------------------- 9. attacco-cifra
  'attacco-cifra': {
    occhiello: 'Attacco 1a',
    titolo: 'Falsificare la cifra',
    corpo: [
      'Un byte solo, dentro la zona coperta: il carattere 1 diventa 9. Il documento resta apribile, la firma non torna più.',
      'La modifica è all’offset 577, dove il byte 0x31 diventa 0x39. La lunghezza del file non cambia, quindi la struttura resta intatta: /Length torna, la tabella xref punta ancora dove deve, il visualizzatore non ha niente da ridire.',
      'A schermo però resta scritto 9.000 euro (mille euro). È la difesa antica di cambiali e assegni che entra in scena: cifre e lettere non concordano più, e chi legge se ne accorge. Ma serviva qualcuno che leggesse, e che badasse proprio a quel dettaglio.',
      'L’impronta se ne accorge da sola. Un byte coperto diverso cambia l’impronta per intero, il confronto con l’attributo messageDigest fallisce e il verdetto è: non valida. Non serve sapere che cosa è cambiato per sapere che qualcosa è cambiato.',
    ],
  },

  // ---------------------------------------------------------- 10. attacco-lettere
  'attacco-lettere': {
    occhiello: 'Attacco 1b',
    titolo: 'Falsificare anche le lettere',
    corpo: [
      'Si riparte dal documento integro, e questa volta mille diventa novemila. Il file diventa strutturalmente incoerente, e il visualizzatore lo apre lo stesso: il renderer perdona, la firma no.',
      'La parola nuova è più lunga di tre byte, e tutto ciò che sta dopo slitta in avanti. Il flusso di contenuto continua a dichiarare /Length 650 mentre i byte reali fra stream e endstream sono diventati 653. Il rimando alla tabella, startxref, continua a dichiarare 1026, mentre la tabella xref ora comincia a 1029: punta tre byte prima del punto giusto, e le sue voci non indicano più l’inizio degli oggetti.',
      'Ci si aspetterebbe un errore di apertura. Non arriva. Il visualizzatore ricostruisce la tabella scandendo il file da capo, ritrova la fine del flusso ignorando la lunghezza dichiarata, e disegna la pagina come se niente fosse. I lettori PDF sono indulgenti per progetto, perché in circolazione ci sono milioni di file malfatti che devono comunque aprirsi.',
      'Quello che si legge adesso è 1.000 euro (novemila euro). L’incoerenza fra cifre e lettere non è sparita, si è solo spostata dall’altra parte. E il verdetto della firma è di nuovo: non valida, perché i byte coperti sono cambiati.',
      'La morale è più forte di quanto sembri: vedere il documento non è verificarlo. Il renderer risponde alla domanda che aspetto ha questo file; la firma risponde alla domanda questi byte sono ancora quelli firmati. Sono due domande diverse, e solo la seconda protegge.',
      'Resta un fatto pratico, e introduce il prossimo attacco: per falsificare bene non basta cambiare il testo, bisogna anche riparare il file.',
    ],
  },

  // ------------------------------------------------------------- 11. attacco-coda
  'attacco-coda': {
    occhiello: 'Attacco 2',
    titolo: 'Modificare dopo la firma',
    corpo: [
      'Di nuovo dal documento integro. Questa volta i byte firmati non si toccano: si appende in coda una revisione che riscrive la pagina.',
      'Il PDF permette di aggiornare un file aggiungendo in fondo una nuova revisione, con i suoi oggetti, la sua tabella xref e un rimando /Prev a quella precedente. È lo stesso meccanismo con cui è stata aggiunta la firma, usato adesso contro di essa.',
      'Il lettore mostra sempre l’ultima revisione, quindi la pagina che si vede è cambiata davvero. Ma il /ByteRange copre soltanto i byte fino alla firma: ciò che è stato appeso dopo sta fuori dalla copertura, e nel righello in cima alla pagina si vede spuntare oltre la parte colorata.',
      'Impronta e firma tornano, perché i byte coperti non sono stati toccati. Il verdetto quindi non è rosso ma ambra: firma valida, documento esteso dopo la firma. A salvare la situazione è il controllo di copertura, non la crittografia.',
      'Ecco perché i verdetti sono tre e non due. Una risposta binaria qui mentirebbe in entrambi i sensi: dire non valida sarebbe falso, dire valida sarebbe pericoloso. Anche i lettori PDF seri distinguono questo caso, e conviene sapere che esiste prima di incontrarlo.',
    ],
  },

  // ----------------------------------------------------------------- 12. chiusura
  chiusura: {
    occhiello: 'Che cosa resta',
    titolo: 'Dimostrato e non dimostrato',
    corpo: [
      'È stato dimostrato un meccanismo: chi cambia un byte coperto rompe la firma. Non è stata dimostrata l’identità di nessuno.',
      'Dimostrato, e ricontrollabile risalendo i pannelli: la firma è una PAdES vera, incorporata nel PDF, con CMS SignedData, attributi firmati e /ByteRange; impronta e verifica avvengono qui, sui byte veri, senza strumenti esterni; i tre verdetti corrispondono a tre situazioni davvero diverse.',
      'Non dimostrato: che il firmatario sia chi dice di essere, perché il certificato è self-signed; che la firma sia stata apposta in un certo momento, perché non c’è marca temporale, cioè una data attestata da un terzo; che il certificato fosse ancora valido in quel momento, perché non si è controllata la revoca.',
      'Non c’è nemmeno valore giuridico, e non è una funzione mancante per distrazione: è una scelta. Il documento stesso dichiara di non averne, e i tre pannelli di teoria dicono che cosa servirebbe perché ne avesse.',
    ],
  },

  // ------------------------------------------------------- teoria: il certificato
  'teoria-certificato': {
    occhiello: 'Teoria · Fiducia',
    titolo: 'Certificato e catena di fiducia',
    corpo: [
      'Il certificato di questa demo è self-signed: la matematica è corretta, ma l’identità non è garantita da nessuno.',
      'Un certificato è una dichiarazione firmata: questa chiave pubblica appartiene a questo soggetto, e vale fino a questa data. A firmarla è un’autorità di certificazione, che con la propria firma ci mette la faccia.',
      'La fiducia non nasce dal singolo certificato, nasce dalla catena. Il certificato del firmatario è firmato da un’autorità intermedia, che a sua volta è firmata da una radice; e la radice sta già dentro il sistema operativo o dentro il lettore PDF, messa lì da chi lo ha costruito. Verificare l’identità vuol dire risalire questa catena fino a una radice che si è deciso in anticipo di considerare fidata.',
      'Qui la catena è lunga uno e si chiude su sé stessa. Emittente e soggetto sono lo stesso nome, e la firma sul certificato è fatta con la chiave che il certificato stesso dichiara. Chiunque può generarne uno in due secondi con qualunque nome dentro: in questa pagina quel nome è un semplice campo di testo.',
      'Le due domande vanno tenute separate. La prima, i byte sono ancora quelli firmati, ha risposta qui, ed è sì. La seconda, chi li ha firmati, non ha risposta e non può averla. Un verificatore serio le tiene su due righe distinte del suo referto: firma valida, emittente non attendibile.',
      'Questa demo dimostra un meccanismo, non autentica una persona.',
    ],
  },

  // --------------------------------------------- teoria: non è una firma scansionata
  'teoria-scansionata': {
    occhiello: 'Teoria · Un equivoco comune',
    titolo: 'Non è una firma scansionata',
    corpo: [
      'L’immagine di una firma autografa è un disegno, e un disegno non lega niente a niente. In questo documento la prova si vede nei byte.',
      'Sotto la data il documento porta un ghirigoro che sembra una firma. Nel flusso di contenuto, fra gli offset 726 e 936, sono 210 byte di coordinate: m sposta la penna, c traccia una curva, S la disegna. Nessuna immagine, nessuna fotografia, nessuna scansione: pura geometria, leggibile nel dump come tutto il resto.',
      'Chiunque può copiare quei 210 byte in un altro documento, o cambiarli, o cancellarli. E il ghirigoro non sa che cosa ci sia scritto sopra di sé: se l’importo passa da mille a novemila il disegno resta identico, e continua a sembrare un’approvazione.',
      'La firma digitale funziona al contrario: non assomiglia a niente, ma è calcolata a partire da tutti i byte che copre. Cambiare una lettera cambia l’impronta, e la verifica fallisce. La firma scansionata è una somiglianza; la firma digitale è un legame.',
      'I due piani si possono sovrapporre, e spesso lo fanno: molti PDF firmati mostrano anche un’immagine di firma, che nel formato si chiama aspetto. È decorazione, utile perché un umano capisca a colpo d’occhio che il documento è firmato. Il valore sta nel CMS, non nel disegno: se il disegno mancasse del tutto, la firma varrebbe uguale.',
    ],
  },

  // ------------------------------------------------------------ teoria: quadro eIDAS
  'teoria-eidas': {
    occhiello: 'Teoria · Quadro normativo',
    titolo: 'eIDAS, formati e livelli',
    corpo: [
      'eIDAS è il regolamento europeo che stabilisce quando una firma elettronica ha valore. Questa demo ne usa il formato, non ne ha il valore.',
      'I livelli sono tre. La firma elettronica semplice è qualunque dato elettronico usato per firmare, perfino il nome in fondo a un messaggio. La firma elettronica avanzata deve essere legata in modo univoco al firmatario, restare sotto il suo controllo esclusivo e rendere rilevabile ogni modifica successiva. La firma elettronica qualificata è un’avanzata fatta con un certificato qualificato, rilasciato da un prestatore di servizi fiduciari qualificato, e creata con un dispositivo apposito.',
      'Solo la qualificata ha, in tutta l’Unione, lo stesso effetto giuridico della firma autografa. Le altre non sono prive di valore, ma quanto pesino lo decide un giudice caso per caso, non il regolamento.',
      'I formati sono tre buste diverse per la stessa idea. PAdES mette la firma dentro il PDF, che resta un PDF e si apre con qualunque lettore: è quello che fa questa demo. CAdES avvolge un file qualunque e produce un .p7m, molto diffuso nella pubblica amministrazione italiana, che però richiede un programma apposito anche solo per rileggere il documento. XAdES firma documenti XML ed è tipico della fatturazione elettronica.',
      'Dove si colloca questa demo, senza sconti: il meccanismo è PAdES reale, con gli stessi algoritmi, gli stessi attributi firmati e la stessa struttura di un documento firmato davvero. Ma il certificato è self-signed e non risale ad alcun prestatore qualificato, non c’è marca temporale, non si controlla la revoca.',
      'Il risultato è una firma tecnicamente ineccepibile e giuridicamente nulla. È la stessa distinzione del pannello sul certificato: la matematica è una cosa, l’identità e il valore legale sono un’altra.',
    ],
  },
}
