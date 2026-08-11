// Controllo statico di autoconsistenza su un HTML prodotto dallo spike.
// Cerca URL assoluti caricabili e riferimenti a file esterni.
// Uso: node spikes/pdfjs/check-offline.mjs spikes/pdfjs/dist/spike.html
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.argv[2] || 'spikes/pdfjs/dist/spike.html');
const testo = readFileSync(file, 'utf8');

// URL innocue, verificate una per una nel bundle di pdf.js 6.2.108. Tre categorie:
//  - identificatori di namespace XML/RDF: sono etichette, non indirizzi;
//  - basi fittizie passate a new URL(...) per validare i link delle annotazioni PDF;
//  - testo di licenza.
// Nessuna finisce mai in fetch(), src o href.
const AMMESSE = [
  'http://www.apache.org/licenses/LICENSE-2.0', // intestazione di licenza
  'http://www.w3.org/', // namespace: svg, xhtml, xlink, xmldsig, XSL
  'http://www.xfa.org/schema/', // namespace XFA
  'http://ns.adobe.com/',
  'http://purl.org/dc/',
  'http://www.aiim.org/pdfa/ns/',
  'http://www.npes.org/pdfx/ns/',
  'https://github.com/mozilla/pdf.js',
  'http://mozilla.github.io/pdf.js/',
  'http://${e}', // addDefaultProtocol su link "www.*" delle annotazioni
  'http://example.com', // base fittizia di createValidAbsoluteUrl
  'https://foo.bar', // base fittizia di new URL() nel parser dei link
];

const trovate = new Map();
for (const m of testo.matchAll(/https?:\/\/[^\s"'`)\\<>]+/g)) {
  const u = m[0];
  if (AMMESSE.some((a) => u.startsWith(a))) continue;
  trovate.set(u, (trovate.get(u) || 0) + 1);
}

// Attributi che il browser caricherebbe davvero.
const caricabili = [];
for (const m of testo.matchAll(/\b(src|href)\s*=\s*["']([^"']+)["']/gi)) {
  const v = m[2];
  if (/^(data:|#|about:)/i.test(v)) continue;
  caricabili.push(`${m[1]}="${v}"`);
}

const righe = [];
righe.push(`file:  ${file}`);
righe.push(`byte:  ${Buffer.byteLength(testo)}`);
righe.push(`URL assolute non ammesse:  ${trovate.size}`);
for (const [u, n] of trovate) righe.push(`  - ${u} (x${n})`);
righe.push(`attributi src/href esterni: ${caricabili.length}`);
for (const c of caricabili) righe.push(`  - ${c}`);

const ok = trovate.size === 0 && caricabili.length === 0;
righe.push(ok ? 'ESITO: nessun riferimento esterno caricabile.' : 'ESITO: RIFERIMENTI ESTERNI PRESENTI.');
console.log(righe.join('\n'));
process.exit(ok ? 0 : 1);
