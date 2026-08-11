// VARIANTE B — nessun worker: il modulo worker entra nel bundle principale
// e viene registrato come "fake worker" sul thread principale.
import './sentinel.js';
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { runSpike } from './harness.js';

globalThis.pdfjsWorker = { WorkerMessageHandler };

runSpike({
  strada: 'B · fake worker sul thread principale (build moderna)',
  nota: 'globalThis.pdfjsWorker = { WorkerMessageHandler }',
  pdfjs,
});
