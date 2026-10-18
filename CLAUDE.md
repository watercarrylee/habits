# habits

Single-file PWA (index.html + sw.js), hosted on GitHub Pages from `main`.

- index.html has a hash-based Content-Security-Policy. After editing the inline `<script>`, run `python3 tools/csp.py` (the local pre-commit hook also does this). A stale hash = blank app.
- Bump `APP_VER` in index.html and `CACHE` in sw.js on every release.
- All data is local (localStorage key `habit-tracker-v1`); `normalize()` is the single gate for loaded/imported data — IDs must pass `cid()`.
- Tag every release `vYYYY.MM.DD-N` matching `APP_VER`, and push tags (`git push origin --tags`) so a version can be named for rollback.
- `normalize()` keeps unknown top-level keys and simple unknown settings, so rolling back to an older build does not erase data added by newer features.
- Add each release to VERSIONS.md (version → commit). Tag pushes are blocked from the cloud session, so VERSIONS.md is the rollback index.
- Before every release run `bash tests/run.sh` (Playwright smoke tests, must end with 0 failed). Add a check there for each new feature.
- To let Aaron try a version before release (when he asks, or for risky changes): build it on a branch, run `python3 tools/preview.py`, and push only `preview/index.html` to main. It is served at /habits/preview/ with separate data (keys `habit-preview-*`). Merge the branch to main after he approves.
- 更新紀錄 is written the day after: when making the first release of a new day (or when asked), first add one entry per previous release day at the top of `CHANGELOG` in index.html — `['<last version of that day>','M/D',[user-facing Traditional Chinese lines]]`. Same-day releases get no changelog line yet. A smoke test fails if a past release day in VERSIONS.md has no entry.
- Release cadence: once Aaron confirms a change in discussion, release it right away. Use the preview flow only when he asks to try it first or the change is risky. The 更新紀錄 new-update dot follows the newest changelog entry, so it appears at most once per day.
