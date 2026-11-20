// Третий круг: проверка в браузере, что engine/derive.js и engine/rules-engine.js работают в странице
// и карточка эксперта отображает новые поля и подписи (CF-006, CF-007, Ед/кг, границы таблицы, длительность курса,
// RDS-008 «вычислено по отметкам / противоречие», SEP-009-A2, SEP-010 осмотр, RDS-003 «сведений нет»).
// engine/audit.html — интерфейс модуля отклонений (этап 4) и карточек базы правил не показывает; поэтому карточки
// рендерятся здесь в отдельной странице теми же модулями, что подключаются в браузере (window.RulesEngine).
// Запуск: PLAYWRIGHT=<путь к playwright> [CHROME=<путь к Chrome>] node engine/test/ui/rules-card.scenario.js
// Только синтетические данные.
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CASES = JSON.parse(read('engine/test/fixtures/cases-171.json')).cases;
const at = (d, hm) => `2026-01-${String(d).padStart(2, '0')}T${hm}+05:00`;
const pick = id => CASES.find(c => c.id === id);
const SCEN = [
  ['ТАБ-B5', 'SEP-005', pick('ТАБ-B5').data, ['Доза записана в Ед/кг: 50000 Ед/кг', 'CF-006, решает эксперт']],
  ['ТАБ-G4', 'SEP-006', pick('ТАБ-G4').data, ['для ГВ 27 нед и возраста 28 сут', 'на границе групп таблицы', 'CF-007, решает эксперт']],
  ['ТАБ-G9', 'SEP-006', pick('ТАБ-G9').data, ['35 недель и старше: 4 мг/кг каждые 24 часа']],
  ['RDS-008 противоречие', 'RDS-008', { antibiotics_started: true, blood_culture_before_antibiotics: true, blood_culture_drawn_at: at(1, '10:20'), first_abx_dose_administered_at: at(1, '10:00') }, ['противоречит отметкам забора крови']],
  ['RDS-003 сведений нет', 'RDS-003', { rds_risk: true, antenatal_steroids_given: false, surfactant_in_delivery_room: true }, ['отсутствие записи не считается «не потребовалась»']],
  ['SEP-009-A2', 'SEP-009', { antibiotics_started: true, empirical_regimen: 'benzylpenicillin+gentamicin', improving: true, blood_culture_result: 'положительный', meningitis: false }, ['вопрос SEP-009-A2 (информационно, без блокировки)']],
  ['SEP-010 осмотр', 'SEP-010', { antibiotics_started: true, meningitis: false, blood_culture_result: 'отрицательный', high_risk_factors: true, course_completed: true, abx_course_started_at: at(1, '10:00'), abx_course_ended_at: at(12, '10:00'), extension_reason: ['nec'] },
    ['о ежедневном клиническом осмотре нет записи', 'Длительность курса: 12 календарных сут, 264 ч', 'Указана причина продления']],
  ['ИСП-T13а', 'SEP-008', pick('ИСП-T13а').data, ['Расхождение способов подсчёта: 6 календарных сут, но 106,5 ч']],
];
(async () => {
  const b = await chromium.launch(Object.assign({ args: ['--no-sandbox'] }, process.env.CHROME ? { executablePath: process.env.CHROME } : {}));
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.setContent('<!doctype html><meta charset="utf-8"><body><main id="out"></main></body>');
  await p.addScriptTag({ content: read('engine/derive.js') });
  await p.addScriptTag({ content: read('engine/rules-engine.js') });
  await p.evaluate(([db, ed, scen]) => {
    const out = document.getElementById('out');
    for (const [name, rule, data] of scen) {
      const o = window.RulesEngine.evaluate(db, { synthetic: true, data }, { expert_decisions: ed });
      const r = o.results.find(x => x.rule_id === rule);
      const s = document.createElement('section'); s.dataset.case = name;
      const h = document.createElement('h2'); h.textContent = `${name} · ${rule} · ${r.card.observation_label} · ${r.active_ambiguities.join(', ')} · ${o.conflicts.map(c => c.id).join(', ')} · final=${o.final_conclusion}`;
      s.appendChild(h);
      for (const l of r.card.labels) { const li = document.createElement('p'); li.className = 'label'; li.textContent = l.text; s.appendChild(li); }
      for (const f of r.card.facts) { const li = document.createElement('p'); li.className = 'fact'; li.textContent = f.field + ': ' + (f.value === null ? '— ' + (f.reason || '') : JSON.stringify(f.value)); s.appendChild(li); }
      out.appendChild(s);
    }
  }, [JSON.parse(read('rules/pilot-rules.json')), JSON.parse(read('rules/expert-decisions.json')), SCEN.map(x => x.slice(0, 3))]);
  let ok = 0, bad = 0;
  for (const [name, , , texts] of SCEN) {
    const txt = await p.locator(`section[data-case="${name}"]`).innerText();
    const miss = texts.filter(t => !txt.includes(t));
    const final = /final=null/.test(txt);
    if (miss.length || !final) { bad++; console.log('НЕ ПОКАЗАНО', name, miss, final ? '' : 'final_conclusion не null'); } else { ok++; console.log('ok', name, '—', txt.split('\n')[0]); }
  }
  await p.screenshot({ path: require('os').tmpdir() + '/rules-card.png', fullPage: true });
  console.log(`карточек: ${ok} показаны верно, ${bad} с ошибками; ERRORS:`, errs);
  await b.close();
  process.exit(bad || errs.length ? 1 : 0);
})();
