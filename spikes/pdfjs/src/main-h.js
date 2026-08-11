// PROBE H — misura: solo l'API di pdf.js, senza il modulo worker.
// Non renderizza nulla: serve a pesare separatamente API e worker.
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
document.getElementById('esito').textContent = `solo API pdf.js ${pdfjs.version}`;
