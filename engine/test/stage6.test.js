'use strict';
// Этап 6 (rules-0.2): инварианты ТЗ §6, приёмочные тесты по правкам врача (§3), критические тесты §6,
// уточнения C1–C4, хронология (M2), «неизвестно» ≠ «нет» (M3), категории обоснования (M4), карточка (M5), комментарии (M6).
// Только синтетические данные.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const E = require('../rules-engine.js');
const D = require('../derive.js');

const ROOT = path.join(__dirname, '..', '..');
const DB = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'pilot-rules.json'), 'utf8'));
const ED = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'expert-decisions.json'), 'utf8'));
const BASE = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'build', 'baseline-2239c52.json'), 'utf8'));
const O = E.OBS;
const clone = x => JSON.parse(JSON.stringify(x));
const run = (data, just, opt, db) => E.evaluate(db || DB, { synthetic: true, data, justifications: just }, Object.assign({ expert_decisions: ED }, opt || {}));
const res = (o, id) => o.results.find(r => r.rule_id === id);
const ev = (id, data, just) => res(run(data, just), id);
const part = (r, id) => r.parts.find(p => p.part_id === id);
const cfs = o => o.conflicts.map(c => c.id);
const at = (d, hm) => `2026-01-${String(d).padStart(2, '0')}T${hm}+05:00`;
const J = (id, extra) => ({ [id]: Object.assign({ text: 'синтетическое обоснование', author: 'врач-синтетик' }, extra || {}) });
const COURSE = (d1, d2, extra) => Object.assign({ course_completed: true, abx_course_started_at: at(d1, '10:00'), abx_course_ended_at: at(d2, '10:00') }, extra || {});
const CONFIRMED = ['RDS-001', 'RDS-002', 'RDS-003', 'RDS-004', 'RDS-005', 'RDS-006', 'RDS-008', 'RDS-009'];
const NEW_BLOCKING = ['RDS-007-A2', 'RDS-010-A2', 'NEC-005-A1', 'NEC-006-A2', 'NEC-009-A1', 'NEC-010-A4', 'SEP-003-A2', 'SEP-006-A3'];
const COURSE_RUNNING = 'Курс продолжается. Окончательная длительность пока не оценивается';
const EXT_DOC = 'Продление документировано. Требуется экспертная оценка клинического обоснования';
const EXT_NF = 'Обоснование не найдено в доступной документации';
const labels = r => r.card.labels.map(l => l.text);
// Масса подтверждена на дату назначения: взвешивание 08:00, назначение 10:00 того же дня (уточнение 17:53).
const WT = drug => ({ weight_measured_at: at(1, '08:00'), [`${drug}_prescribed_at`]: at(1, '10:00') });

// =================== Инварианты (ТЗ §6) ===================
test('И1: 30 rule_id на месте; 22 правила исправлены, 8 подтверждённых не затронуты слоем правок', () => {
  const ids = DB.rules.map(r => r.rule_id);
  assert.deepEqual(ids, Object.keys(BASE.rules));
  assert.equal(DB.schema_version, 'rules-0.2');
  for (const r of DB.rules) {
    assert.equal(r.status, E.CANDIDATE, r.rule_id);
    assert.equal(r.expert_confirmation, null, r.rule_id);
    if (CONFIRMED.includes(r.rule_id)) assert.ok(!('revision' in r) && !('card_labels' in r) && !('display_fields' in r), r.rule_id);
    else assert.ok(r.revision && ['Утвердить', 'Изменить'].includes(r.revision.round2_decision), r.rule_id);
  }
  assert.deepEqual(DB.rules.filter(r => r.revision && r.revision.round2_decision === 'Изменить').map(r => r.rule_id), ['NEC-001', 'NEC-008', 'NEC-010', 'SEP-003', 'SEP-010']);
});

test('И1: восемь подтверждённых правил структурно совпадают с 2239c52 (побайтовая проверка — rules/test_build.py)', () => {
  for (const id of CONFIRMED) {
    const r = DB.rules.find(x => x.rule_id === id), b = BASE.rules[id];
    assert.deepEqual(r.applicability, b.applicability, id);
    assert.deepEqual(r.requirement, b.requirement, id);
    assert.deepEqual(r.source.quotes.map(q => ({ page: q.page, sha256: q.sha256 })), b.quotes, id);
    assert.deepEqual(r.ambiguities.map(a => { const o = {}; for (const k of ['id', 'blocking', 'scope', 'blocks_when']) if (k in a) o[k] = a[k]; return o; }), b.ambiguities, id);
  }
});

test('И1: исходные цитаты 22 правил не изменены и не удалены (новые — только добавлены)', () => {
  for (const r of DB.rules) {
    const b = BASE.rules[r.rule_id].quotes;
    assert.deepEqual(r.source.quotes.slice(0, b.length).map(q => ({ page: q.page, sha256: q.sha256 })), b, r.rule_id);
  }
});

test('И2: 17 блокировок этапа 5 — с прежними условиями; новых — ровно 8; CF-001–CF-005 без изменений', () => {
  const old = [], now = [];
  for (const [id, b] of Object.entries(BASE.rules)) for (const a of b.ambiguities) if (a.blocking !== 'no') old.push(a);
  assert.equal(old.length, 17);
  for (const a of old) {
    const r = DB.rules.find(x => a.id.startsWith(x.rule_id + '-'));
    const n = r.ambiguities.find(x => x.id === a.id);
    assert.ok(n, a.id);
    for (const k of ['blocking', 'scope', 'blocks_when']) assert.deepEqual(n[k], a[k], `${a.id}.${k}`);
  }
  for (const r of DB.rules) for (const a of r.ambiguities) if (a.blocking !== 'no') now.push(a.id);
  assert.equal(now.length, 25);
  assert.deepEqual(now.filter(id => !old.some(a => a.id === id)).sort(), NEW_BLOCKING.slice().sort());
  assert.deepEqual(ED.blocking_ambiguities.new_in_rules_0_2.slice().sort(), NEW_BLOCKING.slice().sort());
  for (const [id, b] of Object.entries(BASE.rules)) {
    const r = DB.rules.find(x => x.rule_id === id);
    for (const a of b.ambiguities) assert.equal(r.ambiguities.find(x => x.id === a.id).text !== undefined, true);
    assert.deepEqual(r.ambiguities.slice(0, b.ambiguities.length).map(a => a.id), b.ambiguities.map(a => a.id), id);
  }
  assert.deepEqual(DB.protocol_conflicts, BASE.protocol_conflicts);
  assert.ok(!DB.protocol_conflicts.some(c => c.id === 'CF-006'));
  assert.ok(!DB.rules.find(r => r.rule_id === 'SEP-010').ambiguities.some(a => a.id === 'SEP-010-A4'));
});

