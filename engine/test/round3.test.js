'use strict';
// Третий круг (rules-0.3): приёмочные тесты пакета исправлений по решениям врача от 20.11.2026 (Р1–Р8),
// ранее утверждённым решениям по SEP-008, SEP-009, SEP-010 (19.11.2026) и техническим исправлениям Т1–Т8.
// Только синтетические данные. Ни один тест не формирует окончательного вывода.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const E = require('../rules-engine.js');
const D = require('../derive.js');

const ROOT = path.join(__dirname, '..', '..');
const DB = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'pilot-rules.json'), 'utf8'));
const ED = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'expert-decisions.json'), 'utf8'));
const CASES = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cases-171.json'), 'utf8')).cases.map(c => [c.id, c]));
const O = E.OBS;
const run = (data, just) => {
  const o = E.evaluate(DB, { synthetic: true, data, justifications: just }, { expert_decisions: ED });
  assert.equal(o.final_conclusion, null);
  for (const r of o.results) assert.equal(r.final, false);
  return o;
};
const res = (o, id) => o.results.find(r => r.rule_id === id);
const ev = (id, data, just) => res(run(data, just), id);
const part = (r, id) => r.parts.find(p => p.part_id === id);
const ids = r => r.card.labels.map(l => l.id);
const lab = (r, id) => r.card.labels.find(l => l.id === id);
const cfs = o => o.conflicts.map(c => c.id);
const at = (d, hm) => `2026-01-${String(d).padStart(2, '0')}T${hm}+05:00`;
const W = { weight_measured_at: at(1, '08:00'), benzylpenicillin_prescribed_at: at(1, '10:00'), gentamicin_prescribed_at: at(1, '10:00') };
const BZ = x => Object.assign({ early_onset_sepsis_suspected: true, benzylpenicillin_given: true, meningitis: false, weight_kg: 3 }, W, x);
const GM = x => Object.assign({ early_onset_sepsis_suspected: true, gentamicin_given: true, weight_kg: 1 }, W, x);
const COURSE = (a, b, extra) => Object.assign({ course_completed: true, abx_course_started_at: a, abx_course_ended_at: b }, extra || {});
const tab = id => run(JSON.parse(JSON.stringify(CASES[id].data)));

// =================== Контрольные числа и защищённые элементы ===================
test('контроль: 30 правил-кандидатов, 28 блокирующих неоднозначностей, 7 противоречий CF-001–CF-007', () => {
  assert.equal(DB.schema_version, 'rules-0.3');
  assert.equal(DB.rules.length, 30);
  for (const r of DB.rules) { assert.equal(r.status, E.CANDIDATE, r.rule_id); assert.equal(r.expert_confirmation, null, r.rule_id); }
  for (const r of DB.rules) for (const a of r.ambiguities) assert.equal(a.decision, null, a.id);
  const blocking = DB.rules.flatMap(r => r.ambiguities).filter(a => a.blocking === 'always' || a.blocking === 'when');
  assert.equal(blocking.length, 28);
  assert.deepEqual(DB.protocol_conflicts.map(c => c.id), ['CF-001', 'CF-002', 'CF-003', 'CF-004', 'CF-005', 'CF-006', 'CF-007']);
  assert.equal(DB.authenticated, false);
  // final_conclusion: null — и при «пустом» случае
  assert.equal(run({}).final_conclusion, null);
});

test('контроль: Q01–Q24 открыты и не изменены; новые вопросы — только предложения; Q24 не удалён', () => {
  assert.deepEqual(ED.open_questions.map(q => q.id), Array.from({ length: 24 }, (_, i) => `Q${String(i + 1).padStart(2, '0')}`));
  assert.ok(ED.open_questions.every(q => q.status === 'открыт' && q.answer === null));
  assert.deepEqual(ED.round3.open_questions_closed, []);
  assert.ok(ED.round3.proposed_new_questions.length >= 1 && ED.round3.proposed_new_questions.every(q => q.status === 'предложение'));
});

