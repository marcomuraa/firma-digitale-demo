// VARIANTE C — come B ma con la build "legacy" di pdf.js (ES5-friendly, piu grande).
import './sentinel.js';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { runSpike } from './harness.js';

globalThis.pdfjsWorker = { WorkerMessageHandler };

runSpike({
  strada: 'C · fake worker sul thread principale (build legacy)',
  nota: 'pdfjs-dist/legacy/build/*',
  pdfjs,
});