test('И2: RDS-007-A1, перенесённая в часть «начало», срабатывает ровно там же, где на 2239c52', () => {
  const oldRule = Object.assign(clone(DB.rules.find(r => r.rule_id === 'RDS-007')), {
    applicability: BASE.rules['RDS-007'].applicability, requirement: BASE.rules['RDS-007'].requirement });
  oldRule.ambiguities = oldRule.ambiguities.filter(a => a.id === 'RDS-007-A1').map(a => { const x = clone(a); delete x.part; return x; });
  const oldDb = Object.assign(clone(DB), { rules: [oldRule] });
  const V = [true, false, undefined];
  let n = 0;
  for (const rds of V) for (const sbi of V) for (const abx of V) {
    const d = {}; if (rds !== undefined) d.rds_diagnosed = rds; if (sbi !== undefined) d.serious_bacterial_infection_excluded = sbi; if (abx !== undefined) d.antibiotics_started = abx;
    const before = res(E.evaluate(oldDb, { synthetic: true, data: d }), 'RDS-007').active_ambiguities.includes('RDS-007-A1');
    const after = res(run(d), 'RDS-007').active_ambiguities.includes('RDS-007-A1');
    assert.equal(after, before, JSON.stringify(d)); n++;
  }
  assert.equal(n, 27);
});

const FORGED = { final_conclusion: 'Соответствует протоколу', status: 'Соответствует протоколу' };
test('И3: final_conclusion === null всегда — и при подделке базы, статуса правил и входных данных', () => {
  const db = clone(DB); db.authenticated = true;
  for (const r of db.rules) { r.status = 'подтверждено экспертом'; r.expert_confirmation = { by: 'эксперт-синтетик', at: '2026-11-19' }; r.ambiguities.forEach(a => { a.decision = 'синтетика'; }); }
  const cases = [{}, { nec_stage: '2а', antibiotics_started: true, ...COURSE(1, 11) }, { rds_diagnosed: true, serious_bacterial_infection_excluded: true, antibiotics_started: true, sbi_excluded_at: at(1, '10:00'), antibiotics_stopped_at: at(1, '18:00') }];
  for (const d of cases) for (const base of [DB, db]) {
    const o = E.evaluate(base, Object.assign({ synthetic: true, data: d }, FORGED), { expert_decisions: ED });
    assert.equal(o.final_conclusion, null);
    assert.ok(E.ALLOWED_STATUSES.includes(o.status));
    assert.equal(o.rules_db.authenticated, false);
    for (const r of o.results) { assert.equal(r.final, false); assert.equal(r.expert_review_required, true); assert.equal(r.card.expert_decision, null); }
  }
});

// Наборы данных, на которых правило «совпадает» (по одному на каждое исправленное правило, где это возможно).
const CONSISTENT_SETS = {
  // RDS-007 исключено из наборов (исправление этапа 6, п. 1): прежний набор — исключение ТБИ 10:00, отмена АБТ 09:00 —
  // закреплял ошибку: отмена ДО исключения ТБИ считалась «совпадает». После исправления «совпадает» для RDS-007
  // недостижимо: часть «начало» всегда под RDS-007-A1, часть «отмена» при положительном интервале — RDS-007-A2,
  // при отрицательном — отличие, при нулевом — нет данных (см. сценарии R1–R9 в stage6-corrections.test.js).
  'RDS-010': { mechanical_ventilation: true, blood_gases: [{ drawn_at: at(1, '10:00'), paco2_mmhg: 44 }], paco2_hypocapnia_threshold: 35, threshold_source: 'синтетический СОП' },
  'NEC-001': { nec_suspected: true, feeding_at_nec_suspicion: 'already_stopped', ng_tube_present_at_suspicion: true, ng_tube_functioning_at_suspicion: true },
  'NEC-002': { nec_suspected: true, uvc_present: true, uvc_removed: true, uac_present: true, uac_removed: true },
  'NEC-005': { nec_stage: '2б', pn_type: 'full', pn_running_at_nec_onset: false, nec_onset_at: at(1, '10:00'), pn_started_at: at(1, '20:00') },
  'NEC-007': { nec_stage: '2б', antibiotics_started: true, metronidazole_given: true },
  'NEC-009': { nec_stage: '1б', facility_level: 2, surgeon_consult_status: 'done', surgeon_consult_format: 'in_person' },
  'NEC-010': { nec_stage: '2б', surgical_department_available: true, current_department: 'neonatal_surgery' },
  'SEP-002': { sepsis_suspected: true, antibiotics_started: true, blood_culture_drawn_at: at(1, '09:40'), first_abx_dose_administered_at: at(1, '10:00') },
  'SEP-004': { early_onset_sepsis_suspected: true, antibiotics_started: true, initial_empirical_regimen: 'benzylpenicillin+gentamicin' },
  'SEP-005': { early_onset_sepsis_suspected: true, benzylpenicillin_given: true, meningitis: false, benzylpenicillin_dose_mg: 25, weight_kg: 1, benzylpenicillin_interval_h: 12, ...WT('benzylpenicillin') },
  'SEP-006': { early_onset_sepsis_suspected: true, gentamicin_given: true, gentamicin_dose_mg: 5, weight_kg: 1, gentamicin_interval_h: 36, ...WT('gentamicin') },
  'SEP-007': { sepsis_suspected: true, antibiotics_started: true, first_abx_dose_administered_at: at(1, '11:00'), crp_samples: [{ drawn_at: at(2, '11:00'), purpose: 'control' }] },
  'SEP-008': { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'отрицательный', high_risk_factors: false, ...COURSE(1, 5) },
};
test('И4: ни одна часть с недостающими данными не даёт правилу «совпадает» (удаление каждого поля по очереди)', () => {
  let checked = 0;
  for (const [id, d] of Object.entries(CONSISTENT_SETS)) {
    assert.equal(ev(id, d).observation, O.CONSISTENT, id);
    for (const k of Object.keys(d)) {
      const x = clone(d); delete x[k];
      const r = ev(id, x);
      const partMissing = (r.parts || []).some(p => p.observation === O.NOT_ASSESSED);
      if (partMissing || r.missing_data.length) assert.notEqual(r.observation, O.CONSISTENT, `${id} без ${k}`);
      if (r.observation === O.CONSISTENT) assert.ok(!partMissing && !r.missing_data.length, `${id} без ${k}`);
      checked++;
    }
  }
  assert.ok(checked > 50);
});

