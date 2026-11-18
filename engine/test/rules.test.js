'use strict';
// Тесты применения базы правил (пилот) к синтетическим клиническим ситуациям.
// Запуск: node --test engine/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const E = require('../rules-engine.js');

const DB_PATH = path.join(__dirname, '..', '..', 'rules', 'pilot-rules.json');
const DB = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));
const run = (data, extra = {}, opt) => E.evaluate(DB, Object.assign({ synthetic: true, data }, extra), opt);
const res = (out, id) => out.results.find(r => r.rule_id === id);
const POSITIVE_OR_NEGATIVE = ['Соответствует протоколу', 'Обоснованное отклонение', 'Потенциальный дефект', 'Дефект', 'Не соответствует протоколу'];

function assertNotFinal(out) {
  assert.equal(out.final_conclusion, null);
  assert.ok(E.ALLOWED_STATUSES.includes(out.status), out.status);
  assert.ok(!POSITIVE_OR_NEGATIVE.includes(out.status));
  assert.ok(out.blocked_by.includes(E.BLOCK.RULES_UNAUTHENTICATED));
  for (const r of out.results) {
    assert.equal(r.final, false, r.rule_id);
    assert.equal(r.provisional, true, r.rule_id);
    assert.equal(r.expert_review_required, true, r.rule_id);
    assert.ok(r.blocked_by.includes(E.BLOCK.RULES_UNAUTHENTICATED), r.rule_id);
  }
}

test('база: 30 правил-кандидатов, по 10 на протокол, все с цитатой и страницей', () => {
  assert.equal(DB.rules.length, 30);
  for (const p of ['rds', 'nek', 'sepsis']) assert.equal(DB.rules.filter(r => r.protocol === p).length, 10);
  for (const r of DB.rules) {
    assert.equal(r.status, E.CANDIDATE);
    assert.equal(r.expert_confirmation, null);
    assert.ok(r.source.quotes.length >= 1 && r.source.quotes.every(q => q.text && Number.isInteger(q.page)));
  }
  assert.equal(DB.authenticated, false);
});

// --- РДС ---
test('РДС, 28 нед., СРАР с рождения 6 см H2O: совпадает, но итог — только оценка эксперта', () => {
  const out = run({ rds_risk: true, gestational_age_weeks: 28, cpap_from_birth: true, cpap_pressure_cmh2o: 6 }, {}, { protocols: ['rds'] });
  const r = res(out, 'RDS-001');
  assert.equal(r.applicability, 'применимо');
  assert.equal(r.observation, E.OBS.CONSISTENT);
  assert.equal(out.status, E.STATUS.EXPERT);
  assertNotFinal(out);
});

test('РДС, 28 нед., СРАР 5 см H2O: отличие — предварительно, не «дефект»', () => {
  const out = run({ rds_risk: true, gestational_age_weeks: 28, cpap_from_birth: true, cpap_pressure_cmh2o: 5 });
  const r = res(out, 'RDS-001');
  assert.equal(r.observation, E.OBS.DIFFERS);
  assert.match(r.observation_weight, /рекомендации/);
  assertNotFinal(out);
});

test('РДС: нет давления СРАР — «не оценено», поле указано как недостающее', () => {
  const r = res(run({ gestational_age_weeks: 27, cpap_from_birth: true }), 'RDS-001');
  assert.equal(r.applicability, 'применимо');
  assert.equal(r.observation, E.OBS.NOT_ASSESSED);
  assert.deepEqual(r.missing_data, ['cpap_pressure_cmh2o']);
});

test('РДС: 32 нед. без риска РДС — RDS-001 неприменимо', () => {
  assert.equal(res(run({ rds_risk: false, gestational_age_weeks: 32 }), 'RDS-001').applicability, 'неприменимо');
});

test('РДС: интубирован, сурфактант не введён, есть обоснование врача — наблюдение и обоснование передаются эксперту', () => {
  const just = { 'RDS-002': { text: 'Синтетика: интубация для транспортировки, РДС не подтверждён рентгенологически', author: 'врач-синтетик' } };
  const out = run({ rds_diagnosed: true, intubated: true, surfactant_given: false }, { justifications: just });
  const r = res(out, 'RDS-002');
  assert.equal(r.observation, E.OBS.DIFFERS);
  assert.equal(r.justification.author, 'врач-синтетик');
  assert.equal(r.justification_complete, true);
  assert.equal(out.summary.justifications_recorded, 1);
  assertNotFinal(out); // обоснование не превращается автоматически в «обоснованное отклонение»
});