test('контроль: изменены записи ровно 12 правил; RDS-001, 002, 004, 005, 006 не затронуты', () => {
  const changed = DB.rules.filter(r => r.revision_round3).map(r => r.rule_id).sort();
  assert.deepEqual(changed, ['NEC-003', 'NEC-004', 'NEC-005', 'NEC-008', 'RDS-003', 'RDS-008', 'RDS-009', 'SEP-005', 'SEP-006', 'SEP-008', 'SEP-009', 'SEP-010']);
  for (const id of ['RDS-001', 'RDS-002', 'RDS-004', 'RDS-005', 'RDS-006']) assert.ok(!('revision_round3' in DB.rules.find(r => r.rule_id === id)), id);
});

test('контроль: новых нормативных порогов длительности нет (Q14) — единственный порог в часах — 120 ч SEP-008-A3 по решению врача', () => {
  const hits = [];
  const walk = (n, where) => { if (!n) return; if (n.all || n.any) (n.all || n.any).forEach(x => walk(x, where)); else if (/_hours$|_days$/.test(n.field) && /^abx_course/.test(n.field)) hits.push([where, n.field, n.op, n.value]); };
  for (const r of DB.rules) {
    walk(r.requirement.check, r.rule_id); (r.requirement.parts || []).forEach(p => walk(p.check, r.rule_id));
    r.ambiguities.forEach(a => walk(a.blocks_when, a.id)); (r.card_labels || []).forEach(c => walk(c.when, r.rule_id + ':' + c.id));
  }
  const hourHits = hits.filter(h => h[1] === 'abx_course_hours' && h[3] !== undefined);
  assert.deepEqual([...new Set(hourHits.map(h => h[3]))], [120]);
  assert.ok(hourHits.every(h => /^SEP-008/.test(h[0])));
});

// =================== Р1: SEP-005 / CF-006 (бензилпенициллин) ===================
test('Р1 SEP-005: ТАБ-B1–B5 — ни «отличается», ни «совпадает»: SEP-005-A3 и CF-006', () => {
  for (const id of ['ТАБ-B1', 'ТАБ-B2', 'ТАБ-B3', 'ТАБ-B4', 'ТАБ-B5']) {
    const o = tab(id), r = res(o, 'SEP-005');
    assert.equal(r.observation, O.AMBIGUOUS_PENDING, id);
    assert.deepEqual(r.active_ambiguities, ['SEP-005-A3'], id);
    assert.ok(cfs(o).includes('CF-006'), id);
    assert.ok(ids(r).includes('sources_diverge'), id);
    const q = lab(r, 'sources_diverge').quotes;
    assert.deepEqual([...new Set(q.map(x => x.page))].sort((a, b) => a - b), [12, 13, 18], id);
  }
});

test('Р1 SEP-005: доза в Ед/кг хранится в исходных единицах и не пересчитывается в мг/кг', () => {
  const o = tab('ТАБ-B5'), r = res(o, 'SEP-005');
  assert.ok(!('benzylpenicillin_dose_per_kg' in o.derived.values));
  assert.ok(!('benzylpenicillin_dose_per_kg_calculated' in o.derived.values));
  assert.equal(r.card.facts.find(f => f.field === 'benzylpenicillin_dose_units_per_kg').value, 50000);
  assert.equal(lab(r, 'dose_units').text, 'Доза записана в Ед/кг: 50000 Ед/кг — хранится в исходных единицах; с «25 мг/кг» без проверенного коэффициента не сопоставляется');
  assert.equal(o.derived.values.benzylpenicillin_table_regimen_status, 'matches');
});