test('И5: неполная или противоречивая отметка времени никогда не даёт интервала', () => {
  const bad = ['2026-01-02', '2026-01-02T10:00', '2026-13-02T10:00+05:00', '02.01.2026 10:00', 'unknown', '', null];
  for (const b of bad) {
    const d = D.derive({ sbi_excluded_at: b, antibiotics_stopped_at: at(2, '14:00'), sepsis_indication_identified_at: b, first_abx_dose_administered_at: at(2, '11:00'),
      blood_culture_drawn_at: b, crp_samples: [{ drawn_at: b, purpose: 'control' }], course_completed: true, abx_course_started_at: b, abx_course_ended_at: at(9, '10:00') });
    for (const f of ['hours_sbi_excluded_to_abx_stop', 'minutes_indication_to_first_dose', 'culture_drawn_before_first_dose', 'hours_first_dose_to_control_crp', 'abx_course_days'])
      assert.ok(!(f in d.derived), `${f} при «${b}»`);
  }
  assert.equal(D.derive({ sbi_excluded_at: '2026-01-02' , antibiotics_stopped_at: at(2, '14:00') }).reasons.hours_sbi_excluded_to_abx_stop, D.REASON.DATE_ONLY);
  assert.equal(D.derive({ sbi_excluded_at: '2026-01-02T10:00', antibiotics_stopped_at: at(2, '14:00') }).reasons.hours_sbi_excluded_to_abx_stop, D.REASON.NO_TZ);
  const contr = [
    [{ first_abx_dose_ordered_at: at(1, '10:00'), first_abx_dose_administered_at: at(1, '09:00'), sepsis_indication_identified_at: at(1, '08:00') }, 'minutes_indication_to_first_dose'],
    [{ course_completed: true, abx_course_started_at: at(5, '10:00'), abx_course_ended_at: at(1, '10:00') }, 'abx_course_days'],
    [{ blood_culture_drawn_at: at(1, '10:00'), culture_result_at: at(1, '09:00'), first_abx_dose_administered_at: at(1, '11:00') }, 'culture_drawn_before_first_dose'],
    [{ first_abx_dose_administered_at: at(1, '11:00'), crp_samples: [{ drawn_at: at(1, '09:00'), purpose: 'control' }] }, 'hours_first_dose_to_control_crp'],
    [{ nec_onset_at: at(3, '10:00'), nec_confirmed_at: at(1, '10:00'), enteral_feeding_resumed_at: at(9, '10:00') }, 'nec_day_from_onset_at_feeding_resumption'],
    [{ transfer_decision_at: at(2, '10:00'), transferred_at: at(1, '10:00') }, 'hours_transfer_decision_to_transfer'],
  ];
  for (const [d, f] of contr) {
    const x = D.derive(d);
    assert.ok(!(f in x.derived), f);
    assert.equal(x.reasons[f], D.REASON.CONTRADICTORY, f);
  }
  // противоречивая хронология → правило «Недостаточно данных» с этой причиной в карточке
  const r = ev('SEP-007', { sepsis_suspected: true, antibiotics_started: true, first_abx_dose_administered_at: at(1, '11:00'), crp_samples: [{ drawn_at: at(1, '09:00'), purpose: 'control' }] });
  assert.equal(r.observation, O.NOT_ASSESSED);
  assert.equal(r.card.missing_reasons.hours_first_dose_to_control_crp, D.REASON.CONTRADICTORY);
});

test('И5: «unknown» никогда не становится «нет» — исход тот же, что при отсутствии поля', () => {
  const triFields = Object.entries(DB.data_dictionary).filter(([, e]) => e.type === 'tri').map(([k]) => k);
  const enumFields = Object.entries(DB.data_dictionary).filter(([, e]) => e.type === 'enum' && e.values.includes('unknown')).map(([k]) => k);
  assert.ok(triFields.length > 40 && enumFields.length >= 10);
  const datasets = Object.values(CONSISTENT_SETS);
  for (const d of datasets) for (const f of [...triFields, ...enumFields]) {
    if (!(f in d)) continue;
    const a = clone(d); a[f] = 'unknown';
    const b = clone(d); delete b[f];
    const oa = run(a), ob = run(b);
    assert.deepEqual(oa.results.map(r => r.observation), ob.results.map(r => r.observation), f);
    assert.ok(!(f in oa.derived.values));
  }
  // пустой список — нет записи, а не «ничего не было»
  assert.equal(ev('RDS-010', { mechanical_ventilation: true, blood_gases: [], paco2_hypocapnia_threshold: 35, threshold_source: 'СОП' }).observation, O.NOT_ASSESSED);
});

test('И5: значения вычисляемых полей, введённые вручную, не используются', () => {
  const o = run({ sepsis_suspected: true, antibiotics_started: true, hours_first_dose_to_control_crp: 20, culture_drawn_before_first_dose: true, abx_course_days: 7 });
  assert.equal(res(o, 'SEP-007').observation, O.NOT_ASSESSED);
  assert.equal(res(o, 'SEP-002').observation, O.NOT_ASSESSED);
  assert.deepEqual(o.derived.manual_values_ignored.sort(), ['abx_course_days', 'culture_drawn_before_first_dose', 'hours_first_dose_to_control_crp']);
});

test('И6: категория обоснования, источники и комментарии врача не меняют исход', () => {
  const sets = [...Object.values(CONSISTENT_SETS),
    { nec_suspected: true, feeding_at_nec_suspicion: 'active', enteral_feeding_stopped: false, ng_tube_placed: true },
    { early_onset_sepsis_suspected: true, antibiotics_started: true, initial_empirical_regimen: 'другое' },
    { early_onset_sepsis_suspected: true, benzylpenicillin_given: true, meningitis: false, benzylpenicillin_dose_mg_kg: 50, benzylpenicillin_interval_h: 12 }];
  for (const d of sets) {
    const plain = E.evaluate(DB, { synthetic: true, data: d }).results.map(r => [r.rule_id, r.observation, r.active_ambiguities]);
    for (const cat of [...Object.keys(E.JUSTIFICATION_CATEGORIES), 'выдуманная']) {
      const just = Object.fromEntries(DB.rules.map(r => [r.rule_id, { text: 'т', author: 'а', category: cat, drug_unavailable: { drug: 'x' }, reference: 'doi:x' }]));
      const sources = Object.fromEntries(Object.keys(d).map(k => [k, { document: 'синтетический документ', author: 'синтетик', confidence: 'высокая' }]));
      const o = E.evaluate(DB, { synthetic: true, data: d, justifications: just, sources }, { expert_decisions: ED });
      assert.deepEqual(o.results.map(r => [r.rule_id, r.observation, r.active_ambiguities]), plain, cat);
    }
  }
});

test('И6: местная практика никогда не даёт «совпадает» (SEP-005 50 мг/кг, SEP-006 4 мг/кг каждые 24 ч)', () => {
  for (const interval of [8, 12, 24]) for (const sev of [true, false, undefined]) {
    const d = { early_onset_sepsis_suspected: true, benzylpenicillin_given: true, meningitis: false, benzylpenicillin_dose_mg: 50, weight_kg: 1, benzylpenicillin_interval_h: interval, ...WT('benzylpenicillin') };
    if (sev !== undefined) d.very_severe_condition = sev;
    assert.notEqual(ev('SEP-005', d, J('SEP-005', { category: 'local_practice' })).observation, O.CONSISTENT);
  }
  for (const vi of [true, false, undefined]) for (const gn of [true, false, undefined]) for (const ga of [24, 30, 40]) {
    const d = { early_onset_sepsis_suspected: true, gentamicin_given: true, gentamicin_dose_mg: 4, weight_kg: 1, gentamicin_interval_h: 24, gestational_age_weeks: ga, ...WT('gentamicin') };
    if (vi !== undefined) d.very_ill = vi; if (gn !== undefined) d.gram_negative_culture = gn;
    const r = ev('SEP-006', d, J('SEP-006', { category: 'local_practice' }));
    assert.notEqual(r.observation, O.CONSISTENT);
    assert.equal(part(r, 'dose').observation, O.AMBIGUOUS_PENDING);
  }
});

