// VARIANTE D — worker vero costruito a mano da un URL data: (modulo ES),
// il sorgente del worker arriva nel bundle come stringa (?raw).
import { watchWorker } from './sentinel.js';
import sorgenteWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { runSpike } from './harness.js';

let nota = 'new Worker("data:text/javascript;base64,...", { type: "module" })';
try {
  const utf8 = new TextEncoder().encode(sorgenteWorker);
  let bin = '';
  for (let i = 0; i < utf8.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, utf8.subarray(i, i + 0x8000));
  }
  const url = `data:text/javascript;base64,${btoa(bin)}`;
  pdfjs.GlobalWorkerOptions.workerPort = watchWorker(new Worker(url, { type: 'module' }));
} catch (err) {
  nota = `costruzione del Worker data: fallita: ${err?.name}: ${err?.message || err}`;
}

runSpike({ strada: 'D · worker da URL data: costruito a mano', nota, pdfjs });
