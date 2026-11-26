// Этап 8, ревью №15 — браузер: время записи подтверждается только явно, с основанием. Только синтетические данные.
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
    await p.fill('#text', '22.06.2026 08:30 — Подозрение на НЭК. Кормление прекращено в 08:40.\n22.06.2026 09:00 — Установлен назогастральный зонд.');
    await p.check('#synth'); await p.fill('#tz', '+05:00'); await p.check('.prot[value="НЭК"]'); await p.click('#go');
    const R = f => `tr[data-field="${f}"]`;
    await p.waitForSelector(R('enteral_feeding_stopped_at'));
    step('своё время события: подпись «время события», подтверждение доступно сразу',
      (await p.textContent(R('enteral_feeding_stopped_at') + ' [data-basis]')).startsWith('время события') && !(await p.isDisabled(R('enteral_feeding_stopped_at') + ' button[data-act="ok"]')));
    const ng = R('ng_tube_placed_at');
    step('время записи: подпись «время записи врача», подтверждение недоступно', (await p.textContent(ng + ' [data-basis]')).startsWith('время записи врача') && await p.isDisabled(ng + ' button[data-act="ok"]'));
    await p.check(ng + ' [data-time-event]');
    step('отметка без основания — подтверждение всё ещё недоступно', await p.isDisabled(ng + ' button[data-act="ok"]'));
    await p.fill(ng + ' [data-time-reason]', 'в записи указано время установки зонда');
    step('отметка и основание — подтверждение доступно', !(await p.isDisabled(ng + ' button[data-act="ok"]')));
    await p.click(ng + ' button[data-act="ok"]');
    step('после явного подтверждения статус «подтверждено»', (await p.textContent(ng + ' .st')) === 'подтверждено');
    // ревью ae85d85: исправление времени записи на то же значение или без основания не принимается
    await p.goto(URL);
    await p.fill('#text', '22.06.2026 08:30 — Подозрение на НЭК. Кормление прекращено в 08:40.\n22.06.2026 09:00 — Установлен назогастральный зонд.');
    await p.check('#synth'); await p.fill('#tz', '+05:00'); await p.check('.prot[value="НЭК"]'); await p.click('#go');
    await p.waitForSelector(ng);
    await p.click(ng + ' button[data-act="ed"]');
    step('исправление времени записи: есть поле основания', await p.isVisible(ng + ' [data-edit-reason]'));
    await p.click(ng + ' button[data-act="save"]');
    step('то же значение — ошибка «не изменено», статус прежний', /не изменено/.test(await p.textContent(ng + ' .err')) && (await p.textContent(ng + ' .st')) === 'не подтверждено');
    await p.fill(ng + ' .vcell input:not([data-edit-reason])', '2026-06-22T08:55+05:00');
    await p.click(ng + ' button[data-act="save"]');
    step('новое значение без основания — ошибка, статус прежний', /основание/.test(await p.textContent(ng + ' .err')) && (await p.textContent(ng + ' .st')) === 'не подтверждено');
    await p.fill(ng + ' [data-edit-reason]', '   ');
    await p.click(ng + ' button[data-act="save"]');
    step('основание из пробелов — ошибка', /основание/.test(await p.textContent(ng + ' .err')) && (await p.textContent(ng + ' .st')) === 'не подтверждено');
    await p.fill(ng + ' [data-edit-reason]', 'лист наблюдения: зонд в 08:55');
    await p.click(ng + ' button[data-act="save"]');
    step('новое значение с основанием — «исправлено»', (await p.textContent(ng + ' .st')) === 'исправлено');
    // ревью цикла 16:30: список подтверждается поэлементно — своё время, своя цитата, своё основание
    await p.goto(URL);
    await p.fill('#text', '02.03.2026 08:00 — pH 7,31, PaCO2 48 мм рт. ст.\n02.03.2026 14:00 — pH 7,44, PaCO2 32 мм рт. ст.');
    await p.check('#synth'); await p.fill('#tz', '+05:00'); await p.check('.prot[value="РДС"]'); await p.click('#go');
    const bg = R('blood_gases');
    await p.waitForSelector(bg);
    step('список: два элемента, у каждого своё время и цитата, общего флажка нет',
      (await p.$$(bg + ' [data-time-elem]')).length === 2 && !(await p.$(bg + ' [data-time-event]')) &&
      /08:00.*pH 7,31/.test(await p.textContent(bg + ' [data-elem-at="2026-03-02T08:00+05:00"]')) && /14:00.*pH 7,44/.test(await p.textContent(bg + ' [data-elem-at="2026-03-02T14:00+05:00"]')));
    await p.check(bg + ' [data-time-elem$=":0"]'); await p.fill(bg + ' [data-time-elem-reason$=":0"]', 'лист газов 08:00');
    step('подтверждён один элемент из двух — кнопка недоступна', await p.isDisabled(bg + ' button[data-act="ok"]'));
    await p.check(bg + ' [data-time-elem$=":1"]'); await p.fill(bg + ' [data-time-elem-reason$=":1"]', '   ');
    step('второе основание из пробелов — кнопка недоступна', await p.isDisabled(bg + ' button[data-act="ok"]'));
    await p.fill(bg + ' [data-time-elem-reason$=":1"]', 'лист газов 14:00');
    step('оба элемента с основаниями — подтверждение доступно', !(await p.isDisabled(bg + ' button[data-act="ok"]')));
    await p.click(bg + ' button[data-act="ok"]');
    step('список подтверждён поэлементно', (await p.textContent(bg + ' .st')) === 'подтверждено');
    step('без ошибок страницы и сетевых обращений', errs.length === 0);
  } finally { await b.close(); }
  const ok = res.filter(Boolean).length; console.log(`этап 8, подтверждение времени в браузере: ${ok}/${res.length}`); process.exit(ok === res.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