test('И6: при неоднозначности части её проверка не выполняется — скрытого результата нет', () => {
  const r = ev('SEP-006', { early_onset_sepsis_suspected: true, gentamicin_dose_mg: 4, weight_kg: 1, gentamicin_given: true, gentamicin_interval_h: 24, very_ill: false, ...WT('gentamicin') });
  for (const p of r.parts) if (p.active_ambiguities.length) { assert.equal(p.observation, O.AMBIGUOUS_PENDING); assert.equal(p.observation_weight, undefined); }
  const r2 = ev('NEC-008', { nec_stage: '2б', antibiotics_started: true, ...COURSE(1, 5) });
  assert.equal(r2.observation, O.AMBIGUOUS_PENDING);
  assert.ok(!JSON.stringify(r2).includes(O.DIFFERS));
});

// =================== Приёмочные: пять правок врача (§3) ===================
test('§3.1 NEC-001-a: подозрение 10:00, кормление прекращено ранее в 08:00 — нового времени отмены не требуется', () => {
  const r = ev('NEC-001', { nec_suspected: true, nec_suspected_at: at(3, '10:00'), feeding_at_nec_suspicion: 'already_stopped', feeding_stopped_before_suspicion_at: at(3, '08:00'), ng_tube_placed: true });
  assert.equal(part(r, 'feeding').observation, O.CONSISTENT);
  assert.equal(r.observation, O.CONSISTENT);
});
test('§3.1 NEC-001-b: исправный зонд установлен до подозрения — отсутствие новой установки не нарушение', () => {
  const r = ev('NEC-001', { nec_suspected: true, feeding_at_nec_suspicion: 'active', enteral_feeding_stopped: true, ng_tube_present_at_suspicion: true, ng_tube_functioning_at_suspicion: true });
  assert.equal(part(r, 'ng_tube').observation, O.CONSISTENT);
  assert.equal(r.observation, O.CONSISTENT);
});
test('§3.1 NEC-001-c: статус кормления на момент подозрения неизвестен — нет данных; NEC-001-A1 не изменена', () => {
  const r = ev('NEC-001', { nec_suspected: true, feeding_at_nec_suspicion: 'unknown', ng_tube_placed: true });
  assert.equal(r.observation, O.NOT_ASSESSED);
  const a1 = DB.rules.find(x => x.rule_id === 'NEC-001').ambiguities.find(a => a.id === 'NEC-001-A1');
  assert.equal(a1.blocking, 'no');
});
test('§3.1 NEC-001: продолжение кормления и документированное отсутствие зонда — отличие; «прекращено раньше» позже подозрения — противоречивая хронология', () => {
  assert.equal(part(ev('NEC-001', { nec_suspected: true, feeding_at_nec_suspicion: 'active', enteral_feeding_stopped: false, ng_tube_placed: true }), 'feeding').observation, O.DIFFERS);
  assert.equal(part(ev('NEC-001', { nec_suspected: true, feeding_at_nec_suspicion: 'already_stopped', ng_tube_present_at_suspicion: false, ng_tube_placed: false }), 'ng_tube').observation, O.DIFFERS);
  const r = ev('NEC-001', { nec_suspected: true, nec_suspected_at: at(3, '10:00'), feeding_at_nec_suspicion: 'already_stopped', feeding_stopped_before_suspicion_at: at(3, '12:00'), ng_tube_placed: true });
  assert.equal(part(r, 'feeding').observation, O.NOT_ASSESSED);
  assert.equal(r.card.missing_reasons.feeding_at_nec_suspicion, D.REASON.CONTRADICTORY);
});

test('§3.2 NEC-008-a: 5-е сутки идущего курса — «Курс продолжается…» первой строкой; не «неприменимо»; длительность не считается', () => {
  const o = run({ nec_stage: '2б', antibiotics_started: true, course_completed: false, abx_course_started_at: at(1, '10:00') });
  const r = res(o, 'NEC-008');
  assert.equal(r.card.labels[0].text, COURSE_RUNNING);
  assert.notEqual(r.observation, O.NOT_APPLICABLE);
  assert.equal(r.observation, O.AMBIGUOUS_PENDING); // C3: машинный исход прежний при постоянной блокировке
  assert.ok(r.active_ambiguities.includes('NEC-008-A1'));
  assert.ok(!('abx_course_days' in o.derived.values));
});
test('§3.2 NEC-008-b: 11 суток со сменой препарата — один курс 11 суток; NEC-008-A1 сохраняется', () => {
  const o = run({ nec_stage: '2б', antibiotics_started: true, ...COURSE(1, 11), drug_changes: [{ at: at(4, '10:00'), from: 'ампициллин', to: 'меропенем' }] });
  const r = res(o, 'NEC-008');
  assert.equal(o.derived.values.abx_course_days, 11);
  assert.equal(r.observation, O.AMBIGUOUS_PENDING);
  assert.ok(r.active_ambiguities.includes('NEC-008-A1'));
  assert.ok(r.card.labels.some(l => l.id === 'drug_change'));
});
test('§3.2 NEC-008-c: курс завершён, даты последней дозы нет — длительность не вычисляется; в карточке «не хватает данных» (исход — блокировка A1, C3)', () => {
  const o = run({ nec_stage: '2б', antibiotics_started: true, course_completed: true, abx_course_started_at: at(1, '10:00') });
  const r = res(o, 'NEC-008');
  assert.ok(!('abx_course_days' in o.derived.values));
  assert.equal(r.observation, O.AMBIGUOUS_PENDING);
  assert.deepEqual(r.card.data_gaps_behind_ambiguity.map(g => g.field), ['abx_course_days']);
  assert.deepEqual(r.card.data_gaps_behind_ambiguity[0].needs, ['abx_course_ended_at']);
  assert.ok(r.card.labels.some(l => l.id === 'gaps_behind_ambiguity'));
});

test('§3.3 NEC-010-a (C1): хирургия есть в организации, ребёнок в ОРИТН — не «неприменимо», неоднозначность NEC-010-A4', () => {
  const r = ev('NEC-010', { nec_stage: '2б', surgical_department_available: true, in_facility_with_neonatal_surgical_beds: true, current_department: 'nicu' });
  assert.notEqual(r.applicability, 'неприменимо');
  assert.equal(r.observation, O.AMBIGUOUS_PENDING);
  assert.deepEqual(r.active_ambiguities, ['NEC-010-A4']);
  const r2 = ev('NEC-010', { nec_stage: '2б', in_facility_with_neonatal_surgical_beds: true, current_department: 'nicu', transferred_to_surgery: false, surgical_department_available: true });
  assert.notEqual(r2.observation, O.DIFFERS); // отсутствие внутрибольничного перевода — не автоматический дефект
});
test('§3.3 NEC-010-b: ребёнок уже в хирургическом отделении — фактический статус маршрутизации: совпадает', () => {
  const r = ev('NEC-010', { nec_stage: '2б', surgical_department_available: true, current_department: 'neonatal_surgery', surgeon_following: true });
  assert.equal(r.observation, O.CONSISTENT);
});
test('§3.3 NEC-010-c: нетранспортабелен, перевод отложен и обоснован — причина, решение хирурга, план в карточке; эксперту; не «совпадает»', () => {
  const d = { nec_stage: '2б', surgical_department_available: false, current_department: 'nicu', transferred_to_surgery: false, transport_stable: false,
    transport_contraindications_documented: true, transfer_delay_reason: 'ИВЛ, нестабильная гемодинамика', surgical_consilium_decision: 'перевод после стабилизации', reassessment_plan: 'через 12 ч', surgeon_following: true };
  const r = ev('NEC-010', d, J('NEC-010', { category: 'physician_or_consilium_decision' }));
  assert.equal(r.observation, O.DIFFERS);
  assert.equal(r.justification_complete, true);
  assert.ok(r.card.labels.some(l => l.id === 'not_transportable'));
  const f = Object.fromEntries(r.card.facts.map(x => [x.field, x.value]));
  assert.equal(f.transfer_delay_reason, d.transfer_delay_reason); assert.equal(f.surgical_consilium_decision, d.surgical_consilium_decision); assert.equal(f.reassessment_plan, d.reassessment_plan);
  // в организации с хирургией нетранспортабельность — тоже эксперту (A4), не дефект
  assert.equal(ev('NEC-010', Object.assign({}, d, { surgical_department_available: true })).observation, O.AMBIGUOUS_PENDING);
});
test('§3.3 NEC-010-d: IIа консервативно — NEC-010-A1 + CF-001; A1–A3 и CF-001 не изменены', () => {
  const o = run({ nec_stage: '2а', facility_level: 3, current_department: 'nicu', transferred_to_surgery: false });
  assert.ok(res(o, 'NEC-010').active_ambiguities.includes('NEC-010-A1'));
  assert.ok(cfs(o).includes('CF-001'));
  const cf = DB.protocol_conflicts.find(c => c.id === 'CF-001');
  assert.deepEqual([cf.rules, cf.related_rules], [['NEC-010'], ['NEC-009']]); // C5
});

