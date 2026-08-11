# Estrae dal DOM stampato da Chrome il blocco #esito e lo ristampa leggibile.
# Esce con 0 solo se data-esito == "ok".
import sys, re, html

h = sys.stdin.read()
m = re.search(r'<pre\b[^>]*id="esito"[^>]*>(.*?)</pre>', h, re.S)
stato = re.search(r'<pre\b[^>]*id="esito"[^>]*data-esito="([^"]*)"', h, re.S)
stato = stato.group(1) if stato else "ASSENTE"
print("data-esito =", stato)
print(html.unescape(m.group(1)) if m else "(nessun blocco #esito nel DOM)")
sys.exit(0 if stato == "ok" else 1)
