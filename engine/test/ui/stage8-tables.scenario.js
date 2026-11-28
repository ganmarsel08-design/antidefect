// Этап 8, ревью 2177b19 — браузер: табличные элементы подтверждаются/отклоняются поэлементно; наблюдения ИВЛ/FiO2
// из таблиц показаны отдельно, вне случая. Только синтетические данные.
'use strict';
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const URL = 'file://' + path.resolve(__dirname, '..', '..', 'expert.html');
const res = []; const step = (n, ok) => { res.push(ok); console.log((ok ? 'ok   ' : 'FAIL ') + n); };
const TEXT = 'Газы артериальной крови\nВремя забора | pH | pCO2, мм рт. ст.\n14.01.2026 08:00 | 7,31 | 52\n14.01.2026 14:00 | 7,38 | 41\n\nИВЛ\nДата/время | Режим | PIP | PEEP | FiO2\n14.01.2026 08:00 | SIMV | 20 | 6 | 0,40\n14.01.2026 14:00 | SIMV | 18 | 6 | 0,30';
(async () => {
  const b = await chromium.launch(Object.assign({ args: ['--no-sandbox'] }, process.env.CHROME ? { executablePath: process.env.CHROME } : {}));
  try {
    const p = await b.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.route('**/*', r => /^(file|blob|data):/.test(r.request().url()) ? r.continue() : (errs.push('СЕТЬ'), r.abort()));
    await p.goto(URL);
    await p.fill('#text', TEXT);
    await p.check('#synth'); await p.fill('#tz', '+05:00'); await p.check('.prot[value="РДС"]'); await p.click('#go');
    const bg = await p.waitForSelector('tr[data-c]:has(.code:text-is("blood_gases"))').then(() => 'tr[data-c]:has(.code:text-is("blood_gases"))');
    step('газы: два табличных элемента, у каждого «подтвердить» и «отклонить»', (await p.$$(bg + ' [data-time-elem]')).length === 2 && (await p.$$(bg + ' [data-time-elem-reject]')).length === 2);
    step('подпись: «строка таблицы верна»', /строка таблицы верна/.test(await p.textContent(bg + ' .elem')));
    step('без решений — кнопка недоступна', await p.isDisabled(bg + ' button[data-act="ok"]'));
    await p.check(bg + ' [data-time-elem$=":0"]'); await p.fill(bg + ' [data-time-elem-reason$=":0"]', 'лист КОС 08:00');
    await p.check(bg + ' [data-time-elem-reject$=":1"]');
    step('отклонение без причины — кнопка недоступна', await p.isDisabled(bg + ' button[data-act="ok"]'));
    await p.check(bg + ' [data-time-elem$=":1"]');
    await p.fill(bg + ' [data-time-elem-reason$=":1"]', 'проба венозная');
    step('элемент и подтверждён, и отклонён — кнопка недоступна', await p.isDisabled(bg + ' button[data-act="ok"]'));
    await p.uncheck(bg + ' [data-time-elem$=":1"]');
    step('один подтверждён, один отклонён с причиной — доступно', !(await p.isDisabled(bg + ' button[data-act="ok"]')));
    await p.click(bg + ' button[data-act="ok"]');
    step('список подтверждён', (await p.textContent(bg + ' .st')) === 'подтверждено');
    step('изменения ИВЛ по разнице строк не стали сведением', !(await p.$('tr[data-c]:has(.code:text-is("vent_changes"))')));
    const obs = await p.$$('[data-test="table-obs"] tr[data-obs]');
    step('наблюдения ИВЛ/FiO2 из таблицы показаны отдельно (2 строки)', obs.length === 2);
    step('изменение PIP показано как интервал, время действия неизвестно', /PIP: 20 → 18 в интервале 08:00 … 2026-01-14 14:00/.test(await p.textContent('[data-test="table-obs"] [data-change="PIP"]')) && /время действия врача неизвестно/.test(await p.textContent('[data-test="table-obs"]')));
    step('без ошибок страницы и сетевых обращений', errs.length === 0);
  } finally { await b.close(); }
  const ok = res.filter(Boolean).length; console.log(`этап 8, таблицы в браузере: ${ok}/${res.length}`); process.exit(ok === res.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
