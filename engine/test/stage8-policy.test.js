// Этап 8 — изменения поведения относительно этапа 7 (ревью ChatGPT к PR №13) и сценарий ручного ввода врачом.
// Неизменённые тесты этапа 7 запускаются отдельно как контроль: engine/test/tools/stage7-control.js.
// Только синтетические данные.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const X = require('../extract/extract.js');
const CB = require('../case-builder.js');
const V = require('../expert-view.js');
const RulesEngine = require('../rules-engine.js');
const Derive = require('../derive.js');
const db = require('../../rules/pilot-rules.json');
const ed = require('../../rules/expert-decisions.json');
const DIR = path.join(__dirname, 'fixtures/stage7');
const EX = JSON.parse(fs.readFileSync(path.join(DIR, 'stage7-extraction-gold.json'), 'utf8'));
const TE = JSON.parse(fs.readFileSync(path.join(DIR, 'stage7-engine-technical.json'), 'utf8'));
const env = { RulesEngine, Derive, db, expertDecisions: ed };
const TZ = '+05:00';
const get = (t, f) => X.extract(t, { tz: TZ }).candidates.find(c => c.field === f);

test('S8-1: «из периферической вены» не даёт separate_vein', () => {
  assert.equal(get('03.07.2026 08:25 — кровь на посев взята из периферической вены, 1,0 мл.', 'sample_site'), undefined);
  assert.equal(get('03.07.2026 08:25 — кровь на посев взята из отдельной периферической вены.', 'sample_site').value, 'separate_vein');
});

test('S8-2: «иммуноглобулин назначен» не даёт «введён»; «не назначался» не даёт «не введён»', () => {
  assert.equal(get('Иммуноглобулин назначен индивидуально.', 'immunoglobulin_given'), undefined);
  assert.equal(get('Иммуноглобулин не назначался.', 'immunoglobulin_given'), undefined);
  assert.equal(get('Иммуноглобулин не назначался и не вводился.', 'immunoglobulin_given').value, false);
  assert.equal(get('Иммуноглобулин не вводился.', 'immunoglobulin_given').value, false);
});

test('S8-3: доза в мг с явной единицей извлекается без «(N мг/кг)»; доза на кг по чужой массе не вычисляется', () => {
  const t = '20.09.2026 18:20 — масса 1,90 кг.\n21.09.2026 09:00 — назначено: гентамицин 7,6 мг в/в.';
  assert.equal(get(t, 'gentamicin_dose_mg').value, 7.6);
  assert.equal(get(t, 'gentamicin_initial_dose_mg_kg'), undefined);
  assert.equal(get('гента 7,6 в/в', 'gentamicin_dose_mg'), undefined);
});

// Сценарий ручного ввода. Значения ниже ВВОДИТ ВРАЧ (записаны в тесте явно, не берутся из эталона автоматически).
// Это проверка того, что движок даёт тот же технический результат при ручном вводе, — НЕ доказательство извлечения
// и не врачебное подтверждение спорного сведения.
const MANUAL = {
  'СИН-СЕП-01': [['sample_site', 'separate_vein', 'врач уточнил: периферическая вена — отдельная от катетера']],
  'СИН-СЕП-03': [['immunoglobulin_given', true, 'врач уточнил по листу введения: иммуноглобулин введён']],
};
const SIM = require('./tools/time-confirm-sim.js');
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 26, 3, 0, tick++)).toISOString();
function reviewAll(s) {
  // время записи / неизвестного типа врач подтверждает ЯВНО как время события, с основанием (сценарий, не доказательство)
  const T = { timeIsEvent: true, basisReason: 'врач: по записи это время события (синтетический сценарий)' };
  for (const it of s.items) if (CB.needsChoice(it.candidate)) CB.choose(s, it.candidate.id, 0);
  for (const it of s.items) if (it.candidate.critical && it.status === CB.STATUS.NEW) CB.confirm(s, it.candidate.id, CB.needsTimeConfirm(it) ? SIM.confirmOpts(it, T.basisReason) : undefined);
  for (const g of [...new Set(s.items.map(i => i.candidate.group))]) CB.confirmGroup(s, g);
}
for (const id of Object.keys(MANUAL)) {
  test(`ручной ввод врача ${id}: без него поле отсутствует; с ним движок = технический эталон этапа 7`, () => {
    const h = EX.histories.find(x => x.id === id), t = TE.histories.find(x => x.id === id);
    const s = CB.createSession({ extraction: X.extract(h.text, { tz: TZ, documentId: id }), actor: 'эксперт-тест', now });
    reviewAll(s);
    for (const [f] of MANUAL[id]) assert.ok(!(f in CB.build(s).case.data), `${f} не должно извлекаться автоматически`);
    for (const [f, v, reason] of MANUAL[id]) CB.addManual(s, f, v, { reason });
    const b = CB.build(s);
    assert.ok(s.journal.some(j => j.action === 'внесено врачом'), 'ручной ввод записан в журнал');
    assert.deepEqual(b.case.data, t.input);
    const v = V.view(env, b, [h.protocol]);
    assert.deepEqual(v.rules.map(r => [r.rule_id, r.label]), t.all_rules.map(r => [r.rule_id, r.label]));
    assert.equal(v.final_conclusion, null);
  });
}