test('РДС: обоснование без автора считается неполным', () => {
  const r = res(run({ rds_diagnosed: true, intubated: true, surfactant_given: false }, { justifications: { 'RDS-002': { text: 'есть текст' } } }), 'RDS-002');
  assert.equal(r.justification_complete, false);
});

test('РДС-003: ГВ ровно 26 нед. не попадает ни в одну ветку — неоднозначность показана врачу', () => {
  const r = res(run({ antenatal_steroids_given: true, intubation_needed_for_stabilization: false, gestational_age_weeks: 26, fio2: 0.45 }), 'RDS-003');
  assert.equal(r.applicability, 'неприменимо');
  assert.ok(r.ambiguities.some(a => /ровно 26/.test(a.text)));
  assert.ok(r.blocked_by.includes(E.BLOCK.AMBIGUOUS));
});

test('РДС-009: доза порактанта 100 мг/кг — отличие от рекомендации, уровень А взят из таблицы препаратов', () => {
  const r = res(run({ rds_diagnosed: true, surfactant_drug: 'порактант альфа', surfactant_initial_dose_mg_kg: 100 }), 'RDS-009');
  assert.equal(r.observation, E.OBS.DIFFERS);
  const rule = DB.rules.find(x => x.rule_id === 'RDS-009');
  assert.equal(rule.evidence_level.value, 'А');
  assert.equal(rule.evidence_level.source_page, 11);
});

test('РДС-010: порог гипокапнии в протоколе не задан — без отметки врача правило не оценивает', () => {
  const r = res(run({ mechanical_ventilation: true }), 'RDS-010');
  assert.equal(r.observation, E.OBS.NOT_ASSESSED);
  assert.equal(r.normativity, 'не_рекомендуется');
});

// --- НЭК ---
test('НЭК: подозрение — кормление прекращено, зонд, пупочный катетер удалён — совпадает', () => {
  const out = run({ nec_suspected: true, enteral_feeding_stopped: true, ng_tube_decompression: true, umbilical_catheter_present: true, umbilical_catheter_removed: true }, {}, { protocols: ['nek'] });
  assert.equal(res(out, 'NEC-001').observation, E.OBS.CONSISTENT);
  assert.equal(res(out, 'NEC-002').observation, E.OBS.CONSISTENT);
  assertNotFinal(out);
});

test('НЭК II: кормление на 5-е сутки, антибиотики 8 суток без метронидазола — три отличия, итог не «дефект»', () => {
  const out = run({ nec_stage: '2б', enteral_feeding_resumed_day: 5, antibiotics_started: true, antibiotic_days: 8, metronidazole_given: false });
  for (const id of ['NEC-004', 'NEC-007', 'NEC-008']) assert.equal(res(out, id).observation, E.OBS.DIFFERS, id);
  assertNotFinal(out);
});

test('НЭК 2а в организации 2-го уровня: консультация есть, перевода нет — противоречие п. 5.1 показано', () => {
  const out = run({ nec_stage: '2а', facility_level: 2, surgeon_consulted: true, transferred_to_surgery: false });
  assert.equal(res(out, 'NEC-009').observation, E.OBS.CONSISTENT);
  assert.equal(res(out, 'NEC-010').observation, E.OBS.DIFFERS);
  assert.ok(out.conflicts.some(c => c.rules.includes('NEC-009') && c.rules.includes('NEC-010')));
});

test('НЭК: при ухудшении снимок не вертикально — отличие; без ухудшения горизонтальный допустим', () => {
  const bad = res(run({ nec_stage: '2а', xray_48h_after_diagnosis: true, clinical_deterioration: true, xray_vertical_or_lateral_at_deterioration: false }), 'NEC-006');
  const ok = res(run({ nec_stage: '2а', xray_48h_after_diagnosis: true, clinical_deterioration: false }), 'NEC-006');
  assert.equal(bad.observation, E.OBS.DIFFERS);
  assert.equal(ok.observation, E.OBS.CONSISTENT);
});

