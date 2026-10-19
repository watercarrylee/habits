#!/usr/bin/env python3
"""Build preview/index.html from index.html for trying a version before release.
The preview keeps its data under separate localStorage keys (never touches real data),
shows a 預覽版 badge, and does not register a service worker."""
import base64, hashlib, pathlib, re, sys
root = pathlib.Path(__file__).resolve().parent.parent
s = (root / 'index.html').read_text(encoding='utf-8')
old = "var KEY=DEMO_NEW?'habit-tracker-demo-new':DEMO?'habit-tracker-demo':'habit-tracker-v1';"
if s.count(old) != 1: sys.exit('KEY line not found')
s = s.replace(old, "var KEY=DEMO_NEW?'habit-preview-demo-new':DEMO?'habit-preview-demo':'habit-preview-v1';")
s = s.replace("navigator.serviceWorker.register('sw.js')", "Promise.reject()")
s = s.replace("fetch('prices.json?t='", "fetch('../prices.json?t='")  # prices.json lives at the site root
s = s.replace("<title>", "<title>預覽 · ", 1)
badge = ('<div style="position:fixed;top:calc(4px + env(safe-area-inset-top,0px));right:8px;z-index:99;background:#b4531f;color:#fff;'
         'font:700 11px/1 -apple-system,sans-serif;padding:5px 8px;border-radius:10px;pointer-events:none">預覽版 · 資料分開</div>')
s = s.replace('<body>', '<body>' + badge, 1) if '<body>' in s else re.sub(r'(<body[^>]*>)', lambda m: m.group(1) + badge, s, 1)
scripts = re.findall(r'<script>(.*?)</script>', s, re.S)
h = base64.b64encode(hashlib.sha256(scripts[0].encode('utf-8')).digest()).decode()
s = re.sub(r"script-src 'sha256-[^']*'", "script-src 'sha256-%s'" % h, s)
(root / 'preview').mkdir(exist_ok=True)
(root / 'preview' / 'index.html').write_text(s, encoding='utf-8')
print('preview/index.html built')
