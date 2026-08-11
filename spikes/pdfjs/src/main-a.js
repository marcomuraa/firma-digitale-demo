// VARIANTE A — worker vero, inlineato da Vite (?worker&inline).
// Il formato del worker (es -> URL data:, iife -> URL blob:) lo decide vite.config.mjs
// tramite SPIKE_WORKER_FORMAT: le due strade hanno esiti diversi da file://.
import { watchWorker } from './sentinel.js';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker&inline';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { runSpike } from './harness.js';

const formato = __SPIKE_WORKER_FORMAT__;
let nota = `workerPort = new Worker() inlineato da Vite, worker.format="${formato}"`;
try {
  pdfjs.GlobalWorkerOptions.workerPort = watchWorker(new PdfWorker());
} catch (err) {
  nota = `costruzione del Worker fallita: ${err?.name}: ${err?.message || err}`;
}

runSpike({ strada: `A · worker inlineato da Vite (format=${formato})`, nota, pdfjs });
