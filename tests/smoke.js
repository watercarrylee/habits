// End-to-end smoke tests. Run with: bash tests/run.sh   (needs Node + Playwright with Chromium)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8799/index.html';
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + msg); } };
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const isKeyLike = v => /^\d{4}-\d\d-\d\d$/.test(v || '');
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
const fitAdd = async (p, kind) => { if (await p.$('.fab')) await p.click('.fab'); await p.click('[data-act=' + kind + ']'); };
const db = (p, key) => p.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key || 'habit-tracker-v1');
const done = async (p, name) => { ok(!p.errs.length, name + ': no page errors ' + p.errs.join(' | ')); ok(!p.csp.length, name + ': no CSP violations'); await p.context().close(); };

(async () => {
  const b = await chromium.launch();
  const T = today();

  console.log('• basics: examples, habits, notes with links');
  let p = await page(b);
  ok(!!(await p.$('.ob')), 'a brand-new user sees the onboarding'); await p.click('[data-act=obskip]');
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
  { const dd = (await db(p)).logs[T].diary; ok(dd.c > Date.now() - 60000 && dd.u >= dd.c, 'diary: first and last writing time saved');
    ok(/^寫於 \d\d:\d\d$/.test(await p.innerText('#dwhen')), 'diary: 寫於 shown under the date'); }
  await p.click('[data-act=dedit]');
  await p.fill('#diary', '**粗** *斜* ~~刪~~ <img src=x onerror=window.__md=1>\n> 引用\n- 甲\n  - 乙\n1. 一\n2. 二');
  await p.click('[data-act=ddone]');
  ok(await p.$eval('.dview b', e => e.textContent) === '粗' && await p.$eval('.dview i', e => e.textContent) === '斜' && await p.$eval('.dview s', e => e.textContent) === '刪', 'markdown: bold, italic, strike');
  ok(!!(await p.$('.dview .md-q')) && (await p.$$('.dview .md-li')).length === 4 && (await p.$$eval('.md-m', e => e.map(x => x.textContent))).join() === '•,◦,1.,2.', 'markdown: quote and lists with nesting');
  ok(!(await p.$('.dview img')) && !(await p.evaluate(() => window.__md)), 'markdown: typed HTML stays text');
  await p.click('[data-act=dedit]'); await p.fill('#diary', '- 甲'); await p.focus('#diary'); await p.keyboard.press('End'); await p.keyboard.press('Enter');
  ok(await p.inputValue('#diary') === '- 甲\n- ', 'markdown: Enter continues the list');
  await p.keyboard.press('Enter'); ok(await p.inputValue('#diary') === '- 甲\n', 'markdown: Enter on an empty item ends the list');
  await p.fill('#diary', '重點'); await p.evaluate(() => { const ta = document.getElementById('diary'); ta.focus(); ta.setSelectionRange(0, 2); });
  await p.click('[data-act=md][data-v=b]'); ok(await p.inputValue('#diary') === '**重點**', 'markdown: toolbar bold wraps the selection');
  await p.click('[data-act=md][data-v=ol]'); ok(await p.inputValue('#diary') === '1. **重點**', 'markdown: toolbar numbered list');
  await p.click('[data-act=md][data-v=in]'); ok(await p.inputValue('#diary') === '  1. **重點**', 'markdown: toolbar indent');
  ok((await db(p)).logs[T].diary.t === '  1. **重點**', 'markdown: toolbar edits are saved');
  await p.fill('#diary', '看 [健身影片](https://example.com/v?a=1) 和 [壞的](javascript:alert(1))\n> **重點**');
  await p.click('[data-act=ddone]');
  ok(await p.$eval('.dview a.ulink', e => e.textContent + '|' + e.getAttribute('href')) === '健身影片|https://example.com/v?a=1', 'markdown: [文字](網址) link');
  ok((await p.$$('.dview a')).length === 1, 'markdown: javascript: never becomes a link');
  await p.click('[data-act=dshare]'); let dsw = p.waitForEvent('download'); await p.click('[data-act=dshtml]'); let dsf = await dsw;
  const dsHtmlTxt = require('fs').readFileSync(await dsf.path(), 'utf8');
  ok(dsf.suggestedFilename() === 'diary-' + T + '.html' && dsHtmlTxt.includes('<b>重點</b>') && dsHtmlTxt.includes('href="https://example.com/v?a=1"') && !dsHtmlTxt.includes('<script'), 'share: HTML file with formatting and links, no script');
  await p.click('[data-act=dshare]'); dsw = p.waitForEvent('download'); await p.click('[data-act=dsimg]'); dsf = await dsw;
  const dsPng = require('fs').readFileSync(await dsf.path());
  ok(dsf.suggestedFilename() === 'diary-' + T + '.png' && dsPng.slice(1, 4).toString() === 'PNG' && dsPng.length > 10000, 'share: image');
  await p.click('[data-act=dedit]'); await p.fill('#diary', '影片'); await p.evaluate(() => { const ta = document.getElementById('diary'); ta.focus(); ta.setSelectionRange(0, 2); });
  await p.click('[data-act=md][data-v=link]'); await p.waitForTimeout(100);
  ok(await p.inputValue('#diary') === '[影片](https://)', 'markdown: link button wraps the selection');
  await done(p, 'diary');
  { const k2 = daysAgo(2), c = Date.now() - 3600e3;
    p = await page(b, { 'habit-tracker-v1': { v: 1, logs: { [k2]: { diary: { t: '補寫的日記', c: c, u: c + 30 * 60000 } } }, settings: { diary: true, onboarded: true }, rewards: [], redeemed: [], habits: [{ id: 'g1', name: '運動', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(9) }] } });
    await p.click('[data-tab=stats]'); await p.click('[data-act=stab][data-v=diary]').catch(() => {});
    ok((await db(p)).logs[k2].diary.c === c, 'diary: writing time kept through load');
    await done(p, 'diary late'); }

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
  ok(d.fit.ex.some(e => e.id === 'p53' && e.name === '啞鈴夾胸') && d.fit.ex.some(e => e.id === 'p54' && e.eq === '器械' && e.part === '二頭'), 'new presets 啞鈴夾胸 and 二頭彎舉機');
  ok(d.fit.ex.length >= 66 && d.fit.ex.some(e => e.id === 'p66' && e.name === '滑輪木樁砍') && d.fit.ex.some(e => e.id === 'p42' && e.name === '坐姿腿彎舉機'), 'Spirit machines added; 腿彎舉機 renamed');
  await p.click('[data-tab=fit]'); await fitAdd(p, 'fpick'); await p.click('[data-act=fpart][data-v="背"]');
  ok((await p.$$eval('.fgrp', x => x.map(e => e.textContent))).some(t => t.includes('器械')), 'picker grouped by equipment');
  ok(await p.$$eval('section', xs => xs.some(x => (x.querySelector('.fgrp') || {}).textContent && x.querySelector('.fgrp').textContent.includes('器械') && x.innerText.includes('滑輪下拉'))), '滑輪下拉 also listed under 器械');
  await p.click('[data-act=fpickex][data-id=p25]');
  ok(!!(await p.$('.sameset')), 'new entry opens in same-sets mode');
  await p.click('[data-act=flcnt][data-d="1"]'); await p.click('[data-act=flsave]');
  ok(/× 4 組/.test(await p.$eval('.fcard .fsets', e => e.textContent)), 'compact sets text');
  ok((await p.$eval('h2.sec-t', e => e.textContent)) === '重訓 · 背', 'day grouped by body part');
  await p.click('[data-act=fmin][data-n="5"]'); for (let i = 0; i < 5; i++) await p.click('[data-act=fmin][data-n="5"]');
  d = await db(p); ok(d.logs[T] && d.logs[T].h && d.logs[T].h.g1 === 1, 'linked habit auto-checked at 30 min');
  await p.click('[data-tab=today]'); await p.click('[data-act=toggle][data-id=g1]');
  d = await db(p); ok(d.logs[T].h.g1 === 1 && (await p.$eval('#toast', e => e.innerText)).includes('自動打勾'), 'a check backed by a 運動 record cannot be undone by tapping');
  await p.click('[data-tab=fit]'); await p.click('[data-act=ftab][data-v=log]').catch(() => {});
  await p.click('[data-act=fmin][data-n="-5"]'); d = await db(p); ok(!(d.logs[T] && d.logs[T].h && d.logs[T].h.g1), 'auto check removed below target');
  await p.click('[data-tab=today]');
  ok((await p.$eval('.hc-sub', e => e.innerText)).startsWith('83%') && !!(await p.$('.pbar')), 'linked card shows 83% (25 of 30 min) and a bar');
  await done(p, 'fitness');
  p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { fit: true }, rewards: [], redeemed: [], logs: { [T]: { h: { g1: 1 }, fa: ['g1'] } },
    fit: { ex: [], ctypes: [], logs: { [T]: { c: [{ id: 'x1', type: '跑步', min: 20 }], min: 30 } } },
    habits: [{ id: 'g1', name: '運動 30 分鐘', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(10), fitLink: true },
             { id: 'g2', name: '伸展', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(10) }] } });
  const subs = await p.$$eval('.hc-sub', x => x.map(e => e.innerText));
  ok(subs[0].startsWith('✓ 達成') && !subs[0].includes('有氧'), 'linked card shows ✓ 達成 without the 運動 breakdown (' + subs[0] + ')');
  ok(!subs[1].includes('重訓'), 'unlinked habits unchanged');
  await p.click('[data-tab=settings]'); await p.click('[data-act=edit][data-id=g1]'); await p.click('[data-act=fitlink]'); await p.click('[data-act=save]');
  await p.click('[data-tab=fit]'); ok(!!(await p.$('[data-act=fmin][data-n="5"]')), '重訓時間 shown even with no linked habit');
  await p.click('[data-act=fmin][data-n="5"]'); ok((await db(p)).fit.logs[T].min === 35, '重訓時間 adjustable without a link');
  ok(!(await p.$eval('#main', e => e.innerText)).includes('這天沒有運動紀錄'), 'minutes alone count as a record');
  await done(p, 'fitness line');

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
  await p.click('.ob [data-act=import]'); await p.fill('#pastebox', enc); await p.dispatchEvent('#pastebox', 'input'); await p.click('[data-act=usepaste]');
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
  await p.goto(BASE); ok(!!(await p.$('.ob')), 'real app shows onboarding to new users');
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
  ok((await p.$eval('#hgoal', e => e.value)) === '4' && (await p.$eval('#ghint', e => e.innerText)).includes('新目標從今天開始'), 'editor sets goal and explains it starts today');
  await p.click('[data-act=save]'); d = await db(p);
  ok(JSON.stringify(d.habits[0].goalHist) === JSON.stringify([{ from: T, n: 4 }]), 'goal stored from today');
  await p.click('[data-act=tab][data-tab=today]');
  for (let i = 0; i < 3; i++) await p.click('[data-act=inc][data-id=w1]');
  ok(!(await p.$('.hcard.g-on')) && (await p.$eval('.hc-sub', e => e.innerText)).startsWith('75%'), 'not done below goal, shows 75%');
  ok(!!(await p.$('.pbar')), 'progress bar shown');
  ok((await p.$eval('.hc-sub', e => e.innerText)).includes('連續 1 天'), 'yesterday (2 times, before the goal) still counts');
  await p.click('[data-act=inc][data-id=w1]');
  ok(!!(await p.$('.hcard.g-on')) && (await p.$eval('.sum-card', e => e.classList.contains('alldone'))), 'reaching the goal completes and celebrates');
  ok((await p.$eval('.hc-sub', e => e.innerText)).includes('連續 2 天'), 'streak continues');
  await done(p, 'goal');

  console.log('• units, amount per tap, typing a total');
  p = await page(b, { 'habit-tracker-v1': { v: 1, settings: {}, rewards: [], redeemed: [], logs: { [daysAgo(1)]: { h: { u1: 3 } }, [daysAgo(2)]: { h: { u1: 4 } } }, habits: [
    { id: 'u1', name: '喝水', kind: 'good', method: 'count', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(10), saveHist: [{ from: daysAgo(10), amt: 10 }] },
    { id: 'b1', name: '宵夜', kind: 'bad', method: 'count', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(10) }] } });
  await p.click('[data-act=tab][data-tab=settings]'); await p.click('[data-act=edit][data-id=u1]');
  await p.click('[data-act=unitchip][data-v=ml]'); await p.fill('#hstep', '500'); await p.fill('#hgoal', '2000');
  const gh = await p.$eval('#ghint', e => e.innerText);
  ok(gh.includes('大約按 4 下') && gh.includes('一起換算'), 'hint shows taps needed and warns about conversion');
  await p.click('[data-act=save]'); d = await db(p); let u = d.habits.find(h => h.id === 'u1');
  ok(u.unit === 'ml' && u.step === 500 && d.logs[daysAgo(1)].h.u1 === 1500 && d.logs[daysAgo(2)].h.u1 === 2000, 'past presses converted to ml');
  ok(JSON.stringify(u.goalHist) === JSON.stringify([{ from: T, n: 2000 }]), 'goal 2000 from today');
  await p.click('[data-act=tab][data-tab=rewards]');
  ok((await p.$eval('#main', e => e.innerText)).includes('NT$70'), 'savings unchanged after conversion (7 presses x 10)');
  await p.click('[data-act=tab][data-tab=today]');
  await p.click('[data-act=inc][data-id=u1]'); await p.click('[data-act=inc][data-id=u1]');
  ok((await db(p)).logs[T].h.u1 === 1000 && (await p.$eval('.hc-sub', e => e.innerText)).startsWith('50%') && (await p.$eval('[data-id=u1] .cunit', e => e.textContent)) === 'ml', 'each tap adds 500 ml, shows 50% and ml under the number');
  await p.click('[data-act=dec][data-id=u1]'); ok((await db(p)).logs[T].h.u1 === 500, 'minus removes 500 ml');
  await p.click('[data-act=inc][data-id=b1]'); ok((await db(p)).logs[T].h.b1 === 1, 'bad habit +1');
  await p.click('[data-act=tab][data-tab=stats]');
  ok(/本月共 .* ml · 平均每天/.test(await p.$eval('#main', e => e.innerText)), 'stats show monthly total and daily average');
  await p.click('[data-act=tab][data-tab=settings]'); await p.click('[data-act=edit][data-id=u1]');
  ok(!(await p.$eval('#ghint', e => e.innerText)).includes('換算'), 'no conversion warning when step unchanged');
  await p.click('[data-act=unitchip][data-v=杯]'); await p.click('[data-act=save]'); d = await db(p); u = d.habits.find(h => h.id === 'u1');
  ok(u.unit === '杯' && d.logs[daysAgo(1)].h.u1 === 1500 && d.logs[T].h.u1 === 500, 're-saving / renaming unit does not rescale again');
  await p.click('[data-act=edit][data-id=u1]'); await p.fill('#hstep', '250');
  ok((await p.$eval('#ghint', e => e.innerText)).includes('以前的紀錄照舊'), 'same unit, smaller tap: hint says old records stay');
  await p.click('[data-act=save]'); d = await db(p); u = d.habits.find(h => h.id === 'u1');
  ok(u.step === 250 && d.logs[daysAgo(1)].h.u1 === 1500 && d.logs[daysAgo(2)].h.u1 === 2000 && d.logs[T].h.u1 === 500, 'changing tap size with the same unit keeps old amounts');
  ok(u.goalHist.every(g => g.n === 2000) && u.stepHist && u.stepHist[0].step === 500, 'goals unchanged, old tap size remembered for savings');
  await p.click('[data-act=tab][data-tab=rewards]'); ok((await p.$eval('#main', e => e.innerText)).includes('NT$90'), 'past savings still count old 500-ml taps (' + ((await p.$eval('#main', e => e.innerText)).match(/NT\$\d+/) || '') + ')');
  await p.click('[data-act=tab][data-tab=settings]');
  await p.click('[data-act=tab][data-tab=today]'); await p.click('[data-act=day][data-n="-1"]'); await p.click('[data-act=day][data-n="-1"]');
  ok(!(await p.$('[data-act=amt]')), 'no tap-to-type on the number');
  await p.click('[data-act=tab][data-tab=settings]'); await p.click('[data-act=fittoggle]');
  await p.click('[data-act=edit][data-id=u1]'); ok(!(await p.$('[data-act=fitlink]')), 'counted habits cannot be linked to 運動');
  await p.click('[data-act=method][data-v=check]'); ok(!(await p.isVisible('[data-act=fitlink]')), 'non-exercise habit (喝水) hides the 運動 link');
  await p.fill('#hname', '晨跑'); ok(await p.isVisible('[data-act=fitlink]'), 'typing an exercise name shows the 運動 link');
  const order = await p.$$eval('.field .lbl, .field label.lbl, .savebox .lbl', x => x.map(e => e.textContent));
  ok(order.findIndex(t => t.includes('頻率')) < order.findIndex(t => t.includes('省下')), '頻率 comes before 省下 in the editor');
  await done(p, 'units');

  console.log('• past days are locked');
  const lockSeed = st => ({ 'habit-tracker-v1': { v: 1, settings: st || {}, rewards: [], redeemed: [], logs: {}, habits: [
    { id: 'k1', name: '伸展', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(30) }] } });
  p = await page(b, lockSeed());
  await p.click('[data-act=day][data-n="-1"]');
  ok(!(await p.$('.lockbar')), 'yesterday is not locked');
  await p.click('[data-act=toggle][data-id=k1]'); ok((await db(p)).logs[daysAgo(1)].h.k1 === 1, 'yesterday can be checked directly');
  await p.click('[data-act=day][data-n="-1"]');
  ok(!!(await p.$('.page.locked .lockbar')), 'two days ago is locked');
  await p.click('[data-act=toggle][data-id=k1]'); await p.click('[data-act=mood][data-i="3"]');
  ok((await p.$$('.moods .mood svg.mface')).length === 5, 'mood: five faces');
  ok(!(await db(p)).logs[daysAgo(2)], 'locked day ignores taps');
  ok((await p.$eval('#toast', e => e.innerText)).includes('編輯這天'), 'locked tap explains how to unlock');
  await p.click('[data-act=unlockday]'); await p.click('[data-act=toggle][data-id=k1]');
  ok((await db(p)).logs[daysAgo(2)].h.k1 === 1 && !!(await p.$('.lockbar.open')), 'unlock lets you edit that day');
  await p.click('[data-act=day][data-n="-1"]'); await p.click('[data-act=day][data-n="1"]');
  ok(!!(await p.$('.page.locked')), 'leaving the day locks it again');
  await p.click('[data-act=tab][data-tab=settings]'); await p.click('[data-act=lockn][data-v="3"]');
  await p.click('[data-act=tab][data-tab=today]'); if (await p.$('[data-act=gotoday]')) await p.click('[data-act=gotoday]');
  await p.click('[data-act=day][data-n="-1"]'); await p.click('[data-act=day][data-n="-1"]');
  ok(!(await p.$('.lockbar')), 'lock after 3 days: 2 days ago editable');
  await p.click('[data-act=tab][data-tab=settings]'); await p.click('[data-act=locktoggle]');
  ok((await db(p)).settings.lockOff === true && !(await p.$('[data-act=lockn]')), 'lock can be turned off');
  await done(p, 'lock');

  console.log('• weekly habits (每週 N 次)');
  const ws = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; })();
  const wk = (weeksBack, i) => { const d = new Date(ws); d.setDate(d.getDate() - 7 * weeksBack + i); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const wlogs = {};
  const put = (k, id) => { (wlogs[k] = wlogs[k] || { h: {} }).h[id] = 1; };
  [0, 2, 4].forEach(i => { put(wk(1, i), 'w3'); put(wk(2, i), 'w3'); }); put(wk(3, 0), 'w3');
  put(wk(1, 5), 'w1');
  p = await page(b, { 'habit-tracker-v1': { v: 1, settings: {}, rewards: [], redeemed: [], logs: wlogs, habits: [
    { id: 'c1', name: '伸展', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(40) },
    { id: 'w3', name: '運動 30 分鐘', kind: 'good', method: 'check', freq: 'week', perWeek: 3, days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(40) },
    { id: 'w1', name: '打電話回家', kind: 'good', method: 'check', freq: 'week', perWeek: 1, days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(40) }] } });
  const secs = await p.$$eval('h2.sec-t', x => x.map(e => e.textContent));
  ok(secs.includes('這週') && secs.indexOf('這週') > secs.indexOf('好習慣'), '這週 section after 好習慣');
  ok((await p.$$('section:has(h2:text-is("這週")) .hcard')).length === 2, 'weekly habits listed in 這週');
  ok((await p.$eval('.sum-card .sum-v', e => e.innerText.replace(/\s/g, ''))) === '0/1', 'today summary counts daily habits only');
  let wsub = await p.$eval('[data-id=w3] .hc-sub', e => e.innerText);
  ok(/^(0%|還差|這週差)/.test(wsub) && wsub.includes('連續 2 週'), 'shows 0% (or a late-week warning) and 連續 2 週 (' + wsub + ')');
  ok((await p.$$('[data-id=w3] .pbar.seg i')).length === 3, 'bar split into 3 segments');
  ok((await p.$eval('[data-id=w3] .chkday small', e => e.textContent)) === '今天' && !(await p.$('[data-id=c1] .chkday')), 'weekly check is labelled 今天; daily habits unchanged');
  await p.click('[data-act=toggle][data-id=w3]');
  wsub = await p.$eval('[data-id=w3] .hc-sub', e => e.innerText);
  ok(wsub.includes('連續 2 週') && (await p.$$('[data-id=w3] .pbar.seg i.on')).length === 1, 'tap today: 1 / 3, current week does not break streak');
  await p.evaluate(() => { document.getElementById('toast').hidden = true; });
  await p.click('[data-act=toggle][data-id=w1]');
  ok((await p.$eval('#toast', e => e.innerText)).includes('本週達成'), 'weekly goal reached toast');
  wsub = await p.$eval('[data-id=w1] .hc-sub', e => e.innerText);
  ok(wsub.startsWith('✓ 本週達成') && wsub.includes('連續 2 週'), 'met week shows ✓ 本週達成 and counts (' + wsub + ')');
  ok(!/本週達成 \d+ 次/.test(wsub), 'exactly at the goal: no extra count');
  ok(!(await p.$eval('.sum-card', e => e.classList.contains('alldone'))), 'weekly taps do not complete the day');
  await p.click('[data-act=toggle][data-id=c1]');
  ok(await p.$eval('.sum-card', e => e.classList.contains('alldone')), 'daily all-done not blocked by unmet weekly habit');
  await p.reload(); d = await db(p);
  ok(d.habits.find(h => h.id === 'w3').freq === 'week' && d.habits.find(h => h.id === 'w3').perWeek === 3, 'freq survives reload');
  await p.click('[data-tab=stats]');
  ok(/週 · 共 \d+ 次/.test(await p.$eval('#main', e => e.innerText)), 'stats ranking counts weekly habits in weeks');
  await p.click('[data-tab=settings]');
  ok((await p.$eval('#main', e => e.innerText)).includes('每週 3 次'), 'settings list shows 每週 3 次');
  await p.click('[data-act=new][data-kind=good]').catch(async () => { await p.click('[data-act=new]'); });
  await p.fill('#hname', '游泳'); await p.click('[data-act=freq][data-v=week]');
  ok(!(await p.$('[data-act=dayt]')) && (await p.$eval('#pwv', e => e.textContent)) === '3', 'weekly mode hides weekday picker, default 3');
  await p.click('[data-act=pwstep][data-n="-1"]'); await p.click('[data-act=save]');
  d = await db(p); const sw = d.habits.find(h => h.name === '游泳');
  ok(sw && sw.freq === 'week' && sw.perWeek === 2, 'new weekly habit saved with 2 per week');
  await p.click('[data-tab=settings]'); await p.click('[data-act=edit][data-id=w3]');
  await p.fill('#hname', '閱讀 20 頁');
  ok(!(await p.isVisible('[data-act=fitlink]')), 'renaming an auto-icon habit away from exercise hides the 運動 link');
  await p.click('[data-act=save]'); d = await db(p);
  ok(d.habits.find(h => h.id === 'w3').icon === 'book', 'auto-picked icon follows the new name');
  await p.click('[data-act=edit][data-id=w3]'); await p.click('#icobtn'); await p.click('[data-act=seticon][data-v=music]');
  await p.fill('#hname', '跑步'); await p.click('[data-act=save]'); d = await db(p);
  ok(d.habits.find(h => h.id === 'w3').icon === 'music', 'a hand-picked icon is kept when renaming');
  if (wk(0, 0) < T) {
    p.csp = []; await p.context().close();
    p = await page(b, { 'habit-tracker-v1': { v: 1, settings: {}, rewards: [], redeemed: [], logs: { [wk(0, 0)]: { h: { m1: 1 } } }, habits: [
      { id: 'm1', name: '打電話回家', kind: 'good', method: 'check', freq: 'week', perWeek: 1, days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(40) }] } });
    ok(await p.$eval('[data-id=m1]', e => e.classList.contains('g-on')) && !(await p.$('[data-id=m1] .check.on')), 'week met: card green, today check stays empty');
    await p.click('[data-act=toggle][data-id=m1]'); ok((await p.$eval('[data-id=m1] .hc-sub', e => e.innerText)).startsWith('✓ 本週達成 2 次'), 'over the goal shows the real count');
  }
  await done(p, 'weekly');

  console.log('• 常見問題');
  p = await page(b, lockSeed());
  await p.click('[data-tab=settings]'); await p.click('[data-act=faq]');
  ok((await p.$$('.faq-cat')).length === 6 && (await p.$$('.faq-cat[open]')).length === 0, 'six categories, all collapsed');
  await p.click('#faq-count summary'); ok(await p.isVisible('#faq-count .faq-item'), 'tapping a category shows its Q&A');
  await p.click('[data-act=faqback]'); ok((await p.$eval('#main', e => e.innerText)).includes('常見問題'), 'back returns to settings');
  await p.click('[data-act=edit][data-id=k1]'); await p.fill('#hname', '伸展 10 分鐘');
  await p.click('.lbl-q [data-act=faq]');
  ok(await p.$eval('#faq-habit', e => e.open) && (await p.$$('.faq-cat[open]')).length === 1, '? next to 頻率 opens 習慣與頻率');
  await p.click('[data-act=faqback]'); ok((await p.$eval('#hname', e => e.value)) === '伸展 10 分鐘', 'back returns to the editor with edits kept');
  await p.click('[data-act=cancel]').catch(() => {}); await p.click('[data-tab=today]');
  if (await p.$('[data-act=gotoday]')) await p.click('[data-act=gotoday]');
  await p.click('[data-act=day][data-n="-1"]'); await p.click('[data-act=day][data-n="-1"]');
  await p.click('.lockbar [data-act=faq]'); ok(await p.$eval('#faq-edit', e => e.open), 'lock ? opens 紀錄與編輯');
  await p.click('[data-act=faqback]'); ok(!!(await p.$('.page.locked')) && (await p.$eval('h1.h1', e => e.textContent)) !== '今天', 'back returns to the same past day');
  await done(p, 'faq');

  console.log('• new-version card');
  const ver0 = require('fs').readFileSync(__dirname + '/../index.html', 'utf8').match(/var APP_VER='([^']+)'/)[1];
  ok(JSON.parse(require('fs').readFileSync(__dirname + '/../version.json', 'utf8')).v === ver0, 'version.json matches APP_VER');
  const vj = async (body, seed) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const q = await ctx.newPage(); q.errs = []; q.csp = [];
    q.on('pageerror', e => q.errs.push(e.message)); q.on('console', m => { if (/Content Security Policy|Refused/.test(m.text())) q.csp.push(m.text()); });
    await q.addInitScript(sd => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const k in sd) localStorage.setItem(k, JSON.stringify(sd[k])); } }, seed || lockSeed());
    await q.route('**/version.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }));
    await q.goto(BASE); await q.waitForTimeout(2000); return q; };
  p = await vj({ v: ver0, notify: true, notes: ['x'] }); ok(!(await p.isVisible('#updcard')), 'same version: no card'); await done(p, 'upd same');
  p = await vj({ v: '2099.01.01-1', notify: false, notes: ['x'] }); ok(!(await p.isVisible('#updcard')), 'quiet update: no card'); await done(p, 'upd quiet');
  p = await vj({ v: '2099.01.01-1', notify: true, notes: ['卡片變好看了', '<img src=x onerror=alert(1)>'] });
  const ut = await p.$eval('#updcard', e => e.innerText);
  ok(await p.isVisible('#updcard') && ut.includes('卡片變好看了') && ut.includes('2099.01.01-1'), 'new version: card with notes');
  ok(!(await p.$('#updcard img')) && (await p.$$('#updcard button')).length === 1, 'notes are text only; a single 立即更新 button');
  let reloaded = false; p.on('framenavigated', () => { reloaded = true; });
  await p.click('[data-upd=go]'); await p.waitForTimeout(500); ok(reloaded, '立即更新 reloads the app');
  await done(p, 'upd card');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    p = await ctx.newPage(); p.errs = []; p.csp = []; p.on('pageerror', e => p.errs.push(e.message));
    await p.addInitScript(sd => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const k in sd) localStorage.setItem(k, JSON.stringify(sd[k])); } }, lockSeed());
    await p.route('**/version.json*', async r => { await new Promise(res => setTimeout(res, 2500)); r.fulfill({ contentType: 'application/json', body: JSON.stringify({ v: '2099.01.01-1', notify: true, notes: ['x'] }) }); });
    await p.goto(BASE); await p.click('[data-tab=settings]'); await p.click('[data-act=edit][data-id=k1]');
    await p.waitForTimeout(4500);
    ok(!(await p.isVisible('#updcard')), 'no update card while editing a habit');
    await p.click('[data-act=back],[data-act=cancel]');
    ok(await p.isVisible('#updcard'), 'card appears after leaving the editor');
    await done(p, 'upd editing');
  }

  console.log('• cardio pace + 今天 tab');
  p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { fit: true, onboarded: true }, rewards: [], redeemed: [], logs: {}, habits: [], fit: { ex: [], ctypes: ['拳擊有氧', '健走課'], cdist: [], logs: {
    [daysAgo(9)]: { c: [{ id: 'r1', type: '戶外跑步', min: 30, dist: 5 }] }, [daysAgo(2)]: { c: [{ id: 'r2', type: '戶外跑步', min: 31, sec: 15, dist: 5.2 }] } } } } });
  await p.click('[data-tab=fit]'); await fitAdd(p, 'fcnew');
  await p.click('[data-act=fctype][data-v=戶外跑步]');
  await p.fill('#fcminin', '32'); await p.fill('#fcsec', '15'); await p.fill('#fcdist', '5.2');
  ok(!(await p.$('[data-act=fcset].on')), 'quick-minute chip not highlighted after typing 32:15');
  ok((await p.$eval('#fcpace', e => e.innerText)).includes(`6:12 /km`), 'pace 6:12/km computed live from 32:15 and 5.2 km');
  await p.click('[data-act=fcsave]'); d = await db(p);
  const rc = d.fit.logs[T].c[0];
  ok(rc.min === 32 && rc.sec === 15 && rc.dist === 5.2, 'saved minutes, seconds and distance');
  ok((await p.$eval('#main', e => e.innerText)).includes(`5.2 km · 6:12 /km`) && (await p.$eval('#main', e => e.innerText)).includes('32:15'), 'day card shows distance, pace and time');
  await fitAdd(p, 'fcnew'); await p.click('[data-act=fctype][data-v=游泳]');
  ok((await p.$eval('.fcx', e => e.innerText)).includes('公尺'), 'swimming distance in meters');
  await p.fill('#fcminin', '30'); await p.fill('#fcsec', ''); await p.fill('#fcdist', '1500');
  ok((await p.$eval('#fcpace', e => e.innerText)).includes(`2:00 /100m`), 'swim pace per 100 m');
  await p.click('[data-act=fctype][data-v=飛輪]'); await p.fill('#fcminin', '60'); await p.fill('#fcdist', '25');
  ok((await p.$eval('#fcpace', e => e.innerText)).includes('25 km/h'), 'bike shows km/h');
  await p.click('[data-act=fctype][data-v=拳擊有氧]'); ok(!(await p.$('#fcdist')) && !!(await p.$('[data-act=fcdisttog]')), 'non-distance custom type: no distance, has toggle');
  await p.click('[data-act=fctype][data-v=健走課]'); ok(!!(await p.$('#fcdist')), 'custom 健走 detected as distance type');
  await p.click('[data-act=fccancel]');
  await p.click('[data-act=ftab][data-v=prog]');
  const pt = await p.$eval('#main', e => e.innerText);
  ok(pt.includes('配速') && pt.includes(`6:00 /km`) && pt.includes('本週距離'), 'progress shows best pace and weekly distance (' + pt.match(/最快配速[^\n]*\n[^\n]*/) + ')');
  ok(!!(await p.$('.chart')), 'pace trend chart drawn');
  ok(pt.includes('只算 2 km 以上'), 'note: only runs of 2 km or more count');
  await p.click('[data-tab=today]'); await p.click('[data-act=day][data-n="-1"]'); await p.click('[data-tab=fit]');
  await p.click('[data-act=ftab][data-v=log]'); ok((await p.$eval('.dnav-c', e => e.innerText)).includes('昨天'), '運動 tab keeps the day you were viewing');
  await p.click('[data-tab=today]');
  ok((await p.$eval('h1.h1', e => e.textContent)) === '今天', '今天 tab always returns to today');
  ok((await p.$eval('.tab[data-tab=today]', e => e.innerText.trim())) === '習慣', 'first tab is labelled 習慣');
  await done(p, 'pace');
  p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { fit: true }, rewards: [], redeemed: [], logs: {}, fit: { ex: [], ctypes: [], logs: {} }, habits: [
    { id: 'g1', name: '運動 30 分鐘', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(10), fitLink: true }] } });
  await p.click('[data-tab=fit]'); await fitAdd(p, 'fcnew'); await p.fill('#fcminin', '29'); await p.fill('#fcsec', '45'); await p.click('[data-act=fcsave]');
  d = await db(p); ok(!(d.logs[T] && d.logs[T].h && d.logs[T].h.g1), '29:45 does not meet a 30-minute target (no rounding)');
  await p.click('[data-act=cedit]'); await p.fill('#fcminin', '30'); await p.fill('#fcsec', ''); await p.click('[data-act=fcsave]');
  d = await db(p); ok(d.logs[T] && d.logs[T].h && d.logs[T].h.g1 === 1, '30:00 meets it');
  await done(p, 'pace exact');

  console.log('• preset rename keeps history');
  p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { fit: true }, rewards: [], redeemed: [], logs: {}, habits: [],
    fit: { ex: [{ id: 'p42', name: '腿彎舉機', eq: '器械', part: '腿', en: 'Leg Curl', mode: 'wr', unit: 'kg' }], ctypes: [], logs: { [daysAgo(3)]: { s: [{ id: 'x1', ex: 'p42', sets: [[30, 10]] }] } } } } });
  d = await db(p); const lc = d.fit.ex.find(e => e.id === 'p42');
  ok(lc.name === '坐姿腿彎舉機' && lc.en === 'Seated Leg Curl' && d.fit.logs[daysAgo(3)].s[0].ex === 'p42', 'existing 腿彎舉機 renamed, records kept');
  await done(p, 'rename');

  console.log('• tab badges + 設定 label');
  p = await page(b, { 'habit-tracker-v1': { v: 1, settings: {}, logs: { [daysAgo(1)]: { h: { r1: 1 } }, [daysAgo(2)]: { h: { r1: 1 } } }, redeemed: [],
    rewards: [{ id: 'rw', name: '吃大餐', type: 'streak', habit: 'r1', target: 2, repeat: true, created: daysAgo(5), earned: [], done: false }],
    habits: [{ id: 'r1', name: '伸展', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(5) }] } });
  ok((await p.$eval('.tab[data-tab=settings]', e => e.innerText.trim())) === '設定', 'tab is named 設定');
  ok(await p.$eval('.tab[data-tab=rewards]', e => e.classList.contains('tdot')), 'reward ready: dot on 獎勵');
  ok(await p.$eval('.tab[data-tab=settings]', e => e.classList.contains('tdot')), 'unseen changelog / backup due: dot on 設定');
  await p.evaluate(() => { localStorage.setItem('habit-tracker-v1-backup', JSON.stringify({ at: new Date().toISOString() })); });
  await p.click('[data-tab=settings]'); await p.click('[data-act=changelog]'); await p.click('[data-act=back]');
  ok(!(await p.$eval('.tab[data-tab=settings]', e => e.classList.contains('tdot'))), 'dot on 設定 clears after viewing 更新紀錄 (backed up)');
  await done(p, 'badges');

  console.log('• photos in 備註 and 日記');
  {
    p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { onboarded: true, diary: true }, rewards: [], redeemed: [], logs: {}, habits: [{ id: 'g1', name: '喝水', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(3) }] } });
    const png = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 3000; c.height = 2000; const x = c.getContext('2d');
      for (let i = 0; i < 4000; i++) { x.fillStyle = 'hsl(' + (i * 37 % 360) + ',70%,50%)'; x.fillRect(Math.random() * 3000, Math.random() * 2000, 60, 60); } return c.toDataURL('image/png').split(',')[1]; });
    const buf = Buffer.from(png, 'base64');
    let fc = p.waitForEvent('filechooser'); await p.click('[data-act=phadd][data-slot=np]'); await (await fc).setFiles({ name: 'big.png', mimeType: 'image/png', buffer: buf });
    await p.waitForSelector('.phthumb img[src]', { timeout: 10000 });
    const np = (await db(p)).logs[T].np;
    const info = await p.evaluate(async id => { const d = await new Promise(r => { const q = indexedDB.open('habit-tracker-v1-photos'); q.onsuccess = () => r(q.result); });
      const blob = await new Promise(r => { const g = d.transaction('p').objectStore('p').get(id); g.onsuccess = () => r(g.result); });
      const bm = await createImageBitmap(blob); return { size: blob.size, type: blob.type, w: bm.width, h: bm.height }; }, np);
    ok(!!np && info.type === 'image/jpeg' && info.size < 600000 && Math.max(info.w, info.h) === 1600, 'note photo is shrunk to JPEG, long edge 1600 (' + JSON.stringify(info) + ', original ' + buf.length + ' bytes)');
    await p.click('[data-act=dopen]'); fc = p.waitForEvent('filechooser'); await p.click('[data-act=phadd][data-slot=dp]'); await (await fc).setFiles({ name: 'd.png', mimeType: 'image/png', buffer: buf });
    await p.waitForSelector('.phthumb img[src]', { timeout: 10000 });
    ok(!!(await db(p)).logs[T].dp, 'diary photo saved');
    await p.click('[data-act=phview]'); await p.waitForSelector('.phsheet img[src]');
    await p.click('[data-act=phremove]'); await p.click('[data-act=phremove]');
    ok(!(await db(p)).logs[T].dp, 'photo can be deleted (asks twice)');
    await p.click('[data-act=dback]'); await p.click('[data-tab=settings]');
    await p.waitForFunction(() => /照片 1 張/.test(document.getElementById('phuse').textContent), null, { timeout: 5000 }).catch(() => {});
    ok((await p.$eval('#phuse', e => e.textContent)).includes('照片 1 張'), 'settings shows how much space photos use');
    await p.click('[data-act=export]'); await p.waitForSelector('.phopt'); await p.click('[data-act=exportplain]');
    await p.waitForSelector('#exporttext', { timeout: 10000 }); const bk = await p.$eval('#exporttext', e => e.value);
    ok(JSON.parse(bk).photos && JSON.parse(bk).photos[np].startsWith('data:image/jpeg;base64,'), 'backup carries the photo');
    await p.click('[data-act=closesheet]');
    await p.evaluate(() => new Promise(r => { localStorage.removeItem('habit-tracker-v1'); const q = indexedDB.deleteDatabase('habit-tracker-v1-photos'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
    await p.reload(); await p.click('.ob [data-act=import]'); await p.fill('#pastebox', bk); await p.dispatchEvent('#pastebox', 'input'); await p.click('[data-act=usepaste]'); await p.click('[data-act=confirmimport]');
    await p.waitForSelector('.phthumb img[src]', { timeout: 10000 });
    ok((await db(p)).logs[T].np === np && !('photos' in (await db(p))), 'restoring the backup brings the photo back (not into localStorage)');
    await done(p, 'photos');
  }

  console.log('• weekly progress segments in every skin');
  for (const skin of ['sprout', 'sport', 'volt', 'ice']) {
    p = await page(b, { 'habit-tracker-v1': { v: 1, settings: Object.assign({ onboarded: true }, skin !== 'sprout' ? { skin } : {}), rewards: [], redeemed: [], logs: { [T]: { h: { w1: 1 } } },
      habits: [{ id: 'w1', name: '運動', kind: 'good', method: 'check', freq: 'week', perWeek: 3, days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(20) }] } });
    const cols = await p.$$eval('[data-id=w1] .pbar.seg i', a => a.map(e => getComputedStyle(e).backgroundColor));
    ok(cols.length === 3 && cols[0] !== cols[1] && cols[1] === cols[2], skin + ': 1 of 3 segments filled (' + cols.join(' | ') + ')');
    await done(p, 'segments ' + skin);
  }

  console.log('• 用範本加入習慣');
  p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { onboarded: true, pnl: true }, rewards: [], redeemed: [], logs: {}, habits: [{ id: 'g1', name: '閱讀 20 頁', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(3) }] } });
  await p.click('[data-tab=settings]'); await p.click('[data-act=obtpl]');
  ok((await p.$eval('.ob', e => e.innerText)).includes('用範本加入習慣') && (await p.$$('.obdots i')).length === 3, 'template picker reuses onboarding without the feature step');
  await p.click('[data-act=obarea][data-v=learn]'); await p.click('[data-act=obnext]'); await p.click('[data-act=obnext]');
  const tp = (await p.$$eval('.obin', a => a.map(e => e.value))).join(',');
  ok(!tp.includes('閱讀 20 頁') && tp.includes('學英文'), 'habits you already have are not suggested again');
  await p.click('[data-act=obnext]');
  const d2t = await db(p); ok(d2t.habits.length >= 2 && d2t.settings.pnl === true, 'adds habits and leaves feature settings alone');
  await done(p, 'templates');

  console.log('• 更新紀錄');
  p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { onboarded: true }, habits: [], logs: {}, rewards: [], redeemed: [] } });
  await p.click('[data-tab=settings]');
  ok(!!(await p.$('.clink .cldot')), 'dot shown for an unseen version');
  await p.click('[data-act=changelog]');
  const ver = await p.evaluate(() => document.documentElement.innerHTML.match(/APP_VER='([^']+)'/)[1]);
  // 更新紀錄 is written the day after: every release day before today's must have an entry, and nothing newer than APP_VER
  const html = await p.content();
  const clVers = [...html.match(/var CHANGELOG=\[[\s\S]*?\n\];/)[0].matchAll(/\['(\d{4}\.\d\d\.\d\d)-(\d+)'/g)].map(m => [m[1], +m[2]]);
  const vnum = v => { const [d, n] = v.split('-'); return d.replace(/\./g, '') * 1000 + +n; };
  ok(vnum(clVers[0][0] + '-' + clVers[0][1]) <= vnum(ver), 'newest changelog entry is not newer than APP_VER (' + ver + ')');
  const relDays = [...new Set([...require('fs').readFileSync(__dirname + '/../VERSIONS.md', 'utf8').matchAll(/^\| (\d{4}\.\d\d\.\d\d)-\d+ /gm)].map(m => m[1]))];
  const missing = relDays.filter(d => d < ver.split('-')[0] && !clVers.some(c => c[0] === d));
  ok(!missing.length, 'every past release day has a 更新紀錄 entry' + (missing.length ? ' (missing ' + missing.join(', ') + ')' : ''));
  ok((await p.$$eval('.cl-item .cl-h b', x => x.map(e => e.textContent))).filter(t => t.startsWith('10/17')).length <= 1, 'one card per day');
  ok((await p.$$('.cl-item')).length >= 5, 'history listed by day');
  await p.evaluate(() => { document.getElementById('toast').hidden = true; });
  ok(!(await p.$('.cl-foot')), 'credit line is not on the 更新紀錄 page');
  await p.click('[data-act=back]'); ok(!(await p.$('.clink .cldot')), 'dot cleared after viewing');
  ok(!!(await p.$('.cl-foot svg.cl-av')) && !!(await p.$('.cl-foot .cl-c')), '設定 page bottom shows sprout and C avatars');
  for (let i = 0; i < 4; i++) await p.click('[data-act=cltap]');
  ok(await p.$eval('#toast', e => e.hidden), 'no easter egg before 5 taps');
  await p.click('[data-act=cltap]'); ok((await p.$eval('#toast', e => e.innerText)).includes('Aaron 再找 Claude'), 'easter egg after 5 taps');
  await done(p, 'changelog');

  console.log('• 週報');
  {
    const mon = n => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * n); return d; };
    const kk = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const W = mon(1), wk = i => { const d = new Date(W); d.setDate(d.getDate() + i); return kk(d); };
    const logs = {}; for (let i = 0; i < 7; i++) logs[wk(i)] = { h: { g1: i % 3 ? 1 : 0, b1: i === 2 ? 2 : 0 }, mood: i < 3 ? 1 : 3, pnl: 1000 * i - 500 };
    const ex = { id: 'e1', name: '深蹲', eq: '槓鈴', part: '腿', mode: 'wr', unit: 'kg' };
    const flogs = { [wk(-7)]: { s: [{ id: 'a', ex: 'e1', sets: [[60, 5]] }] }, [wk(1)]: { s: [{ id: 'b', ex: 'e1', sets: [[70, 5]] }], min: 40 }, [wk(3)]: { c: [{ id: 'c', type: '跑步機', min: 30, dist: 5 }] } };
    p = await page(b, { 'habit-tracker-v1': { v: 1, logs, settings: { fit: true, pnl: true }, rewards: [], redeemed: [], fit: { ex: [ex], ctypes: [], logs: flogs },
      habits: [{ id: 'g1', name: '閱讀', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: wk(-14) }, { id: 'b1', name: '熬夜', kind: 'bad', days: [1, 1, 1, 1, 1, 1, 1], created: wk(-14) }] } });
    await p.click('[data-tab=stats]'); await p.click('[data-act=report]');
    ok((await p.$eval('h1.h1', e => e.textContent)) === '我的這一週', 'report button opens 我的這一週');
    const lbl = () => p.$eval('.month-l', e => e.textContent);
    const rng = `${W.getMonth() + 1}/${W.getDate()} – `;
    if (new Date().getDay() === 0) await p.click('[data-act=rweek][data-n="-1"]');
    ok((await lbl()).startsWith(rng), 'defaults to last full week (' + await lbl() + ')');
    const img = async () => { await p.waitForFunction(() => { const i = document.getElementById('repimg'); return i && i.complete && i.naturalWidth > 0; }); return p.$eval('#repimg', i => [i.naturalWidth, i.naturalHeight, i.src]); };
    let [iw, ih, src] = await img();
    ok(iw === 1080 && ih >= 1920 && src.startsWith('blob:'), 'report image drawn on the phone (' + iw + '×' + ih + ')');
    await p.fill('#repnote', '這週好累，但還是有喝水'); await p.waitForFunction(s => document.getElementById('repimg').src !== s, src);
    { const [, hN, sN] = await img(); ok(hN > ih, 'personal note adds a line to the image'); ih = hN; src = sN; }
    ok(!JSON.stringify(await db(p)).includes('這週好累'), 'personal note is not saved');
    ok(!!(await p.$('[data-act=ropt][data-v=bad]')) && !!(await p.$('[data-act=ropt][data-v=amt]')), 'bad-habit and amount sub-options shown');
    ok(await p.$eval('[data-v=bad]', e => e.getAttribute('aria-checked')) === 'false' && await p.$eval('[data-v=amt]', e => e.getAttribute('aria-checked')) === 'false', 'bad habits and amounts are off by default');
    await p.click('[data-act=ropt][data-v=bad]'); await p.waitForFunction(s => document.getElementById('repimg').src !== s, src);
    let [, ih2, src2] = await img(); ok(ih2 > ih, 'adding bad habits makes the report longer');
    ok(JSON.parse(await p.evaluate(() => localStorage.getItem('habit-tracker-v1-rep'))).bad === true, 'choices remembered');
    ok(await p.$eval('[data-act=rhide][data-id=g1]', e => e.textContent) === '不公開' && !!(await p.$('[data-act=rhide][data-id=b1]')), '不公開 buttons for good and (when included) bad habits');
    { const s0 = await p.$eval('#repimg', i => i.src); await p.click('[data-act=rhide][data-id=g1]'); await p.waitForFunction(s => document.getElementById('repimg').src !== s, s0);
      ok(await p.$eval('[data-act=rhide][data-id=g1]', e => e.getAttribute('aria-pressed') === 'true' && e.textContent === '✓ 不公開'), 'habit marked 不公開');
      const st = JSON.parse(await p.evaluate(() => localStorage.getItem('habit-tracker-v1-rep')));
      ok(Array.isArray(st.hide) && st.hide.join() === 'g1' && st.bad === true, '不公開 remembered with the other choices');
      ok(!JSON.stringify(await db(p)).includes('"hide"'), '不公開 is not stored in the habit data');
      await p.click('[data-act=ropt][data-v=bad]'); await p.click('[data-act=ropt][data-v=bad]');
      ok(JSON.parse(await p.evaluate(() => localStorage.getItem('habit-tracker-v1-rep'))).hide.join() === 'g1', 'toggling another option keeps 不公開');
      await p.click('[data-act=rhide][data-id=g1]'); await p.click('[data-act=rhide][data-id=g1]'); }
    await p.click('[data-act=ropt][data-v=pnl]'); ok(!(await p.$('[data-v=amt]')), 'amount option hides when 投資 is off');
    await p.click('[data-act=rweek][data-n="-1"]'); await p.click('[data-act=rweek][data-n="-1"]');
    ok(await p.$eval('[data-act=rweek][data-n="-1"]', e => e.disabled), 'cannot go before the first week of use (' + await lbl() + ')');
    for (let i = 0; i < 3; i++) { const nx = await p.$('[data-act=rweek][data-n="1"]:not([disabled])'); if (nx) await nx.click(); }
    if (new Date().getDay() !== 0) ok(await p.$eval('[data-act=rweek][data-n="1"]', e => e.disabled), 'cannot go past this week');
    ok((await lbl()).includes('本週'), 'this week is labelled');
    for (const k of ['h', 'fit', 'mood']) await p.click('[data-act=ropt][data-v=' + k + ']');
    ok(await p.$eval('[data-act=rshare]', e => e.disabled), 'share disabled when nothing is chosen');
    await p.click('[data-act=rback]'); ok((await p.$eval('h1.h1', e => e.textContent)) === '統計', 'back returns to 統計');
    await done(p, 'report');
  }

  console.log('• habits before they started');
  p = await page(b, { 'habit-tracker-v1': { v: 1, logs: {}, settings: {}, rewards: [], redeemed: [], habits: [{ id: 'g1', name: '喝水', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(2) }, { id: 'g2', name: '咖啡', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: T }] } });
  await p.click('[data-act=day][data-n="-1"]');
  ok((await p.$eval('.sum-card.good .sum-v', e => e.innerText.replace(/\s/g, ''))) === '0/1', 'day count leaves out habits not started yet');
  ok(!(await p.$('[data-id=g2]')) && (await p.$eval('.pre-more', e => e.innerText)).includes('還有 1 個習慣這天還沒開始'), 'habits not started yet are folded into one line');
  ok((await p.$eval('.pre-more', e => e.innerText)).includes('開始日期') && !(await p.$('[data-act=preshow]')), 'no back-filling on days before the start; the line points to the start date');
  await p.click('[data-tab=settings]'); await p.click('[data-act=edit][data-id=g2]');
  ok((await p.$eval('#hstart', e => e.value)) === daysAgo(0), 'editor shows the start date');
  await p.fill('#hstart', daysAgo(1)); await p.click('[data-act=save]');
  ok((await db(p)).habits.find(h => h.id === 'g2').created === daysAgo(1), 'start date can be moved earlier');
  await p.click('[data-tab=today]'); await p.click('[data-act=day][data-n="-1"]');
  ok(!(await p.$('.pre-more')) && (await p.$eval('[data-id=g2]', e => !e.classList.contains('pre'))), 'after moving the start date the day can be filled in');
  await p.click('[data-id=g2]'); await p.click('[data-id=g2]');
  ok((await db(p)).habits.find(h => h.id === 'g2').created === daysAgo(1), 'checking and unchecking never moves the start date');
  ok(!(await p.$eval('[data-id=g1]', e => e.classList.contains('pre'))), 'older habit shows normally');

  await done(p, 'pre-created');

  console.log('• nothing before first use');
  p = await page(b, { 'habit-tracker-v1': { v: 1, logs: { [daysAgo(1)]: { h: { g1: 1 } } }, settings: { firstUse: daysAgo(1) }, rewards: [], redeemed: [], habits: [{ id: 'g1', name: '喝水', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(1) }] } });
  await p.click('[data-act=day][data-n="-1"]');
  ok(await p.$eval('[data-act=day][data-n="-1"]', e => e.disabled), 'cannot go back before the first day of use');
  await p.click('[data-tab=stats]');
  const before = new Date(); before.setDate(before.getDate() - 2);
  if (before.getMonth() === new Date().getMonth()) ok(!(await p.$('[data-act=pickday][data-k="' + daysAgo(2) + '"]')), 'calendar days before first use are not clickable');
  if (new Date().getDate() > 1) ok(await p.$eval('[data-act=month][data-n="-1"]', e => e.disabled), 'cannot go to months before first use');
  await done(p, 'first use');

  console.log('• skins');
  p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { onboarded: true }, habits: [], logs: {}, rewards: [], redeemed: [] } });
  await p.click('[data-tab=settings]');
  ok((await p.$$('[data-act=skin]')).length === 4, 'four skins offered');
  await p.click('[data-act=skin][data-v=ice]'); ok(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--good').trim()) === '#2D6A89', '冰島 colours in effect');
  await p.click('[data-act=skin][data-v=volt]');
  ok(await p.evaluate(() => document.documentElement.getAttribute('data-skin')) === 'volt' && (await db(p)).settings.skin === 'volt', 'picking 黑白螢光 applies and saves it');
  await p.reload(); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.documentElement.getAttribute('data-skin')) === 'volt', 'skin kept after reopening');
  ok(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--good').trim()) === '#111111', 'volt colours in effect');
  await p.click('[data-tab=settings]'); await p.click('[data-act=skin][data-v=sport]');
  ok(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--good').trim()) === '#FC5200', 'sport colours in effect');
  await p.click('[data-act=skin][data-v=sprout]');
  ok(!(await p.evaluate(() => document.documentElement.hasAttribute('data-skin'))) && !('skin' in (await db(p)).settings), 'back to 小芽綠 clears the skin');
  await done(p, 'skins');

  console.log('• rewards: habit first');
  {
    const lg = {}; for (let i = 1; i <= 20; i++) lg[daysAgo(i)] = { h: { d1: 1, w1: 1, b1: i === 3 ? 1 : 0 } };
    p = await page(b, { 'habit-tracker-v1': { v: 1, logs: lg, settings: {}, rewards: [], redeemed: [], habits: [
      { id: 'd1', name: '喝水', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(30) },
      { id: 'w1', name: '運動', kind: 'good', method: 'check', freq: 'week', perWeek: 3, days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(30) },
      { id: 'b1', name: '宵夜', kind: 'bad', method: 'count', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(30) }] } });
    await p.click('[data-tab=rewards]'); await p.click('[data-act=rnew]');
    const types = async () => p.$$eval('[data-act=rtype]', x => x.map(e => e.dataset.v).join(','));
    ok(await types() === 'streak,weekly,rate,total', 'daily habit offers 連續/每週/完成率/累計 (' + await types() + ')');
    await p.click('[data-act=rhabit][data-id=w1]'); ok(await types() === 'wktotal,streak', 'weekly habit offers 累計週數 and 連續週數');
    ok(await p.$eval('[data-act=rtype].on', e => e.dataset.v) === 'wktotal', 'weekly habit defaults to 累計達標週數');
    await p.click('[data-act=rhabit][data-id=b1]'); ok(await types() === 'limit,clean', 'bad habit offers 上限 and 連續沒犯');
    await p.click('[data-act=rhabit][data-id=""]'); ok(!(await p.$('[data-act=rtype]')) && (await p.$eval('#rpreview', e => e.innerText)).includes('省下的錢'), 'no habit → savings reward');
    await p.click('[data-act=rhabit][data-id=d1]'); await p.click('[data-act=rtype][data-v=total]');
    await p.fill('#rname', '買新書'); await p.fill('#rtarget', '10'); await p.click('[data-act=rsave]');
    let d2 = await db(p); const rt = d2.rewards.find(r => r.type === 'total');
    ok(rt && rt.habit === 'd1' && rt.target === 10, 'total-days reward saved');
    // past days only count from the reward's start, so backdate it to check counting
    await p.evaluate(() => { const k = 'habit-tracker-v1', o = JSON.parse(localStorage.getItem(k)); o.rewards.forEach(r => { r.created = o.habits[0].created; }); localStorage.setItem(k, JSON.stringify(o)); });
    await p.reload(); await p.click('[data-tab=rewards]');
    d2 = await db(p); ok(d2.rewards[0].earned.length === 1, '累計 10 天 earned after 20 done days');
    await p.click('[data-act=rnew]'); await p.click('[data-act=rhabit][data-id=w1]'); await p.fill('#rname', '按摩'); await p.fill('#rtarget', '2'); await p.click('[data-act=rsave]');
    await p.click('[data-act=rnew]'); await p.click('[data-act=rhabit][data-id=b1]'); await p.click('[data-act=rtype][data-v=clean]'); await p.fill('#rname', '甜點'); await p.fill('#rtarget', '5'); await p.click('[data-act=rsave]');
    await p.evaluate(() => { const k = 'habit-tracker-v1', o = JSON.parse(localStorage.getItem(k)); o.rewards.forEach(r => { r.created = o.habits[0].created; }); localStorage.setItem(k, JSON.stringify(o)); });
    await p.reload(); await p.click('[data-tab=rewards]'); d2 = await db(p);
    const wk = d2.rewards.find(r => r.type === 'wktotal'), cl = d2.rewards.find(r => r.type === 'clean');
    ok(wk && wk.earned.length === 1, '累計達標 2 週 earned');
    ok(cl && cl.earned.length === 1, '連續 5 天沒犯 earned (slip 3 days ago resets, earlier run counts)');
    await done(p, 'rewards habit first');
  }

  console.log('• 持股 from closing prices');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 1600 }, serviceWorkers: 'block' });
    const hp = await ctx.newPage(); hp.errs = []; hp.csp = []; hp.on('pageerror', e => hp.errs.push(e.message));
    hp.on('console', m => { if (/Content Security Policy|Refused/.test(m.text())) hp.csp.push(m.text()); });
    let pxCalls = 0;
    await hp.route('**/prices.json*', r => { pxCalls++; r.fulfill({ contentType: 'application/json', body: JSON.stringify({ d: T, t: 'x', p: { '2330': [1000, 10, '台積電'], '0050': [190, -1, '元大台灣50'] } }) }); });
    await hp.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('habit-tracker-v1', JSON.stringify(s)); } },
      { v: 1, logs: {}, settings: { pnl: true }, rewards: [], redeemed: [], habits: [{ id: 'g1', name: '喝水', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(5) }],
        hold: [{ id: 'h1', code: '2330', shares: 1500, cost: 900 }, { id: 'bad', code: '23<b>', shares: 1, cost: 1 }] });
    await hp.goto(BASE); await hp.waitForSelector('.hsug.ok');
    let lg = (await db(hp)).logs[T];
    ok(lg && lg.pnl === 150000 && lg.pa === true, 'closing-price P&L saved automatically (自動優先)');
    ok((await hp.$eval('.hsug', e => e.innerText)).includes('自動記錄'), 'card says it was recorded from closing prices');
    ok((await db(hp)).hold.length === 1, 'invalid holding dropped by normalize');
    ok(isKeyLike((await db(hp)).settings.holdSince), 'holdSince set for existing holdings');
    await hp.click('[data-act=pnlopen]');
    ok((await hp.$eval('#main', e => e.innerText)).includes('不會再被自動覆蓋'), 'keypad warns that a manual edit locks the day');
    await hp.keyboard.press('Backspace'); await hp.click('[data-act=psave]');
    lg = (await db(hp)).logs[T]; ok(lg.pnl === 15000 && lg.pm === true && !lg.pa, 'manual edit after closes locks the day');
    await hp.reload(); await hp.waitForSelector('[data-act=pauto]');
    ok((await db(hp)).logs[T].pnl === 15000, 'locked day is not overwritten on the next open');
    await hp.click('[data-act=pauto]'); await hp.waitForSelector('.hsug.ok');
    lg = (await db(hp)).logs[T]; ok(lg.pnl === 150000 && lg.pa && !lg.pm, '改回自動 restores the computed value');
    await hp.click('[data-tab=stats]'); await hp.click('[data-act=stab][data-v=pnl]');
    const hl = await hp.$eval('#main', e => e.innerText);
    ok(hl.includes('台積電') && hl.includes('1,500 股') && !hl.includes('張') && hl.includes('市值 NT$1,500,000') && hl.includes('今天收盤'), 'stats lists holdings in shares and market value');
    await hp.click('[data-act=holdedit]'); await hp.click('[data-act=holdadd]');
    await hp.fill('[data-hi="1"][data-hf=code]', '0050'); await hp.fill('[data-hi="1"][data-hf=shares]', '37'); await hp.fill('[data-hi="1"][data-hf=cost]', '180.5');
    await hp.click('[data-act=holdsave]');
    let hd = (await db(hp)).hold; ok(hd.length === 2 && hd[1].code === '0050' && hd[1].shares === 37 && hd[1].cost === 180.5 && hd[1].name === '元大台灣50', 'add an odd-lot holding with name from prices');
    await hp.click('[data-act=holdedit]'); await hp.fill('[data-hi="0"][data-hf=code]', '12'); await hp.click('[data-act=holdsave]');
    ok((await hp.$eval('.err', e => e.innerText)).includes('4–6 碼'), 'bad stock code is rejected');
    await hp.click('[data-act=holdcancel]');
    await hp.click('[data-act=holdedit]'); await hp.click('[data-act=hpopen]');
    await hp.fill('#hptext', '股票代號, 持有股數, 平均成本\n2330, 2,000, 612.5\n元大台灣50 1537 142.2 ?\n9999, 10, 1\n0050, 100, 150\nabc');
    await hp.click('[data-act=hpcheck]');
    const pv = await hp.$eval('.hp-list', e => e.innerText);
    ok(pv.includes('台積電') && pv.includes('2,000 股') && pv.includes('AI 標記不確定') && pv.includes('沒有這個代號的收盤價') && pv.includes('重複') && pv.includes('看不懂這一行'), 'paste preview flags unsure, unknown, duplicate and bad lines');
    ok((await hp.$eval('.hpaste', e => e.innerText)).includes('4 檔可以匯入'), 'preview counts importable rows');
    await hp.click('[data-act=hpapply][data-v=replace]'); await hp.click('[data-act=holdsave]');
    hd = (await db(hp)).hold;
    ok(hd.length === 3 && hd.find(x => x.code === '2330').shares === 2000 && hd.find(x => x.code === '0050').shares === 100 && hd.some(x => x.code === '9999'), 'replace imports the checked rows (last duplicate wins)');
    await hp.click('[data-act=holdedit]'); await hp.click('[data-act=hpopen]'); await hp.fill('#hptext', '2454, 300, 1180'); await hp.click('[data-act=hpcheck]');
    await hp.click('[data-act=hpapply][data-v=merge]'); await hp.click('[data-act=holdsave]');
    ok((await db(hp)).hold.length === 4, 'merge keeps existing holdings and adds new ones');
    await hp.click('[data-tab=stats]'); await hp.click('[data-act=stab][data-v=pnl]');
    const pie = await hp.$eval('[data-pblk=pie]', e => e.innerText);
    ok(pie.includes('持股佔比') && pie.includes('99.1%') && pie.includes('0.9%') && pie.includes('2,019,000') && pie.includes('未列入'), 'donut shows share by market value, total, and skips holdings without price (' + pie.replace(/\n/g, ' ') + ')');
    ok((await hp.$eval('[data-pblk=hold]', e => e.innerText)).includes('佔 99.1%'), 'holding rows show their share');
    ok((await hp.$eval('[data-pblk=hold]', e => e.innerText)).includes('1000 · +63.27%'), 'in 損益 mode the price line shows the holding return on cost');
    const names = () => hp.$$eval('[data-pblk=hold] .hrow b:first-child', a => a.map(e => e.innerText).join(','));
    ok((await hp.$eval('.hsort', e => e.innerText)).includes('今日') && (await names()).startsWith('台積電'), 'sort switch shown, default sorts by unrealized P&L');
    await hp.click('[data-act=hsort][data-v=mv]');
    ok((await db(hp)).settings.holdSort === 'mv' && (await hp.$eval('[data-pblk=hold] .hrow-r b', e => e.innerText)) === '2,000,000', 'sort by market value shows market value as the big number');
    await hp.click('[data-act=hsort][data-v=mv]');
    ok((await db(hp)).settings.holdSort === 'mv-' && (await names()).startsWith('元大台灣50'), 'tap again reverses the order');
    await hp.click('[data-act=hsort][data-v=day]');
    ok((await hp.$eval('[data-pblk=hold] .hrow-r b', e => e.innerText)) === '+20,000', 'today sort shows today P&L (shares × change)');
    ok((await hp.$eval('[data-pblk=hold]', e => e.innerText)).includes('1000 ▲1.01%'), 'in 今日 mode the price line shows the day change %');
    await hp.click('[data-act=hsort][data-v=un]');
    ok(!('holdSort' in (await db(hp)).settings), 'back to default removes the setting');
    const order = () => hp.$$eval('[data-pblk]', a => a.map(e => e.dataset.pblk).join(','));
    ok((await order()) === 'trend,pie,hold', 'default block order');
    await hp.evaluate(() => { scrollTo(0, 0); document.querySelectorAll('*').forEach(e => { if (e.scrollTop) e.scrollTop = 0; }); }); await hp.waitForTimeout(100);
    const g = await (await hp.$('[data-pdrag=pie]')).boundingBox(), tr = await (await hp.$('[data-pblk=trend]')).boundingBox();
    await hp.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await hp.mouse.down();
    await hp.mouse.move(g.x + g.width / 2, tr.y + 10, { steps: 8 }); await hp.mouse.up();
    ok((await order()) === 'pie,trend,hold' && (await db(hp)).settings.pnlOrder === 'pie,trend,hold', 'drag moves 持股佔比 to the top and saves the order');
    await hp.reload(); await hp.click('[data-tab=stats]'); await hp.click('[data-act=stab][data-v=pnl]');
    ok((await order()) === 'pie,trend,hold', 'block order kept after reload');
    await hp.click('[data-tab=today]');
    ok((await hp.$eval('.hsug', e => e.innerText)).includes('9999'), 'card warns when a holding has no closing price');
    ok(pxCalls >= 1, 'prices fetched from the same site');
    await done(hp, 'holdings');
  }

  console.log('• 賣出 / 已實現損益');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const hp = await ctx.newPage(); hp.errs = []; hp.csp = []; hp.on('pageerror', e => hp.errs.push(e.message));
    hp.on('console', m => { if (/Content Security Policy|Refused/.test(m.text())) hp.csp.push(m.text()); });
    await hp.route('**/prices.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ d: T, t: 'x', p: { '2330': [1100, 10, '台積電'], '0050': [190, 1, '元大台灣50'] } }) }));
    await hp.route('**/prices-30.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ d: [], c: {} }) }));
    await hp.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('habit-tracker-v1', JSON.stringify(s)); } },
      { v: 1, settings: { pnl: true, onboarded: true, holdSince: daysAgo(3) }, rewards: [], redeemed: [], habits: [{ id: 'g1', name: '喝水', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(9) }], logs: {},
        hold: [{ id: 'h1', code: '2330', shares: 2000, cost: 1000 }, { id: 'h2', code: '0050', shares: 1000, cost: 150 }] });
    await hp.goto(BASE); await hp.waitForTimeout(400);
    await hp.click('[data-tab=stats]'); await hp.click('[data-act=stab][data-v=pnl]');
    await hp.click('[data-act=sellnew]'); await hp.click('[data-act=sellpick][data-id=h1]');
    ok(await hp.inputValue('#sellsh') === '2000' && await hp.inputValue('#sellpx') === '1100', 'sell: shares default to all, price to the latest close');
    ok(await hp.inputValue('#sellamt') === '200000', 'sell: realized amount prefilled from price and cost');
    await hp.fill('#sellsh', '1000');
    ok(await hp.inputValue('#sellamt') === '100000', 'sell: estimate follows the shares');
    await hp.fill('#sellamt', '99500'); await hp.click('[data-act=sellsave]'); await hp.waitForTimeout(300);
    let d = await db(hp);
    ok(d.sold.length === 1 && d.sold[0].amt === 99500 && d.sold[0].shares === 1000 && d.sold[0].c === 1000000 && d.sold[0].d === T, 'sell: record saved with the typed amount');
    ok(d.hold.find(h => h.id === 'h1').shares === 1000, 'sell: holding reduced');
    ok(d.logs[T] && d.logs[T].pnl === 140000, 'sell: 未實現 recalculated with the remaining shares');
    ok(/\+239,500/.test(await hp.innerText('.pnl-read')), 'sell: chart shows 總損益 = 已實現 + 未實現');
    ok(/已實現 \+99,500/.test(await hp.innerText('.pnl-split')), 'sell: split line shows 已實現');
    ok(!!(await hp.$('.real-ln')) && !!(await hp.$('.pnl-lg')), 'sell: chart draws the 已實現 dashed line with a legend');
    ok(/交易紀錄/.test(await hp.innerText('main')) && (await hp.$$('.sold-row')).length === 1, 'sell: 交易紀錄 list');
    await hp.click('[data-act=sellnew]'); await hp.click('[data-act=sellpick][data-id=h2]'); await hp.click('[data-act=sellsign][data-v="1"]'); await hp.fill('#sellamt', '500');
    await hp.click('[data-act=sellsave]'); await hp.waitForTimeout(300); d = await db(hp);
    ok(!d.hold.find(h => h.id === 'h2') && d.sold.some(x => x.code === '0050' && x.amt === -500), 'sell: selling all removes the holding; loss saved as negative');
    await hp.click('.sold-row >> nth=1'); ok(!(await hp.$('#sellsh')), 'sell: editing an old sale does not change shares');
    await hp.click('[data-act=selldel]'); await hp.waitForTimeout(300); d = await db(hp);
    ok(d.sold.length === 1 && d.sold[0].code === '0050', 'sell: delete removes the record');
    ok(d.hold.find(h => h.code === '2330').shares === 2000 && d.hold.find(h => h.code === '2330').cost === 1000, 'sell: delete puts the shares back at the same cost');
    await hp.click('[data-tab=today]');
    await hp.waitForTimeout(200); const tm = await hp.innerText('main'); if (!/投資損益/.test(tm)) console.log(tm.slice(0, 900));
    ok(/投資損益/.test(tm) && /已實現/.test(await hp.innerText('.pnl-meta')), 'today card shows 總損益 with 已實現');
    await done(hp, 'sell');
  }

  console.log('• 買入');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const hp = await ctx.newPage(); hp.errs = []; hp.csp = []; hp.on('pageerror', e => hp.errs.push(e.message));
    hp.on('console', m => { if (/Content Security Policy|Refused/.test(m.text())) hp.csp.push(m.text()); });
    await hp.route('**/prices.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ d: T, t: 'x', p: { '2330': [1100, 10, '台積電'], '0050': [190, 1, '元大台灣50'], '2412': [132, 0, '中華電'] } }) }));
    await hp.route('**/prices-30.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ d: [], c: {} }) }));
    await hp.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('habit-tracker-v1', JSON.stringify(s)); } },
      { v: 1, settings: { pnl: true, onboarded: true, holdSince: daysAgo(3) }, rewards: [], redeemed: [], habits: [{ id: 'g1', name: '喝水', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(9) }], logs: {},
        hold: [{ id: 'h1', code: '2330', shares: 2000, cost: 1000 }, { id: 'h2', code: '0050', shares: 1000, cost: 150 }] });
    await hp.goto(BASE); await hp.waitForTimeout(400);
    await hp.click('[data-tab=stats]'); await hp.click('[data-act=stab][data-v=pnl]');
    await hp.click('[data-act=buynew]'); await hp.click('[data-act=buypick][data-id=h1]');
    ok(await hp.inputValue('#buypx') === '1100', 'buy: price defaults to the latest close');
    await hp.fill('#buysh', '1000');
    ok(await hp.inputValue('#buyamt') === '1101567', 'buy: 實付 = price × shares + 0.1425% fee');
    ok(/2,000 股 → 3,000 股/.test(await hp.innerText('#buyprev')) && /1000 → 1033\.9/.test(await hp.innerText('#buyprev')), 'buy: preview shows shares and new average cost');
    await hp.fill('#buyamt', '1100500'); await hp.click('[data-act=buysave]'); await hp.waitForTimeout(300);
    let d = await db(hp), h1 = d.hold.find(h => h.id === 'h1');
    ok(h1.shares === 3000 && h1.cost === 1033.5, 'buy: holding shares and average cost updated with the typed amount');
    ok(d.buys.length === 1 && d.buys[0].amt === 1100500 && d.buys[0].ps === 2000 && d.buys[0].pc === 1000 && d.buys[0].d === T, 'buy: record saved');
    ok(d.logs[T] && d.logs[T].pnl === Math.round(3000 * 1100 - 3000 * 1033.5 + 1000 * 190 - 150000), '未實現 recalculated after buying');
    await hp.click('[data-act=buynew]'); await hp.click('[data-act=buypick][data-id=new]'); await hp.fill('#buycode', '2412');
    ok(/中華電/.test(await hp.innerText('#buyname')) && await hp.inputValue('#buypx') === '132', 'buy: new code shows the name and fills the price');
    await hp.fill('#buysh', '500');
    ok(await hp.inputValue('#buyamt') === '66094', 'buy: 零股 fee estimate');
    await hp.click('[data-act=buysave]'); await hp.waitForTimeout(300); d = await db(hp);
    const nh = d.hold.find(h => h.code === '2412');
    ok(nh && nh.shares === 500 && nh.cost === 132.188 && nh.name === '中華電', 'buy: new stock added to holdings');
    ok((await hp.$$('.sold-row')).length === 2 && /交易紀錄/.test(await hp.innerText('main')), 'buy: 交易紀錄 lists buys');
    await hp.click('[data-act=txf][data-v=sell]'); ok(/還沒有賣出紀錄/.test(await hp.innerText('main')), 'buy: filter by 賣出');
    await hp.click('[data-act=txf][data-v=buy]'); ok((await hp.$$('.sold-row')).length === 2, 'buy: filter by 買入');
    await hp.click('[data-act=buynew]'); await hp.click('[data-act=buypick][data-id=new]'); await hp.fill('#buycode', '0050'); await hp.fill('#buysh', '10'); await hp.fill('#buypx', '190');
    await hp.click('[data-act=buysave]'); await hp.waitForTimeout(300); d = await db(hp);
    ok(d.hold.filter(h => h.code === '0050').length === 1 && d.hold.find(h => h.code === '0050').shares === 1010, 'buy: typing a held code adds to that holding');
    await hp.click('.sold-row >> nth=0'); ok(!(await hp.$('#buysh')) && /買入紀錄/.test(await hp.innerText('main')), 'buy: tapping a record opens it read-only');
    await hp.click('[data-act=buydel]'); await hp.click('[data-act=buydel]'); await hp.waitForTimeout(300); d = await db(hp);
    ok(d.hold.find(h => h.code === '0050').shares === 1000 && d.hold.find(h => h.code === '0050').cost === 150, 'buy: delete restores shares and cost');
    await hp.click('[data-act=txf][data-v=all]'); await hp.click('[data-act=buyedit] >> text=中華電');
    await hp.click('[data-act=buydel]'); await hp.click('[data-act=buydel]'); await hp.waitForTimeout(300); d = await db(hp);
    ok(!d.hold.find(h => h.code === '2412') && d.buys.length === 1, 'buy: deleting the only buy of a stock removes the holding');
    await done(hp, 'buy');
  }

  console.log('• 填息');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const hp = await ctx.newPage(); hp.errs = []; hp.csp = []; hp.on('pageerror', e => hp.errs.push(e.message));
    hp.on('console', m => { if (/Content Security Policy|Refused/.test(m.text())) hp.csp.push(m.text()); });
    const H = [daysAgo(6), daysAgo(5), daysAgo(4), daysAgo(3), daysAgo(1)];
    await hp.route('**/prices.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ d: T, t: 'x', p: { '2330': [1005, 4, '台積電'], '0050': [189, 0.5, '元大台灣50'], '2454': [1500, 0, '聯發科'] } }) }));
    await hp.route('**/prices-30.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ d: H, c: { '2330': [1000, 992, 995, 998, 1001], '0050': [190, 188.2, 188.5, 188.4, 188.5] } }) }));
    await hp.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('habit-tracker-v1', JSON.stringify(s)); } },
      { v: 1, settings: { pnl: true, onboarded: true, holdSince: daysAgo(8), fillFrom: daysAgo(30) }, rewards: [], redeemed: [], habits: [{ id: 'g1', name: '喝水', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(9) }], logs: {},
        hold: [{ id: 'h1', code: '2330', shares: 1000, cost: 900 }, { id: 'h2', code: '0050', shares: 1000, cost: 150 }, { id: 'h3', code: '2454', shares: 100, cost: 1400 }],
        divs: [{ id: 'd1', d: daysAgo(5), code: '2330', name: '台積電', shares: 1000, cash: 10, amt: 10000, ratio: 0, add: 0, paid: false },
          { id: 'd2', d: daysAgo(5), code: '0050', name: '元大台灣50', shares: 1000, cash: 2, amt: 2000, ratio: 0, add: 0, paid: false },
          { id: 'd3', d: daysAgo(60), code: '2454', name: '聯發科', shares: 100, cash: 20, amt: 2000, ratio: 0, add: 0, paid: true }] });
    await hp.goto(BASE); await hp.waitForTimeout(400);
    await hp.click('[data-tab=stats]'); await hp.click('[data-act=stab][data-v=pnl]'); await hp.waitForTimeout(800);
    let d = await db(hp), d1 = d.divs.find(x => x.id === 'd1'), d2 = d.divs.find(x => x.id === 'd2');
    ok(d1.pre === 1000 && d1.fill === daysAgo(1) && d1.fd >= 1, 'fill: target is the close before the ex-date; first close back at it is the fill day');
    ok(d2.pre === 190 && !d2.fill, 'fill: not filled yet');
    ok(/填息/.test(await hp.$eval('#toast', e => e.innerText)), 'fill: toast on the first fill');
    const rows = await hp.innerText('.list');
    ok(/✓ \d+ 天填息/.test(rows) && /填息中 50% · 還差 1 元/.test(rows), 'fill: holdings show the fill and the progress (' + (rows.match(/填息中[^\n]*/) || [''])[0] + ')');
    const tx = await hp.innerText('main');
    ok(/已入帳 · 沒有資料/.test(tx) && /待入帳 · \d+ 天填息/.test(tx) && /填息中 50%/.test(tx), 'fill: 交易紀錄 shows fill results; old dividend has no data');
    await hp.click('[data-act=divedit][data-id=d2]'); ok(/除息前收盤（目標價）\s*190/.test(await hp.innerText('main')) && /還差 1 元/.test(await hp.innerText('main')), 'fill: dividend page shows the target and progress');
    await hp.click('[data-act=divcancel]');
    await done(hp, 'fill');
  }

  console.log('• 補登已實現損益');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const hp = await ctx.newPage(); hp.errs = []; hp.csp = []; hp.on('pageerror', e => hp.errs.push(e.message));
    hp.on('console', m => { if (/Content Security Policy|Refused/.test(m.text())) hp.csp.push(m.text()); });
    await hp.route('**/prices.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ d: T, t: 'x', p: { '2330': [1100, 10, '台積電'], '0050': [190, 1, '元大台灣50'] } }) }));
    await hp.route('**/prices-30.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ d: [], c: {} }) }));
    await hp.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('habit-tracker-v1', JSON.stringify(s)); } },
      { v: 1, settings: { pnl: true, onboarded: true, holdSince: daysAgo(3) }, rewards: [], redeemed: [], habits: [{ id: 'g1', name: '喝水', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(9) }], logs: {},
        hold: [{ id: 'h1', code: '2330', shares: 2000, cost: 1000 }], sold: [{ id: 's1', d: daysAgo(10), code: '2330', name: '台積電', shares: 500, px: 1000, amt: 3000, c: 497000 }] });
    await hp.goto(BASE); await hp.waitForTimeout(400);
    await hp.click('[data-tab=stats]'); await hp.click('[data-act=stab][data-v=pnl]');
    await hp.click('[data-act=bfnew]'); ok(/補登已實現損益/.test(await hp.innerText('main')), 'backfill: page opens from 交易紀錄');
    await hp.fill('#bftext', [daysAgo(30) + ', 2330, 1000, 980, 52300', daysAgo(20) + ', 0050, , , -1,200', daysAgo(20) + ', 0050, , , −1200 ?', daysAgo(10) + ', 2330, 500, 1000, 3000', 'hello'].join('\n'));
    await hp.click('[data-act=bfcheck]');
    ok((await hp.$$('.bf-row')).length === 3 && (await hp.$$('.hp-bad')).length === 2, 'backfill: 3 rows parsed, 2 bad lines shown');
    ok(await hp.$eval('.bf-row >> nth=2', e => e.classList.contains('off')) && /已經有同一天/.test(await hp.innerText('.bf-list')), 'backfill: duplicate of an existing sale is unticked');
    ok(/不確定/.test(await hp.innerText('.bf-list')), 'backfill: unsure lines flagged');
    ok(/勾選 2 筆/.test(await hp.innerText('.bf-sum')) && /\+51,100/.test(await hp.innerText('.bf-sum')), 'backfill: count and total of ticked rows');
    await hp.click('[data-act=bfsave]'); await hp.waitForTimeout(300); let d = await db(hp);
    ok(d.sold.length === 3 && d.sold.filter(x => x.bf).length === 2, 'backfill: rows saved as backfilled sales');
    const ao = d.sold.find(x => x.code === '0050');
    ok(ao && ao.shares === 0 && ao.amt === -1200 && ao.d === daysAgo(20), 'backfill: amount-only sale kept');
    const tw = d.sold.find(x => x.bf && x.code === '2330'); ok(tw.c === 980 * 1000 - 52300, 'backfill: cost derived from price and P&L for 報酬率');
    ok(d.hold.length === 1 && d.hold[0].shares === 2000 && d.hold[0].cost === 1000, 'backfill: holdings untouched');
    ok(/補登金額/.test(await hp.innerText('main')), 'backfill: amount-only row labelled');
    await hp.click('[data-act=selledit] >> text=補登金額'); ok(/刪除這筆補登紀錄/.test(await hp.innerText('main')), 'backfill: edit page offers plain delete');
    await hp.click('[data-act=selldel]'); await hp.waitForTimeout(300); d = await db(hp);
    ok(d.sold.length === 2 && d.hold[0].shares === 2000, 'backfill: delete removes only the record');
    await hp.click('[data-act=bfnew]'); await hp.click('[data-act=bfmode][data-v=one]'); await hp.fill('#bfd', daysAgo(40)); await hp.fill('#bfcode', '0050');
    ok(/元大台灣50/.test(await hp.innerText('#bfname')), 'backfill: code shows the name');
    await hp.fill('#bfamt', '5000'); await hp.click('[data-act=bfsign][data-v="1"]'); await hp.click('[data-act=bfsave1]'); await hp.waitForTimeout(300); d = await db(hp);
    ok(d.sold.some(x => x.bf && x.code === '0050' && x.amt === -5000 && x.d === daysAgo(40)), 'backfill: one sale entered by hand');
    await hp.click('[data-act=bfnew]'); await hp.click('[data-act=bfkind][data-v=div]');
    ok(/股利／配息/.test(await hp.innerText('main')), 'backfill dividends: own instructions');
    await hp.fill('#bftext', [daysAgo(50) + ', 2330, 1240, 7440', daysAgo(60) + ', 元大台灣50, 23000, 13800', daysAgo(55) + ', 2330, 1240, 7440, 1', daysAgo(5) + ', 0050, , 100'].join('\n'));
    await hp.click('[data-act=bfcheck]');
    ok((await hp.$$('.bf-row')).length === 2 && (await hp.$$('.hp-bad')).length === 2 && /\+21,240/.test(await hp.innerText('.bf-sum')), 'backfill dividends: 2 rows (name → code), 2 bad lines, total');
    await hp.click('[data-act=bfsave]'); await hp.waitForTimeout(300); d = await db(hp);
    const dv = d.divs.filter(x => x.bf); ok(dv.length === 2 && dv.some(x => x.code === '0050' && x.amt === 13800 && x.shares === 23000 && x.paid && x.cash === 0.6), 'backfill dividends: saved as paid dividends');
    ok(d.hold.length === 1 && d.hold[0].shares === 2000, 'backfill dividends: holdings untouched');
    ok(/補登股利/.test(await hp.innerText('main')) && /其中股利\s*\+21,240/.test(await hp.innerText('main')), 'backfill dividends: listed and counted in 其中股利');
    await hp.click('[data-act=bfnew]'); await hp.click('[data-act=bfkind][data-v=div]'); await hp.click('[data-act=bfmode][data-v=one]');
    await hp.fill('#bfd', daysAgo(70)); await hp.fill('#bfcode', '2330'); await hp.fill('#bfsh', '1000'); await hp.fill('#bfamt', '4500'); await hp.click('[data-act=bfsave1]'); await hp.waitForTimeout(300); d = await db(hp);
    ok(d.divs.some(x => x.bf && x.amt === 4500 && x.d === daysAgo(70)), 'backfill dividends: one entered by hand');
    await hp.click('[data-act=bfnew]'); await hp.click('[data-act=bfkind][data-v=div]'); await hp.fill('#bftext', daysAgo(69) + ', 2330, 1000, 4500'); await hp.click('[data-act=bfcheck]');
    ok(await hp.$eval('.bf-row', e => e.classList.contains('off')), 'backfill dividends: likely duplicate unticked');
    await hp.click('[data-act=bfcancel]');
    // 分潤
    const r0 = (await db(hp)).sold.concat((await db(hp)).divs).reduce((a, x) => a + x.amt, 0);
    await hp.click('[data-act=bfnew]'); await hp.click('[data-act=bfkind][data-v=prof]');
    ok(!!(await hp.$('#pfwho')) && await hp.inputValue('#pfrate') === '50', 'profit share: first person typed, rate defaults to 50%');
    await hp.fill('#pfwho', '媽媽'); await hp.fill('#pfd', daysAgo(3)); await hp.fill('#pfamt', '120000'); await hp.fill('#pfpct', '18.5');
    ok(await hp.inputValue('#pfmine') === '60000' && /120,000 × 50% ＝ 60,000/.test(await hp.innerText('#pfcalc')), 'profit share: my share computed');
    await hp.click('[data-act=pfsave]'); await hp.waitForTimeout(300); let pd = await db(hp);
    ok(pd.prof.length === 1 && pd.prof[0].who === '媽媽' && pd.prof[0].amt === 120000 && pd.prof[0].pct === 18.5 && pd.prof[0].mine === 60000, 'profit share: saved');
    await hp.click('[data-act=bfnew]'); await hp.click('[data-act=bfkind][data-v=prof]');
    ok(await hp.$eval('[data-act=pfwho][data-v=媽媽]', e => e.classList.contains('on')) && await hp.inputValue('#pfrate') === '50', 'profit share: person and rate remembered');
    await hp.fill('#pfd', daysAgo(2)); await hp.click('[data-act=pfsign][data-v="1"]'); await hp.fill('#pfamt', '20000'); await hp.fill('#pfpct', '4');
    ok(/你分到 0/.test(await hp.innerText('#pfcalc')), 'profit share: loss → nothing shared');
    await hp.click('[data-act=pfsave]'); await hp.waitForTimeout(300);
    await hp.click('[data-act=bfnew]'); await hp.click('[data-act=bfkind][data-v=prof]'); await hp.click('[data-act=pfwho][data-v=""]'); await hp.fill('#pfwho', '哥哥'); await hp.fill('#pfrate', '35');
    await hp.fill('#pfd', daysAgo(1)); await hp.fill('#pfamt', '50000'); await hp.fill('#pfmine', '17000'); await hp.click('[data-act=pfsave]'); await hp.waitForTimeout(300); pd = await db(hp);
    ok(pd.prof.length === 3 && pd.prof.find(x => x.who === '媽媽' && x.amt === -20000).mine === 0 && pd.prof.find(x => x.who === '媽媽' && x.amt === -20000).pct === -4 && pd.prof.find(x => x.who === '哥哥').mine === 17000, 'profit share: loss and typed amount saved');
    const mt = await hp.innerText('main');
    ok(/其中分潤 \+77,000/.test(mt) && new RegExp('不含分潤 \\+' + r0.toLocaleString('en-US')).test(mt), 'profit share: counted in 已實現 and shown separately');
    ok(/媽媽 · 分 50%/.test(mt) && /已實現 \+100,000 · 報酬率 \+/.test(mt) && /2 筆 · 賺 1 賠 1 · 勝率 50%/.test(mt), 'profit share: per-person card with their results (' + (mt.match(/報酬率 [^\n]*/) || [''])[0] + ')');
    ok(/虧損不分/.test(mt) && /× 35%/.test(mt), 'profit share: rows describe each share');
    await hp.click('[data-act=profedit] >> text=哥哥'); await hp.fill('#pfmine', '17500'); await hp.click('[data-act=pfsave]'); await hp.waitForTimeout(300);
    ok((await db(hp)).prof.find(x => x.who === '哥哥').mine === 17500 && (await db(hp)).prof.length === 3, 'profit share: edit keeps one record');
    await hp.click('[data-act=profedit] >> text=哥哥'); await hp.click('[data-act=pfdel]'); await hp.click('[data-act=pfdel]'); await hp.waitForTimeout(300);
    ok((await db(hp)).prof.length === 2, 'profit share: delete');
    await done(hp, 'backfill');
  }

  console.log('• 除權息');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const hp = await ctx.newPage(); hp.errs = []; hp.csp = []; hp.on('pageerror', e => hp.errs.push(e.message));
    hp.on('console', m => { if (/Content Security Policy|Refused/.test(m.text())) hp.csp.push(m.text()); });
    const ex = daysAgo(2), soon = daysAgo(-5);
    await hp.route('**/prices.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ d: T, t: 'x', p: { '2330': [1100, 10, '台積電'], '0056': [36, 0, '元大高股息'] } }) }));
    await hp.route('**/prices-30.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ d: [], c: {} }) }));
    await hp.route('**/dividends.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ t: 'x', e: [['2330', ex, 4.5, 0.05], ['0056', ex, 1.72, 0], ['2330', soon, 5, 0], ['9999', ex, 1, 0]] }) }));
    await hp.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('habit-tracker-v1', JSON.stringify(s)); } },
      { v: 1, settings: { pnl: true, onboarded: true, holdSince: daysAgo(30) }, rewards: [], redeemed: [], habits: [{ id: 'g1', name: '喝水', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(9) }], logs: {},
        hold: [{ id: 'h1', code: '2330', shares: 1000, cost: 1000 }, { id: 'h2', code: '0056', shares: 2000, cost: 30 }] });
    await hp.goto(BASE); await hp.waitForTimeout(500);
    await hp.click('[data-tab=stats]'); await hp.click('[data-act=stab][data-v=pnl]'); await hp.waitForTimeout(300);
    ok((await hp.$$('.divbn')).length === 2 && /即將除權息：台積電/.test(await hp.innerText('main')), 'dividends: due ex-dates asked, upcoming listed');
    await hp.click('.divbn [data-act=divskip][data-v^="0056"]'); ok((await hp.$$('.divbn')).length === 1, 'dividends: 略過 hides it');
    await hp.click('[data-act=divrec]');
    ok(await hp.inputValue('#divcash') === '4.5' && await hp.inputValue('#divstk') === '0.5' && await hp.inputValue('#divamt') === '4500', 'dividends: form prefilled from the announcement');
    await hp.fill('#divamt', '4405'); await hp.click('[data-act=divsave]'); await hp.waitForTimeout(300);
    let d = await db(hp);
    ok(d.divs.length === 1 && d.divs[0].amt === 4405 && d.divs[0].add === 50 && d.divs[0].d === ex && !d.divs[0].paid, 'dividends: record saved (amount as typed, 50 shares added)');
    const h1 = d.hold.find(h => h.id === 'h1'); ok(h1.shares === 1050 && Math.abs(h1.shares * h1.cost - 1000000) < 1, 'dividends: stock dividend adds shares, total cost unchanged');
    ok(!(await hp.$('.divbn')) && /股利/.test(await hp.innerText('.pnl-split')), 'dividends: banner gone; 已實現 shows 股利');
    await hp.click('.sold-row'); await hp.click('[data-act=divpaid]'); await hp.click('[data-act=divsave]'); ok((await db(hp)).divs[0].paid === true, 'dividends: mark 已入帳');
    await hp.click('.sold-row'); await hp.click('[data-act=divdel]'); await hp.click('[data-act=divdel]'); d = await db(hp);
    ok(d.divs.length === 0 && d.hold.find(h => h.id === 'h1').shares === 1000, 'dividends: delete takes the added shares back');
    await done(hp, 'dividends');
  }

  console.log('• 持股 back-fill from 30-day closes');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const hp = await ctx.newPage(); hp.errs = []; hp.csp = []; hp.on('pageerror', e => hp.errs.push(e.message));
    hp.on('console', m => { if (/Content Security Policy|Refused/.test(m.text())) hp.csp.push(m.text()); });
    const D = [6, 5, 4, 3, 2, 1].map(daysAgo); let histCalls = 0;
    await hp.route('**/prices.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ d: T, t: 'x', p: { '2330': [1100, 10, '台積電'] } }) }));
    await hp.route('**/prices-30.json*', r => { histCalls++; r.fulfill({ contentType: 'application/json', body: JSON.stringify({ d: D, c: { '2330': [1000, 1010, null, 1030, 1040, 1050] } }) }); });
    await hp.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('habit-tracker-v1', JSON.stringify(s)); } },
      { v: 1, settings: { pnl: true, holdSince: D[1] }, rewards: [], redeemed: [], habits: [{ id: 'g1', name: '喝水', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(9) }],
        logs: { [D[0]]: { pnl: 7 }, [D[3]]: { pnl: 8 }, [D[4]]: { pnl: 9, pm: true } }, hold: [{ id: 'h1', code: '2330', shares: 1000, cost: 1000 }] });
    await hp.goto(BASE); await hp.waitForFunction(() => /補上/.test(document.body.innerText), null, { timeout: 5000 }).catch(() => {});
    const L = (await db(hp)).logs;
    ok(L[T] && L[T].pnl === 100000 && L[T].pa, 'latest close recorded');
    ok(L[D[1]].pnl === 10000 && L[D[5]].pnl === 50000 && L[D[3]].pnl === 30000, 'missed days filled from the 30-day closes, overriding unlocked manual values');
    ok(L[D[0]].pnl === 7, 'days before the last holdings change are never recomputed');
    ok(!L[D[2]], 'day without a close for a holding is left empty');
    ok(L[D[4]].pnl === 9 && L[D[4]].pm, 'hand-locked day kept');
    ok(histCalls === 1, 'history downloaded once, only because days were missing');
    ok(L[T].cb === 1000000, 'cost basis stored with the auto record');
    await hp.click('[data-tab=stats]'); await hp.click('[data-act=stab][data-v=pnl]');
    ok((await hp.$eval('.pxbar', e => e.innerText)).includes('重新整理'), 'investment tab has a refresh button with the price time');
    await hp.click('[data-act=pxrefresh]'); await hp.waitForTimeout(300);
    await hp.click('[data-act=holdedit]'); await hp.fill('#hdate', D[3]); await hp.fill('[data-hi="0"][data-hf=shares]', '2000'); await hp.click('[data-act=holdsave]');
    await hp.waitForFunction(d => { const o = JSON.parse(localStorage.getItem('habit-tracker-v1')); return o.logs[d] && o.logs[d].pnl === 60000; }, D[3], { timeout: 5000 }).catch(() => {});
    const L2 = (await db(hp)).logs;
    ok(L2[D[3]].pnl === 60000 && L2[D[5]].pnl === 100000 && L2[T].pnl === 200000, 'holdings change dated earlier recomputes from that day');
    ok(L2[D[1]].pnl === 10000 && L2[D[4]].pnl === 9 && (await db(hp)).settings.holdSince === D[3], 'days before the trade date and locked days stay as they were');
    await hp.reload(); await hp.waitForSelector('.pnl-card .pct');
    const pc = await hp.$eval('.pnl-card', e => e.innerText);
    ok(pc.includes('+10.00%') && pc.includes('今日損益') && pc.includes('+4.76%'), 'today card: return on cost and today % of previous market value (' + pc.replace(/\n/g, ' ') + ')');
    await hp.click('[data-tab=stats]'); await hp.click('[data-act=stab][data-v=pnl]');
    const sp = await hp.$eval('.pnl-read', e => e.innerText);
    ok(sp.includes('+10.00%') && sp.includes('今日損益') && sp.includes('+4.76%'), 'stats panel shows both percentages');
    ok((await hp.$eval('[data-pblk=trend]', e => e.innerText)).includes('週變動') && (await hp.$eval('[data-pblk=trend]', e => e.innerText)).includes('本月變動'), 'trend shows a week row above the month row');
    await hp.click('[data-act=pgran][data-v=w]');
    ok((await hp.$eval('.pnl-read', e => e.innerText)).includes('本週損益') && (await db(hp)).settings.pnlGran === 'w', 'week view: one point per week, 本週損益');
    const oh = await hp.$eval('.ohlc', e => e.innerText); ok(['開', '高', '低', '收'].every(x => oh.includes(x)) && oh.includes('+200,000'), 'week view draws K bars with open/high/low/close (' + oh.replace(/\n/g, ' ') + ')');
    await hp.click('[data-act=pgran][data-v=m]');
    ok((await hp.$eval('.pnl-read', e => e.innerText)).includes('本月損益') && (await hp.$$('[data-act=pnlpt]')).length >= 1, 'month view: one point per month, 本月損益');
    await hp.click('[data-act=pgran][data-v=d]');
    ok((await hp.$$('.chart-x.ticks span')).length >= 1 && !('pnlGran' in (await db(hp)).settings), 'day view with weekly date ticks');
    await done(hp, 'holdings back-fill');
  }

  console.log('• P&L % for records without stored cost');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const hp = await ctx.newPage(); hp.errs = []; hp.csp = []; hp.on('pageerror', e => hp.errs.push(e.message));
    hp.on('console', m => { if (/Content Security Policy|Refused/.test(m.text())) hp.csp.push(m.text()); });
    await hp.route('**/prices.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ d: daysAgo(30), t: 'x', p: {} }) }));
    await hp.addInitScript(s => { localStorage.setItem('habit-tracker-v1', JSON.stringify(s)); },
      { v: 1, settings: { pnl: true, holdSince: T }, rewards: [], redeemed: [], habits: [{ id: 'g1', name: '喝水', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(9) }],
        logs: { [daysAgo(1)]: { pnl: 120000 }, [T]: { pnl: 100000, pm: true } }, hold: [{ id: 'h1', code: '2330', shares: 1000, cost: 1000 }] });
    await hp.goto(BASE); await hp.waitForSelector('.pnl-card');
    const pc = await hp.$eval('.pnl-card', e => e.innerText);
    ok(pc.includes('+10.00%') && pc.includes('−1.79%'), 'falls back to current holdings cost (' + pc.replace(/\n/g, ' ') + ')');
    await done(hp, 'P&L % fallback');
  }

  console.log('• demo gets sample holdings even when its data predates 我的持股');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const hp = await ctx.newPage(); hp.errs = []; hp.csp = []; hp.on('pageerror', e => hp.errs.push(e.message));
    hp.on('console', m => { if (/Content Security Policy|Refused/.test(m.text())) hp.csp.push(m.text()); });
    await hp.route('**/prices.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ d: daysAgo(1), t: 'x', p: { '2330': [2420, 0, '台積電'] } }) }));
    await hp.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('habit-tracker-demo', JSON.stringify(s)); } },
      { v: 1, settings: { pnl: true, onboarded: true }, rewards: [], redeemed: [], habits: [{ id: 'g1', name: '喝水', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(9) }],
        logs: { [daysAgo(2)]: { pnl: 1000 } } });
    await hp.goto(BASE.replace('index.html', 'index.html?demo')); await hp.waitForSelector('#demobar');
    const d = await hp.evaluate(() => JSON.parse(localStorage.getItem('habit-tracker-demo')));
    ok(d.hold.length === 5 && d.logs[daysAgo(2)].cb > 0, 'old demo data gets sample holdings and cost basis');
    await done(hp, 'demo holdings');
  }

  console.log('• 禁止斜線 on icons');
  {
    p = await page(b, { 'habit-tracker-v1': { v: 1, logs: {}, settings: { onboarded: true }, rewards: [], redeemed: [], habits: [
      { id: 'n1', name: '不喝咖啡', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(3), icon: 'coffee' },
      { id: 'n2', name: '喝咖啡', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(3), icon: 'coffee' }] } });
    ok(await p.$eval('[data-id=n1] .hico', e => !!e.querySelector('.ko')) && !(await p.$eval('[data-id=n2] .hico', e => !!e.querySelector('.ko'))), 'names that say "don\'t" get a slash');
    await p.click('[data-tab=settings]'); await p.click('[data-act=edit][data-id=n1]'); await p.click('[data-act=iconpick]').catch(() => {});
    await p.click('[data-act=slasht]'); await p.click('[data-act=save]');
    ok((await db(p)).habits.find(h => h.id === 'n1').slash === false, 'slash can be turned off by hand');
    await p.click('[data-tab=today]');
    ok(!(await p.$eval('[data-id=n1] .hico', e => !!e.querySelector('.ko'))), 'turned-off slash is not drawn');
    await done(p, 'slash');
  }

  console.log('• 投資 rewards');
  {
    const wsOf = k => { const d = new Date(k + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const WS = wsOf(T), bd = new Date(WS + 'T00:00:00'); bd.setDate(bd.getDate() - 3);
    const B = bd.getFullYear() + '-' + String(bd.getMonth() + 1).padStart(2, '0') + '-' + String(bd.getDate()).padStart(2, '0');
    const R = (id, name, type, target, extra) => Object.assign({ id, name, type, habit: null, target, repeat: true, created: daysAgo(10), earned: [], done: false }, extra || {});
    p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { onboarded: true, pnl: true }, redeemed: [], habits: [{ id: 'g1', name: '喝水', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(20) }],
      logs: { [B]: { pnl: 100000, cb: 1000000 }, [T]: { pnl: 130000, cb: 1000000 } },
      rewards: [R('r1', '跑鞋', 'invwk', 20000), R('r2', '耳機', 'invwk', 3, { u: 'pct' }), R('r3', '新手機', 'invhi', 120000, { repeat: false }), R('r4', '出國', 'invpct', 12, { repeat: false }), R('r5', '大餐', 'invmo', 1000000)] } });
    await p.click('[data-tab=rewards]');
    const rw = await p.$eval('#main', e => e.innerText), d0 = await db(p), E = id => d0.rewards.find(r => r.id === id).earned;
    ok(E('r1')[0] === WS && !E('r2').length && E('r3')[0] === T && E('r4')[0] === T && !E('r5').length, 'week change (amount), break-through and return % are earned; week % and month amount are not yet');
    ok(rw.includes('本週 ▲2.73% / 3%') && rw.includes('一週內未實現損益增加 NT$20,000'), 'progress and rule text for 投資 rewards (' + rw.split('進行中')[1].slice(0, 80).replace(/\n/g, ' ') + ')');
    await p.click('[data-act=rnew]'); await p.click('[data-act=rhabit][data-id=inv]'); await p.click('[data-act=rtype][data-v=invmo]'); await p.click('[data-act=runit][data-v=pct]');
    await p.fill('#rtarget', '4'); await p.fill('#rname', '按摩'); await p.click('[data-act=rsave]');
    const nr = (await db(p)).rewards.find(r => r.name === '按摩');
    ok(nr && nr.type === 'invmo' && nr.u === 'pct' && nr.target === 4 && nr.habit === null, 'editor creates a monthly % 投資 reward');
    await done(p, 'investment rewards');
  }

  console.log('• automatic backups');
  {
    p = await page(b, { 'habit-tracker-v1': { v: 1, logs: { [T]: { mood: 2 } }, settings: { onboarded: true }, rewards: [], redeemed: [], habits: [{ id: 'g1', name: '喝水', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(3) }] } });
    let A = await p.evaluate(() => JSON.parse(localStorage.getItem('habit-tracker-v1-auto') || '[]'));
    ok(A.length === 1 && A[0].why === 'daily', 'first open of the day keeps a daily copy');
    await p.click('[data-tab=settings]'); ok((await p.$eval('[data-act=autobk]', e => e.innerText)).includes('瀏覽器'), 'auto backup row says it lives in the browser');
    await p.evaluate(() => localStorage.setItem('habit-tracker-v1-ver', '2026.10.01-1')); await p.reload(); await p.waitForSelector('.page');
    A = await p.evaluate(() => JSON.parse(localStorage.getItem('habit-tracker-v1-auto') || '[]'));
    ok(A.length === 2 && A[0].why === 'update' && A[0].v === '2026.10.01-1', 'opening a new version keeps a copy from before the update');
    await p.reload(); await p.waitForSelector('.page');
    ok((await p.evaluate(() => JSON.parse(localStorage.getItem('habit-tracker-v1-auto')).length)) === 2, 'no extra copies on later opens the same day');
    await p.click('[data-tab=today]'); await p.click('[data-act=toggle][data-id=g1]');
    await p.click('[data-tab=settings]'); await p.click('[data-act=autobk]');
    const sh = await p.$eval('.sheet', e => e.innerText);
    ok(/\d+\/\d+（.）\d\d:\d\d/.test(sh) && sh.includes('更新前（2026.10.01-1 版）') && sh.includes('每日自動備份') && sh.includes('1 個習慣'), 'backup list shows date, weekday, time and reason');
    await p.click('[data-act=autorestore][data-i="0"]'); await p.click('[data-act=confirmimport]');
    ok(!((await db(p)).logs[T].h), 'restoring brings back the data from before');
    A = await p.evaluate(() => JSON.parse(localStorage.getItem('habit-tracker-v1-auto')));
    ok(A[0].why === 'restore' && JSON.parse(A[0].d).logs[T].h, 'the data replaced by a restore is kept too');
    await done(p, 'auto backups');
  }

  console.log('• security headers in page');
  p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { onboarded: true }, habits: [], logs: {}, rewards: [], redeemed: [] } });
  ok(!(await p.evaluate(() => fetch('https://example.com/').then(() => true, () => false))), 'CSP blocks outbound requests');
  await p.evaluate(() => { const d = document.createElement('div'); d.innerHTML = '<img src=x onerror="window.__x=1">'; document.body.appendChild(d); });
  await p.waitForTimeout(200); ok(!(await p.evaluate(() => window.__x)), 'CSP blocks inline handlers');
  const f = await p.context().newPage(); await f.setContent('<iframe src="' + BASE + '"></iframe>'); await f.waitForTimeout(800);
  ok((await f.frames()[1].evaluate(() => document.body.innerText)).includes('不能嵌在其他網頁'), 'refuses to run inside a frame');
  ok(p.csp.length >= 2, 'CSP reported the blocked attempts'); p.csp = []; // violations above were triggered on purpose
  await done(p, 'security');

  // 練了哪些部位: bear (front/back) with 週／月／季／年 and paging back
  {
    const ex = [['e1', '臥推', '胸'], ['e2', '深蹲', '腿'], ['e3', '波比', '全身']].map(([id, name, part]) => ({ id, name, part, eq: '槓鈴' }));
    const logs = {}; logs[daysAgo(0)] = { s: [{ id: 'a1', ex: 'e1', sets: [[40, 10]] }, { id: 'a2', ex: 'e3', sets: [[0, 10]] }] };
    logs[daysAgo(40)] = { s: [{ id: 'a3', ex: 'e2', sets: [[60, 5]] }] }; logs[daysAgo(400)] = { s: [{ id: 'a4', ex: 'e1', sets: [[30, 5]] }] };
    const p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { onboarded: true, fit: true }, habits: [], logs: {}, rewards: [], redeemed: [], fit: { ex, logs, ctypes: [] } } });
    await p.click('#fitTab'); await p.click('[data-act=ftab][data-v=prog]');
    ok((await p.$$('svg.bear')).length === 1 && (await p.$$('.bear-lbl')).length === 9, 'body map: bear front and back with 9 part labels');
    ok(await p.$eval('.bear-lbl[data-v=胸] .bear-c', e => e.textContent) === '1 天', 'body map: chest label counts days this month');
    ok(await p.$eval('.bear-lbl[data-v=背]', e => e.classList.contains('zero')), 'body map: untrained part is greyed');
    ok(/全身 1 天/.test(await p.innerText('.bmfoot')), 'body map: 全身 counted separately');
    ok(/腿 40 天沒練/.test(await p.innerText('.bmfoot')), 'body map: stale part warning kept');
    await p.click('[data-act=fbgran][data-v=y]');
    ok((await db(p)).settings.fitGran === 'y', 'body map: 年 remembered');
    for (const [id, nm] of [['mel', '南蜜瓜'], ['pp', '屁屁'], ['man', '男生'], ['woman', '女生'], ['kaka', '咖咖']]) {
      await p.selectOption('#fbchar', id);
      ok((await p.getAttribute('svg.bear', 'aria-label')).startsWith(nm) && (await p.$$('.bear-lbl')).length === 9, 'body map: switch to ' + nm);
    }
    await p.selectOption('#fbchar', 'man');
    ok(await p.$$eval('path.mp.bl5', e => e.length) >= 1 && await p.$$eval('path.mp', e => e.length) > 10, 'body map: 小人 shades the trained muscles');
    await p.selectOption('#fbchar', 'kaka');
    ok((await db(p)).settings.fitChar === undefined, 'body map: 咖咖 is the default');
    await p.selectOption('#fbchar', 'pp'); ok((await db(p)).settings.fitChar === 'pp', 'body map: character remembered');
    ok((await p.$$eval('#fbchar option', o => o.map(x => x.textContent))).join() === '男生,女生,咖咖,屁屁,南蜜瓜', 'body map: dropdown order');
    await p.click('[data-act=fboff][data-n="1"]');
    ok(await p.$eval('.bmnav b', e => e.textContent) === (new Date().getFullYear() - 1) + ' 年', 'body map: ‹ pages to last year');
    await p.click('.bear-lbl[data-v=胸] .bear-n');
    ok(/胸 · .*練了 1 天/.test(await p.$eval('#toast', e => e.innerText)), 'body map: tapping a part shows its days');
    await done(p, 'body map');
  }

  // 運動頁：右下角 ＋、部位旁 ＋、計時條在上方
  {
    const T0 = daysAgo(0);
    const p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { onboarded: true, fit: true, ftStart: Date.now() - 20 * 60000, ftDay: T0 }, habits: [], logs: {}, rewards: [], redeemed: [],
      fit: { ex: [{ id: 'p1', name: '槓鈴臥推', eq: '槓鈴', part: '胸' }, { id: 'p11', name: '啞鈴肩推', eq: '啞鈴', part: '肩' }], logs: { [T0]: { s: [{ id: 'a1', ex: 'p1', sets: [[40, 10]] }, { id: 'a2', ex: 'p11', sets: [[10, 10]] }] } }, ctypes: [] } } });
    await p.click('#fitTab');
    ok(!!(await p.$('.fab')) && !(await p.$('.fbtns')), 'fit: floating ＋ replaces the bottom buttons once there are records');
    ok(!!(await p.$('.fttop .ftbox')) && !(await p.$('.fmin .ftbox')), 'fit: running timer shown at the top');
    await p.click('.secplus[data-v=肩]'); ok(await p.$eval('.fchip.on[data-act=fpart]', e => e.textContent) === '肩', 'fit: section ＋ opens the picker on that part');
    await p.click('[data-act=fpback]'); await p.click('.fab'); ok(!!(await p.$('.fadd')), 'fit: ＋ asks 重訓 or 有氧');
    await p.click('.fadd [data-act=fcnew]'); ok(!(await p.$('#sheet .sheet')), 'fit: menu closes after choosing');
    await done(p, 'fit add');
  }

  // 這週訓練表
  {
    const ex = [['p1', '槓鈴臥推', '槓鈴', '胸'], ['p18', '槓鈴深蹲', '槓鈴', '腿'], ['p52', '壺鈴擺盪', '壺鈴', '全身']].map(([id, name, eq, part]) => ({ id, name, eq, part }));
    const logs = { [daysAgo(0)]: { s: [{ id: 'a', ex: 'p1', sets: [[40, 10]] }] }, [daysAgo(7)]: { s: [{ id: 'b', ex: 'p18', sets: [[60, 5]] }], c: [{ id: 'c', type: '跑步', min: 30 }] } };
    const p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { onboarded: true, fit: true }, habits: [], logs: {}, rewards: [], redeemed: [], fit: { ex, logs, ctypes: [] } } });
    await p.click('#fitTab');
    ok((await p.$$('.cyd')).length === 7 && await p.$eval('.cyd.today .cyp', e => e.textContent) === '胸', 'week table: today shows the part trained');
    await p.click('[data-act=cyoff][data-n="1"]');
    ok(/上週/.test(await p.innerText('.cyh')) && (await p.$$eval('.cyp', e => e.map(x => x.textContent))).join() === '腿,有氧', 'week table: ‹ shows last week with 有氧');
    await done(p, 'week table');
  }

  // 今天建議練什麼
  {
    const ex = [['p1', '臥推', '槓鈴', '胸'], ['p11', '肩推', '啞鈴', '肩'], ['p14', '彎舉', '啞鈴', '二頭'], ['p16', '下壓', '滑輪', '三頭'], ['p18', '深蹲', '槓鈴', '腿'], ['p22', '臀推', '槓鈴', '臀'], ['p23', '棒式', '徒手', '核心']].map(([id, name, eq, part]) => ({ id, name, eq, part }));
    const S = (ids) => ({ s: ids.map((x, i) => ({ id: x + i, ex: x, sets: [[10, 10]] })) });
    const logs = { [daysAgo(3)]: S(['p18']), [daysAgo(2)]: S(['p18', 'p22', 'p23']), [daysAgo(1)]: S(['p1', 'p11', 'p14', 'p16', 'p22']), [daysAgo(0)]: { c: [{ id: 'r', type: '跑步', min: 30 }] } };
    const p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { onboarded: true, fit: true }, habits: [], logs: {}, rewards: [], redeemed: [], fit: { ex, logs, ctypes: [] } } });
    await p.click('#fitTab');
    ok((await p.$$eval('.cyd.today .cyp.dash', e => e.map(x => x.textContent))).join() === '背,腿,核心', 'suggest: 背 (never), 腿 (2 days), plus 核心');
    ok(/建議今天練：背、腿，可以搭核心/.test(await p.innerText('.cyft')) && /胸、肩、臀、二頭、三頭昨天剛練/.test(await p.innerText('.cyft')), 'suggest: reason line');
    await p.click('[data-act=cyhelp]'); ok(/48 小時/.test(await p.innerText('#sheet')), 'suggest: ? explains the rule');
    await p.click('#sheet [data-act=closesheet]').catch(() => {});
    await done(p, 'suggest');
    {
      const logs2 = Object.assign({}, logs, { [daysAgo(0)]: S(['p23']) });
      const q = await page(b, { 'habit-tracker-v1': { v: 1, settings: { onboarded: true, fit: true }, habits: [], logs: {}, rewards: [], redeemed: [], fit: { ex: ex.concat([{ id: 'p6', name: '下拉', eq: '滑輪', part: '背' }]), logs: logs2, ctypes: [] } } });
      await q.click('#fitTab');
      ok((await q.$$eval('.cyd.today .cyp.dash', e => e.map(x => x.textContent))).join() === '背,腿' && /核心 ✓/.test(await q.innerText('.cyft')), 'suggest: kept while training, done parts ticked');
      await done(q, 'suggest partly done');
    }
  }

  // 子部位 + 器材篩選
  {
    const p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { onboarded: true, fit: true }, habits: [], logs: {}, rewards: [], redeemed: [], fit: { ex: [], logs: {}, ctypes: [] } } });
    await p.click('#fitTab'); await fitAdd(p, 'fpick'); await p.click('[data-act=fpart][data-v=胸]');
    ok((await p.$$eval('.fchips.sub .fchip', e => e.map(x => x.textContent))).join() === '全部,上胸,中胸,下胸', 'sub-parts: 胸 offers 上胸／中胸／下胸');
    await p.click('[data-act=fpsub][data-v=上胸]');
    let names = await p.$$eval('#fplist .fprow .fp-n > span', e => e.map(x => x.textContent));
    ok(names.includes('上斜啞鈴臥推') && names.includes('上斜槓鈴臥推') && names.includes('低位滑輪夾胸') && !names.includes('槓鈴臥推'), 'sub-parts: 上胸 lists only upper-chest exercises');
    await p.click('[data-act=fpeq][data-v=槓鈴]'); names = await p.$$eval('#fplist .fprow .fp-n > span', e => e.map(x => x.textContent));
    ok(names.join() === '上斜槓鈴臥推', 'equipment filter narrows to 槓鈴');
    await p.click('[data-act=fpsub][data-v=下胸]'); names = await p.$$eval('#fplist .fprow .fp-n > span', e => e.map(x => x.textContent));
    ok(names.join() === '下斜槓鈴臥推', 'sub-parts: new 下胸 presets');
    ok((await db(p)).settings.fpSub === '下胸' && (await db(p)).settings.fpEq === '槓鈴', 'filters remembered');
    await p.click('[data-act=fpedit]'); await p.click('[data-act=fexedit]'); ok(await p.inputValue('#fxsub') === '下胸', 'editor shows the sub-part');
    await p.selectOption('#fxsub', '中胸'); await p.click('[data-act=fxsave]');
    ok((await db(p)).fit.ex.find(e => e.name === '下斜槓鈴臥推').sub === '中胸', 'sub-part can be changed');
    { const ex = (await db(p)).fit.ex; const lr = ex.find(e => e.name === '低位划船機'), pc = ex.find(e => e.name === '槓片式推胸機');
      ok(lr && lr.part === '背' && lr.sub === '背闊' && lr.en === 'Low Row' && pc && pc.part === '胸' && pc.sub === '中胸' && pc.eq === '器械', 'machine presets: 低位划船機 + 槓片式推胸機'); }
    { const ex = (await db(p)).fit.ex; const sm = ['史密斯臥推', '史密斯上斜臥推', '史密斯下斜臥推'].map(n => ex.find(e => e.name === n));
      ok(sm.every(e => e && e.eq === '史密斯機' && e.part === '胸') && sm.map(e => e.sub).join() === '中胸,上胸,下胸', 'Smith machine chest presets'); }
    await done(p, 'sub-parts');
  }

  // 個人化 + 習慣等級
  {
    const logs = {}; for (let i = 1; i <= 8; i++) logs[daysAgo(i)] = { h: { g1: 1 } };
    const p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { onboarded: true }, rewards: [], redeemed: [], logs,
      habits: [{ id: 'g1', name: '喝水', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(20) }, { id: 'b1', name: '不喝含糖飲料', kind: 'bad', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(22) }] } });
    ok(!(await p.$('.hello')), 'profile: no greeting until something is set');
    ok(await p.$eval('[data-id=g1] .lv', e => e.textContent) === 'Lv2', 'level: 8 days done → Lv2');
    ok(await p.$eval('[data-id=b1] .lv', e => e.textContent) === 'Lv3', 'level: bad habit counts clean days (22 → Lv3)');
    await p.click('[data-act=toggle][data-id=g1]'); await p.waitForTimeout(400);
    ok(/升級了/.test(await p.$eval('#toast', e => e.innerText)) === false, 'level: no level-up toast when not crossing');
    await p.click('[data-tab=settings]'); await p.fill('#uname', 'Aaron'); await p.fill('#motto', '慢慢來，比較快');
    await p.click('[data-act=avpick]'); await p.click('[data-act=avset][data-v=mel]');
    await p.click('[data-act=quotes]'); ok((await p.$$('.qopt')).length === 6, 'profile: six quotes to pick from');
    await p.click('.qopt >> nth=0'); const mt = (await db(p)).settings.motto; ok(!!mt && mt !== '慢慢來，比較快', 'profile: picking a quote sets the motto');
    await p.click('[data-tab=today]');
    ok(/Aaron/.test(await p.innerText('.hello')) && !!(await p.$('.hello .av.ch svg')), 'profile: greeting with name and character avatar');
    const d = (await db(p)).settings; ok(d.uname === 'Aaron' && d.avatar === 'mel', 'profile: saved');
    await p.click('[data-tab=settings]'); await p.click('[data-act=avpick]');
    ok((await p.$$('.avopt')).length === 7 && /軟軟/.test(await p.innerText('.avgrid')) && /帕丁/.test(await p.innerText('.avgrid')), 'profile: seven avatars incl. 軟軟 and 帕丁');
    await p.click('[data-act=avset][data-v=cat]'); await p.click('[data-tab=today]');
    ok(!!(await p.$('.hello .av.ch img.avimg')) && (await db(p)).settings.avatar === 'cat', 'profile: picture avatar shown and saved');
    await p.click('[data-tab=settings]'); await p.click('[data-act=avpick]'); await p.click('[data-act=avset][data-v=mel]');
    { const png = Buffer.from((await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 400, 400); x.fillStyle = '#33c'; x.fillRect(400, 0, 400, 400); return c.toDataURL('image/png'); })).split(',')[1], 'base64');
      const pick = async (open) => { if (open) { await p.click('[data-tab=settings]'); await p.click('[data-act=avpick]'); } const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-act=avphoto]')]); await fc.setFiles({ name: 'a.png', mimeType: 'image/png', buffer: png }); await p.waitForSelector('.avcrop'); };
      await pick(true); ok(!!(await p.$('.avc-ring')) && !!(await p.$('.avc-zoom')), 'avatar crop: frame and zoom slider shown');
      await p.click('.avcrop .textbtn >> text=取消'); ok(!(await p.$('.avcrop')) && (await db(p)).settings.avatar === 'mel', 'avatar crop: cancel keeps the old avatar');
      ok(!!(await p.$('[data-act=avphoto]')), 'avatar crop: cancel returns to the avatar picker');
      await pick(false); const st = await p.$('.avc-stage'), bb = await st.boundingBox(), tf0 = await p.$eval('.avc-img', e => e.style.transform);
      await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.move(bb.x + bb.width / 2 + 400, bb.y + bb.height / 2, { steps: 5 }); await p.mouse.up();
      const tf = await p.$eval('.avc-img', e => e.style.transform); ok(tf !== tf0, 'avatar crop: dragging moves the photo');
      const lim = await p.evaluate(() => { const r = document.querySelector('.avc-ring').getBoundingClientRect(), i = document.querySelector('.avc-img').getBoundingClientRect(); return i.left <= r.left + 0.5 && i.right >= r.right - 0.5 && i.top <= r.top + 0.5 && i.bottom >= r.bottom - 0.5; });
      ok(lim, 'avatar crop: photo always covers the frame');
      await p.$eval('.avc-zoom', e => { e.value = '600'; e.dispatchEvent(new Event('input')); }); ok((await p.$eval('.avc-zoom', e => +e.value)) > 500, 'avatar crop: slider zooms');
      await p.click('.avcrop .textbtn >> text=使用'); await p.waitForFunction(() => !document.querySelector('.avcrop')); await p.waitForTimeout(400);
      const sd = (await db(p)).settings; ok(sd.avatar === 'photo' && !!sd.avPh, 'avatar crop: 使用 saves the photo avatar');
      await p.click('[data-tab=settings]'); await p.click('[data-act=avpick]'); await p.click('[data-act=avset][data-v=mel]'); }
    await p.click('[data-tab=settings]'); const lm = 'You need to develop conviction in a set of beliefs that nobody else agrees with'; await p.fill('#motto', lm);
    ok((await db(p)).settings.motto === lm, 'profile: long motto (79 chars) kept whole');
    ok(/自動備份／還原/.test(await p.innerText('main')), 'settings: 自動備份／還原 label');
    await done(p, 'profile');
  }

  // 日記 #標籤
  {
    const k1 = daysAgo(1), k2 = daysAgo(5);
    const p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { onboarded: true, diary: true }, habits: [{ id: 'g1', name: '運動', kind: 'good', method: 'check', days: [1, 1, 1, 1, 1, 1, 1], created: daysAgo(9) }], rewards: [], redeemed: [],
      logs: { [k1]: { diary: { t: '結婚週年 #紀念 #感謝' } }, [k2]: { diary: { t: '想通了一件事。C# 不是標籤 https://x.com/#a\n#察覺 #紀念' } } } } });
    await p.click('[data-act=dopen]');
    ok((await p.$$('.mdtags .dtag')).length === 3 && await p.$eval('.mdtags .dtag', e => e.textContent) === '#紀念', 'tags: used tags offered as quick buttons, most used first');
    await p.fill('#diary', '今天'); await p.evaluate(() => { const ta = document.getElementById('diary'); ta.focus(); ta.setSelectionRange(2, 2); });
    await p.click('.mdtags [data-v=紀念]'); ok(await p.inputValue('#diary') === '今天 #紀念 ', 'tags: quick button inserts the tag');
    await p.click('[data-act=ddone]');
    ok(await p.$eval('.dview .dtag', e => e.textContent) === '#紀念', 'tags: shown as a chip');
    await p.click('.dview .dtag');
    ok(/3 篇日記/.test(await p.innerText('main')) && (await p.$$('.tagrow')).length === 3, 'tags: tapping lists every entry with the tag');
    await p.click('.tagrow >> nth=2'); ok(/C# 不是標籤/.test(await p.innerText('.dview')) && (await p.$$('.dview .dtag')).length === 2, 'tags: C# and URL fragments are not tags');
    await p.click('[data-act=dback]'); ok(/#紀念/.test(await p.innerText('main')) && !!(await p.$('.tagrow')), 'tags: back returns to the tag list');
    await p.click('[data-act=tagback]'); ok(!!(await p.$('.dview')), 'tags: back from the list returns to the diary'); await p.click('[data-act=dback]');
    await p.click('[data-tab=stats]'); await p.click('[data-act=stab][data-v=diary]');
    ok(/標籤/.test(await p.innerText('main')) && (await p.$$('.tagcloud .dtag')).length === 3, 'tags: 統計 → 日記 lists all tags with counts');
    await done(p, 'tags');
  }

  // 重訓計時 + 動作搜尋
  {
    const T0 = daysAgo(0), now = Date.now();
    let p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { onboarded: true, fit: true, ftStart: now - 45 * 60000, ftDay: T0 }, habits: [], logs: {}, rewards: [], redeemed: [], fit: { ex: [], logs: { [T0]: { min: 10 } }, ctypes: [] } } });
    await p.click('#fitTab');
    ok(/45 分/.test(await p.innerText('.ftbox')), 'timer: elapsed minutes from the saved start');
    await p.click('[data-act=ftend]'); let d = await db(p);
    ok(d.fit.logs[T0].min === 55 && !d.settings.ftStart, 'timer: 結束 adds the minutes to 重訓時間');
    await p.click('[data-act=ftstart]'); d = await db(p);
    ok(d.settings.ftStart > now - 1000 && d.settings.ftDay === T0 && !!(await p.$('.ftbox')), 'timer: start saves the time');
    await p.click('[data-act=ftcancel]'); ok(!(await db(p)).settings.ftStart, 'timer: cancel');
    await fitAdd(p, 'fpick'); await p.fill('#fq', '槓鈴硬舉');
    ok(/硬舉/.test(await p.innerText('#fplist')), 'search: 器材＋動作 finds 硬舉');
    await p.fill('#fq', 'deadlift'); ok((await p.innerText('#fplist')).includes('羅馬尼亞硬舉') && /搜尋結果 · 2/.test(await p.innerText('#fplist')), 'search: English name');
    await done(p, 'timer');
    p = await page(b, { 'habit-tracker-v1': { v: 1, settings: { onboarded: true, fit: true, ftStart: now - 5 * 3600e3, ftDay: T0, ftLast: now - 4 * 3600e3 }, habits: [], logs: {}, rewards: [], redeemed: [], fit: { ex: [], logs: {}, ctypes: [] } } });
    await p.click('#fitTab');
    ok(!!(await p.$('.ftbox.stale')), 'timer: over 3 hours asks instead of counting');
    await p.click('[data-act=ftend][data-v=last]'); d = await db(p);
    ok(d.fit.logs[T0] && d.fit.logs[T0].min === 60, 'timer: end at the last set');
    await done(p, 'timer stale');
  }

  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