test('Р1 SEP-005: CF-006 — не постоянная блокировка: режим, не совпадающий ни с текстом, ни с таблицей, оценивается обычно', () => {
  // 30 мг/кг каждые 12 ч: не текст (доза), не таблица (интервал) → «отличается», CF-006 нет
  const o1 = run(BZ({ benzylpenicillin_dose_mg: 90, benzylpenicillin_interval_h: 12 }));
  assert.equal(res(o1, 'SEP-005').observation, O.DIFFERS); assert.ok(!cfs(o1).includes('CF-006'));
  // 100 000 Ед/кг каждые 8 ч, не очень тяжёлое: не таблица (доза), не текст (интервал) → не CF-006
  const o2 = run(BZ({ benzylpenicillin_dose_units_per_kg: 100000, benzylpenicillin_interval_h: 8, very_severe_condition: false }));
  assert.ok(!cfs(o2).includes('CF-006')); assert.notEqual(res(o2, 'SEP-005').observation, O.CONSISTENT);
  // интервал неизвестен — сверка не выполняется, CF-006 нет, «нет данных»
  const o3 = run(BZ({ benzylpenicillin_dose_mg: 75 }));
  assert.ok(!cfs(o3).includes('CF-006')); assert.equal(res(o3, 'SEP-005').observation, O.NOT_ASSESSED);
  // менингит — правило неприменимо, CF-006 не показывается
  const o4 = run(BZ({ meningitis: true, benzylpenicillin_dose_mg: 75, benzylpenicillin_interval_h: 12 }));
  assert.equal(res(o4, 'SEP-005').observation, O.NOT_APPLICABLE); assert.ok(!cfs(o4).includes('CF-006'));
});

test('Р1 SEP-005: совпадение и с текстом, и с таблицей (25 мг/кг и 50 000 Ед/кг каждые 8 ч при очень тяжёлом) — расхождения нет', () => {
  const o = run(BZ({ benzylpenicillin_dose_mg: 75, benzylpenicillin_dose_units_per_kg: 50000, benzylpenicillin_interval_h: 8, very_severe_condition: true }));
  assert.equal(o.derived.values.benzylpenicillin_regimen_sources_diverge, false);
  assert.equal(res(o, 'SEP-005').observation, O.CONSISTENT);
  assert.ok(!cfs(o).includes('CF-006'));
});

// =================== Р1: SEP-006 / CF-007 (гентамицин) ===================
test('Р1 SEP-006: возрастные режимы таблицы стр. 18 — все группы и границы 7 и 28 суток', () => {
  const rows = (ga, pna) => D.gentamicinTableRows(ga, pna).rows.map(r => [r.dose, r.interval]);
  const bnd = (ga, pna) => D.gentamicinTableRows(ga, pna).boundary;
  assert.deepEqual(rows(27, 0), [[5, 48]]); assert.deepEqual(rows(29, 7), [[5, 48]]); assert.deepEqual(rows(29, 8), [[4, 36]]);
  assert.deepEqual(rows(27, 27), [[4, 36]]); assert.deepEqual(rows(27, 28), [[4, 36], [4, 24]]); assert.equal(bnd(27, 28), true);
  assert.deepEqual(rows(27, 29), [[4, 24]]); assert.deepEqual(rows(29.9, 2), [[5, 48]]);
  assert.deepEqual(rows(30, 6), [[4.5, 36]]); assert.deepEqual(rows(34, 8), [[4, 24]]);
  assert.deepEqual(rows(32, 7), [[4.5, 36], [4, 24]]); assert.equal(bnd(32, 7), true);
  assert.deepEqual(rows(35, 0), [[4, 24]]); assert.deepEqual(rows(41, 30), [[4, 24]]);
  assert.equal(bnd(27, 2), false); assert.equal(bnd(38, 2), false);
});

test('Р1 SEP-006: ТАБ-G1–G9 — CF-007 и SEP-006-A4; G9 не подтверждается только по тексту; SEP-006-A3 сохраняется', () => {
  for (const id of ['ТАБ-G1', 'ТАБ-G2', 'ТАБ-G3', 'ТАБ-G4', 'ТАБ-G5', 'ТАБ-G6', 'ТАБ-G7', 'ТАБ-G8', 'ТАБ-G9']) {
    const o = tab(id), r = res(o, 'SEP-006');
    assert.equal(r.observation, O.AMBIGUOUS_PENDING, id);
    assert.ok(r.active_ambiguities.includes('SEP-006-A4'), id);
    assert.ok(cfs(o).includes('CF-007'), id);
    assert.ok(ids(r).includes('table_band') && ids(r).includes('sources_diverge'), id);
  }
  for (const id of ['ТАБ-G3', 'ТАБ-G4', 'ТАБ-G5', 'ТАБ-G6', 'ТАБ-G7', 'ТАБ-G8']) assert.ok(res(tab(id), 'SEP-006').active_ambiguities.includes('SEP-006-A3'), id);
  for (const id of ['ТАБ-G4', 'ТАБ-G5', 'ТАБ-G7']) assert.ok(ids(res(tab(id), 'SEP-006')).includes('table_boundary'), id);
  assert.equal(lab(res(tab('ТАБ-G9'), 'SEP-006'), 'table_band').text, 'Таблица препаратов (стр. 18) для ГВ 38 нед и возраста 2 сут: 35 недель и старше: 4 мг/кг каждые 24 часа');
});

