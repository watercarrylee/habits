# habits

Single-file PWA (index.html + sw.js), hosted on GitHub Pages from `main`.

- index.html has a hash-based Content-Security-Policy. After editing the inline `<script>`, run `python3 tools/csp.py` (the local pre-commit hook also does this). A stale hash = blank app.
- Bump `APP_VER` in index.html and `CACHE` in sw.js on every release.
- All data is local (localStorage key `habit-tracker-v1`); `normalize()` is the single gate for loaded/imported data — IDs must pass `cid()`.
- Tag every release `vYYYY.MM.DD-N` matching `APP_VER`, and push tags (`git push origin --tags`) so a version can be named for rollback.
- `normalize()` keeps unknown top-level keys and simple unknown settings, so rolling back to an older build does not erase data added by newer features.
- Add each release to VERSIONS.md (version → commit). Tag pushes are blocked from the cloud session, so VERSIONS.md is the rollback index.
- Before every release run `bash tests/run.sh` (Playwright smoke tests, must end with 0 failed). Add a check there for each new feature.
- To let Aaron try a version before release: build it on a branch, run `python3 tools/preview.py`, and push only `preview/index.html` to main. It is served at /habits/preview/ with separate data (keys `habit-preview-*`). Merge the branch to main after he approves.
- Every release also gets a line at the top of `CHANGELOG` in index.html (user-facing Traditional Chinese, shown in 設定 → 更新紀錄). A smoke test fails if its newest entry doesn't match `APP_VER`.