test('§3.4 SEP-003-a: ИГ рутинно всем с сепсисом — отличие', () => {
  const r = ev('SEP-003', { sepsis_suspected: true, immunoglobulin_given: true, immunoglobulin_purpose: 'sepsis_treatment_or_prophylaxis', immunoglobulin_use_type: 'routine' });
  assert.equal(r.observation, O.DIFFERS);
});
test('§3.4 SEP-003-b (C2, исправление п. 2): индивидуально, текст основания + консилиум + статья — неоднозначность SEP-003-A2, не «совпадает»', () => {
  const r = ev('SEP-003', { sepsis_suspected: true, immunoglobulin_given: true, immunoglobulin_purpose: 'sepsis_treatment_or_prophylaxis', immunoglobulin_use_type: 'individualized',
    clinical_evidence: 'синтетическое особое клиническое основание', consilium_documented: true, research_reference: 'doi:10.0000/синтетика' });
  assert.equal(r.observation, O.AMBIGUOUS_PENDING);
  assert.deepEqual(r.active_ambiguities, ['SEP-003-A2']);
});
test('§3.4 SEP-003-c: иное самостоятельное показание — SEP-003-A2', () => {
  const r = ev('SEP-003', { sepsis_suspected: true, immunoglobulin_given: true, immunoglobulin_purpose: 'other_indication' });
  assert.deepEqual(r.active_ambiguities, ['SEP-003-A2']);
});
test('§3.4 SEP-003-d: цель введения не указана — нет данных; «показание записано» само по себе не «совпадает»', () => {
  assert.equal(ev('SEP-003', { sepsis_suspected: true, immunoglobulin_given: true }).observation, O.NOT_ASSESSED);
  assert.equal(ev('SEP-003', { sepsis_suspected: true, immunoglobulin_given: true, immunoglobulin_indication_documented: true }).observation, O.NOT_ASSESSED);
  assert.equal(ev('SEP-003', { sepsis_suspected: true, immunoglobulin_given: true, immunoglobulin_purpose: 'sepsis_treatment_or_prophylaxis' }).observation, O.NOT_ASSESSED);
  const a1 = DB.rules.find(x => x.rule_id === 'SEP-003').ambiguities.find(a => a.id === 'SEP-003-A1');
  assert.equal(a1.blocking, 'no');
});

test('§3.5 SEP-010-a (C3): 5-е сутки идущего курса — «Курс продолжается…», без оценки длительности', () => {
  const o = run({ antibiotics_started: true, meningitis: false, blood_culture_result: 'положительный', course_completed: false, abx_course_started_at: at(1, '10:00') });
  const r = res(o, 'SEP-010');
  assert.equal(r.card.labels[0].text, COURSE_RUNNING);
  assert.equal(r.observation, O.AMBIGUOUS_PENDING);
  assert.ok(!('abx_course_days' in o.derived.values));
});
test('§3.5 SEP-010-b (C4.1): 14 суток, продление из-за НЭК с записью — «Продление документировано…», неоднозначность, не «совпадает»', () => {
  const r = ev('SEP-010', { antibiotics_started: true, meningitis: false, blood_culture_result: 'отрицательный', high_risk_factors: true, ...COURSE(1, 14), extension_reason: ['nec'], extension_justification_status: 'found' });
  assert.ok(labels(r).includes(EXT_DOC));
  assert.ok(!labels(r).includes(EXT_NF));
  assert.equal(r.observation, O.AMBIGUOUS_PENDING);
});
test('§3.5 SEP-010-c: курс завершён, причина продления не найдена — «Обоснование не найдено в доступной документации», не «показаний не было»', () => {
  const r = ev('SEP-010', { antibiotics_started: true, meningitis: false, blood_culture_result: 'положительный', ...COURSE(1, 12), extension_justification_status: 'not_found_in_documentation' });
  assert.ok(labels(r).includes(EXT_NF));
  assert.ok(!labels(r).some(t => /показаний не было/.test(t)));
});
test('§3.5 SEP-010-d: 7 и 10 суток при пересечении условий — CF-002, без окончательного вывода', () => {
  for (const d2 of [7, 10]) {
    const o = run({ antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'положительный', meningitis: false, ...COURSE(1, d2) });
    assert.ok(cfs(o).includes('CF-002'));
    assert.equal(res(o, 'SEP-009').observation, O.AMBIGUOUS_PENDING);
    assert.equal(res(o, 'SEP-010').observation, O.AMBIGUOUS_PENDING);
    assert.equal(o.final_conclusion, null);
  }
});
test('§3.5 SEP-010-e: менингит неизвестен — нет данных', () => {
  assert.equal(ev('SEP-010', { antibiotics_started: true, blood_culture_result: 'положительный', ...COURSE(1, 7) }).observation, O.NOT_ASSESSED);
  assert.equal(ev('SEP-010', { antibiotics_started: true, meningitis: 'unknown', blood_culture_result: 'положительный', ...COURSE(1, 7) }).observation, O.NOT_ASSESSED);
});
test('C4.2: курс короче 7 суток — в карточке SEP-010 положение о решении через 36/48 ч с цитатами стр. 15; логика не меняется', () => {
  const r = ev('SEP-010', { antibiotics_started: true, meningitis: false, blood_culture_result: 'положительный', ...COURSE(1, 5) });
  const l = r.card.labels.find(x => x.id === 'shorter_than_7');
  assert.ok(l);
  assert.equal(l.quotes.length, 2);
  assert.ok(l.quotes.every(q => q.page === 15 && q.protocol === 'sepsis'));
  assert.match(l.quotes[1].text, /первоначального риска/);
  assert.equal(r.observation, O.AMBIGUOUS_PENDING);
  assert.deepEqual(r.active_ambiguities, ['SEP-010-A1', 'SEP-010-A2']);
});