test('Р1 SEP-006: без ГВ или возраста сверка с таблицей не выполняется — CF-007 нет, подпись «не выполнена»', () => {
  const o = run(GM({ gentamicin_dose_mg: 5, gentamicin_interval_h: 36 }));
  const r = res(o, 'SEP-006');
  assert.ok(!cfs(o).includes('CF-007'));
  assert.ok(ids(r).includes('table_not_checked'));
  assert.equal(o.derived.values.gentamicin_table_check_status, 'no_age_data');
  assert.ok(!('gentamicin_regimen_sources_diverge' in o.derived.values));
});

test('Р1 SEP-006: режим не совпадает ни с текстом, ни с таблицей — «отличается» без CF-007 (блокировка не постоянная)', () => {
  const o = run(GM({ gentamicin_dose_mg: 3, gentamicin_interval_h: 36, gestational_age_weeks: 38, postnatal_age_days: 2 }));
  assert.ok(!cfs(o).includes('CF-007'));
  assert.equal(part(res(o, 'SEP-006'), 'dose').observation, O.DIFFERS);
});

test('Р1/Т5 SEP-006: подпись Q24 скрыта при активной SEP-006-A1 (НЭК) и показана без неё; Q24 открыт', () => {
  const withNec = ev('SEP-006', { early_onset_sepsis_suspected: true, gentamicin_given: true, gentamicin_initial_dose_mg_kg: 4, nec_stage: '2а' });
  assert.ok(withNec.active_ambiguities.includes('SEP-006-A1'));
  assert.ok(!ids(withNec).includes('dose_q24'));
  const noNec = ev('SEP-006', { early_onset_sepsis_suspected: true, gentamicin_given: true, gentamicin_initial_dose_mg_kg: 4, gentamicin_interval_h: 36 });
  assert.ok(ids(noNec).includes('dose_q24'));
  assert.equal(ED.open_questions.find(q => q.id === 'Q24').status, 'открыт');
});

// =================== Р2: NEC-003 ===================
test('Р2 NEC-003: продолжение энтеральной нагрузки видно как отличие, даже когда срок возобновления неоднозначен', () => {
  const o = run({ nec_stage: '1б', gi_passage_restored: false, enteral_feeding_stopped: false, enteral_feeding_resumed_at: at(4, '10:00') });
  const r = res(o, 'NEC-003');
  assert.equal(part(r, 'stop').observation, O.DIFFERS);
  assert.deepEqual(part(r, 'resume').active_ambiguities, ['NEC-003-A1']);
  assert.equal(r.observation, O.AMBIGUOUS_PENDING);
  assert.ok(cfs(o).includes('CF-003'));
  // кормление прекращено, не возобновлялось — «совпадает»; сведений о прекращении нет — «нет данных»
  assert.equal(ev('NEC-003', { nec_stage: '1б', gi_passage_restored: false, enteral_feeding_stopped: true }).observation, O.CONSISTENT);
  assert.equal(ev('NEC-003', { nec_stage: '1б', gi_passage_restored: false }).observation, O.NOT_ASSESSED);
});

