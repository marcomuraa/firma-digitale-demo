#!/bin/sh
# Collaudo avversariale — lente 1: «la firma e reale, o convince solo il nostro codice?»
#
# Esegue tutto in ordine e stampa gli output VERI degli strumenti terzi.
#   sh scripts/collaudo/firma-reale/collauda.sh
#
# Strumenti usati, nessuno dei quali sa niente di questo progetto:
#   openssl 3.6.3 · poppler/pdfsig 26.07 · ghostscript 10.0 · python-cryptography 49
set -e
cd "$(dirname "$0")"
NSS="sql:$HOME/.pki/nssdb"
[ -f "$HOME/.pki/nssdb/cert9.db" ] || { mkdir -p "$HOME/.pki/nssdb"; certutil -N -d "$NSS" --empty-password; }

titolo() { printf '\n========================================================\n%s\n========================================================\n' "$1"; }

titolo "1. la catena vera: firma e deposita out/firmato.pdf"
node firma.mjs

titolo "2. openssl asn1parse — la struttura del CMS estratto dal /Contents"
openssl asn1parse -inform DER -i -in out/cms-dal-pdf.der

titolo "3. gli attributi firmati che il piano pretende"
for oid in contentType messageDigest signingTime signingCertificateV2; do
  printf '%-24s ' "$oid"
  openssl asn1parse -inform DER -i -in out/cms-dal-pdf.der | grep -qi "$oid" && echo PRESENTE || echo ASSENTE
done

titolo "4. openssl cms -cmsout -print — openssl riconosce la struttura?"
openssl cms -inform DER -in out/cms-dal-pdf.der -cmsout -noout -print

titolo "5. openssl cms -verify — la firma torna, sui byte del /ByteRange"
openssl cms -verify -inform DER -in out/cms-dal-pdf.der -content out/covered.bin -binary -noverify -out /dev/null
echo "controprova con un byte cambiato (deve fallire):"
node -e 'const f=require("fs");const b=f.readFileSync("out/covered.bin");b[500]^=1;f.writeFileSync("out/covered-guasto.bin",b)'
openssl cms -verify -inform DER -in out/cms-dal-pdf.der -content out/covered-guasto.bin -binary -noverify -out /dev/null || echo "(fallita, come deve)"

titolo "6. verifica RSA a mano: signedAttrs ri-taggati SET"
node estrai-e-verifica.mjs
openssl cms -inform DER -in out/cms-dal-pdf.der -cmsout -noout -certsout out/cert.pem
openssl x509 -in out/cert.pem -pubkey -noout > out/pubkey.pem
openssl x509 -in out/cert.pem -outform DER -out out/cert-estratto.der
echo "firma sui byte con tag SET (0x31):"
openssl dgst -sha256 -verify out/pubkey.pem -signature out/signature-dal-pdf.bin out/signedattrs-set-31.der
echo "controprova sui byte con tag implicito (0xa0), deve fallire:"
openssl dgst -sha256 -verify out/pubkey.pem -signature out/signature-dal-pdf.bin out/signedattrs-implicito-a0.der || echo "(fallita, come deve)"

titolo "7. il DER e canonico? openssl lo riscrive identico?"
openssl cms -inform DER -in out/cms-dal-pdf.der -cmsout -outform DER -out out/cms-roundtrip.der
cmp out/cms-dal-pdf.der out/cms-roundtrip.der && echo "CMS: byte identici"
openssl x509 -inform DER -in out/cert-estratto.der -outform DER -out out/cert-roundtrip.der
cmp out/cert-estratto.der out/cert-roundtrip.der && echo "certificato: byte identici"

titolo "8. quarto parere: python-cryptography"
python3 quarto-parere.py

titolo "9. pdfsig (poppler) sul PDF firmato"
pdfsig -nssdir "$NSS" out/firmato.pdf || true

titolo "10. SubFilter: PAdES o Adobe legacy?"
grep -a -o '/SubFilter */[A-Za-z0-9.]*' out/firmato.pdf
grep -a -o '/Filter */[A-Za-z0-9.]*' out/firmato.pdf | head -1

titolo "11. altri parser: pdfinfo, pdftotext, ghostscript"
pdfinfo out/firmato.pdf
pdftotext -layout out/firmato.pdf - | grep -i euro
gs -o /dev/null -sDEVICE=nullpage out/firmato.pdf 2>&1 | tail -3

titolo "12. varianti manomesse: che dice pdfsig?"
node tortura.mjs
node attacco2.mjs
for f in manomesso-1a.pdf manomesso-coda.pdf manomesso-contents.pdf attacco2-reale.pdf attacco2-con-esca.pdf; do
  printf '\n--- %s ---\n' "$f"
  pdfsig -nssdir "$NSS" "out/$f" 2>&1 | grep -E 'Validation|signed' || true
done

titolo "13. l'esca: il nostro motore verifica il documento o l'ultima cosa che gli somiglia?"
node esca.mjs
echo "--- pdfsig (terzo) su out/esca.pdf ---"
pdfsig -nssdir "$NSS" out/esca.pdf 2>&1 | grep -E 'Validation|signed|Signed Ranges' || true
echo "--- pdftotext su out/esca.pdf ---"
pdftotext -layout out/esca.pdf - | grep -i euro
echo "--- il nostro verify.js sulle stesse varianti ---"
node confronto-verdetti.mjs
node -e 'import("../../../src/core/verify.js").then(async({verify})=>{const fs=await import("node:fs");
for(const n of ["attacco2-reale.pdf","attacco2-con-esca.pdf","coda-neutra.pdf","esca.pdf"]){
const r=await verify(new Uint8Array(fs.readFileSync("out/"+n)));
console.log(n.padEnd(26),"verdetto="+String(r.verdict).padEnd(9),"coda="+(r.coverage?r.coverage.uncoveredTail:"-"),"CN="+(r.identity?r.identity.subjectCN:"-"),r.reason?"motivo="+r.reason:"");}})'
