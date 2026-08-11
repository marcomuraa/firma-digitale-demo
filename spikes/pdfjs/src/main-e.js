// VARIANTE E — worker vero costruito a mano da un URL blob: (modulo ES),
// il sorgente del worker arriva nel bundle come stringa (?raw).
import { watchWorker } from './sentinel.js';
import sorgenteWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { runSpike } from './harness.js';

let nota = 'new Worker(URL.createObjectURL(Blob), { type: "module" })';
try {
  const url = URL.createObjectURL(
    new Blob([sorgenteWorker], { type: 'text/javascript' }),
  );
  pdfjs.GlobalWorkerOptions.workerPort = watchWorker(new Worker(url, { type: 'module' }));
} catch (err) {
  nota = `costruzione del Worker blob: fallita: ${err?.name}: ${err?.message || err}`;
}

runSpike({ strada: 'E · worker da URL blob: costruito a mano', nota, pdfjs });