// =================== Р3: NEC-004 ===================
const N4 = (onset, conf, resumed, extra) => Object.assign({ nec_stage: '2а', nec_onset_at: onset, nec_confirmed_at: conf, enteral_feeding_resumed_at: resumed }, extra || {});
test('Р3 NEC-004: одинаковая оценка двух отсчётов — без блокировки; разная или один неизвестен — NEC-004-A1', () => {
  const same7 = ev('NEC-004', N4(at(1, '10:00'), at(1, '18:00'), at(9, '10:00'), { clinical_lab_improvement_documented: true }));
  assert.equal(same7.observation, O.CONSISTENT);
  const same4 = ev('NEC-004', N4(at(1, '10:00'), at(1, '18:00'), at(4, '10:00'), { clinical_lab_improvement_documented: true }));
  assert.equal(same4.observation, O.DIFFERS); assert.equal(part(same4, 'term').observation, O.DIFFERS);
  const differ = ev('NEC-004', N4(at(1, '10:00'), at(3, '10:00'), at(7, '10:00'), { clinical_lab_improvement_documented: true }));
  assert.deepEqual(part(differ, 'term').active_ambiguities, ['NEC-004-A1']);
  const oneUnknown = ev('NEC-004', { nec_stage: '2а', nec_onset_at: at(1, '10:00'), enteral_feeding_resumed_at: at(9, '10:00'), clinical_lab_improvement_documented: true });
  assert.deepEqual(part(oneUnknown, 'term').active_ambiguities, ['NEC-004-A1']);
});
test('Р3 NEC-004: улучшение проверяется отдельно — по одному сроку полного соответствия нет', () => {
  const noImpr = ev('NEC-004', N4(at(1, '10:00'), at(1, '18:00'), at(9, '10:00')));
  assert.equal(part(noImpr, 'term').observation, O.CONSISTENT);
  assert.equal(part(noImpr, 'improvement').observation, O.NOT_ASSESSED);
  assert.notEqual(noImpr.observation, O.CONSISTENT);
  const impr = ev('NEC-004', N4(at(1, '10:00'), at(1, '18:00'), at(9, '10:00'), { clinical_lab_improvement_documented: false }));
  assert.equal(impr.observation, O.DIFFERS);
});

// =================== Р4: NEC-008 ===================
test('Р4 NEC-008: A1 остаётся постоянной при курсе ≥10 суток; показаны сутки, часы, первая и последняя доза', () => {
  for (const end of [at(11, '10:00'), at(14, '10:00')]) {
    const r = ev('NEC-008', Object.assign({ nec_stage: '2а', antibiotics_started: true }, COURSE(at(1, '10:00'), end)));
    assert.deepEqual(r.active_ambiguities, ['NEC-008-A1']);
    assert.equal(r.observation, O.AMBIGUOUS_PENDING);
  }
  const r = ev('NEC-008', Object.assign({ nec_stage: '2а', antibiotics_started: true }, COURSE(at(1, '10:00'), at(11, '10:00'))));
  assert.equal(lab(r, 'course_duration').text, 'Длительность курса: 11 календарных сут, 240 ч; первая доза — 2026-01-01T10:00+05:00, последняя — 2026-01-11T10:00+05:00');
});

// =================== Р5: RDS-009 ===================
test('Р5 RDS-009: «unknown» вместо дозы — «Недостаточно данных», не неоднозначность и не «нет»', () => {
  const r = ev('RDS-009', { rds_diagnosed: true, surfactant_drug: 'порактант альфа', surfactant_initial_dose_mg_kg: 'unknown' });
  assert.equal(r.observation, O.NOT_ASSESSED);
  assert.deepEqual(r.active_ambiguities, []);
});