// =================== Критические тесты §6 ТЗ ===================
test('§6 RDS-010: нет газов — «Недостаточно данных», не «совпадает»', () => {
  assert.equal(ev('RDS-010', { mechanical_ventilation: true }).observation, O.NOT_ASSESSED);
});
test('§6 RDS-010: один эпизод гипокапнии, ИВЛ скорректирована — RDS-010-A2, не автоматический дефект; порог без источника — нет данных', () => {
  const r = ev('RDS-010', { mechanical_ventilation: true, blood_gases: [{ drawn_at: at(1, '10:00'), paco2_mmhg: 29 }], paco2_hypocapnia_threshold: 35, threshold_source: 'СОП', vent_changes: [{ at: at(1, '10:20'), parameter: 'rate', from: 50, to: 40 }] });
  assert.equal(r.observation, O.AMBIGUOUS_PENDING);
  assert.deepEqual(r.active_ambiguities, ['RDS-010-A2']);
  assert.equal(ev('RDS-010', { mechanical_ventilation: true, blood_gases: [{ drawn_at: at(1, '10:00'), paco2_mmhg: 29 }], paco2_hypocapnia_threshold: 35 }).observation, O.NOT_ASSESSED);
  assert.equal(ev('RDS-010', { mechanical_ventilation: true, hypocapnia_documented: true }).observation, O.NOT_ASSESSED); // старое ручное поле больше не даёт «отличается»
});
test('§6 NEC-006: ургентный снимок до 48 ч — не нарушение; NEC-006-A2 сохраняется', () => {
  const r = ev('NEC-006', { nec_stage: '2б', nec_diagnosed_at: at(1, '10:00'), clinical_deterioration: true, deterioration_at: at(1, '20:00'), xrays: [{ at: at(1, '21:00'), position: 'lateral', reason: 'urgent' }] });
  assert.notEqual(r.observation, O.DIFFERS);
  assert.ok(r.active_ambiguities.includes('NEC-006-A2'));
});
test('§6 NEC-009: дистанционный хирург — NEC-009-A1; записи нет — нет данных; записано «не проводилась» — отличие', () => {
  assert.deepEqual(ev('NEC-009', { nec_stage: '2а', facility_level: 2, surgeon_consult_status: 'done', surgeon_consult_format: 'remote' }).active_ambiguities, ['NEC-009-A1']);
  assert.equal(ev('NEC-009', { nec_stage: '1а', facility_level: 2, surgeon_consult_status: 'no_record' }).observation, O.NOT_ASSESSED);
  assert.equal(ev('NEC-009', { nec_stage: '1а', facility_level: 2, surgeon_consult_status: 'documented_not_done' }).observation, O.DIFFERS);
});
test('§6 SEP-001: назначение раньше введения — отсчёт по фактическому введению; Q09 открыт (A1)', () => {
  const o = run({ red_flag_count: 1, antibiotics_started: true, sepsis_indication_identified_at: at(1, '10:00'), first_abx_dose_ordered_at: at(1, '10:00'), first_abx_dose_administered_at: at(1, '11:30') });
  assert.equal(o.derived.values.minutes_indication_to_first_dose, 90);
  assert.ok(res(o, 'SEP-001').active_ambiguities.includes('SEP-001-A1'));
  assert.equal(ED.open_questions.find(q => q.id === 'Q09').status, 'открыт');
});
test('§6 SEP-002: посев до введения — соответствие; после — отличие; одинаковое время — нет данных; время результата не влияет', () => {
  const base = { sepsis_suspected: true, antibiotics_started: true, first_abx_dose_administered_at: at(1, '10:00') };
  assert.equal(ev('SEP-002', { ...base, blood_culture_drawn_at: at(1, '09:40'), culture_result_at: at(3, '10:00') }).observation, O.CONSISTENT);
  assert.equal(ev('SEP-002', { ...base, blood_culture_drawn_at: at(1, '10:30') }).observation, O.DIFFERS);
  assert.equal(ev('SEP-002', { ...base, blood_culture_drawn_at: at(1, '10:00') }).observation, O.NOT_ASSESSED);
  assert.equal(ev('SEP-002', { ...base }).observation, O.NOT_ASSESSED);
});
test('§6 SEP-007: первая доза 11:00, СРБ 06:00 следующего дня — 19 ч; доза 17:00, забор 09:00 — 16 ч от дозы, отличие; «следующий день» без часа — нет данных', () => {
  const base = { sepsis_suspected: true, antibiotics_started: true, first_abx_dose_ordered_at: at(1, '10:00') };
  const a = run({ ...base, first_abx_dose_administered_at: at(1, '11:00'), crp_samples: [{ drawn_at: at(2, '06:00'), purpose: 'control' }] });
  assert.equal(a.derived.values.hours_first_dose_to_control_crp, 19);
  assert.equal(res(a, 'SEP-007').observation, O.CONSISTENT);
  assert.equal(ev('SEP-007', { ...base, first_abx_dose_administered_at: at(1, '17:00'), crp_samples: [{ drawn_at: at(2, '09:00'), purpose: 'control' }] }).observation, O.DIFFERS);
  assert.equal(ev('SEP-007', { ...base, first_abx_dose_administered_at: at(1, '11:00'), crp_samples: [{ drawn_at: '2026-01-02', purpose: 'control' }] }).observation, O.NOT_ASSESSED);
  assert.equal(ev('SEP-007', { ...base, first_abx_dose_administered_at: at(1, '11:00'), crp_samples: [{ drawn_at: at(2, '06:00'), purpose: 'baseline' }] }).observation, O.NOT_ASSESSED);
  for (const h of ['05:00', '11:00']) assert.equal(ev('SEP-007', { ...base, first_abx_dose_administered_at: at(1, '11:00'), crp_samples: [{ drawn_at: at(2, h), purpose: 'control' }] }).observation, O.CONSISTENT, h);
});
test('§6 SEP-008: отмена через 48 ч при критериях — не отклонение по краткости; 7 суток — отличие; высокий риск — неприменимо; конец неизвестен — нет данных', () => {
  const base = { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'отрицательный', high_risk_factors: false };
  assert.equal(ev('SEP-008', { ...base, ...COURSE(1, 3) }).observation, O.CONSISTENT);
  assert.equal(ev('SEP-008', { ...base, ...COURSE(1, 7) }).observation, O.DIFFERS);
  assert.equal(ev('SEP-008', { ...base, high_risk_factors: true, ...COURSE(1, 7) }).observation, O.NOT_APPLICABLE);
  assert.equal(ev('SEP-008', { ...base, course_completed: true, abx_course_started_at: at(1, '10:00') }).observation, O.NOT_ASSESSED);
});

