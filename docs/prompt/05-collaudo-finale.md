# 05 · Fase 6 — collaudo finale end-to-end

**Dipende da tutti i prompt precedenti**, 02b compreso. È l'ultimo passo prima della consegna.

Strumento da usare invece di improvvisare: `scripts/anteprima/anteprima.mjs` (`--aiuto`) costruisce
una entry sola in una cartella propria, la apre da `file://` in Chrome headless, la **pilota** e
scatta. `scripts/anteprima/copioni/demo-intera.json` percorre la demo su entrambe le direzioni;
`scripts/anteprima/copioni/regressioni-doppia.json` è la rete di sicurezza della direzione C e
fallisce da sola. **Guarda le schermate con lo strumento Read**: una schermata non guardata non è
una verifica.

Lavori dalla radice del repository. **Leggi prima `docs/stato.md`**, poi `docs/decisioni.md`.
Il piano originale non fa parte del repository: le lenti del collaudo avversariale e la verifica
end-to-end che chiedeva sono elencate qui sotto, punto per punto.

Usa agenti e workflow: le lenti sono indipendenti e vanno in parallelo. Ognuna è istruita a
**confutare**, non a confermare, e non modifica nulla: referta. Le riparazioni vengono dopo, con i
referti in mano.

---

## Le lenti

1. **La firma è reale?** Estrarre il CMS dal `/Contents`, passarlo a
   `openssl asn1parse -inform DER -i`, e confrontarlo con la vista ASN.1 che la pagina mostra: se
   divergono, la pagina sta raccontando una struttura che nel file non c'è.
2. **Un terzo è d'accordo?** `pdfsig` sul PDF scaricato dalla pagina (se serve un database NSS
   vuoto: `certutil -N -d sql:$HOME/.pki/nssdb --empty-password`). Atteso: firma valida,
   emittente non fidato. Qualunque altra cosa è un rilievo bloccante.
3. **Il controllo di copertura regge ancora?** Vale ciò che è stato già fatto in
   `docs/vulnerabilita.md`: qui si verifica che le riparazioni non abbiano riaperto nulla, e si
   prova un giro nuovo su ciò che nel frattempo è cambiato.
4. **Gli attacchi sono onesti?** Che modifichino davvero byte dentro il `/ByteRange` e non
   simulino il fallimento a monte.
5. **Autoconsistenza e offline.** Nessuna richiesta di rete, nessun riferimento esterno, i quattro
   file aprono con doppio click **a rete disattivata**. Verificare davvero, non staticamente: la
   prova è aprire i file e guardare che non manchi nulla.
6. **Il PDF campione è ancora valido?** `npm run pdf:validate`, pdf.js, poppler, e ogni offset
   congelato che punta dove dice.
7. **Critica di design, una per direzione.** Leggibilità proiettata con i corpi misurati,
   contrasto calcolato, gerarchia, focus da tastiera, `prefers-reduced-motion`, verdetto
   distinguibile **senza colore**, e la domanda «sembra generato da un template?».
   *Questa lente ha già girato due volte per direzione in fase 5*, con misure e riparazioni: qui
   serve a verificare che non sia rientrato niente e a chiudere ciò che era stato lasciato aperto
   per scelta motivata, non a ricominciare da zero. Due avvertenze da chi ci è passato: la
   spaccatura della direzione C è dipinta con un `linear-gradient` sul `<body>`, quindi una sonda di
   contrasto che risale gli antenati cercando il primo `backgroundColor` non trasparente misura
   chiaro-su-chiaro nella metà scura e produce decine di violazioni finte — misura sui pixel veri.
   E le regioni che scorrono dentro sé stesse (dump, albero ASN.1) vanno ritagliate al rettangolo
   visibile, o si misurano righe che sullo schermo nessuno dipinge.
8. **Coerenza della narrazione.** Ogni segmento corrisponde al passo giusto, nessun esadecimale
   nel copione, nessuna frase che legge ad alta voce un'etichetta già a schermo, e la somma delle
   durate è quella dichiarata. Verifica anche che l'audio **si senta**: un file che dura giusto ed è
   muto è un fallimento silenzioso, e in Chrome headless non c'è un dispositivo audio — quindi una
   parte di questa lente si chiude solo a orecchio, e va detto.
9. **La pagina dice il vero?** Porta la demo a uno stato e confronta ciò che la pagina *afferma* con
   ciò che i byte dicono: byte coperti, buco, coda, offset nelle etichette, impronte affiancate,
   impronta SHA-256 del certificato. In fase 5 due bugie sono state trovate e riparate così — una
   legenda che stampava gli offset del buco clampati alla finestra, e «Ricomincia» che lasciava in
   pagina i pannelli del giro prima. Prova gli stati che nessuno percorre: dopo un reset, dopo un
   ripristino, dopo un passo rifiutato fuori sequenza.

## La verifica end-to-end, da eseguire e riferire punto per punto

1. `npm run build` → quattro file in `dist/`, ciascuno autoconsistente.
2. Aprire ciascuno con doppio click **a rete disattivata**: comportamento identico.
3. Percorso completo → «Verifica» → ✅ *valida e completa*.
4. Attacco 1a → ❌, byte evidenziato nel dump, impronte affiancate, incoerenza cifre/lettere
   visibile. Attacco 1b → **attenzione, il piano è superato dai fatti**: il documento **si
   renderizza lo stesso** e mostra `1.000 euro (novemila euro)`, mentre `/Length` e `xref` sono
   incoerenti. La morale è *il renderer perdona, la firma no*. Verificare che la pagina racconti
   questa versione e non quella pianificata.
5. Attacco 2 → ⚠️, coda visibile fuori dal righello, documento renderizzato che cambia.
6. Versioni narrate: play una volta → la demo si svolge da sola fino al verdetto finale; pausa a
   metà → il controllo torna al mouse senza rompere lo stato. Se 02 e 02b non sono state eseguite,
   i due file narrati sono identici ai muti a meno di un attributo: **non è un guasto da riparare
   qui**, è una fase che manca, e va scritto così nel referto invece di aprirci un rilievo.
7. Controlli responsive, focus da tastiera, `prefers-reduced-motion`.

## Come si chiude

Ciò che le lenti trovano **rientra come lavoro**, non come nota a piè di pagina — con l'eccezione
già decisa: le vulnerabilità di sicurezza rientrano anche come **contenuto**, vedi
`docs/prompt/04`. Dopo le riparazioni, rieseguire le lenti che avevano refertato.

Alla fine aggiorna `docs/stato.md` con la fotografia finale e riferisci: cosa è stato verificato,
con quali comandi, cosa resta aperto e cosa è fuori portata per scelta dichiarata (marca
temporale, revoca, upload di PDF arbitrari, validazione in Adobe, certificati qualificati,
sincronia parola per parola).