// =================== Р6: RDS-003 ===================
const R3B = x => Object.assign({ rds_risk: true, antenatal_steroids_given: false, surfactant_in_delivery_room: true }, x);
test('Р6 RDS-003: сведений об интубации нет — RDS-003-A2; отсутствие записи не превращается в «не потребовалась»', () => {
  for (const intub of [undefined, 'unknown']) {
    const d = R3B(intub === undefined ? {} : { intubation_needed_for_stabilization: intub });
    const o = run(d), r = res(o, 'RDS-003');
    assert.deepEqual(r.active_ambiguities, ['RDS-003-A2'], String(intub));
    assert.equal(o.derived.values.intubation_needed_status, 'no_record');
    assert.ok(ids(r).includes('intubation_no_record'));
  }
  // документированное «не потребовалась» — прежняя ветка A2 (без изменений)
  assert.deepEqual(ev('RDS-003', R3B({ intubation_needed_for_stabilization: false })).active_ambiguities, ['RDS-003-A2']);
});
test('Р6 RDS-003: другие самостоятельные показания сохраняются — интубация потребовалась или показание по FiO₂', () => {
  assert.equal(ev('RDS-003', R3B({ intubation_needed_for_stabilization: true })).observation, O.CONSISTENT);
  assert.equal(ev('RDS-003', R3B({ intubation_needed_for_stabilization: true, surfactant_in_delivery_room: false })).observation, O.DIFFERS);
  const fio2 = ev('RDS-003', R3B({ gestational_age_weeks: 28, fio2: 0.45 }));
  assert.deepEqual(fio2.active_ambiguities, []); assert.equal(fio2.observation, O.CONSISTENT);
  // без РДС и риска РДС — правило неприменимо, A2 не включается
  const term = ev('RDS-003', { rds_risk: false, rds_diagnosed: false, gestational_age_weeks: 39, antenatal_steroids_given: false, surfactant_in_delivery_room: false });
  assert.equal(term.applicability, 'неприменимо'); assert.deepEqual(term.active_ambiguities, []);
});

// =================== Р7: NEC-005 ===================
const PN = x => Object.assign({ nec_stage: '2а', pn_type: 'full', nec_onset_at: at(5, '10:00') }, x);
test('Р7 NEC-005: ПП начато и прекращено до начала НЭК — не считается проводившимся; ложного «совпадает» нет', () => {
  const o = run(PN({ pn_started_at: at(1, '10:00'), pn_stopped_at: at(3, '10:00') }));
  const r = res(o, 'NEC-005');
  assert.notEqual(r.observation, O.CONSISTENT);
  assert.equal(r.observation, O.NOT_ASSESSED);
  assert.equal(o.derived.values.pn_stopped_before_nec_onset, true);
  assert.ok(ids(r).includes('pn_stopped_before_onset'));
  // «ПП шло на момент НЭК» при прекращении до НЭК — противоречие, значение не используется
  const c = run(PN({ pn_running_at_nec_onset: true, pn_started_at: at(1, '10:00'), pn_stopped_at: at(3, '10:00') }));
  assert.notEqual(res(c, 'NEC-005').observation, O.CONSISTENT);
  assert.equal(c.derived.reasons.pn_running_at_nec_onset, D.REASON.CONTRADICTORY);
});
test('Р7 NEC-005: прекращено после начала НЭК — как раньше; прекращение раньше начала ПП — противоречивая хронология', () => {
  assert.equal(ev('NEC-005', PN({ pn_started_at: at(1, '10:00'), pn_stopped_at: at(9, '10:00') })).observation, O.CONSISTENT);
  const o = run(PN({ pn_started_at: at(3, '10:00'), pn_stopped_at: at(2, '10:00') }));
  assert.equal(o.derived.reasons.pn_stopped_before_nec_onset, D.REASON.CONTRADICTORY);
  assert.notEqual(res(o, 'NEC-005').observation, O.CONSISTENT);
  // без pn_stopped_at — поведение прежнее (новой блокировки нет)
  assert.deepEqual(ev('NEC-005', PN({ pn_started_at: at(5, '12:00') })).active_ambiguities, []);
});

