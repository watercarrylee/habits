# habits

Single-file PWA (index.html + sw.js), hosted on GitHub Pages from `main`.

- index.html has a hash-based Content-Security-Policy. After editing the inline `<script>`, run `python3 tools/csp.py` (the local pre-commit hook also does this). A stale hash = blank app.
- Bump `APP_VER` in index.html and `CACHE` in sw.js on every release.
- All data is local (localStorage key `habit-tracker-v1`); `normalize()` is the single gate for loaded/imported data — IDs must pass `cid()`.