// --- Сепсис ---
test('Сепсис: признак «Красный флаг», антибиотик через 45 мин — совпадает; через 90 мин — отличие от рекомендации', () => {
  const a = res(run({ red_flag_count: 1, antibiotics_started: true, antibiotics_start_minutes: 45 }), 'SEP-001');
  const b = res(run({ red_flag_count: 1, antibiotics_started: true, antibiotics_start_minutes: 90 }), 'SEP-001');
  assert.equal(a.observation, E.OBS.CONSISTENT);
  assert.equal(b.observation, E.OBS.DIFFERS);
  assert.equal(b.normativity, 'рекомендуется');
});

test('Сепсис: один фактор риска без «Красного флага» — SEP-001 неприменимо', () => {
  assert.equal(res(run({ red_flag_count: 0, risk_factor_or_sign_count: 1 }), 'SEP-001').applicability, 'неприменимо');
});

test('Сепсис: положительный посев, 7 суток — SEP-010 совпадает, SEP-009 (10 суток) отличается; противоречие показано', () => {
  const out = run({ antibiotics_started: true, improving: true, blood_culture_result: 'положительный', antibiotic_days: 7 });
  assert.equal(res(out, 'SEP-010').observation, E.OBS.CONSISTENT);
  assert.equal(res(out, 'SEP-009').observation, E.OBS.DIFFERS);
  assert.ok(out.conflicts.some(c => c.rules.join() === 'SEP-009,SEP-010'));
  assertNotFinal(out);
});

test('Сепсис: улучшение, посев отрицательный, без факторов высокого риска, 4 суток — SEP-008 совпадает', () => {
  const out = run({ antibiotics_started: true, improving: true, blood_culture_result: 'отрицательный', high_risk_factors: false, antibiotic_days: 4 });
  assert.equal(res(out, 'SEP-008').observation, E.OBS.CONSISTENT);
  assert.equal(res(out, 'SEP-010').applicability, 'неприменимо');
});

test('Сепсис: иммуноглобулин без отдельного показания — «не рекомендуется», отличие', () => {
  const r = res(run({ sepsis_suspected: true, immunoglobulin_given: true, immunoglobulin_indication_documented: false }), 'SEP-003');
  assert.equal(r.observation, E.OBS.DIFFERS);
  assert.equal(r.kind, 'ограничение');
  assert.match(r.observation_weight, /не рекомендует/);
});

test('Сепсис: бензилпенициллин 25 мг/кг каждые 8 ч при очень тяжёлом состоянии — допускается оговоркой', () => {
  const r = res(run({ early_onset_sepsis_suspected: true, benzylpenicillin_given: true, benzylpenicillin_dose_mg_kg: 25, benzylpenicillin_interval_h: 8, very_severe_condition: true }), 'SEP-005');
  assert.equal(r.observation, E.OBS.CONSISTENT);
});

test('Сепсис: доза гентамицина 4 мг/кг — отличие; неоднозначность доз (сепсис/НЭК) показана', () => {
  const r = res(run({ early_onset_sepsis_suspected: true, gentamicin_given: true, gentamicin_initial_dose_mg_kg: 4 }), 'SEP-006');
  assert.equal(r.observation, E.OBS.DIFFERS);
  assert.ok(r.ambiguities.some(a => /НЭК/.test(a.text)));
});

// --- защита итогового вывода ---
test('пустой случай: «Недостаточно данных», ни одного положительного или отрицательного вывода', () => {
  const out = run({});
  assert.equal(out.status, E.STATUS.INSUFFICIENT);
  assert.equal(out.summary.consistent_literal + out.summary.differs_literal, 0);
  assertNotFinal(out);
});

test('подделка: база помечена authenticated, правило «подтверждено» с записью эксперта — вывод всё равно не окончательный', () => {
  const db = clone(DB);
  db.authenticated = true;
  const r = db.rules.find(x => x.rule_id === 'RDS-001');
  r.status = 'подтверждено экспертом';
  r.expert_confirmation = { by: 'эксперт-синтетик', at: '2026-11-18' };
  const out = E.evaluate(db, { synthetic: true, data: { rds_risk: true, gestational_age_weeks: 28, cpap_from_birth: true, cpap_pressure_cmh2o: 6 } });
  assert.equal(out.rules_db.authenticated, false);
  assert.equal(out.rules_db.declared_authenticated, true);
  assert.equal(res(out, 'RDS-001').observation, E.OBS.CONSISTENT);
  assertNotFinal(out);
});