// =================== Р8: RDS-008 ===================
const R8 = x => Object.assign({ antibiotics_started: true }, x);
test('Р8 RDS-008: без ручной записи — вычисление по отметкам (как SEP-002)', () => {
  const before = run(R8({ blood_culture_drawn_at: at(1, '09:40'), first_abx_dose_administered_at: at(1, '10:00') }));
  assert.equal(res(before, 'RDS-008').observation, O.CONSISTENT);
  assert.equal(before.derived.values.blood_culture_before_antibiotics_basis, 'computed');
  assert.ok(ids(res(before, 'RDS-008')).includes('computed_from_timestamps'));
  const after = ev('RDS-008', R8({ blood_culture_drawn_at: at(1, '10:20'), first_abx_dose_administered_at: at(1, '10:00') }));
  assert.equal(after.observation, O.DIFFERS);
  const same = ev('RDS-008', R8({ blood_culture_drawn_at: at(1, '10:00'), first_abx_dose_administered_at: at(1, '10:00') }));
  assert.equal(same.observation, O.NOT_ASSESSED);
});
test('Р8 RDS-008: ручное значение не перезаписывается; противоречие ручного и вычисленного — показывается, «нет данных»', () => {
  const o = run(R8({ blood_culture_before_antibiotics: true, blood_culture_drawn_at: at(1, '10:20'), first_abx_dose_administered_at: at(1, '10:00') }));
  const r = res(o, 'RDS-008');
  assert.equal(r.observation, O.NOT_ASSESSED);
  assert.equal(o.derived.values.blood_culture_before_antibiotics_basis, 'conflict');
  assert.ok(ids(r).includes('manual_vs_timestamps_conflict'));
  assert.equal(r.card.facts.find(f => f.field === 'blood_culture_before_antibiotics').value, true);
  const m = run(R8({ blood_culture_before_antibiotics: true }));
  assert.equal(res(m, 'RDS-008').observation, O.CONSISTENT);
  assert.equal(m.derived.values.blood_culture_before_antibiotics_basis, 'manual');
  // «unknown» в ручном поле — нет данных, не «нет»
  assert.equal(ev('RDS-008', R8({ blood_culture_before_antibiotics: 'unknown' })).observation, O.NOT_ASSESSED);
});

// =================== SEP-008-A3 (решение 19.11 20:06) ===================
const S8 = x => Object.assign({ antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'отрицательный', high_risk_factors: false, facility_utc_offset: '+05:00' }, x);
test('SEP-008-A3: >5 календарных суток при ≤120 ч — экспертное решение; >120 ч — предварительное «отличается»', () => {
  const a3 = ev('SEP-008', S8(COURSE('2026-01-01T18:30Z', at(6, '10:00'))));
  assert.deepEqual(a3.active_ambiguities, ['SEP-008-A3']);
  assert.ok(ids(a3).includes('days_hours_diverge') && ids(a3).includes('course_duration'));
  const over = ev('SEP-008', S8(COURSE(at(1, '10:00'), at(6, '12:00'))));
  assert.equal(over.observation, O.DIFFERS); assert.deepEqual(over.active_ambiguities, []);
  assert.equal(ev('SEP-008', S8(COURSE(at(1, '10:00'), at(5, '10:00')))).observation, O.CONSISTENT);
  const running = ev('SEP-008', S8({ course_completed: false, abx_course_started_at: at(1, '10:00') }));
  assert.ok(!running.active_ambiguities.includes('SEP-008-A3'));
});

// =================== SEP-009-A2 (решение 19.11 20:11) ===================
test('SEP-009-A2: схема бензилпенициллин + гентамицин — информационная подпись без блокировки; правило неприменимо', () => {
  const r = ev('SEP-009', { antibiotics_started: true, empirical_regimen: 'benzylpenicillin+gentamicin', improving: true, blood_culture_result: 'положительный', meningitis: false });
  assert.equal(r.observation, O.NOT_APPLICABLE);
  assert.ok(ids(r).includes('a2_benzylpenicillin_info'));
  assert.deepEqual(r.active_ambiguities, []);
  const amp = ev('SEP-009', { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'положительный', meningitis: false });
  assert.ok(!ids(amp).includes('a2_benzylpenicillin_info'));
  assert.equal(DB.rules.find(x => x.rule_id === 'SEP-009').ambiguities.find(a => a.id === 'SEP-009-A2').blocking, 'no');
});

