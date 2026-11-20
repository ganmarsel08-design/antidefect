// Этап 7 — сценарий в браузере для engine/expert.html (четыре экрана). Только синтетические данные.
// Запуск: PLAYWRIGHT=<путь к playwright> [CHROME=<путь к Chrome>] node engine/test/ui/expert.scenario.js
// Любой сетевой запрос, ошибка страницы или несовпадение — код выхода 1.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const URL = 'file://' + path.join(ROOT, 'engine/expert.html');
const TE = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine/test/fixtures/stage7/stage7-engine-technical.json'), 'utf8'));
const results = [];
const step = (name, ok) => { results.push([name, ok]); console.log((ok ? 'ok   ' : 'FAIL ') + name); };

async function open(b) {
  const p = await b.newPage({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console ' + m.text()); });
  await p.route('**/*', r => { const u = r.request().url(); if (/^(file|blob|data):/.test(u)) r.continue(); else { errs.push('СЕТЬ ' + u); r.abort(); } });
  await p.goto(URL);
  return { p, errs };
}
async function start(p, sample) { await p.selectOption('#sample', sample); await p.check('#synth'); await p.click('#go'); }
const tab = (p, n) => p.click(`nav button[data-s="${n}"]`);
async function confirmAll(p) {
  for (const g of await p.$$eval('button[data-bulk]', bs => bs.map(b => b.dataset.bulk))) { const b = await p.$(`button[data-bulk="${g}"]`); if (b && await b.isEnabled()) await b.click(); }
  for (;;) {
    const id = await p.evaluate(() => { const tr = [...document.querySelectorAll('tr[data-c]')].find(t => t.querySelector('.st').textContent === 'не подтверждено' && !t.querySelector('button[data-act="ok"]').disabled); return tr ? tr.dataset.c : null; });
    if (!id) break;
    await p.click(`tr[data-c="${id}"] button[data-act="ok"]`);
  }
}
const cardLabels = p => p.$$eval('.card', cs => cs.map(c => [c.dataset.rule, c.querySelector('[data-label]').dataset.label]));

(async () => {
  const b = await chromium.launch(Object.assign({ args: ['--no-sandbox'] }, process.env.CHROME ? { executablePath: process.env.CHROME } : {}));
  try {
    // ── РДС-01: проверки экрана 1, частичный анализ, полная проверка, устаревание, правка, выгрузка
    {
      const { p, errs } = await open(b);
      await p.selectOption('#sample', 'СИН-РДС-01'); await p.click('#go');
      step('экран 1: без подтверждения «текст синтетический» извлечение не запускается', /синтетический/.test(await p.textContent('#goerr')) && await p.isVisible('#s1'));
      await p.check('#synth'); await p.fill('#tz', '5:00'); await p.click('#go');
      step('экран 1: неверный часовой пояс отклоняется', /часовой пояс/.test(await p.textContent('#goerr')));
      await p.fill('#tz', '+05:00'); await p.click('#go');
      step('экран 2: найдено 34 сведения', /Найдено: 34 · решено 0 из 34/.test(await p.textContent('#cnt')));
      await p.click('#prev');
      step('частичный анализ при 0 подтверждённых: предупреждение, «соответствий» нет', /Частичный анализ: результаты построены по 0/.test(await p.textContent('#partial3')) && (await cardLabels(p)).every(([, l]) => l !== 'соответствие'));
      await tab(p, 4);
      step('сводка при частичной проверке: выгрузка закрыта', await p.isDisabled('#exp') && /0/.test(await p.textContent('[data-kpi="соответствие"] b')));
      await tab(p, 2);
      step('карточки не помечены устаревшими до правок', await p.isHidden('#stale'));
      await confirmAll(p);
      step('после решения по всем сведениям «Завершить» доступно, полоса полной проверки', await p.isEnabled('#fin') && /завершена/.test(await p.textContent('#mode')));
      step('журнал: групповые и индивидуальные подтверждения записаны', await p.$$eval('#jr div', ds => ds.some(d => /групповое подтверждение/.test(d.textContent)) && ds.some(d => /подтверждено · cpap_pressure_cmh2o/.test(d.textContent))));
      await tab(p, 3);
      step('после подтверждений карточки помечены устаревшими', await p.isVisible('#stale'));
      await p.click('#recalc');
      const ref = TE.histories.find(h => h.id === 'СИН-РДС-01');
      step('после пересчёта: результаты = технический эталон РДС-01', JSON.stringify(await cardLabels(p)) === JSON.stringify(ref.shown_by_default.map(r => [r.rule_id, r.label])) && await p.isHidden('#stale'));
      await tab(p, 4);
      step('замечание 1: после расчёта по полной проверке выгрузка разрешена', await p.isEnabled('#exp'));
      await tab(p, 2);
      await p.click('tr[data-field="surfactant_initial_dose_mg_kg"] button[data-act="ed"]');
      await p.fill('tr[data-field="surfactant_initial_dose_mg_kg"] .vcell input', '100');
      await p.click('tr[data-field="surfactant_initial_dose_mg_kg"] .vcell button');
      await tab(p, 4);
      step('замечание 1: доза изменена после расчёта — выгрузка запрещена, причина показана', await p.isDisabled('#exp') && /изменены после последнего расчёта/.test(await p.textContent('#expn')));
      await p.evaluate(() => document.getElementById('exp').click());
      await tab(p, 3);
      step('замечание 1: карточки помечены устаревшими', await p.isVisible('#stale'));
      await p.click('#recalc');
      step('замечание 1: после пересчёта RDS-009 — неоднозначность, выгрузка снова разрешена', (await cardLabels(p)).find(([r]) => r === 'RDS-009')[1] === 'неоднозначность' && await p.isEnabled('#exp'));
      // 4. комментарий и обоснования
      await p.fill('.card[data-rule="RDS-001"] [data-comment="RDS-001"]', 'Проверить давление СРАР по реанимационной карте'); await p.press('.card[data-rule="RDS-001"] [data-comment="RDS-001"]', 'Tab');
      await p.fill('[data-jtext="RDS-006"]', 'Отсрочено на 60 секунд по состоянию'); await p.fill('[data-jfrag="RDS-006"]', 'пуповина пережата через 60 секунд'); await p.click('[data-jsave="RDS-006"]');
      step('замечание 4: фрагмент обоснования привязан к тексту истории', /Привязан фрагмент истории \(позиция \d+\)/.test(await p.textContent('[data-jstatus="RDS-006"]')));
      await p.fill('[data-jtext="RDS-010"]', 'Газы контролировались'); await p.fill('[data-jfrag="RDS-010"]', 'PaCO2'); await p.click('[data-jsave="RDS-010"]');
      step('неоднозначный фрагмент (встречается несколько раз) не выдаётся за установленный источник', /встречается в истории \d+ раз — место однозначно не установлено/.test(await p.textContent('[data-jstatus="RDS-010"]')));
      await p.fill('[data-jtext="RDS-004"]', 'Со слов старшей акушерки'); await p.fill('[data-jfrag="RDS-004"]', 'такого текста в истории нет'); await p.click('[data-jsave="RDS-004"]');
      step('замечание 4: несуществующий фрагмент не привязывается', /не найден/.test(await p.textContent('[data-jstatus="RDS-004"]')));
      await p.fill('[data-jfrag="RDS-004"]', ''); await p.click('[data-jsave="RDS-004"]');
      step('замечание 4: ручное обоснование помечено как не связанное с документом', /введено вручную/.test(await p.textContent('[data-jstatus="RDS-004"]')));
      await tab(p, 2);
      await p.click('tr[data-field="cpap_pressure_cmh2o"] button[data-act="ed"]');
      await p.fill('tr[data-field="cpap_pressure_cmh2o"] .vcell input', '5');
      await p.click('tr[data-field="cpap_pressure_cmh2o"] .vcell button');
      step('исправление записано в журнал (было → стало)', await p.$$eval('#jr div', ds => ds.some(d => /исправлено · cpap_pressure_cmh2o · 6 → 5/.test(d.textContent))));
      await tab(p, 3);
      step('после реальной правки — «устарело»', await p.isVisible('#stale'));
      await p.click('#recalc');
      step('пересчёт: RDS-001 — предварительное отличие', (await cardLabels(p)).find(([r]) => r === 'RDS-001')[1] === 'предварительное отличие');
      await tab(p, 2);
      await p.click('tr[data-field="fio2"] button[data-act="rej"]');
      await tab(p, 3); await p.click('#recalc');
      step('отклонённое значение не передаётся: FiO2 исчез из данных карточки RDS-003', !(await p.textContent('.card[data-rule="RDS-003"]')).includes('fio2 ='));
      await tab(p, 4);
      const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exp')]);
      const body = fs.readFileSync(await dl.path(), 'utf8');
      console.log('   файл:', dl.suggestedFilename(), '|', body.slice(0, 160).replace(/\n/g, ' '));
      step('выгрузка черновика: «ПРЕДВАРИТЕЛЬНО», без окончательного вывода', /PREDVARITELNO.*\.doc$/.test(dl.suggestedFilename()) && /ПРЕДВАРИТЕЛЬНО — черновик, не экспертное заключение/.test(body) && /Окончательный вывод программа не формирует/.test(body));
      step('замечание 4: в выгрузке комментарий, обоснование с фрагментом и ручное обоснование с предупреждением',
        /Проверить давление СРАР по реанимационной карте/.test(body) && /Отсрочено на 60 секунд по состоянию.*Фрагмент истории \(позиция \d+\): «пуповина пережата через 60 секунд»/s.test(body)
        && /Со слов старшей акушерки.*обоснование введено вручную и не связано с документом/s.test(body));
      step('в выгрузке неоднозначная привязка помечена, позиция не выдаётся за источник', /Газы контролировались.*встречается в документе \d+ раз — место в истории однозначно не установлено/s.test(body) && !/Фрагмент истории \(позиция \d+\): «PaCO2»/.test(body));
      step('замечание 1: выгружен пересчитанный результат (RDS-009 — неоднозначность, RDS-001 — отличие)', /<td>RDS-009<\/td><td>неоднозначность<\/td>/.test(body) && /<td>RDS-001<\/td><td>предварительное отличие<\/td>/.test(body));
      step('выгрузка документа, прочитанного полностью, не содержит предупреждения о неполном чтении', !/ПРОЧИТАН НЕ ПОЛНОСТЬЮ/.test(body));
      step('РДС-01: нет ошибок и сетевых запросов', errs.length === 0 || (console.log(errs), false));
      await p.close();
    }
    // ── НЭК-03: динамика пассажа, ограничение движка, выбор врача
    {
      const { p, errs } = await open(b);
      await start(p, 'СИН-НЭК-03');
      const lim = await p.textContent('[data-alt="gi_passage_restored"]');
      step('НЭК-03: показано ограничение движка и альтернативный результат NEC-003', /Ограничение текущего движка/.test(lim) && /NEC-003 — неприменимо/.test(lim));
      step('НЭК-03: подтвердить без выбора нельзя', await p.isDisabled('tr[data-field="gi_passage_restored"] button[data-act="ok"]'));
      await confirmAll(p);
      step('НЭК-03: без выбора проверка не завершена', await p.isDisabled('#fin'));
      await tab(p, 3);
      step('НЭК-03: в карточке NEC-003 — альтернативный результат', /при передаче «да» \(2026-06-10 16:00\) — неприменимо/.test(await p.textContent('.card[data-rule="NEC-003"]')));
      await tab(p, 2);
      await p.check('tr[data-field="gi_passage_restored"] input[type="radio"] >> nth=0');
      step('НЭК-03: выбор записан в журнал', await p.$$eval('#jr div', ds => ds.some(d => /выбор значения · gi_passage_restored/.test(d.textContent))));
      await p.click('tr[data-field="gi_passage_restored"] button[data-act="ok"]');
      await tab(p, 3); await p.click('#recalc');
      const A = TE.histories.find(h => h.id === 'СИН-НЭК-03').variants.A;
      step('НЭК-03 (выбор «нет», 08.06): результаты = технический эталон, вариант A', JSON.stringify(await cardLabels(p)) === JSON.stringify(A.shown_by_default.map(r => [r.rule_id, r.label])));
      step('НЭК-03: скрытых правил другого протокола — ' + A.hidden_cross_protocol_undetermined.count, (await p.textContent('#hc')) === String(A.hidden_cross_protocol_undetermined.count));
      await p.check('#showhidden');
      step('НЭК-03: кнопка раскрывает скрытые правила', (await p.$$('.card')).length === A.shown_by_default.length + A.hidden_cross_protocol_undetermined.count);
      step('НЭК-03: нет ошибок и сетевых запросов', errs.length === 0 || (console.log(errs), false));
      await p.close();
    }
    // ── СЕП-01: SEP-006 без постнатального возраста
    {
      const { p, errs } = await open(b);
      await start(p, 'СИН-СЕП-01');
      await confirmAll(p);
      await p.click('tr[data-field="postnatal_age_days"] button[data-act="rej"]');
      step('СЕП-01: подсказка — постнатальный возраст нужен для сверки с таблицей', await p.isVisible('[data-need="postnatal_age_days"]'));
      await tab(p, 3);
      const t = await p.textContent('.card[data-rule="SEP-006"]');
      step('СЕП-01: SEP-006 — неполная сверка, таблица не проверена', /соответствует проверенному фрагменту/.test(t) && /Возрастная таблица не проверена: отсутствует постнатальный возраст/.test(t));
      await tab(p, 2);
      await p.selectOption('#mfield', 'postnatal_age_days'); await p.fill('#mval', '0'); await p.click('#madd');
      await tab(p, 3); await p.click('#recalc');
      step('СЕП-01: возраст внесён врачом — предупреждения нет, CF-007 активен', !(await p.$('[data-warn="SEP-006"]')) && /Активный конфликт CF-007/.test(await p.textContent('.card[data-rule="SEP-006"]')));
      step('СЕП-01: нет ошибок и сетевых запросов', errs.length === 0 || (console.log(errs), false));
      await p.close();
    }
    // ── DOCX: СЕП-03
    {
      const { p, errs } = await open(b);
      await p.setInputFiles('#docx', { name: 'СИН-СЕП-03.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: fs.readFileSync(path.join(ROOT, 'engine/test/fixtures/stage7/docx/СИН-СЕП-03.docx')) });
      await p.waitForFunction(() => document.getElementById('text').value.length > 100);
      await p.check('.prot[value="Сепсис"]'); await p.check('#synth'); await p.click('#go');
      step('DOCX СЕП-03: прочитан полностью, найдено 29 сведений', /Найдено: 29/.test(await p.textContent('#cnt')) && !(await p.textContent('#docxwarn')));
      step('DOCX: нет ошибок и сетевых запросов', errs.length === 0 || (console.log(errs), false));
      await p.close();
    }
    // ── замечание 3: DOCX прочитан частично (надпись)
    {
      const JSZip = require(path.join(ROOT, 'engine/vendor/jszip/jszip.min.js'));
      const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
      const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const src = TE.histories && fs.readFileSync(path.join(ROOT, 'engine/test/fixtures/stage7/stage7-extraction-gold.json'), 'utf8');
      const text = JSON.parse(src).histories.find(h => h.id === 'СИН-СЕП-01').text;
      const z = new JSZip();
      z.file('word/document.xml', `<w:document ${W}><w:body>` + text.split('\n').map(l => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('') +
        '<w:p><w:r><w:pict><w:txbxContent><w:p><w:r><w:t>Текст в надписи</w:t></w:r></w:p></w:txbxContent></w:pict></w:r></w:p></w:body></w:document>');
      const buf = await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      const { p, errs } = await open(b);
      await p.setInputFiles('#docx', { name: 'partial.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: buf });
      await p.waitForFunction(() => document.getElementById('text').value.length > 100);
      await p.check('.prot[value="Сепсис"]'); await p.check('#synth'); await p.click('#go');
      step('замечание 3: экран 2 — извлечение неполное', /Извлечение неполное/.test(await p.textContent('#docxwarn')));
      await confirmAll(p);
      step('замечание 3: все сведения решены, но полной проверки нет', await p.isEnabled('#fin') && /прочитан НЕ полностью — это не полная проверка документа/.test(await p.textContent('#mode')));
      await tab(p, 3);
      step('замечание 3: предупреждение на экране карточек', await p.isVisible('#source3 [data-source-incomplete]'));
      await tab(p, 4);
      step('замечание 3: предупреждение на экране сводки', await p.isVisible('#source4 [data-source-incomplete]'));
      const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exp')]);
      const body = fs.readFileSync(await dl.path(), 'utf8');
      step('замечание 3: в выгрузке — «ИСХОДНЫЙ ДОКУМЕНТ ПРОЧИТАН НЕ ПОЛНОСТЬЮ», нет формулировки о полной проверке',
        /ИСХОДНЫЙ ДОКУМЕНТ ПРОЧИТАН НЕ ПОЛНОСТЬЮ: [^<]*надпись/.test(body) && /исходный документ прочитан НЕ полностью/.test(body) && !/исходный документ прочитан полностью/.test(body));
      step('замечание 3: нет ошибок и сетевых запросов', errs.length === 0 || (console.log(errs), false));
      await p.close();
    }
    // ── безопасность отображения
    {
      const { p, errs } = await open(b);
      await p.fill('#text', '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>\n13.04.2026 10:20 — вздутие. Подозрение на НЭК.');
      await p.check('.prot[value="НЭК"]'); await p.check('#synth'); await p.click('#go');
      step('текст документа выводится как текст, разметка не исполняется', (await p.evaluate(() => window.__xss)) === undefined && (await p.textContent('#src')).includes('<img src=x') && (await p.$$('#src img')).length === 0);
      step('безопасность: нет ошибок и сетевых запросов', errs.length === 0 || (console.log(errs), false));
      await p.close();
    }
  } finally { await b.close(); }
  const bad = results.filter(r => !r[1]);
  console.log(`\nэтап 7, браузер: ${results.length - bad.length}/${results.length}`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