// =================== Остальные утверждённые правила (план 22 правил) ===================
test('RDS-007: без факторов риска АБТ не начата — часть «начало» неоднозначна + CF-004; исключение 10:00 / отмена 14:00 — A2, «4 ч»; нет времени отмены — нет данных; АБТ не было — часть «отмена» неприменима', () => {
  const a = run({ rds_diagnosed: true, serious_bacterial_infection_excluded: false, red_flag_count: 0, risk_factor_or_sign_count: 0, antibiotics_started: false });
  assert.equal(part(res(a, 'RDS-007'), 'start').observation, O.AMBIGUOUS_PENDING);
  assert.ok(cfs(a).includes('CF-004'));
  const b = run({ rds_diagnosed: true, serious_bacterial_infection_excluded: true, antibiotics_started: true, sbi_excluded_at: at(2, '10:00'), antibiotics_stopped_at: at(2, '14:00') });
  assert.deepEqual(res(b, 'RDS-007').active_ambiguities, ['RDS-007-A2']);
  assert.equal(res(b, 'RDS-007').card.facts.find(f => f.field === 'hours_sbi_excluded_to_abx_stop').value, 4);
  assert.equal(ev('RDS-007', { rds_diagnosed: true, serious_bacterial_infection_excluded: true, antibiotics_started: true, sbi_excluded_at: at(2, '10:00') }).observation, O.NOT_ASSESSED);
  assert.equal(ev('RDS-007', { rds_diagnosed: true, serious_bacterial_infection_excluded: true, antibiotics_started: false }).observation, O.NOT_APPLICABLE);
});
test('NEC-002: только ПВК, удалён — совпадает; ПАК стоял, записи об удалении нет — нет данных; ни одного катетера — неприменимо', () => {
  assert.equal(ev('NEC-002', { nec_suspected: true, uvc_present: true, uvc_removed: true, uac_present: false }).observation, O.CONSISTENT);
  assert.equal(ev('NEC-002', { nec_suspected: true, uvc_present: false, uac_present: true }).observation, O.NOT_ASSESSED);
  assert.equal(ev('NEC-002', { nec_suspected: true, uvc_present: false, uac_present: false }).observation, O.NOT_APPLICABLE);
});
test('NEC-003: стадия II — неприменимо; сведений о пассаже нет — нет данных; A1 «всегда» и CF-003', () => {
  assert.equal(ev('NEC-003', { nec_stage: '2а', gi_passage_restored: false }).observation, O.NOT_APPLICABLE);
  assert.equal(ev('NEC-003', { nec_stage: '1а' }).observation, O.NOT_ASSESSED);
  const o = run({ nec_stage: '1а', gi_passage_restored: false, enteral_feeding_stopped: true });
  assert.ok(res(o, 'NEC-003').active_ambiguities.includes('NEC-003-A1')); assert.ok(cfs(o).includes('CF-003'));
});
test('NEC-004: дата подтверждения неизвестна — отсчёт «от подтверждения» не строится', () => {
  const o = run({ nec_stage: '2а', nec_onset_at: at(1, '10:00'), enteral_feeding_resumed_at: at(8, '10:00') });
  assert.equal(o.derived.values.nec_day_from_onset_at_feeding_resumption, 8);
  assert.ok(!('nec_day_from_confirmation_at_feeding_resumption' in o.derived.values));
  assert.ok(res(o, 'NEC-004').active_ambiguities.includes('NEC-004-A1'));
});
test('NEC-005: ПП до НЭК — совпадает; глюкоза — не ПП; частичное — NEC-005-A1; тип неизвестен — нет данных', () => {
  assert.equal(ev('NEC-005', { nec_stage: '2а', pn_type: 'full', pn_running_at_nec_onset: true }).observation, O.CONSISTENT);
  assert.equal(ev('NEC-005', { nec_stage: '2а', pn_type: 'glucose_only', pn_running_at_nec_onset: true }).observation, O.DIFFERS);
  assert.deepEqual(ev('NEC-005', { nec_stage: '2а', pn_type: 'partial', pn_running_at_nec_onset: true }).active_ambiguities, ['NEC-005-A1']);
  assert.equal(ev('NEC-005', { nec_stage: '2а', pn_running_at_nec_onset: true }).observation, O.NOT_ASSESSED);
});
test('NEC-006: снимков нет — нет данных; интервал больше 7 суток — часть «раз в неделю» отличается', () => {
  assert.equal(ev('NEC-006', { nec_stage: '2а', clinical_deterioration: false }).observation, O.NOT_ASSESSED);
  const r = ev('NEC-006', { nec_stage: '2а', nec_diagnosed_at: at(1, '10:00'), clinical_deterioration: false, xrays: [{ at: at(3, '10:00'), position: 'horizontal' }, { at: at(12, '10:00'), position: 'horizontal' }] });
  assert.equal(part(r, 'weekly').observation, O.DIFFERS);
});
test('NEC-007: другой антианаэробный препарат + обоснование — отличие, не «совпадает»; схема неизвестна — нет данных', () => {
  const r = ev('NEC-007', { nec_stage: '2б', antibiotics_started: true, metronidazole_given: false, other_antianaerobic_drug: 'клиндамицин' }, J('NEC-007', { category: 'clinical_indication' }));
  assert.equal(r.observation, O.DIFFERS); assert.equal(r.justification_complete, true);
  assert.equal(ev('NEC-007', { nec_stage: '2б', antibiotics_started: true }).observation, O.NOT_ASSESSED);
});
test('SEP-001: один фактор риска без «Красного флага» — A2 (без изменений)', () => {
  assert.ok(ev('SEP-001', { red_flag_count: 0, risk_factor_or_sign_count: 1, antibiotics_started: true }).active_ambiguities.includes('SEP-001-A2'));
});
test('SEP-004: первично ампициллин + гентамицин, потом смена по чувствительности — совпадает; поздний сепсис — неприменимо; первичная схема неизвестна — нет данных', () => {
  assert.equal(ev('SEP-004', { early_onset_sepsis_suspected: true, antibiotics_started: true, initial_empirical_regimen: 'ampicillin+gentamicin', empirical_regimen: 'другое' }).observation, O.CONSISTENT);
  assert.equal(ev('SEP-004', { early_onset_sepsis_suspected: false, antibiotics_started: true, initial_empirical_regimen: 'другое' }).observation, O.NOT_APPLICABLE);
  assert.equal(ev('SEP-004', { early_onset_sepsis_suspected: true, antibiotics_started: true }).observation, O.NOT_ASSESSED);
});
test('SEP-005: менингит — неприменимо; масса неизвестна — нет данных; 25 мг/кг каждые 8 ч при очень тяжёлом — совпадает; несогласованные мг и мг/кг — по вычисленной дозе (D-таблица)', () => {
  const base = { early_onset_sepsis_suspected: true, benzylpenicillin_given: true, ...WT('benzylpenicillin') };
  assert.equal(ev('SEP-005', { ...base, meningitis: true, benzylpenicillin_dose_mg_kg: 50, benzylpenicillin_interval_h: 12 }).observation, O.NOT_APPLICABLE);
  assert.equal(ev('SEP-005', { ...base, meningitis: false, benzylpenicillin_dose_mg: 25, benzylpenicillin_interval_h: 12 }).observation, O.NOT_ASSESSED);
  assert.equal(ev('SEP-005', { ...base, meningitis: false, benzylpenicillin_dose_mg: 30, weight_kg: 1.2, benzylpenicillin_interval_h: 8, very_severe_condition: true }).observation, O.CONSISTENT);
  // прежняя проверка «несогласованные записи → нет данных» заменена (уточнение 17:34): приоритет — у вычисленной дозы 50 мг/кг
  const inc = ev('SEP-005', { ...base, meningitis: false, benzylpenicillin_dose_mg: 60, weight_kg: 1.2, benzylpenicillin_dose_mg_kg: 25, benzylpenicillin_interval_h: 12 });
  assert.equal(inc.observation, O.DIFFERS);
  assert.ok(inc.card.labels.some(l => l.id === 'dose_records_inconsistent'));
});
test('SEP-006: 5 мг/кг каждые 36 ч — совпадает; короче при очень больном и грамотрицательном посеве — совпадает; 3 мг/кг — отличие; интервал неизвестен — часть «интервал» нет данных', () => {
  const base = { early_onset_sepsis_suspected: true, gentamicin_given: true, gentamicin_dose_mg: 5, weight_kg: 1, ...WT('gentamicin') };
  assert.equal(ev('SEP-006', { ...base, gentamicin_interval_h: 36 }).observation, O.CONSISTENT);
  assert.equal(ev('SEP-006', { ...base, gentamicin_interval_h: 24, very_ill: true, gram_negative_culture: true }).observation, O.CONSISTENT);
  assert.equal(part(ev('SEP-006', { ...base, gentamicin_dose_mg: 3, gentamicin_interval_h: 36 }), 'dose').observation, O.DIFFERS);
  assert.equal(part(ev('SEP-006', base), 'interval').observation, O.NOT_ASSESSED);
});
test('SEP-009: менингит — неприменимо; менингит неизвестен — нет данных', () => {
  const base = { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'положительный', ...COURSE(1, 10) };
  assert.equal(ev('SEP-009', { ...base, meningitis: true }).observation, O.NOT_APPLICABLE);
  assert.equal(ev('SEP-009', base).observation, O.NOT_ASSESSED);
});