// =================== SEP-010 (решение 19.11 21:23) ===================
const S10 = x => Object.assign({ antibiotics_started: true, meningitis: false }, x);
test('SEP-010: A1 только при положительном посеве; A2 постоянная', () => {
  const neg = ev('SEP-010', S10(Object.assign({ blood_culture_result: 'отрицательный', high_risk_factors: true }, COURSE(at(1, '10:00'), at(7, '10:00')))));
  assert.ok(neg.card.labels.some(l => l.id === 'course_duration'));
  assert.deepEqual(neg.active_ambiguities, ['SEP-010-A2']);
  const pos = ev('SEP-010', S10(Object.assign({ blood_culture_result: 'положительный' }, COURSE(at(1, '10:00'), at(7, '10:00')))));
  assert.deepEqual(pos.active_ambiguities, ['SEP-010-A1', 'SEP-010-A2']);
});
test('SEP-010: причина продления и клиническое обоснование — раздельно; осмотр — три состояния', () => {
  const b = S10(Object.assign({ blood_culture_result: 'отрицательный', high_risk_factors: true, extension_reason: ['nec'] }, COURSE(at(1, '10:00'), at(12, '10:00'))));
  const notFound = ev('SEP-010', Object.assign({}, b, { extension_justification_status: 'not_found_in_documentation' }));
  assert.ok(ids(notFound).includes('extension_documented') && ids(notFound).includes('extension_not_found'));
  assert.ok(!ids(notFound).includes('extension_justification_found'));
  for (const [v, id] of [[true, 'daily_exam'], [false, 'daily_exam_not_documented'], [undefined, 'daily_exam_no_record']]) {
    const d = Object.assign({}, b); if (v !== undefined) d.daily_clinical_exam_documented = v;
    const r = ev('SEP-010', d);
    assert.ok(ids(r).includes(id), String(v));
    assert.equal(['daily_exam', 'daily_exam_not_documented', 'daily_exam_no_record'].filter(x => ids(r).includes(x)).length, 1);
  }
});

// =================== Т1, Т3 ===================
test('Т1: подписи правила не показываются, когда правило неприменимо (кроме явно разрешённой SEP-009-A2)', () => {
  const r = ev('SEP-010', { antibiotics_started: true, meningitis: true, blood_culture_result: 'отрицательный', high_risk_factors: true, extension_reason: ['nec'], ...COURSE(at(1, '10:00'), at(12, '10:00')) });
  assert.equal(r.observation, O.NOT_APPLICABLE);
  assert.deepEqual(ids(r), []);
  const allowed = DB.rules.flatMap(x => (x.card_labels || []).filter(c => c.show_when_not_applicable).map(c => x.rule_id + ':' + c.id));
  assert.deepEqual(allowed, ['SEP-009:a2_benzylpenicillin_info']);
});
test('Т3 SEP-003: «иное самостоятельное показание» — нет строки «не хватает данных» про вид назначения', () => {
  const r = ev('SEP-003', { sepsis_suspected: true, immunoglobulin_given: true, immunoglobulin_purpose: 'other_indication' });
  assert.deepEqual(r.active_ambiguities, ['SEP-003-A2']);
  assert.deepEqual(r.card.data_gaps_behind_ambiguity, []);
  assert.ok(!ids(r).includes('gaps_behind_ambiguity'));
});

// =================== Словарь данных и вычисляемые поля ===================
test('словарь: новые поля описаны; вычисляемые совпадают с derive.js; ручные значения вычисляемых полей игнорируются', () => {
  for (const f of ['benzylpenicillin_dose_units_per_kg', 'pn_stopped_at']) assert.ok(DB.data_dictionary[f] && DB.data_dictionary[f].type !== 'derived' && DB.data_dictionary[f].since === 'rules-0.3', f);
  const dict = Object.entries(DB.data_dictionary).filter(([, e]) => e.type === 'derived').map(([k]) => k).sort();
  assert.deepEqual(dict, [...D.DERIVED_FIELDS].sort());
  const o = run(BZ({ benzylpenicillin_dose_mg: 90, benzylpenicillin_interval_h: 12, benzylpenicillin_regimen_sources_diverge: false }));
  assert.ok(o.derived.manual_values_ignored.includes('benzylpenicillin_regimen_sources_diverge'));
});
