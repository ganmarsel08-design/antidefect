// Этап 8, issue #10 п.3 — браузер: блок «Препараты в тексте» показан, в случай не входит. Только синтетические данные.
'use strict';
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const URL = 'file://' + path.resolve(__dirname, '..', '..', 'expert.html');
const res = []; const step = (n, ok) => { res.push(ok); console.log((ok ? 'ok   ' : 'FAIL ') + n); };
(async () => {
  const b = await chromium.launch(Object.assign({ args: ['--no-sandbox'] }, process.env.CHROME ? { executablePath: process.env.CHROME } : {}));
  try {
    const p = await b.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.route('**/*', r => /^(file|blob|data):/.test(r.request().url()) ? r.continue() : (errs.push('СЕТЬ'), r.abort()));
    await p.goto(URL);
    await p.fill('#text', '14.01.2026 07:30 — Планируется гентамицин 6 мг в/в. В 07:40 введена первая доза: ампициллин 100 мг в/в. Иммуноглобулин назначен индивидуально, фактически не вводился.');
    await p.check('#synth'); await p.fill('#tz', '+05:00'); await p.check('.prot[value="Сепсис"]'); await p.click('#go');
    await p.waitForSelector('[data-test="med-status"]', { state: 'attached' });
    const rows = await p.$$eval('[data-test="med-status"] tr[data-status]', t => t.map(r => [r.children[0].textContent, r.dataset.status, r.children[2].textContent]));
    step('блок «Препараты в тексте» показан', rows.length === 3);
    step('гентамицин — план', rows.some(r => r[0] === 'гентамицин' && r[1] === 'planned'));
    step('ампициллин — введено, время 07:40', rows.some(r => r[0] === 'ампициллин' && r[1] === 'administered' && r[2] === '2026-01-14 07:40'));
    step('иммуноглобулин — не введено', rows.some(r => r[0] === 'иммуноглобулин' && r[1] === 'not_administered'));
    step('в найденных сведениях нет «назначен гентамицин»', !(await p.$('tr[data-c] .code')) || !(await p.$$eval('tr[data-c] .code', c => c.map(x => x.textContent))).includes('gentamicin_given'));
    // ревью 8622515: смешанные и отрицательные записи — статус у своего препарата, неоднозначное — «не определён»
    await p.goto(URL);
    await p.fill('#text', '14.01.2026 07:30 — Гентамицин назначен, ампициллин введён в 07:50. Метронидазол не вводить. Назначены цефотаксим и амикацин. Введено не было. Начат ванкомицин.');
    await p.check('#synth'); await p.fill('#tz', '+05:00'); await p.check('.prot[value="Сепсис"]'); await p.click('#go');
    await p.waitForSelector('[data-test="med-status"]', { state: 'attached' });
    const r2 = await p.$$eval('[data-test="med-status"] tr[data-status]', t => t.map(r => [r.children[0].textContent, r.dataset.status, r.children[1].textContent, r.children[2].textContent]));
    const st = d => (r2.find(r => r[0] === d) || [])[1];
    step('гентамицин — назначено, не «введено»', st('гентамицин') === 'prescribed');
    step('ампициллин — введено в 07:50', r2.some(r => r[0] === 'ампициллин' && r[1] === 'administered' && r[3] === '2026-01-14 07:50'));
    step('метронидазол — указание не вводить', st('метронидазол') === 'withheld');
    step('цефотаксим и амикацин — «не определён» с пояснением', st('цефотаксим') === 'unknown' && st('амикацин') === 'unknown' && r2.filter(r => r[1] === 'unknown').every(r => /не определён.*нескольк/.test(r[2])));
    step('ванкомицин — начато, без времени введения', r2.some(r => r[0] === 'ванкомицин' && r[1] === 'started' && r[3] === '—'));
    step('ни один препарат не показан как введённый, кроме ампициллина', r2.filter(r => r[1] === 'administered').map(r => r[0]).join() === 'ампициллин');
    step('без ошибок страницы и сетевых обращений', errs.length === 0);
  } finally { await b.close(); }
  const ok = res.filter(Boolean).length; console.log(`этап 8, препараты в браузере: ${ok}/${res.length}`); process.exit(ok === res.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
