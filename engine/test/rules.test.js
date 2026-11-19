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

test('РДС-003: ГВ ровно 26 нед. не попадает ни в одну ветку — «Неоднозначность», а не «неприменимо»', () => {
  const r = res(run({ antenatal_steroids_given: true, intubation_needed_for_stabilization: false, gestational_age_weeks: 26, fio2: 0.45 }), 'RDS-003');
  assert.equal(r.observation, E.OBS.AMBIGUOUS_PENDING);
  assert.equal(r.observation_label, 'Неоднозначность — ожидает экспертного решения');
  assert.deepEqual(r.active_ambiguities, ['RDS-003-A1']);
  assert.equal(r.observation_weight, null);
});

test('РДС-009: сравнительное положение о порактанте не превращается в обязательную дозу (п. 5 замечаний)', () => {
  for (const dose of [100, 200]) {
    const r = res(run({ rds_diagnosed: true, surfactant_drug: 'порактант альфа', surfactant_initial_dose_mg_kg: dose }), 'RDS-009');
    assert.equal(r.observation, E.OBS.AMBIGUOUS_PENDING, String(dose));
    assert.equal(r.kind, 'сравнительное_положение');
    assert.equal(r.observation_weight, null);
  }
  const rule = DB.rules.find(x => x.rule_id === 'RDS-009');
  assert.notEqual(rule.normativity, 'обязательно');
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

test('НЭК II: без метронидазола — отличие; сроки кормления и антибиотиков — неоднозначность, без утверждения о нарушении', () => {
  const out = run({ nec_stage: '2б', enteral_feeding_resumed_day: 5, antibiotics_started: true, antibiotic_days: 8, metronidazole_given: false });
  assert.equal(res(out, 'NEC-007').observation, E.OBS.DIFFERS);
  assert.equal(res(out, 'NEC-004').observation, E.OBS.AMBIGUOUS_PENDING);
  assert.equal(res(out, 'NEC-008').observation, E.OBS.AMBIGUOUS_PENDING);
  assertNotFinal(out);
});

test('НЭК 1а: метронидазол не введён — неоднозначность «при любой стадии», а не отличие', () => {
  const r = res(run({ nec_stage: '1а', antibiotics_started: true, metronidazole_given: false }), 'NEC-007');
  assert.equal(r.observation, E.OBS.AMBIGUOUS_PENDING);
});

test('НЭК 2а: противоречие п. 5.1 показано как свойство протокола, NEC-010 — неоднозначность', () => {
  const out = run({ nec_stage: '2а', facility_level: 2, surgeon_consulted: true, transferred_to_surgery: false });
  assert.equal(res(out, 'NEC-009').observation, E.OBS.CONSISTENT);
  assert.equal(res(out, 'NEC-010').observation, E.OBS.AMBIGUOUS_PENDING);
  const cf = out.conflicts.find(c => c.id === 'CF-001');
  assert.ok(cf);
  assert.equal(cf.quotes.length, 3);
});

test('противоречие не выводится из разных результатов двух правил (п. 4 замечаний)', () => {
  // NEC-001 совпадает, NEC-002 отличается — это не противоречие протокола
  const out = run({ nec_suspected: true, enteral_feeding_stopped: true, ng_tube_decompression: true, umbilical_catheter_present: true, umbilical_catheter_removed: false }, {}, { protocols: ['nek'] });
  assert.equal(res(out, 'NEC-001').observation, E.OBS.CONSISTENT);
  assert.equal(res(out, 'NEC-002').observation, E.OBS.DIFFERS);
  assert.deepEqual(out.conflicts, []);
  // НЭК 2б: NEC-010 отличается, NEC-009 неприменимо — объявленное противоречие для 2а не показывается
  const b = run({ nec_stage: '2б', facility_level: 2, surgeon_consulted: true, transferred_to_surgery: false });
  assert.equal(res(b, 'NEC-010').observation, E.OBS.DIFFERS);
  assert.ok(!b.conflicts.some(c => c.id === 'CF-001'));
});

test('противоречие 2а показывается и тогда, когда оба правила выполнены', () => {
  const out = run({ nec_stage: '2а', facility_level: 2, surgeon_consulted: true, transferred_to_surgery: true });
  assert.ok(out.conflicts.some(c => c.id === 'CF-001'));
});

test('НЭК: при ухудшении снимок не вертикально — отличие; без ухудшения горизонтальный допустим', () => {
  const bad = res(run({ nec_stage: '2а', xray_48h_after_diagnosis: true, clinical_deterioration: true, xray_vertical_or_lateral_at_deterioration: false }), 'NEC-006');
  const ok = res(run({ nec_stage: '2а', xray_48h_after_diagnosis: true, clinical_deterioration: false }), 'NEC-006');
  assert.equal(bad.observation, E.OBS.DIFFERS);
  assert.equal(ok.observation, E.OBS.CONSISTENT);
});

// --- Сепсис ---
test('Сепсис-001: начало «в течение 1 часа» без точки отсчёта — неоднозначность при любом времени', () => {
  for (const m of [45, 90]) {
    const r = res(run({ red_flag_count: 1, antibiotics_started: true, antibiotics_start_minutes: m }), 'SEP-001');
    assert.equal(r.observation, E.OBS.AMBIGUOUS_PENDING, String(m));
    assert.equal(r.observation_weight, null);
  }
});

test('Сепсис-001: один фактор риска без «Красного флага» — неоднозначность прочтения, не «неприменимо»', () => {
  const r = res(run({ red_flag_count: 0, risk_factor_or_sign_count: 1 }), 'SEP-001');
  assert.equal(r.observation, E.OBS.AMBIGUOUS_PENDING);
  assert.deepEqual(r.active_ambiguities, ['SEP-001-A2']);
  assert.equal(res(run({ red_flag_count: 0, risk_factor_or_sign_count: 0 }), 'SEP-001').applicability, 'неприменимо');
});

test('Сепсис-009/010: 7 или 10 суток — ни одного отрицательного наблюдения о длительности (п. 1 замечаний)', () => {
  for (const days of [5, 7, 8, 10, 14]) {
    const out = run({ antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'положительный', meningitis: false, antibiotic_days: days });
    for (const id of ['SEP-009', 'SEP-010']) {
      const r = res(out, id);
      assert.equal(r.observation, E.OBS.AMBIGUOUS_PENDING, id + ' ' + days);
      assert.notEqual(r.observation, E.OBS.DIFFERS);
    }
    const cf = out.conflicts.find(c => c.id === 'CF-002');
    assert.ok(cf);
    assert.ok(cf.quotes.some(q => /продолжается10 дней/.test(q.text)) && cf.quotes.some(q => /в течение 7 дней/.test(q.text)));
    assertNotFinal(out);
  }
});

test('Сепсис-010: статус менингита неизвестен — «Недостаточно данных» (п. 2 замечаний)', () => {
  const r = res(run({ antibiotics_started: true, blood_culture_result: 'положительный', antibiotic_days: 7 }), 'SEP-010');
  assert.equal(r.observation, E.OBS.NOT_ASSESSED);
  assert.equal(r.observation_label, 'Недостаточно данных');
  assert.deepEqual(r.missing_data, ['meningitis']);
  assert.deepEqual(r.active_ambiguities, []);
});

test('Сепсис-010: при менингите правило неприменимо', () => {
  const r = res(run({ antibiotics_started: true, blood_culture_result: 'положительный', meningitis: true, antibiotic_days: 7 }), 'SEP-010');
  assert.equal(r.applicability, 'неприменимо');
});

test('Сепсис-008: ампициллин + гентамицин, улучшение, посев отрицательный, 4 суток — совпадает', () => {
  const out = run({ antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'отрицательный', high_risk_factors: false, antibiotic_days: 4 });
  assert.equal(res(out, 'SEP-008').observation, E.OBS.CONSISTENT);
  assert.equal(res(out, 'SEP-010').applicability, 'неприменимо');
});

test('Сепсис-008/009: другая схема — правило не переносится (п. 3 замечаний)', () => {
  for (const reg of ['benzylpenicillin+gentamicin', 'другое']) {
    const a = res(run({ antibiotics_started: true, empirical_regimen: reg, improving: true, blood_culture_result: 'отрицательный', high_risk_factors: false, antibiotic_days: 9 }), 'SEP-008');
    const b = res(run({ antibiotics_started: true, empirical_regimen: reg, improving: true, blood_culture_result: 'положительный', antibiotic_days: 3 }), 'SEP-009');
    assert.equal(a.applicability, 'неприменимо', reg);
    assert.equal(b.applicability, 'неприменимо', reg);
  }
  const unknown = res(run({ antibiotics_started: true, improving: true, blood_culture_result: 'отрицательный', high_risk_factors: false, antibiotic_days: 9 }), 'SEP-008');
  assert.equal(unknown.observation, E.OBS.NOT_ASSESSED);
  assert.deepEqual(unknown.missing_data, ['empirical_regimen']);
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

test('Сепсис: доза гентамицина 4 мг/кг без НЭК — отличие; при НЭК — неоднозначность доз и противоречие протоколов', () => {
  const r = res(run({ early_onset_sepsis_suspected: true, gentamicin_given: true, gentamicin_initial_dose_mg_kg: 4 }), 'SEP-006');
  assert.equal(r.observation, E.OBS.DIFFERS);
  const out = run({ early_onset_sepsis_suspected: true, gentamicin_given: true, gentamicin_initial_dose_mg_kg: 4, nec_stage: '2а' });
  assert.equal(res(out, 'SEP-006').observation, E.OBS.AMBIGUOUS_PENDING);
  assert.ok(out.conflicts.some(c => c.id === 'CF-005'));
});

test('РДС-001: 30 нед. без риска РДС — неоднозначность «до 30 недель»', () => {
  const r = res(run({ rds_risk: false, gestational_age_weeks: 30, cpap_from_birth: false }), 'RDS-001');
  assert.equal(r.observation, E.OBS.AMBIGUOUS_PENDING);
});

test('РДС-007: антибиотики при РДС — неоднозначность; расхождение с протоколом сепсиса — только без факторов риска и признаков', () => {
  const out = run({ rds_diagnosed: true, serious_bacterial_infection_excluded: false, antibiotics_started: false, red_flag_count: 0, risk_factor_or_sign_count: 0 });
  assert.equal(res(out, 'RDS-007').observation, E.OBS.AMBIGUOUS_PENDING);
  const cf = out.conflicts.find(c => c.id === 'CF-004');
  assert.deepEqual(cf.quotes.map(q => q.protocol), ['rds', 'sepsis']);
});

// --- ред. 3: RDS-003 — клиническая применимость (замечание 1) ---
test('RDS-003: доношенный без РДС и без риска, мать без стероидов — сурфактант не требуется', () => {
  const r = res(run({ rds_risk: false, rds_diagnosed: false, gestational_age_weeks: 39, antenatal_steroids_given: false, surfactant_in_delivery_room: false }), 'RDS-003');
  assert.equal(r.applicability, 'неприменимо');
  assert.notEqual(r.observation, E.OBS.DIFFERS);
});

test('RDS-003: интубация по иной причине (нет РДС и риска РДС) — сурфактант не требуется', () => {
  const r = res(run({ rds_risk: false, rds_diagnosed: false, gestational_age_weeks: 38, intubation_needed_for_stabilization: true, antenatal_steroids_given: true, surfactant_in_delivery_room: false }), 'RDS-003');
  assert.equal(r.applicability, 'неприменимо');
});

test('RDS-003: нет сведений о РДС/риске РДС — «Недостаточно данных», а не требование', () => {
  const r = res(run({ antenatal_steroids_given: false, surfactant_in_delivery_room: false }), 'RDS-003');
  assert.equal(r.observation, E.OBS.NOT_ASSESSED);
  assert.deepEqual(r.missing_data, ['rds_diagnosed', 'rds_risk']);
});

test('RDS-003: риск РДС + интубация для стабилизации без сурфактанта — предварительное отличие', () => {
  const r = res(run({ rds_risk: true, gestational_age_weeks: 29, intubation_needed_for_stabilization: true, antenatal_steroids_given: true, fio2: 0.25, surfactant_in_delivery_room: false }), 'RDS-003');
  assert.equal(r.observation, E.OBS.DIFFERS);
});

test('RDS-003: риск РДС, единственное основание — нет стероидов — неоднозначность, не требование', () => {
  const r = res(run({ rds_risk: true, gestational_age_weeks: 36, antenatal_steroids_given: false, intubation_needed_for_stabilization: false, fio2: 0.21, surfactant_in_delivery_room: false }), 'RDS-003');
  assert.equal(r.observation, E.OBS.AMBIGUOUS_PENDING);
  assert.deepEqual(r.active_ambiguities, ['RDS-003-A2']);
});

// --- ред. 3: условия противоречий (замечание 2) ---
const CF2_BASE = { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'положительный', meningitis: false, antibiotic_days: 7 };
const cfIds = out => out.conflicts.map(c => c.id);

test('CF-002: показывается, только когда выполнены условия обоих положений', () => {
  assert.ok(cfIds(run(CF2_BASE)).includes('CF-002'));
});

test('CF-002: менингит — не показывается', () => {
  assert.ok(!cfIds(run({ ...CF2_BASE, meningitis: true })).includes('CF-002'));
});

test('CF-002: статус менингита неизвестен — не показывается', () => {
  const d = { ...CF2_BASE }; delete d.meningitis;
  assert.ok(!cfIds(run(d)).includes('CF-002'));
});

test('CF-002: другая схема АБТ — не показывается', () => {
  for (const reg of ['benzylpenicillin+gentamicin', 'другое']) assert.ok(!cfIds(run({ ...CF2_BASE, empirical_regimen: reg })).includes('CF-002'), reg);
});

test('CF-002: без улучшения или при отрицательном посеве — не показывается', () => {
  assert.ok(!cfIds(run({ ...CF2_BASE, improving: false })).includes('CF-002'));
  assert.ok(!cfIds(run({ ...CF2_BASE, blood_culture_result: 'отрицательный', high_risk_factors: true })).includes('CF-002'));
});

test('CF-004: РДС с исключённой инфекцией — не показывается', () => {
  const out = run({ rds_diagnosed: true, serious_bacterial_infection_excluded: true, red_flag_count: 0, risk_factor_or_sign_count: 0 });
  assert.ok(!cfIds(out).includes('CF-004'));
  assert.equal(res(out, 'RDS-007').applicability, 'неприменимо');
});

test('CF-004: РДС с признаками/факторами риска инфекции — не показывается (антибиотики показаны по обоим протоколам)', () => {
  assert.ok(!cfIds(run({ rds_diagnosed: true, serious_bacterial_infection_excluded: false, red_flag_count: 1, risk_factor_or_sign_count: 0 })).includes('CF-004'));
  assert.ok(!cfIds(run({ rds_diagnosed: true, serious_bacterial_infection_excluded: false, red_flag_count: 0, risk_factor_or_sign_count: 2 })).includes('CF-004'));
});

test('CF-004: факторы риска не оценены — не показывается', () => {
  assert.ok(!cfIds(run({ rds_diagnosed: true, serious_bacterial_infection_excluded: false })).includes('CF-004'));
});

test('CF-005: НЭК и гентамицин без подозрения на ранний сепсис — не показывается (SEP-006 неприменимо)', () => {
  const out = run({ gentamicin_given: true, nec_stage: '2а', early_onset_sepsis_suspected: false, gentamicin_initial_dose_mg_kg: 3 });
  assert.equal(res(out, 'SEP-006').applicability, 'неприменимо');
  assert.ok(!cfIds(out).includes('CF-005'));
});

test('расхождение не показывается, если правило из его состава неприменимо, даже при истинном active_when', () => {
  const db = clone(DB);
  db.protocol_conflicts.find(c => c.id === 'CF-002').active_when = { field: 'blood_culture_result', op: 'eq', value: 'положительный' };
  const out = E.evaluate(db, { synthetic: true, data: { ...CF2_BASE, meningitis: true } });
  assert.ok(!cfIds(out).includes('CF-002'));
});

// --- ред. 3: CF-001 — неоднозначность маршрутизации (замечание 3) ---
test('CF-001: НЭК 2а — «Неоднозначность маршрутизации», не противоречие; сочетание действий допустимо', () => {
  for (const d of [
    { nec_stage: '2а', facility_level: 2, surgeon_consulted: true, transferred_to_surgery: true },
    { nec_stage: '2а', facility_level: 3, transferred_to_surgery: false },
    { nec_stage: '2а', facility_level: 2, surgeon_consulted: true, transferred_to_surgery: false }
  ]) {
    const out = run(d);
    const cf = out.conflicts.find(c => c.id === 'CF-001');
    assert.ok(cf, JSON.stringify(d));
    assert.equal(cf.type, 'неоднозначность_маршрутизации');
    assert.equal(cf.label, 'Неоднозначность маршрутизации — требуется экспертное толкование');
    assert.ok(!/^противоречие/i.test(cf.description));
    assert.match(cf.description, /могут сочетаться/);
    assert.notEqual(res(out, 'NEC-010').observation, E.OBS.DIFFERS);
    assertNotFinal(out);
  }
});

test('CF-001: НЭК 2б и 1б — неоднозначность маршрутизации не показывается', () => {
  assert.ok(!cfIds(run({ nec_stage: '2б', facility_level: 2, transferred_to_surgery: true })).includes('CF-001'));
  assert.ok(!cfIds(run({ nec_stage: '1б', facility_level: 2, surgeon_consulted: true })).includes('CF-001'));
});

test('обоснование врача сохраняется и при неоднозначности', () => {
  const just = { 'NEC-010': { text: 'Синтетика: консервативно в 3-м уровне, хирург осмотрел, перевод не потребовался', author: 'врач-синтетик' } };
  const r = res(run({ nec_stage: '2а', facility_level: 3, transferred_to_surgery: false }, { justifications: just }), 'NEC-010');
  assert.equal(r.observation, E.OBS.AMBIGUOUS_PENDING);
  assert.equal(r.justification_complete, true);
});

test('неоднозначность: ни при каком исходе не даёт отличия, веса или скрытого результата (п. 6 замечаний)', () => {
  const cases = [
    { nec_stage: '2б', enteral_feeding_resumed_day: 2, antibiotics_started: true, antibiotic_days: 1 },
    { nec_stage: '1а', gi_passage_restored: false, enteral_feeding_stopped: false },
    { rds_diagnosed: true, surfactant_drug: 'порактант альфа', surfactant_initial_dose_mg_kg: 50 },
    { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'положительный', meningitis: false, antibiotic_days: 2 }
  ];
  let seen = 0;
  for (const d of cases) {
    for (const r of run(d).results) {
      if (!r.active_ambiguities.length) continue;
      seen++;
      assert.equal(r.observation, E.OBS.AMBIGUOUS_PENDING, r.rule_id);
      assert.equal(r.observation_weight, null, r.rule_id);
      assert.ok(r.blocked_by.includes(E.BLOCK.AMBIGUITY_ACTIVE), r.rule_id);
      assert.ok(!JSON.stringify(r).includes(E.OBS.DIFFERS), r.rule_id);
    }
  }
  assert.ok(seen >= 4);
});

test('неоднозначность: «решение», вписанное в неподтверждённое правило, неоднозначность не снимает', () => {
  const db = clone(DB);
  const rule = db.rules.find(x => x.rule_id === 'SEP-009');
  rule.ambiguities[0].decision = 'принять 10 дней';
  const out = E.evaluate(db, { synthetic: true, data: { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'положительный', antibiotic_days: 7 } });
  assert.equal(res(out, 'SEP-009').observation, E.OBS.AMBIGUOUS_PENDING);
});

test('неоднозначность снимается только решением эксперта в подтверждённом правиле — и итог всё равно не окончательный', () => {
  const db = clone(DB);
  const rule = db.rules.find(x => x.rule_id === 'RDS-009');
  rule.status = 'подтверждено экспертом';
  rule.expert_confirmation = { by: 'эксперт-синтетик', at: '2026-11-19' };
  rule.ambiguities.forEach(a => { a.decision = 'синтетическое решение'; });
  const out = E.evaluate(db, { synthetic: true, data: { rds_diagnosed: true, surfactant_drug: 'порактант альфа', surfactant_initial_dose_mg_kg: 100 } });
  assert.equal(res(out, 'RDS-009').observation, E.OBS.DIFFERS);
  assertNotFinal(out);
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
  assert.ok(out.summary.consistent_literal >= 10, String(out.summary.consistent_literal));
  assert.ok(out.summary.ambiguous_pending_expert >= 1);
  assertNotFinal(out);
});

test('evalNode: трёхзначная логика (нет данных ≠ «нет»)', () => {
  const m = new Set();
  assert.equal(E.evalNode({ any: [{ field: 'a', op: 'is_true' }, { field: 'b', op: 'is_true' }] }, { a: false }, m), null);
  assert.equal(E.evalNode({ any: [{ field: 'a', op: 'is_true' }, { field: 'b', op: 'is_true' }] }, { b: true }, new Set()), true);
  assert.equal(E.evalNode({ all: [{ field: 'a', op: 'is_true' }, { field: 'b', op: 'is_true' }] }, { a: false }, new Set()), false);
  assert.deepEqual([...m], ['b']);
  const m2 = new Set();
  assert.equal(E.evalNode({ any: [{ field: 'a', op: 'is_true' }, { all: [{ field: 'b', op: 'is_true' }, { field: 'c', op: 'is_true' }] }] }, { a: true, b: false }, m2), true);
  assert.deepEqual([...m2], []);
});