// =================== Курс АБТ: календарные сутки (Q14 по умолчанию) ===================
test('курс АБТ: календарные сутки от первой до последней дозы, по часовому поясу отметки; часы показываются отдельно', () => {
  const d = D.derive({ course_completed: true, abx_course_started_at: '2026-01-01T23:30+05:00', abx_course_ended_at: '2026-01-02T00:30+05:00' });
  assert.equal(d.derived.abx_course_days, 2); assert.equal(d.derived.abx_course_hours, 1);
  const z = D.derive({ course_completed: true, abx_course_started_at: '2026-01-01T18:30Z', abx_course_ended_at: '2026-01-07T18:30Z' });
  assert.equal(z.derived.abx_course_days, 7);
  assert.equal(D.derive({ course_completed: 'unknown', abx_course_started_at: at(1, '10:00'), abx_course_ended_at: at(7, '10:00') }).reasons.abx_course_days, D.REASON.COURSE_STATUS_UNKNOWN);
});

// =================== Карточка эксперта (M5) и комментарии врача (M6) ===================
test('M5: карточка — цитаты со страницами, факты с источником, хронология, недостающие данные, пустое решение эксперта', () => {
  const o = E.evaluate(DB, { synthetic: true, data: { sepsis_suspected: true, antibiotics_started: true, blood_culture_drawn_at: at(1, '10:30'), first_abx_dose_administered_at: at(1, '10:00') },
    sources: { blood_culture_drawn_at: { document: 'лист назначений (синтетика)', author: 'медсестра-синтетик', recorded_at: at(1, '10:35'), confidence: 'высокая' } },
    justifications: J('SEP-002', { category: 'other' }) }, { expert_decisions: ED });
  const c = res(o, 'SEP-002').card;
  assert.equal(c.observation, O.DIFFERS);
  assert.ok(c.labels.some(l => l.text === E.CARD.DIFFERS_JUSTIFIED));
  assert.ok(c.quotes.length >= 2 && c.quotes.every(q => Number.isInteger(q.page) && q.text));
  assert.equal(c.facts.find(f => f.field === 'blood_culture_drawn_at').source.document, 'лист назначений (синтетика)');
  assert.equal(c.facts.find(f => f.field === 'culture_drawn_before_first_dose').computed_by, 'engine/derive.js');
  assert.deepEqual(c.timeline.map(t => t.field), ['first_abx_dose_administered_at', 'blood_culture_drawn_at']);
  assert.equal(c.justification.category_label, 'иное');
  assert.equal(c.expert_decision, null);
  assert.equal(c.triggered_condition, DB.rules.find(r => r.rule_id === 'SEP-002').applicability.description);
});
test('M6: четыре комментария врача — дословно, с автором и датой, «требует отдельной проверки», в оценке не участвуют', () => {
  assert.deepEqual(ED.clinical_comments.map(c => c.rule_id), ['RDS-008', 'SEP-004', 'SEP-005', 'SEP-006']);
  assert.equal(ED.clinical_comments.find(c => c.rule_id === 'SEP-006').text_verbatim, 'Мы назначаем детям Гентамицин 4 мг/кг 1 раз в сутки, независимо от гестационного возраста');
  const o = run({ early_onset_sepsis_suspected: true, gentamicin_given: true, gentamicin_initial_dose_mg_kg: 4, gentamicin_interval_h: 24, very_ill: false });
  const c = res(o, 'SEP-006').card.clinical_comments;
  assert.equal(c.length, 1);
  assert.equal(c[0].text, 'Мы назначаем детям Гентамицин 4 мг/кг 1 раз в сутки, независимо от гестационного возраста');
  assert.ok(c[0].author && c[0].date && /отдельной проверки/.test(c[0].note));
  assert.ok(ED.clinical_comments.every(x => x.requires_separate_validation === true && x.used_in_evaluation === false));
  assert.equal(res(o, 'RDS-008').card.clinical_comments.length, 1);
});
test('решения экспертизы — отдельно от базы: 30 решений, статус всех правил «кандидат», Q01–Q24 открыты, C1–C7 записаны', () => {
  assert.equal(ED.decisions.length, 30);
  assert.ok(ED.decisions.every(d => d.rule_status_after === E.CANDIDATE));
  assert.deepEqual(ED.decisions.filter(d => d.round1 === 'Подтвердить').map(d => d.rule_id), CONFIRMED);
  const r2 = {}; ED.decisions.forEach(d => { if (d.round2) r2[d.round2.decision] = (r2[d.round2.decision] || 0) + 1; });
  assert.deepEqual(r2, { 'Утвердить': 17, 'Изменить': 5 });
  assert.equal(ED.open_questions.length, 24);
  assert.ok(ED.open_questions.every(q => q.status === 'открыт' && q.answer === null));
  assert.deepEqual(ED.technical_clarifications.map(c => c.id), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
  for (const r of DB.rules) assert.ok(!('round1' in r) && !('decisions' in r) && !('clinician_comment' in r), r.rule_id);
});

test('браузер: derive.js и rules-engine.js загружаются без require (window.RulesDerive → window.RulesEngine)', () => {
  const vm = require('node:vm');
  const ctx = {}; ctx.self = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'derive.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'rules-engine.js'), 'utf8'), ctx);
  const o = ctx.RulesEngine.evaluate(DB, { synthetic: true, data: { nec_stage: '2б', antibiotics_started: true, course_completed: false } });
  assert.equal(o.final_conclusion, null);
  assert.equal(o.results.find(r => r.rule_id === 'NEC-008').card.labels[0].text, COURSE_RUNNING);
});
