// GENERATO da scripts/genera/sample-pdf.mjs — non modificare a mano.
// Rigeneralo con:  node scripts/genera/sample-pdf.mjs
//
// I byte del PDF campione, in base64. Sorgente: src/assets/sample.pdf
//   1285 byte · sha256 8eb0f906ed51563c81f354f818e12dd3d561ff703fc4bb7d2b391b5e61e507a1
//
// Serve perche' src/ui/machine.js gira in due ambienti: nel browser non c'e' `fs`,
// in node non c'e' l'import `?url` di Vite. Un modulo di testo li accontenta
// entrambi. Gli offset congelati di src/assets/sample-offsets.json valgono per
// QUESTI byte: se lo sha256 qui sopra e quello del JSON divergono, ogni offset
// punta altrove — ed e' esattamente cio' che un test controlla.

/** I byte del campione, in base64. */
export const SAMPLE_PDF_B64 =
  'JVBERi0xLjcKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5' +
  'cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UKICAgL1Bh' +
  'cmVudCAyIDAgUgogICAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXQogICAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAg' +
  'UiA+PiA+PgogICAvQ29udGVudHMgNCAwIFIKPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA2NTAgPj4Kc3RyZWFtCkJU' +
  'Ci9GMSAxOCBUZgo3MCA3NjIgVGQKKFBST01FU1NBIERJIFBBR0FNRU5UTykgVGoKRVQKQlQKL0YxIDEyIFRmCjcwIDczNCBU' +
  'ZAooRG9jdW1lbnRvIGRpbW9zdHJhdGl2bywgcHJpdm8gZGkgdmFsb3JlIGxlZ2FsZS4pIFRqCkVUCkJUCi9GMSAxMiBUZgo3' +
  'MCA2OTYgVGQKKElvIHNvdHRvc2NyaXR0byBMb3JlbnpvIFJvc3NpIHByb21ldHRvIGRpIHBhZ2FyZSkgVGoKMCAtMTggVGQK' +
  'KGFsIHNpZ25vciBNYXJpbyBCaWFuY2hpIGxhIHNvbW1hIGRpKSBUagpFVApCVAovRjEgMTUgVGYKMTEwIDYzNiBUZAogICAK' +
  'KDEuMDAwIGV1cm8gKG1pbGxlIGV1cm8pKSBUagpFVApCVAovRjEgMTIgVGYKNzAgNTk2IFRkCihlbnRybyBpbCBnaW9ybm8g' +
  'MzAgc2V0dGVtYnJlIDIwMjYuKSBUagpFVApCVAovRjEgMTIgVGYKNzAgNTU2IFRkCihSb21hLCAxMCBhZ29zdG8gMjAyNikg' +
  'VGoKRVQKcQoxLjEgdwoxIEoKMSBqCjAuMTAgMC4xMyAwLjQ1IFJHCjc4IDUwMiBtCjg2IDUzOCA5OCA1NTAgMTA2IDUyNCBj' +
  'CjExMyA1MDIgMTAzIDQ4NyA5NyA1MDEgYwoxMDQgNTI5IDEyNyA1NDAgMTQzIDUxNCBjCjE1NyA0OTIgMTY3IDUyNSAxNzkg' +
  'NTE5IGMKMTkxIDUxMyAxOTUgNDg5IDIxMyA1MTMgYwpTCjg0IDQ4OSBtCjEzMCA0ODEgMTc4IDQ5NSAyMTcgNDg1IGMKUwpR' +
  'CmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9UaW1l' +
  'cy1Sb21hbiA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAw' +
  'MDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjUzIDAwMDAwIG4gCjAwMDAwMDA5NTQgMDAwMDAg' +
  'biAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSIC9JRCBbPDBBMUIyQzNENEU1RjYwNzE4MjkzQTRCNUM2RDdFOEY5' +
  'PjwwQTFCMkMzRDRFNUY2MDcxODI5M0E0QjVDNkQ3RThGOT5dID4+CnN0YXJ0eHJlZgoxMDI2CiUlRU9GCg=='

/** Lunghezza in byte del campione decodificato. */
export const SAMPLE_PDF_LENGTH = 1285

/** SHA-256 dei byte decodificati, in esadecimale minuscolo. */
export const SAMPLE_PDF_SHA256 = '8eb0f906ed51563c81f354f818e12dd3d561ff703fc4bb7d2b391b5e61e507a1'

/**
 * I byte del campione, decodificati.
 *
 * Restituisce ogni volta un array NUOVO: chi lo riceve puo' scriverci sopra —
 * e pdf.js, per esempio, prende possesso dei byte che gli si passano — senza
 * che la copia successiva ne risenta.
 *
 * `atob` esiste sia nel browser sia in node (>= 16): e' l'unica funzione di
 * decodifica che i due ambienti condividono senza adattatori.
 *
 * @returns {Uint8Array} 1285 byte
 */
export function samplePdfBytes() {
  const testo = atob(SAMPLE_PDF_B64)
  const byte = new Uint8Array(testo.length)
  for (let i = 0; i < testo.length; i++) byte[i] = testo.charCodeAt(i)
  return byte
}
