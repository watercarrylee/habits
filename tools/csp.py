#!/usr/bin/env python3
"""Recompute the CSP script hash in index.html. Run after ANY edit to the inline <script>.
If the hash is stale, browsers refuse to run the script and the app shows a blank page."""
import base64, hashlib, pathlib, re, sys
p = pathlib.Path(__file__).resolve().parent.parent / 'index.html'
s = p.read_text(encoding='utf-8')
scripts = re.findall(r'<script>(.*?)</script>', s, re.S)
if len(scripts) != 1:
    sys.exit('expected exactly one inline <script>, found %d' % len(scripts))
h = base64.b64encode(hashlib.sha256(scripts[0].encode('utf-8')).digest()).decode()
csp = ("default-src 'self'; script-src 'sha256-%s'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; "
       "object-src 'none'; base-uri 'none'; form-action 'none'") % h
new, n = re.subn(r'(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")', lambda m: m.group(1) + csp + m.group(2), s)
if n != 1:
    sys.exit('CSP meta tag not found')
if new != s:
    p.write_text(new, encoding='utf-8'); print('CSP hash updated: sha256-' + h)
else:
    print('CSP hash already current')
