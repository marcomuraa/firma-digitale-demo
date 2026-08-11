#!/usr/bin/env python3
"""
Collaudo avversariale — quarto parere, con uno stack che non e ne il nostro, ne openssl CLI,
ne poppler: python-cryptography (backend Rust).

Legge SOLO i file gia depositati in out/ e ricontrolla i tre anelli:
  1. il certificato e davvero autofirmato (la firma sul TBS torna con la sua stessa chiave);
  2. la firma RSA del SignerInfo torna sui byte del SET degli attributi firmati;
  3. il messageDigest dichiarato e SHA-256 dei byte coperti dal /ByteRange.
"""

import hashlib
import pathlib
import sys

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding

out = pathlib.Path(__file__).resolve().parent / "out"
esito = {}

cert = x509.load_der_x509_certificate((out / "cert-estratto.der").read_bytes())
esito["soggetto"] = cert.subject.rfc4514_string()
esito["emittente"] = cert.issuer.rfc4514_string()
esito["seriale"] = format(cert.serial_number, "x")
esito["autofirmato_stessi_nomi"] = cert.subject == cert.issuer

# 1. autofirma del certificato
try:
    cert.public_key().verify(
        cert.signature,
        cert.tbs_certificate_bytes,
        padding.PKCS1v15(),
        cert.signature_hash_algorithm,
    )
    esito["autofirma_certificato"] = "OK"
except InvalidSignature:
    esito["autofirma_certificato"] = "FALLITA"

# 2. firma del SignerInfo sui signedAttrs re-taggati SET
signed_attrs = (out / "signedattrs-set-31.der").read_bytes()
signature = (out / "signature-dal-pdf.bin").read_bytes()
try:
    cert.public_key().verify(signature, signed_attrs, padding.PKCS1v15(), hashes.SHA256())
    esito["firma_su_signedAttrs_SET"] = "OK"
except InvalidSignature:
    esito["firma_su_signedAttrs_SET"] = "FALLITA"

# controprova: gli stessi attributi col tag implicito 0xa0 non devono verificare
implicito = (out / "signedattrs-implicito-a0.der").read_bytes()
try:
    cert.public_key().verify(signature, implicito, padding.PKCS1v15(), hashes.SHA256())
    esito["controprova_tag_a0"] = "VERIFICA (sarebbe un assurdo)"
except InvalidSignature:
    esito["controprova_tag_a0"] = "fallisce, come deve"

# 3. messageDigest dichiarato contro i byte coperti
atteso = (out / "messagedigest-dichiarato.hex").read_text().strip()
calcolato = hashlib.sha256((out / "covered.bin").read_bytes()).hexdigest()
esito["messageDigest_dichiarato"] = atteso
esito["sha256_byte_coperti"] = calcolato
esito["digest_coincide"] = atteso == calcolato

for k, v in esito.items():
    print(f"{k:32} {v}")

fallito = (
    esito["autofirma_certificato"] != "OK"
    or esito["firma_su_signedAttrs_SET"] != "OK"
    or not esito["digest_coincide"]
    or esito["controprova_tag_a0"] != "fallisce, come deve"
)
sys.exit(1 if fallito else 0)
