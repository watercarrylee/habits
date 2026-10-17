// End-to-end smoke tests. Run with: bash tests/run.sh   (needs Node + Playwright with Chromium)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8799/index.html';
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + msg); } };
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

async function page(b, seed, url) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); p.errs = []; p.csp = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('console', m => { if (/Content Security Policy|Refused/.test(m.text())) p.csp.push(m.text()); });
  if (seed) await p.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const k in s) localStorage.setItem(k, typeof s[k] === 'string' ? s[k] : JSON.stringify(s[k])); } }, seed);
  await p.goto(url || BASE);
  return p;
}
const db = (p, key) => p.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key || 'habit-tracker-v1');
const done = async (p, name) => { ok(!p.errs.length, name + ': no page errors ' + p.errs.join(' | ')); ok(!p.csp.length, name + ': no CSP violations'); await p.context().close(); };

(async () => {
  const b = await chromium.launch();
  const T = today();

  console.log('• basics: examples, habits, notes with links');
  let p = await page(b);
  await p.click('[data-act=examples]');
  let d = await db(p); ok(d.habits.length === 7, 'examples add 7 habits');
  const g = d.habits.find(h => h.kind === 'good');
  await p.click('[data-act=toggle][data-id="' + g.id + '"]');
  d = await db(p); ok(d.logs[T] && d.logs[T].h[g.id] === 1, 'toggle checks a habit');
  await p.fill('#note', '看這篇 https://example.com/a?x=1。也看 www.test.org 但不要 javascript:alert(1)');
  await p.click('[data-act=notedone]');
  const links = await p.$$eval('#note-view a', a => a.map(x => [x.getAttribute('href'), x.rel, x.target]));
  ok(links.length === 2, 'note: two links (got ' + links.length + ')');
  ok(links[0] && links[0][0] === 'https://example.com/a?x=1', 'note: trailing 。 not in link');
  ok(links[1] && links[1][0] === 'https://www.test.org', 'note: www gets https://');
  ok(links.every(l => /noopener/.test(l[1]) && l[2] === '_blank'), 'note: links open safely in new tab');
  ok(!(await p.$eval('#note-view', e => e.innerHTML)).includes('href="javascript'), 'note: javascript: never linked');
  await done(p, 'basics');

  console.log('• diary with links');
  p = await page(b, { 'habit-tracker-v1': { v: 1, logs: {}, settings: { diary: true }, rewards: [], redeemed: [], habits: [{ id: 'g1', name: '運動', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(3) }] } });
  await p.click('[data-act=dopen]'); await p.fill('#diary', '今天讀了 https://github.com/watercarrylee/habits/blob/main/README.md 很長的網址');
  await p.click('[data-act=ddone]');
  const dl = await p.$$eval('.dview a', a => a.map(x => [x.getAttribute('href'), x.textContent]));
  ok(dl.length === 1 && dl[0][0].startsWith('https://github.com/watercarrylee/habits/blob'), 'diary: link with full href');
  ok(dl[0] && dl[0][1].length <= 40, 'diary: long URL shortened for display');
  await done(p, 'diary');

  console.log('• hostile backup data is inert');
  const X = '"><img src=x onerror="window.__pwn=1">';
  p = await page(b, { 'habit-tracker-v1': { v: 1, logs: { [T]: { note: X + ' https://a.com/' + X, diary: { t: X, q: X }, h: { ['g1' + X]: 1 } } }, settings: { diary: true, fit: true }, rewards: [], redeemed: [],
    habits: [{ id: 'g1' + X, name: X, kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(3) }],
    fit: { ex: [{ id: 'e' + X, name: X, eq: X, part: X, mode: X }], ctypes: [X], logs: { [T]: { s: [{ id: 's' + X, ex: 'e' + X, sets: [[X, 5]] }], c: [{ id: 'c', type: X, min: X }] } } } } });
  for (const tab of ['today', 'fit', 'stats', 'rewards', 'settings']) { await p.click('[data-tab=' + tab + ']'); }
  ok(!(await p.evaluate(() => window.__pwn)), 'no injected script ran');
  ok((await p.$$('img')).length === 0, 'no injected elements');
  await done(p, 'hostile');

  console.log('• fitness: same-sets entry, grouping, habit link');
  p = await page(b, { 'habit-tracker-v1': { v: 1, logs: {}, settings: {}, rewards: [], redeemed: [], habits: [{ id: 'g1', name: '運動 30 分鐘', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(10), fitLink: true }] } });
  await p.click('[data-tab=settings]'); await p.click('[data-act=fittoggle]');
  d = await db(p); ok(d.fit.ex.length >= 52, 'presets seeded (' + d.fit.ex.length + ')');
  await p.click('[data-tab=fit]'); await p.click('[data-act=fpick]'); await p.click('[data-act=fpart][data-v="背"]');
  ok((await p.$$eval('.fgrp', x => x.map(e => e.textContent))).some(t => t.includes('器械')), 'picker grouped by equipment');
  await p.click('[data-act=fpickex][data-id=p25]');
  ok(!!(await p.$('.sameset')), 'new entry opens in same-sets mode');
  await p.click('[data-act=flcnt][data-d="1"]'); await p.click('[data-act=flsave]');
  ok(/× 4 組/.test(await p.$eval('.fcard .fsets', e => e.textContent)), 'compact sets text');
  ok((await p.$eval('h2.sec-t', e => e.textContent)) === '重訓 · 背', 'day grouped by body part');
  await p.click('[data-act=fmin][data-n="5"]'); for (let i = 0; i < 5; i++) await p.click('[data-act=fmin][data-n="5"]');
  d = await db(p); ok(d.logs[T] && d.logs[T].h && d.logs[T].h.g1 === 1, 'linked habit auto-checked at 30 min');
  await p.click('[data-act=fmin][data-n="-5"]'); d = await db(p); ok(!(d.logs[T] && d.logs[T].h && d.logs[T].h.g1), 'auto check removed below target');
  await done(p, 'fitness');

  console.log('• backup: reminder, snooze, encrypted round trip');
  p = await page(b, { 'habit-tracker-v1': { v: 1, logs: { [daysAgo(20)]: { note: '舊的' } }, settings: {}, rewards: [], redeemed: [], habits: [{ id: 'g1', name: '運動', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(20) }] } });
  ok(!!(await p.$('.bk')), 'reminder shown after 20 days without backup');
  await p.click('[data-act=bksnooze]'); ok(!(await p.$('.bk')), 'snooze hides reminder');
  await p.click('[data-tab=settings]'); await p.click('[data-act=export]');
  await p.fill('#pw1', 'correct-horse'); await p.fill('#pw2', 'correct-horse'); await p.click('[data-act=exportenc]');
  await p.waitForSelector('#exporttext', { timeout: 20000 }); const enc = await p.$eval('#exporttext', e => e.value);
  ok(!/運動|舊的/.test(enc) && JSON.parse(enc).enc === 'AES-GCM', 'encrypted backup hides content');
  const dlw = p.waitForEvent('download'); await p.click('[data-act=download]'); const fn = (await dlw).suggestedFilename();
  ok(/^habits-backup-\d{4}-\d\d-\d\d-\d{4}-(safari|chrome|app|browser|edge|firefox)-locked\.json$/.test(fn), 'backup file name has time and source (' + fn + ')');
  await p.click('[data-act=copy]'); await p.click('[data-act=closesheet]');
  ok((await p.$eval('[data-act=export]', e => e.textContent)).includes('今天備份過'), 'settings shows backup age');
  await p.evaluate(() => localStorage.removeItem('habit-tracker-v1')); await p.reload();
  await p.click('[data-tab=settings]'); await p.click('[data-act=import]'); await p.fill('#pastebox', enc); await p.dispatchEvent('#pastebox', 'input'); await p.click('[data-act=usepaste]');
  await p.fill('#pw3', 'wrong-pass'); await p.click('[data-act=unlockimp]'); await p.waitForSelector('.err0'); ok(true, 'wrong password rejected');
  await p.fill('#pw3', 'correct-horse'); await p.click('[data-act=unlockimp]'); await p.waitForSelector('[data-act=confirmimport]', { timeout: 20000 });
  ok((await p.$eval('.sheet', e => e.innerText)).includes('備份時間'), 'restore shows when the backup was made');
  await p.click('[data-act=confirmimport]');
  d = await db(p); ok(d.habits[0].name === '運動' && d.logs[daysAgo(20)].note === '舊的', 'restore brings data back');
  ok(!('meta' in d), 'backup metadata not stored into app data');
  await done(p, 'backup');

  console.log('• demo mode is isolated');
  p = await page(b, { 'habit-tracker-v1': { v: 1, logs: {}, settings: {}, rewards: [], redeemed: [], habits: [{ id: 'real', name: '真的', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(1) }] } }, BASE + '?demo');
  ok(!!(await p.$('.demobar')), 'demo bar shown');
  const demo = await db(p, 'habit-tracker-demo'); ok(demo && demo.habits.length === 8 && Object.keys(demo.fit.logs).length > 30, 'demo data generated');
  const real = await db(p); ok(real.habits.length === 1 && real.habits[0].name === '真的', 'real data untouched');
  ok(!(await p.$('.bk')), 'no backup reminder in demo');
  await done(p, 'demo');

  console.log('• new-user demo: onboarding');
  p = await page(b, { 'habit-tracker-v1': { v: 1, logs: {}, settings: {}, rewards: [], redeemed: [], habits: [] } }, BASE + '?demo=new');
  ok(!!(await p.$('.ob')), 'onboarding shown in ?demo=new');
  ok(await p.$eval('[data-act=obnext]', e => e.disabled), 'next disabled until an area is picked');
  await p.click('[data-act=obarea][data-v=sleep]'); await p.click('[data-act=obarea][data-v=fit]'); await p.click('[data-act=obnext]');
  await p.click('[data-act=obsize][data-v="5"]'); await p.click('[data-act=obnext]');
  ok((await p.$eval('[data-act=obfeat][data-v=fit]', e => e.getAttribute('aria-checked'))) === 'true', 'fitness preselected when 運動健身 chosen');
  await p.click('[data-act=obnext]');
  ok((await p.$$('.obpick')).length === 5, '5 habits recommended');
  await p.click('[data-act=obpick][data-i="4"]'); await p.fill('.obin[data-i="0"]', '11 點前睡覺'); await p.click('[data-act=obnext]');
  d = await db(p, 'habit-tracker-demo-new');
  ok(d.habits.length === 4 && d.habits[0].name === '11 點前睡覺', 'habits created with edits (' + d.habits.length + ')');
  ok(d.habits.some(h => h.fitLink) && d.settings.fit && d.settings.onboarded, 'fitness on and 運動 linked');
  await p.click('[data-act=demofill]'); d = await db(p, 'habit-tracker-demo-new');
  ok(Object.keys(d.logs).length > 100 && Object.keys(d.fit.logs).length > 30, 'fake history filled for chosen habits');
  await p.click('[data-act=demoreset]'); ok(!!(await p.$('.ob')), 'restart returns to onboarding');
  ok((await db(p)).habits.length === 0, 'real data untouched');
  await p.goto(BASE); ok(!(await p.$('.ob')), 'real app does not show onboarding yet');
  await done(p, 'onboarding');

  console.log('• 運動 tab + all-done celebration');
  const celSeed = histDays => {
    const logs = {};
    for (let i = 1; i <= histDays; i++) logs[daysAgo(i)] = { h: { c1: 1, c2: 1 } };
    return { 'habit-tracker-v1': { v: 1, logs, settings: { fit: true }, rewards: [], redeemed: [], habits: [
      { id: 'c1', name: '伸展', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(30) },
      { id: 'c2', name: '閱讀', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(30) }] } };
  };
  p = await page(b, celSeed(2));
  ok((await p.$eval('#tabs', e => e.innerText)).includes('運動') && !(await p.$eval('#tabs', e => e.innerText)).includes('健身'), 'tab is named 運動');
  await p.click('[data-act=toggle][data-id="c1"]');
  ok(!(await p.$eval('.sum-card', e => e.classList.contains('alldone'))), 'no celebration while one habit left');
  await p.click('[data-act=toggle][data-id="c2"]');
  ok(await p.$eval('.sum-card', e => e.classList.contains('alldone') && e.innerText.includes('今天全部完成')), 'card shows 今天全部完成');
  ok(/連續 3 天/.test(await p.$eval('#toast', e => e.hidden ? '' : e.innerText)), 'cheer toast with streak');
  ok((await p.evaluate(() => localStorage.getItem('habit-tracker-v1-cel'))) === T, 'celebration remembered for today');
  await p.evaluate(() => { document.getElementById('toast').hidden = true; });
  await p.click('[data-act=toggle][data-id="c2"]'); await p.click('[data-act=toggle][data-id="c2"]');
  ok(await p.$eval('#toast', e => e.hidden), 'celebrates only once a day');
  await done(p, 'celebration');

  p = await page(b, celSeed(6));
  await p.click('[data-act=toggle][data-id="c1"]'); await p.click('[data-act=toggle][data-id="c2"]');
  ok(await p.$eval('.sheet', e => e.innerText.includes('連續 7 天全部完成')), 'milestone sheet at 7 days');
  await p.click('.sheet [data-act=closesheet]'); ok(!(await p.$('.sheet')), 'milestone sheet closes');
  await done(p, 'milestone');

  console.log('• daily goal for counted habits (from the day it is set)');
  p = await page(b, { 'habit-tracker-v1': { v: 1, settings: {}, rewards: [], redeemed: [], logs: { [daysAgo(1)]: { h: { w1: 2 } } }, habits: [
    { id: 'w1', name: '喝水', kind: 'good', method: 'count', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(10) }] } });
  await p.click('[data-act=tab][data-tab=settings]'); await p.click('[data-act=edit][data-id=w1]');
  for (let i = 0; i < 3; i++) await p.click('[data-act=goalstep][data-n="1"]');
  ok((await p.$eval('.goalv', e => e.textContent)) === '4' && (await p.content()).includes('從今天開始用新目標'), 'editor sets goal and explains it starts today');
  await p.click('[data-act=save]'); d = await db(p);
  ok(JSON.stringify(d.habits[0].goalHist) === JSON.stringify([{ from: T, n: 4 }]), 'goal stored from today');
  await p.click('[data-act=tab][data-tab=today]');
  for (let i = 0; i < 3; i++) await p.click('[data-act=inc][data-id=w1]');
  ok(!(await p.$('.hcard.g-on')) && (await p.$eval('.cnt', e => e.innerText.replace(/\s/g, ''))) === '3/4', 'not done below goal, shows 3/4');
  ok(!!(await p.$('.gbar')) && (await p.$eval('.hc-sub', e => e.innerText)).includes('還差 1 次'), 'progress bar and remaining count');
  ok((await p.$eval('.hc-sub', e => e.innerText)).includes('連續 1 天'), 'yesterday (2 times, before the goal) still counts');
  await p.click('[data-act=inc][data-id=w1]');
  ok(!!(await p.$('.hcard.g-on')) && (await p.$eval('.sum-card', e => e.classList.contains('alldone'))), 'reaching the goal completes and celebrates');
  ok((await p.$eval('.hc-sub', e => e.innerText)).includes('連續 2 天'), 'streak continues');
  await done(p, 'goal');

  console.log('• security headers in page');
  p = await page(b);
  ok(!(await p.evaluate(() => fetch('https://example.com/').then(() => true, () => false))), 'CSP blocks outbound requests');
  await p.evaluate(() => { const d = document.createElement('div'); d.innerHTML = '<img src=x onerror="window.__x=1">'; document.body.appendChild(d); });
  await p.waitForTimeout(200); ok(!(await p.evaluate(() => window.__x)), 'CSP blocks inline handlers');
  const f = await p.context().newPage(); await f.setContent('<iframe src="' + BASE + '"></iframe>'); await f.waitForTimeout(800);
  ok((await f.frames()[1].evaluate(() => document.body.innerText)).includes('不能嵌在其他網頁'), 'refuses to run inside a frame');
  ok(p.csp.length >= 2, 'CSP reported the blocked attempts'); p.csp = []; // violations above were triggered on purpose
  await done(p, 'security');

  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