test('подделка: статус правила изменён без записи эксперта — правило не используется', () => {
  const db = clone(DB);
  db.rules.find(x => x.rule_id === 'NEC-001').status = 'подтверждено';
  const r = res(E.evaluate(db, { synthetic: true, data: { nec_suspected: true, enteral_feeding_stopped: false, ng_tube_decompression: false } }), 'NEC-001');
  assert.equal(r.observation, E.OBS.RULE_REJECTED);
  assert.ok(r.blocked_by.includes(E.BLOCK.RULE_STATUS_INVALID));
});

test('попытка передать итог через входные данные игнорируется', () => {
  const out = run({ rds_diagnosed: true, intubated: true, surfactant_given: true }, { final_conclusion: 'Соответствует протоколу', status: 'Соответствует протоколу' });
  assertNotFinal(out);
});

test('класс «может применяться»: неприменённый вариант не считается отличием', () => {
  const db = clone(DB);
  const r = db.rules.find(x => x.rule_id === 'RDS-006');
  r.normativity = 'может_применяться';
  const x = res(E.evaluate(db, { synthetic: true, data: { gestational_age_weeks: 30, condition_allows_delayed_clamping: true, cord_clamp_delay_s: 10 } }), 'RDS-006');
  assert.equal(x.observation, E.OBS.NOT_APPLIED_ALLOWED);
});

test('только синтетические данные: без флага synthetic и с полем ФИО/ИИН — отказ', () => {
  assert.throws(() => E.evaluate(DB, { data: {} }), /синтетические/);
  assert.throws(() => E.evaluate(DB, { synthetic: true, data: { iin: '000000000000' } }), /персональных данных/);
  assert.throws(() => E.evaluate(DB, { synthetic: true, data: {}, patient: { ФИО: 'x' } }), /персональных данных/);
});

test('входные данные и база не изменяются', () => {
  const c = { synthetic: true, data: { nec_stage: '2а', antibiotics_started: true, antibiotic_days: 3 }, justifications: { 'NEC-008': { text: 't', author: 'a' } } };
  const before = JSON.stringify(c), dbBefore = JSON.stringify(DB);
  E.evaluate(DB, c);
  assert.equal(JSON.stringify(c), before);
  assert.equal(JSON.stringify(DB), dbBefore);
});

test('комплексный синтетический случай по трём протоколам: все результаты предварительные', () => {
  const out = run({
    gestational_age_weeks: 27, birth_weight_g: 900, rds_risk: true, rds_diagnosed: true, cpap_from_birth: true, cpap_pressure_cmh2o: 6,
    intubated: true, surfactant_given: true, antenatal_steroids_given: false, intubation_needed_for_stabilization: true, fio2: 0.5,
    surfactant_in_delivery_room: true, oxygen_given: true, oxygen_via_blender: true, oxygen_after_stabilization: true,
    spo2_target_low: 90, spo2_target_high: 95, condition_allows_delayed_clamping: true, cord_clamp_delay_s: 60,
    antibiotics_started: true, serious_bacterial_infection_excluded: false, blood_culture_before_antibiotics: true,
    sepsis_suspected: true, early_onset_sepsis_suspected: true, red_flag_count: 1, antibiotics_start_minutes: 40,
    empirical_regimen: 'ampicillin+gentamicin', gentamicin_given: true, gentamicin_initial_dose_mg_kg: 5, crp_18_24h_after_start: true,
    nec_suspected: true, nec_stage: '2а', enteral_feeding_stopped: true, ng_tube_decompression: true, parenteral_nutrition_started_day: 1,
    metronidazole_given: true, facility_level: 3
  });
  assert.ok(out.summary.consistent_literal >= 15, String(out.summary.consistent_literal));
  assertNotFinal(out);
});

test('evalNode: трёхзначная логика (нет данных ≠ «нет»)', () => {
  const m = new Set();
  assert.equal(E.evalNode({ any: [{ field: 'a', op: 'is_true' }, { field: 'b', op: 'is_true' }] }, { a: false }, m), null);
  assert.equal(E.evalNode({ any: [{ field: 'a', op: 'is_true' }, { field: 'b', op: 'is_true' }] }, { b: true }, new Set()), true);
  assert.equal(E.evalNode({ all: [{ field: 'a', op: 'is_true' }, { field: 'b', op: 'is_true' }] }, { a: false }, new Set()), false);
  assert.deepEqual([...m], ['b']);
});
