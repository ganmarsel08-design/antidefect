'use strict';
// Исправления этапа 6 (после независимой проверки): 13 пунктов согласованного плана, уточнения 17:34 (дозы)
// и 17:53 (актуальная масса). Сценарии R1–R9, S1–S11, T1–T13, D1–D22, X1–X6, P1–P4, I1–I5, N1–N3, V1–V10.
// Только синтетические данные. Ни один сценарий не формирует окончательного вывода.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const E = require('../rules-engine.js');
const D = require('../derive.js');

const ROOT = path.join(__dirname, '..', '..');
const DB = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'pilot-rules.json'), 'utf8'));
const ED = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'expert-decisions.json'), 'utf8'));
const BASE = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'build', 'baseline-2239c52.json'), 'utf8'));
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'build', 'fixture-d314a58.json'), 'utf8'));
const O = E.OBS;
const clone = x => JSON.parse(JSON.stringify(x));

const RUNS = []; // все входы, прогнанные в этом файле, — для V5 и V10
function run(data, just, db) {
  const o = E.evaluate(db || DB, { synthetic: true, data, justifications: just }, { expert_decisions: ED });
  assert.equal(o.final_conclusion, null);
  for (const r of o.results) assert.equal(r.final, false);
  if (!db) RUNS.push({ data: clone(data), just });
  return o;
}
const res = (o, id) => o.results.find(r => r.rule_id === id);
const ev = (id, data, just, db) => res(run(data, just, db), id);
const part = (r, id) => r.parts.find(p => p.part_id === id);
const lab = (r, id) => r.card.labels.find(l => l.id === id);
const ids = r => r.card.labels.map(l => l.id);
const at = (d, hm, tz) => `2026-01-${String(d).padStart(2, '0')}T${hm}${tz || '+05:00'}`;
const J = (id, extra) => ({ [id]: Object.assign({ text: 'синтетическое обоснование', author: 'врач-синтетик' }, extra || {}) });

// =================== RDS-007: интервал «исключение ТБИ → отмена АБТ» (пункт 1) ===================
const RDS = stop => Object.assign({ rds_diagnosed: true, serious_bacterial_infection_excluded: true, antibiotics_started: true, sbi_excluded_at: at(2, '10:00') },
  stop === undefined ? {} : { antibiotics_stopped_at: stop });

test('R1: отмена за 2 ч до исключения ТБИ — отличие, подпись с интервалом −2 ч, RDS-007-A2 не активна', () => {
  const r = ev('RDS-007', RDS(at(2, '08:00')));
  assert.equal(r.observation, O.DIFFERS);
  assert.equal(part(r, 'stop').observation, O.DIFFERS);
  assert.ok(!r.active_ambiguities.includes('RDS-007-A2'));
  assert.match(lab(r, 'stop_before_exclusion').text, /интервал -2 ч — как отмена после исключения не засчитывается/);
});
test('R2: отмена за 1 минуту до исключения — отличие', () => {
  assert.equal(ev('RDS-007', RDS(at(2, '09:59'))).observation, O.DIFFERS);
});
test('R3: одинаковое время — «Недостаточно данных», причина «порядок событий не установлен»; интервал 0 ч показан', () => {
  const o = run(RDS(at(2, '10:00')));
  const r = res(o, 'RDS-007');
  assert.equal(r.observation, O.NOT_ASSESSED);
  assert.equal(part(r, 'stop').observation, O.NOT_ASSESSED);
  assert.equal(r.card.missing_reasons.abx_stopped_after_sbi_exclusion, D.REASON.SAME_TIME);
  assert.equal(o.derived.values.hours_sbi_excluded_to_abx_stop, 0);
  assert.ok(ids(r).includes('stop_same_time'));
  assert.ok(!ids(r).includes('stop_before_exclusion') && !ids(r).includes('stop_after_exclusion'));
});
test('R4: отмена через 1 минуту после исключения — RDS-007-A2', () => {
  const r = ev('RDS-007', RDS(at(2, '10:01')));
  assert.equal(r.observation, O.AMBIGUOUS_PENDING);
  assert.deepEqual(r.active_ambiguities, ['RDS-007-A2']);
});
test('R5: отмена через 4 ч — RDS-007-A2, в карточке «через 4 ч»', () => {
  const r = ev('RDS-007', RDS(at(2, '14:00')));
  assert.deepEqual(r.active_ambiguities, ['RDS-007-A2']);
  assert.match(lab(r, 'stop_after_exclusion').text, /^АБТ отменена через 4 ч после исключения ТБИ; своевременность оценивает эксперт \(RDS-007-A2\)$/);
  assert.equal(r.card.facts.find(f => f.field === 'hours_sbi_excluded_to_abx_stop').value, 4);
});
test('R6: ни одна категория обоснования и ни один интервал не дают RDS-007 «совпадает»', () => {
  for (const stop of [at(2, '08:00'), at(2, '10:00'), at(2, '10:01'), at(2, '14:00'), undefined])
    for (const cat of [undefined, ...Object.keys(E.JUSTIFICATION_CATEGORIES)]) {
      const r = ev('RDS-007', RDS(stop), J('RDS-007', cat ? { category: cat } : {}));
      assert.notEqual(r.observation, O.CONSISTENT, `${stop} ${cat}`);
    }
});
test('R7: нет времени отмены — «Недостаточно данных»', () => {
  assert.equal(ev('RDS-007', RDS()).observation, O.NOT_ASSESSED);
});
test('R8: та же пара моментов в разной записи часовых поясов даёт тот же исход', () => {
  for (const [a, b] of [[at(2, '08:00'), '2026-01-02T03:00Z'], [at(2, '10:00'), '2026-01-02T05:00Z'], [at(2, '14:00'), '2026-01-02T09:00+00:00']]) {
    const x = ev('RDS-007', RDS(a)), y = ev('RDS-007', Object.assign(RDS(b), { sbi_excluded_at: '2026-01-02T05:00Z' }));
    assert.equal(x.observation, y.observation); assert.deepEqual(x.active_ambiguities, y.active_ambiguities);
  }
});
test('R9: RDS-007-A1 по-прежнему срабатывает ровно там же, где на 2239c52 (27 сочетаний)', () => {
  const oldRule = Object.assign(clone(DB.rules.find(r => r.rule_id === 'RDS-007')), {
    applicability: BASE.rules['RDS-007'].applicability, requirement: BASE.rules['RDS-007'].requirement });
  oldRule.ambiguities = oldRule.ambiguities.filter(a => a.id === 'RDS-007-A1').map(a => { const x = clone(a); delete x.part; return x; });
  const oldDb = Object.assign(clone(DB), { rules: [oldRule] });
  const V = [true, false, undefined]; let n = 0;
  for (const rds of V) for (const sbi of V) for (const abx of V) {
    const d = {}; if (rds !== undefined) d.rds_diagnosed = rds; if (sbi !== undefined) d.serious_bacterial_infection_excluded = sbi; if (abx !== undefined) d.antibiotics_started = abx;
    const before = res(E.evaluate(oldDb, { synthetic: true, data: d }), 'RDS-007').active_ambiguities.includes('RDS-007-A1');
    assert.equal(ev('RDS-007', d).active_ambiguities.includes('RDS-007-A1'), before, JSON.stringify(d)); n++;
  }
  assert.equal(n, 27);
});

// =================== SEP-003: текст основания и консилиум раздельно (пункт 2) ===================
const IG = extra => Object.assign({ sepsis_suspected: true, immunoglobulin_given: true, immunoglobulin_purpose: 'sepsis_treatment_or_prophylaxis', immunoglobulin_use_type: 'individualized' }, extra);
const TEXT = 'синтетическое особое клиническое основание';
test('S1: текст основания + консилиум — SEP-003-A2', () => {
  const r = ev('SEP-003', IG({ clinical_evidence: TEXT, consilium_documented: true }));
  assert.deepEqual(r.active_ambiguities, ['SEP-003-A2']);
  assert.ok(!ids(r).some(i => ['basis_without_consilium', 'consilium_without_basis', 'basis_not_found'].includes(i)));
});
test('S2: текст основания, записано «консилиум не проводился» — A2 и подпись «основание изложено, консилиум не документирован»', () => {
  const r = ev('SEP-003', IG({ clinical_evidence: TEXT, consilium_documented: false }));
  assert.deepEqual(r.active_ambiguities, ['SEP-003-A2']);
  assert.equal(lab(r, 'basis_without_consilium').text, 'Основание изложено, решение консилиума не документировано');
});
test('S3: текст основания, записи о консилиуме нет — A2 и та же подпись', () => {
  const r = ev('SEP-003', IG({ clinical_evidence: TEXT }));
  assert.deepEqual(r.active_ambiguities, ['SEP-003-A2']);
  assert.ok(ids(r).includes('basis_without_consilium'));
});
test('S4: консилиум без текста основания — «Недостаточно данных» с подписью', () => {
  const r = ev('SEP-003', IG({ consilium_documented: true }));
  assert.equal(r.observation, O.NOT_ASSESSED);
  assert.equal(lab(r, 'consilium_without_basis').text, 'Консилиум документирован, содержание особого клинического основания не найдено');
  assert.equal(r.card.missing_reasons.ig_use_individualized_with_basis, D.REASON.BASIS_TEXT_NOT_FOUND);
});
test('S5: без текста, консилиум не проводился — «Недостаточно данных», «Обоснование не найдено в доступной документации»', () => {
  const r = ev('SEP-003', IG({ consilium_documented: false }));
  assert.equal(r.observation, O.NOT_ASSESSED);
  assert.equal(lab(r, 'basis_not_found').text, 'Обоснование не найдено в доступной документации');
});
test('S6: без текста и без записи о консилиуме — то же', () => {
  const r = ev('SEP-003', IG({}));
  assert.equal(r.observation, O.NOT_ASSESSED);
  assert.ok(ids(r).includes('basis_not_found'));
});
test('S7: консилиум + публикация, текст пустой или из пробелов — «Недостаточно данных» (публикация текст не заменяет)', () => {
  for (const ce of [undefined, '', '   ']) {
    const d = IG({ consilium_documented: true, research_reference: 'doi:10.0000/синтетика' }); if (ce !== undefined) d.clinical_evidence = ce;
    assert.equal(ev('SEP-003', d).observation, O.NOT_ASSESSED, JSON.stringify(ce));
  }
});
test('S8: рутинно — отличие, даже при наличии текста и консилиума', () => {
  assert.equal(ev('SEP-003', IG({ immunoglobulin_use_type: 'routine', clinical_evidence: TEXT, consilium_documented: true })).observation, O.DIFFERS);
});
test('S9: иное самостоятельное показание — SEP-003-A2', () => {
  assert.deepEqual(ev('SEP-003', { sepsis_suspected: true, immunoglobulin_given: true, immunoglobulin_purpose: 'other_indication' }).active_ambiguities, ['SEP-003-A2']);
});
test('S10: цель введения не указана — «Недостаточно данных»', () => {
  assert.equal(ev('SEP-003', { sepsis_suspected: true, immunoglobulin_given: true, clinical_evidence: TEXT }).observation, O.NOT_ASSESSED);
});
test('S11: условие SEP-003-A2 побайтово совпадает с d314a58', () => {
  const a2 = DB.rules.find(r => r.rule_id === 'SEP-003').ambiguities.find(a => a.id === 'SEP-003-A2');
  assert.equal(JSON.stringify(a2), JSON.stringify(FX.blocking_ambiguities['SEP-003-A2']));
});

// =================== Календарные сутки по часовому поясу организации (пункт 3) ===================
// Курс 01.01 23:30 → 08.01 00:30 (+05:00), 145 ч.
const CRS = (a, b, fac) => Object.assign({ course_completed: true, abx_course_started_at: a, abx_course_ended_at: b }, fac === undefined ? {} : { facility_utc_offset: fac });
const days = d => D.derive(d).derived.abx_course_days;
const hrs = d => D.derive(d).derived.abx_course_hours;
const T1 = CRS(at(1, '23:30'), at(8, '00:30'), '+05:00');
const T2 = CRS('2026-01-01T18:30Z', '2026-01-07T19:30Z', '+05:00');
const T3 = CRS(at(1, '23:30'), '2026-01-07T19:30Z', '+05:00');
const T4 = CRS('2026-01-02T00:30+06:00', '2026-01-08T01:30+06:00', '+05:00');
const T5 = CRS('2026-01-01T18:30Z', '2026-01-07T19:30Z');
const T6 = CRS(at(1, '23:30'), '2026-01-07T19:30Z');
test('T1–T4: пояс организации +05:00 — 8 календарных суток при любой записи отметок', () => {
  for (const d of [T1, T2, T3, T4]) assert.equal(days(d), 8, JSON.stringify(d));
});
test('T5: обе отметки в Z, пояс организации не указан — сутки по общему смещению (7)', () => {
  assert.equal(days(T5), 7);
});
test('T6: разные смещения без пояса организации — сутки не считаются, причина указана', () => {
  const x = D.derive(T6);
  assert.ok(!('abx_course_days' in x.derived));
  assert.equal(x.reasons.abx_course_days, D.REASON.MIXED_TZ);
});
test('T7: неверный формат пояса организации — «Недостаточно данных»', () => {
  for (const f of ['+5', 'UTC+5', '+05:00:00', '05:00', '+05:60', '+15:00', 5, '']) {
    const x = D.derive(CRS(at(1, '23:30'), at(8, '00:30'), f));
    assert.ok(!('abx_course_days' in x.derived), String(f));
    assert.equal(x.reasons.abx_course_days, D.REASON.BAD_FACILITY_TZ, String(f));
  }
});
test('T8: переход через год 31.12 → 02.01 — 3 суток', () => {
  assert.equal(days(CRS('2025-12-31T10:00+05:00', '2026-01-02T10:00+05:00', '+05:00')), 3);
  assert.equal(days(CRS('2025-12-31T10:00+05:00', '2026-01-02T10:00+05:00')), 3);
});
test('T9: Z и +00:00 — одно смещение', () => {
  assert.equal(days(CRS('2026-01-01T10:00Z', '2026-01-03T10:00+00:00')), 3);
});
test('T10: часы не зависят от пояса — 145 ч во всех вариантах T1–T6', () => {
  for (const d of [T1, T2, T3, T4, T5, T6]) assert.equal(hrs(d), 145);
});
test('T11: NEC-005 — день начала ПП по поясу организации (2-й день → отличие); без пояса при разных смещениях — нет данных', () => {
  const d = { nec_stage: '2а', pn_type: 'full', pn_running_at_nec_onset: false, nec_onset_at: '2026-01-01T18:30Z', pn_started_at: at(2, '00:30') };
  const o1 = run({ ...d, facility_utc_offset: '+05:00' });
  assert.equal(o1.derived.values.pn_start_illness_day, 2);
  assert.equal(res(o1, 'NEC-005').observation, O.DIFFERS);
  const r2 = ev('NEC-005', d);
  assert.equal(r2.observation, O.NOT_ASSESSED);
  assert.equal(r2.card.missing_reasons.pn_start_illness_day, D.REASON.MIXED_TZ);
});
test('T12: NEC-004 — оба отсчёта по поясу организации; без пояса при разных смещениях — нет данных', () => {
  const d = { nec_stage: '2а', nec_onset_at: '2026-01-01T18:30Z', nec_confirmed_at: at(2, '10:00'), enteral_feeding_resumed_at: at(8, '00:30') };
  const x = D.derive({ ...d, facility_utc_offset: '+05:00' }).derived;
  assert.equal(x.nec_day_from_onset_at_feeding_resumption, 8);
  assert.equal(x.nec_day_from_confirmation_at_feeding_resumption, 7);
  const y = D.derive(d);
  assert.ok(!('nec_day_from_onset_at_feeding_resumption' in y.derived));
  assert.equal(y.reasons.nec_day_from_onset_at_feeding_resumption, D.REASON.MIXED_TZ);
  assert.equal(y.derived.nec_day_from_confirmation_at_feeding_resumption, 7);
});
test('T13: SEP-008 — 6 суток по поясу организации → отличие; без пояса при разных смещениях → нет данных', () => {
  const b = { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'отрицательный', high_risk_factors: false,
    course_completed: true, abx_course_started_at: '2026-01-01T18:30Z', abx_course_ended_at: at(6, '10:00') };
  assert.equal(ev('SEP-008', { ...b, facility_utc_offset: '+05:00' }).observation, O.DIFFERS);
  assert.equal(ev('SEP-008', b).observation, O.NOT_ASSESSED);
});

// =================== SEP-005/006: три величины дозы (пункт 4, уточнения 17:34 и 17:53) ===================
const WT = (drug, w, p) => ({ weight_measured_at: w === undefined ? at(1, '08:00') : w, [`${drug}_prescribed_at`]: p === undefined ? at(1, '10:00') : p });
const BP = extra => Object.assign({ early_onset_sepsis_suspected: true, benzylpenicillin_given: true, meningitis: false, benzylpenicillin_interval_h: 12, weight_kg: 1.2 }, WT('benzylpenicillin'), extra);
const GM = extra => Object.assign({ early_onset_sepsis_suspected: true, gentamicin_given: true, gentamicin_interval_h: 36 }, WT('gentamicin'), extra);
const dv = data => run(data).derived.values;

test('D1: 30 мг / 1,2 кг, записано «25» — записи согласованы, вычислено 25 → совпадает', () => {
  const v = dv(BP({ benzylpenicillin_dose_mg: 30, benzylpenicillin_dose_mg_kg: '25' }));
  assert.equal(v.benzylpenicillin_dose_records_consistent, true);
  assert.equal(v.benzylpenicillin_dose_basis, 'calculated');
  const r = ev('SEP-005', BP({ benzylpenicillin_dose_mg: 30, benzylpenicillin_dose_mg_kg: '25' }));
  assert.equal(r.observation, O.CONSISTENT);
  assert.ok(!ids(r).includes('dose_q24') && !ids(r).includes('dose_records_inconsistent'));
});
test('D2: 30,5 мг / 1,2 кг, записано «25» — записи согласованы (до целых), оценка по вычисленной 25,4167 → отличие + подпись Q24', () => {
  const d = BP({ benzylpenicillin_dose_mg: 30.5, benzylpenicillin_dose_mg_kg: '25' });
  assert.equal(dv(d).benzylpenicillin_dose_records_consistent, true);
  const r = ev('SEP-005', d);
  assert.equal(r.observation, O.DIFFERS);
  assert.match(lab(r, 'dose_q24').text, /^Доза 25,4167 мг\/кг: отличие от буквального значения 25 мг\/кг — предварительная оценка, не дефект; допустимое отклонение — Q24$/);
});
test('D3: 30,5 мг / 1,2 кг, записано «25,0» — записи не согласованы; отличие по вычисленной дозе, обе величины в подписи', () => {
  const d = BP({ benzylpenicillin_dose_mg: 30.5, benzylpenicillin_dose_mg_kg: '25,0' });
  assert.equal(dv(d).benzylpenicillin_dose_records_consistent, false);
  const r = ev('SEP-005', d);
  assert.equal(r.observation, O.DIFFERS);
  assert.equal(lab(r, 'dose_records_inconsistent').text, 'Записи дозы не согласованы: записано 25,0 мг/кг, вычислено 25,4167 мг/кг (30,5 мг ÷ 1,2 кг)');
  assert.ok(ids(r).includes('dose_q24'));
});
test('D4: 30 / 1,2, записано «25,00» — совпадает', () => {
  const d = BP({ benzylpenicillin_dose_mg: 30, benzylpenicillin_dose_mg_kg: '25,00' });
  assert.equal(dv(d).benzylpenicillin_dose_records_consistent, true);
  assert.equal(ev('SEP-005', d).observation, O.CONSISTENT);
});
test('D5: 30,05 / 1,2, записано «25,00» — записи не согласованы (25,04); отличие', () => {
  const d = BP({ benzylpenicillin_dose_mg: 30.05, benzylpenicillin_dose_mg_kg: '25,00' });
  assert.equal(dv(d).benzylpenicillin_dose_records_consistent, false);
  assert.equal(ev('SEP-005', d).observation, O.DIFFERS);
});
test('D6: 31 / 1,2, записано «25» — записи не согласованы (26); отличие', () => {
  const d = BP({ benzylpenicillin_dose_mg: 31, benzylpenicillin_dose_mg_kg: '25' });
  assert.equal(dv(d).benzylpenicillin_dose_records_consistent, false);
  assert.equal(ev('SEP-005', d).observation, O.DIFFERS);
});
test('D7: только записанная доза «25» — совпадает с подписью «расчёт по актуальной массе не подтверждён»', () => {
  const r = ev('SEP-005', BP({ benzylpenicillin_dose_mg_kg: '25' }));
  assert.equal(r.observation, O.CONSISTENT);
  assert.equal(lab(r, 'dose_recorded_basis').text, 'Расчёт по актуальной массе не подтверждён — оценка по записанной дозе в мг/кг');
});
test('D8: масса другого дня, записано «25» — оценка по записанной дозе с подписью', () => {
  const d = BP({ benzylpenicillin_dose_mg: 30.5, benzylpenicillin_dose_mg_kg: '25', weight_measured_at: '2025-12-31T08:00+05:00' });
  const o = run(d);
  assert.equal(o.derived.values.benzylpenicillin_weight_confirmed_for_calc, false);
  assert.equal(o.derived.values.benzylpenicillin_dose_basis, 'recorded');
  const r = res(o, 'SEP-005');
  assert.equal(r.observation, O.CONSISTENT);
  assert.ok(ids(r).includes('dose_recorded_basis'));
});
test('D9: масса другого дня, записанной дозы нет — «Недостаточно данных»', () => {
  const r = ev('SEP-005', BP({ benzylpenicillin_dose_mg: 30, weight_measured_at: '2025-12-31T08:00+05:00' }));
  assert.equal(r.observation, O.NOT_ASSESSED);
  assert.equal(r.card.missing_reasons.benzylpenicillin_dose_per_kg, 'масса измерена в другой календарный день');
});
test('D10: только 29,6 мг / 1,2 кг — вычислено 24,6667 → отличие', () => {
  const r = ev('SEP-005', BP({ benzylpenicillin_dose_mg: 29.6 }));
  assert.equal(r.observation, O.DIFFERS);
  assert.match(lab(r, 'dose_q24').text, /^Доза 24,6667 мг\/кг/);
});
test('D11: гентамицин 4,9 мг / 1 кг, записано «5» — часть «доза» под SEP-006-A3 (вычисленная 4,9)', () => {
  const r = ev('SEP-006', GM({ gentamicin_dose_mg: 4.9, weight_kg: 1, gentamicin_initial_dose_mg_kg: '5' }));
  assert.equal(part(r, 'dose').observation, O.AMBIGUOUS_PENDING);
  assert.ok(r.active_ambiguities.includes('SEP-006-A3'));
});
test('D12: гентамицин 6 мг / 1,2 кг, записано «5,0» — совпадает', () => {
  assert.equal(ev('SEP-006', GM({ gentamicin_dose_mg: 6, weight_kg: 1.2, gentamicin_initial_dose_mg_kg: '5,0' })).observation, O.CONSISTENT);
});
test('D13: местная практика никогда не даёт «совпадает»', () => {
  for (const rec of ['50', '50,0', 50, undefined]) {
    const d = BP({ benzylpenicillin_dose_mg: 60 }); if (rec !== undefined) d.benzylpenicillin_dose_mg_kg = rec;
    for (const w of [undefined, '2025-12-31T08:00+05:00']) {
      const x = clone(d); if (w) x.weight_measured_at = w;
      assert.notEqual(ev('SEP-005', x, J('SEP-005', { category: 'local_practice' })).observation, O.CONSISTENT);
    }
  }
  const g = ev('SEP-006', GM({ gentamicin_dose_mg: 4.8, weight_kg: 1.2, gentamicin_initial_dose_mg_kg: '4', gentamicin_interval_h: 24 }), J('SEP-006', { category: 'local_practice' }));
  assert.notEqual(g.observation, O.CONSISTENT);
});
test('D14: форма записи «25» / «25,0» / «25,00» / «25.0» / 25 при известной вычисленной дозе на исход не влияет', () => {
  for (const mg of [30, 30.5, 29.6]) {
    const outs = ['25', '25,0', '25,00', '25.0', 25].map(rec => {
      const r = ev('SEP-005', BP({ benzylpenicillin_dose_mg: mg, benzylpenicillin_dose_mg_kg: rec }));
      return [r.observation, r.active_ambiguities.join()];
    });
    for (const x of outs) assert.deepEqual(x, outs[0], String(mg));
  }
});
test('D15: Q24 открыт; промежуточный режим — точное сравнение без клинического допуска', () => {
  const q = ED.open_questions.find(x => x.id === 'Q24');
  assert.deepEqual(q.rules, ['SEP-005', 'SEP-006']);
  assert.equal(q.status, 'открыт'); assert.equal(q.answer, null);
  assert.match(q.interim_mode, /без клинического допуска/);
  // 25,01 мг/кг — уже отличие (допуска нет)
  assert.equal(ev('SEP-005', BP({ benzylpenicillin_dose_mg: 30.012 })).observation, O.DIFFERS);
});
test('D16: записи не согласованы и масса не подтверждена — оценка по записанной, обе подписи', () => {
  const r = ev('SEP-005', BP({ benzylpenicillin_dose_mg: 30.5, benzylpenicillin_dose_mg_kg: '25,0', weight_measured_at: '2025-12-31T08:00+05:00' }));
  assert.ok(ids(r).includes('dose_recorded_basis') && ids(r).includes('dose_records_inconsistent'));
  assert.equal(r.observation, O.CONSISTENT);
});
const basis = d => dv(d).benzylpenicillin_dose_basis;
test('D17: взвешивание 08:00, назначение 10:00 — расчёт по вычисленной дозе', () => {
  assert.equal(basis(BP({ benzylpenicillin_dose_mg: 30, benzylpenicillin_dose_mg_kg: '25' })), 'calculated');
});
test('D18: взвешивание 12:00 позже назначения 10:00 — по записанной с подписью; без записанной — нет данных', () => {
  const d = BP({ benzylpenicillin_dose_mg: 30.5, weight_measured_at: at(1, '12:00') });
  const o = run({ ...d, benzylpenicillin_dose_mg_kg: '25' });
  assert.equal(o.derived.values.benzylpenicillin_dose_basis, 'recorded');
  assert.equal(o.derived.reasons.benzylpenicillin_weight_confirmed_for_calc, 'масса измерена после назначения');
  assert.ok(ids(res(o, 'SEP-005')).includes('dose_recorded_basis'));
  assert.equal(ev('SEP-005', d).observation, O.NOT_ASSESSED);
});
test('D19: взвешивание накануне в 23:50 — как D18', () => {
  const d = BP({ benzylpenicillin_dose_mg: 30.5, weight_measured_at: '2025-12-31T23:50+05:00' });
  assert.equal(basis({ ...d, benzylpenicillin_dose_mg_kg: '25' }), 'recorded');
  assert.equal(ev('SEP-005', d).observation, O.NOT_ASSESSED);
});
test('D20: у взвешивания только дата — как D18', () => {
  const d = BP({ benzylpenicillin_dose_mg: 30.5, weight_measured_at: '2026-01-01' });
  const o = run({ ...d, benzylpenicillin_dose_mg_kg: '25' });
  assert.equal(o.derived.values.benzylpenicillin_dose_basis, 'recorded');
  assert.match(o.derived.reasons.benzylpenicillin_weight_confirmed_for_calc, /только дата/);
  assert.equal(ev('SEP-005', d).observation, O.NOT_ASSESSED);
});
test('D21: взвешивание и назначение в одну минуту — вычисленная доза', () => {
  assert.equal(basis(BP({ benzylpenicillin_dose_mg: 30, weight_measured_at: at(1, '10:00') })), 'calculated');
});
test('D22: разные пояса отметок — решает пояс организации; без него — как D18', () => {
  const d = BP({ benzylpenicillin_dose_mg: 30.5, benzylpenicillin_dose_mg_kg: '25', weight_measured_at: '2025-12-31T20:00Z' }); // = 01.01 01:00 по +05:00
  assert.equal(basis({ ...d, facility_utc_offset: '+05:00' }), 'calculated');
  assert.equal(basis({ ...d, facility_utc_offset: 'Z' }), 'recorded');
  const o = run(d);
  assert.equal(o.derived.values.benzylpenicillin_dose_basis, 'recorded');
  assert.equal(o.derived.reasons.benzylpenicillin_weight_confirmed_for_calc, D.REASON.MIXED_TZ);
});
test('D: разбор записи — запятая и точка, точность сохраняется; неверная запись не превращается в число', () => {
  assert.deepEqual(D.parseDoseRecord('25'), { value: 25, decimals: 0, raw: '25' });
  assert.deepEqual(D.parseDoseRecord('25,0'), { value: 25, decimals: 1, raw: '25,0' });
  assert.deepEqual(D.parseDoseRecord(' 25.00 '), { value: 25, decimals: 2, raw: ' 25.00 ' });
  for (const bad of ['25 мг', '25,', ',5', '-25', 'двадцать пять', '', true]) assert.equal(D.parseDoseRecord(bad).reason, D.REASON.BAD_DOSE_RECORD, String(bad));
  const v = dv(BP({ benzylpenicillin_dose_mg: 30, benzylpenicillin_dose_mg_kg: '25 мг' }));
  assert.equal(v.benzylpenicillin_dose_basis, 'calculated'); assert.ok(!('benzylpenicillin_dose_records_consistent' in v));
});
test('D: 2 % допуск удалён — 25,4167 не «округляется» до записанных 25', () => {
  const v = dv(BP({ benzylpenicillin_dose_mg: 30.5, benzylpenicillin_dose_mg_kg: 25 }));
  assert.equal(v.benzylpenicillin_dose_per_kg, 25.416667);
  assert.equal(v.benzylpenicillin_dose_per_kg_calculated, 25.416667);
});

// =================== NEC-006: только подписи, без порога 216 ч (пункт 6) ===================
const NX = extra => Object.assign({ nec_stage: '2а', nec_diagnosed_at: at(1, '10:00'), clinical_deterioration: false }, extra);
test('X1: один снимок через 240 ч — NEC-006-A2 и подпись с часами; отличия нет; 216 ч нигде', () => {
  const r = ev('NEC-006', NX({ xrays: [{ at: at(11, '10:00'), position: 'horizontal' }] }));
  assert.equal(part(r, 'first_48h').observation, O.AMBIGUOUS_PENDING);
  assert.ok(r.active_ambiguities.includes('NEC-006-A2'));
  assert.notEqual(r.observation, O.DIFFERS);
  assert.equal(lab(r, 'first_xray_hours').text, 'Первый снимок через 240 ч после установленного диагноза; допустимое окно «через 48 часов» протоколом не определено (Q13)');
  assert.ok(!JSON.stringify(DB.rules.find(x => x.rule_id === 'NEC-006')).includes('216'));
});
test('X2: снимок ровно через 48 ч — A2, подпись «48 ч»', () => {
  const r = ev('NEC-006', NX({ xrays: [{ at: at(3, '10:00'), position: 'horizontal' }] }));
  assert.ok(r.active_ambiguities.includes('NEC-006-A2'));
  assert.match(lab(r, 'first_xray_hours').text, /через 48 ч/);
});
test('X3: 48 ч, затем через 20 суток — часть «раз в неделю» отличается, подпись 480 ч', () => {
  const r = ev('NEC-006', NX({ xrays: [{ at: at(3, '10:00'), position: 'horizontal' }, { at: at(23, '10:00'), position: 'horizontal' }] }));
  assert.equal(part(r, 'weekly').observation, O.DIFFERS);
  assert.match(lab(r, 'max_interval_hours').text, /— 480 ч/);
});
test('X4: вертикальный снимок через 5 суток после ухудшения — часть «ухудшение» совпадает, подпись 120 ч', () => {
  const r = ev('NEC-006', NX({ clinical_deterioration: true, deterioration_at: at(3, '10:00'),
    xrays: [{ at: at(3, '10:00'), position: 'horizontal' }, { at: at(8, '10:00'), position: 'vertical' }] }));
  assert.equal(part(r, 'deterioration').observation, O.CONSISTENT);
  assert.match(lab(r, 'deterioration_to_upright_hours').text, /через 120 ч после клинического ухудшения/);
});
test('X5: снимков нет — «Недостаточно данных», подписей с часами нет', () => {
  const r = ev('NEC-006', NX({}));
  assert.equal(r.observation, O.NOT_ASSESSED);
  assert.ok(!ids(r).some(i => /hours/.test(i)));
});
test('X6: NEC-006-A2 и Q13 не изменены', () => {
  const a2 = DB.rules.find(r => r.rule_id === 'NEC-006').ambiguities.find(a => a.id === 'NEC-006-A2');
  assert.deepEqual(a2, FX.blocking_ambiguities['NEC-006-A2']);
  assert.deepEqual(ED.open_questions.find(q => q.id === 'Q13'), FX.open_questions.find(q => q.id === 'Q13'));
});

// =================== NEC-005: противоречие отметок (пункт 7) ===================
const PN = extra => Object.assign({ nec_stage: '2а', pn_type: 'full', nec_onset_at: at(2, '10:00') }, extra);
test('P1: «ПП не шло», а начато раньше НЭК — противоречие, «Недостаточно данных»', () => {
  const o = run(PN({ pn_running_at_nec_onset: false, pn_started_at: at(1, '10:00') }));
  assert.equal(res(o, 'NEC-005').observation, O.NOT_ASSESSED);
  assert.equal(o.derived.reasons.pn_start_illness_day, D.REASON.CONTRADICTORY);
  assert.equal(o.derived.reasons.pn_running_at_nec_onset, D.REASON.CONTRADICTORY);
});
test('P2: «ПП шло», а начато позже НЭК — противоречие, «Недостаточно данных»', () => {
  assert.equal(ev('NEC-005', PN({ pn_running_at_nec_onset: true, pn_started_at: at(3, '10:00') })).observation, O.NOT_ASSESSED);
});
test('P3: «ПП шло» и начато до НЭК — совпадает', () => {
  assert.equal(ev('NEC-005', PN({ pn_running_at_nec_onset: true, pn_started_at: at(1, '10:00') })).observation, O.CONSISTENT);
});
test('P4: «ПП не шло», начато в 1-й день — совпадает; во 2-й — отличие', () => {
  assert.equal(ev('NEC-005', PN({ pn_running_at_nec_onset: false, pn_started_at: at(2, '20:00') })).observation, O.CONSISTENT);
  assert.equal(ev('NEC-005', PN({ pn_running_at_nec_onset: false, pn_started_at: at(3, '09:00') })).observation, O.DIFFERS);
});

// =================== Признаки улучшения — не критерий (пункт 8) ===================
const SIGNS = (yes, no) => Object.fromEntries(D.IMPROVEMENT_SIGNS.map((k, i) => [k, i < yes ? true : i < yes + no ? false : undefined]).filter(([, v]) => v !== undefined));
const NEC4 = extra => Object.assign({ nec_stage: '2а', nec_onset_at: at(1, '10:00'), nec_confirmed_at: at(1, '12:00'), enteral_feeding_resumed_at: at(9, '10:00') }, extra);
const noA1 = (() => { const db = clone(DB); db.rules.find(r => r.rule_id === 'NEC-004').ambiguities.find(a => a.id === 'NEC-004-A1').blocking = 'no'; return db; })();
test('I1: 7 «да» и 1 «нет» — подписи «нет улучшения» нет, счётчики показаны', () => {
  const r = ev('NEC-004', NEC4({ improvement_signs: SIGNS(7, 1) }));
  assert.ok(!ids(r).includes('no_improvement'));
  assert.match(lab(r, 'improvement_signs_info').text, /«да» — 7, «нет» — 1, не указано — 0; клиническое улучшение оценивается по записи врача/);
});
test('I2: (копия базы без NEC-004-A1) все 8 признаков «да», записи врача нет — часть «улучшение» нет данных', () => {
  const r = ev('NEC-004', NEC4({ improvement_signs: SIGNS(8, 0) }), undefined, noA1);
  assert.equal(part(r, 'improvement').observation, O.NOT_ASSESSED);
  assert.equal(part(r, 'term').observation, O.CONSISTENT);
});
test('I3: (та же копия) запись врача об улучшении есть, признаков нет — часть «улучшение» совпадает', () => {
  const r = ev('NEC-004', NEC4({ clinical_lab_improvement_documented: true }), undefined, noA1);
  assert.equal(part(r, 'improvement').observation, O.CONSISTENT);
  assert.ok(!ids(r).includes('improvement_signs_info'));
});
test('I4: EDGE-09 — блокировка NEC-004-A1 сохраняется, информационный блок вместо «нет улучшения»', () => {
  const r = ev('NEC-004', { nec_stage: '2а', nec_onset_at: at(1, '10:00'), nec_confirmed_at: at(2, '10:00'), enteral_feeding_resumed_at: at(7, '10:00'), improvement_signs: { abdomen_not_distended_not_tender: false } });
  assert.equal(r.observation, O.AMBIGUOUS_PENDING);
  assert.ok(r.active_ambiguities.includes('NEC-004-A1'));
  assert.ok(ids(r).includes('improvement_signs_info') && !ids(r).includes('no_improvement'));
});
test('I5: NEC-003 — признаки только показываются, исход от них не зависит', () => {
  const b = { nec_stage: '1б', gi_passage_restored: false, enteral_feeding_stopped: true };
  for (const s of [SIGNS(0, 8), SIGNS(8, 0), SIGNS(3, 2)]) {
    const r = ev('NEC-003', { ...b, improvement_signs: s });
    assert.equal(r.observation, ev('NEC-003', b).observation);
    assert.ok(ids(r).includes('improvement_signs_info') && !ids(r).includes('no_improvement'));
  }
  for (const f of ['improvement_achieved', 'improvement_signs_documented_count', 'ig_special_basis_documented']) {
    assert.ok(!(f in DB.data_dictionary), f); assert.ok(!D.DERIVED_FIELDS.includes(f), f);
  }
});

// =================== NEC-010: подпись при отсутствии хирургии и перевода (пункт 9) ===================
const NEC10 = 'Предварительная техническая оценка (Q16 открыт): отсутствие перевода — отличие для экспертной проверки, не дефект; клиническое обоснование обязательно сохраняется';
test('N1: хирургии в организации нет, перевода нет — отличие с подписью; обоснование сохранено', () => {
  const r = ev('NEC-010', { nec_stage: '2б', surgical_department_available: false, current_department: 'nicu', transferred_to_surgery: false },
    J('NEC-010', { category: 'physician_or_consilium_decision', text: 'синтетика: нетранспортабелен' }));
  assert.equal(r.observation, O.DIFFERS);
  assert.equal(lab(r, 'no_surgery_no_transfer').text, NEC10);
  assert.equal(r.justification_complete, true);
  assert.equal(r.justification.text, 'синтетика: нетранспортабелен');
});
test('N2: хирургия в организации есть, ребёнок в ОРИТН — NEC-010-A4, подписи N1 нет', () => {
  const r = ev('NEC-010', { nec_stage: '2б', surgical_department_available: true, current_department: 'nicu', transferred_to_surgery: false });
  assert.deepEqual(r.active_ambiguities, ['NEC-010-A4']);
  assert.ok(!ids(r).includes('no_surgery_no_transfer'));
});
test('N3: ребёнок в хирургическом отделении — совпадает, подписи нет', () => {
  const r = ev('NEC-010', { nec_stage: '2б', surgical_department_available: true, current_department: 'neonatal_surgery' });
  assert.equal(r.observation, O.CONSISTENT);
  assert.ok(!ids(r).includes('no_surgery_no_transfer'));
});

// =================== Инварианты V1–V10 ===================
test('V1: восемь подтверждённых правил побайтово неизменны (sha256 записи правила)', () => {
  const sha = ED.confirmed_unchanged.sha256_at_baseline;
  assert.deepEqual(ED.confirmed_unchanged.rules, ['RDS-001', 'RDS-002', 'RDS-003', 'RDS-004', 'RDS-005', 'RDS-006', 'RDS-008', 'RDS-009']);
  for (const id of ED.confirmed_unchanged.rules) {
    const r = DB.rules.find(x => x.rule_id === id);
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(r, null, 1)).digest('hex'), sha[id], id);
    assert.ok(!('card_labels' in r) && !('revision' in r), id);
  }
});
test('V2: 25 блокирующих неоднозначностей и их условия совпадают с d314a58', () => {
  const cur = Object.fromEntries(DB.rules.flatMap(r => r.ambiguities).filter(a => a.blocking !== 'no').map(a => [a.id, a]));
  assert.equal(Object.keys(cur).length, 25);
  assert.deepEqual(cur, FX.blocking_ambiguities);
});
test('V3: конфликты CF-001–CF-005 не изменены (2239c52 и d314a58)', () => {
  assert.deepEqual(DB.protocol_conflicts, BASE.protocol_conflicts);
  assert.deepEqual(DB.protocol_conflicts, FX.protocol_conflicts);
  assert.deepEqual(DB.protocol_conflicts.map(c => c.id), ['CF-001', 'CF-002', 'CF-003', 'CF-004', 'CF-005']);
});
test('V4: Q01–Q23 дословно прежние, добавлен только Q24; все открыты; статус «подтверждено» не присвоен', () => {
  assert.deepEqual(ED.open_questions.slice(0, 23), FX.open_questions);
  assert.deepEqual(ED.open_questions.map(q => q.id), Array.from({ length: 24 }, (_, i) => `Q${String(i + 1).padStart(2, '0')}`));
  assert.ok(ED.open_questions.every(q => q.status === 'открыт' && q.answer === null));
  for (const r of DB.rules) { assert.equal(r.status, E.CANDIDATE, r.rule_id); assert.equal(r.expert_confirmation, null, r.rule_id); }
  assert.equal(DB.authenticated, false);
  assert.ok(ED.decisions.every(d => d.rule_status_after === E.CANDIDATE));
});
test('V5: словарь данных согласован с derive.js; новые поля описаны', () => {
  const derivedDict = Object.entries(DB.data_dictionary).filter(([, e]) => e.type === 'derived').map(([k]) => k).sort();
  assert.deepEqual(derivedDict, [...D.DERIVED_FIELDS].sort());
  for (const f of ['facility_utc_offset', 'weight_measured_at', 'benzylpenicillin_prescribed_at', 'gentamicin_prescribed_at', 'clinical_lab_improvement_documented'])
    assert.ok(DB.data_dictionary[f] && DB.data_dictionary[f].type !== 'derived', f);
  assert.ok(DB.data_dictionary.benzylpenicillin_dose_mg_kg.record_format && DB.data_dictionary.gentamicin_initial_dose_mg_kg.record_format);
});
test('V6: шаблон подписи без значения не показывается; число — 4 знака и десятичная запятая', () => {
  const db = clone(DB);
  db.rules.find(r => r.rule_id === 'NEC-002').card_labels = [{ id: 't1', label: 'есть {uvc_removed_at}' }, { id: 't2', label: 'число {weight_kg}' }];
  const r = ev('NEC-002', { nec_suspected: true, uvc_present: true, uvc_removed: true, uac_present: false, weight_kg: 1.234567 }, undefined, db);
  assert.ok(!ids(r).includes('t1'));
  assert.equal(lab(r, 't2').text, 'число 1,2346');
});
test('V6a: порядок осторожности частей — неоднозначность > отличие > нет данных > совпадает', () => {
  assert.deepEqual(E.CAUTION, [O.AMBIGUOUS_PENDING, O.DIFFERS, O.NOT_ASSESSED, O.NOT_APPLIED_ALLOWED, O.CONSISTENT]);
  // часть «доза» отличается (3 мг/кг), часть «интервал» без данных — правило «отличается»
  const r = ev('SEP-006', GM({ gentamicin_dose_mg: 3, weight_kg: 1, gentamicin_interval_h: undefined }));
  assert.deepEqual([part(r, 'dose').observation, part(r, 'interval').observation], [O.DIFFERS, O.NOT_ASSESSED]);
  assert.equal(r.observation, O.DIFFERS);
  // часть «доза» неоднозначна (4,5 мг/кг, SEP-006-A3), часть «интервал» отличается — правило «неоднозначность»
  const q = ev('SEP-006', GM({ gentamicin_dose_mg: 4.5, weight_kg: 1, gentamicin_interval_h: 12, very_ill: false }));
  assert.equal(q.observation, O.AMBIGUOUS_PENDING);
});
// V7 (детерминированная сборка), V8 (сверка цитат с PDF), V9 (этап 4: 71/71 и 41/41) — rules/test_build.py,
// rules/test_rules.py, engine/test/rules.test.js, engine/test/deviation.test.js; V11 — engine/test/mutation-check.js.
test('V10: подписи с подстановкой не меняют исход — на всех входах этого файла и 117 архивных сценариях', () => {
  const bare = clone(DB); for (const r of bare.rules) delete r.card_labels;
  assert.ok(RUNS.length > 80);
  for (const { data, just } of RUNS) {
    const a = E.evaluate(DB, { synthetic: true, data, justifications: just }, { expert_decisions: ED });
    const b = E.evaluate(bare, { synthetic: true, data, justifications: just }, { expert_decisions: ED });
    assert.deepEqual(a.results.map(r => [r.rule_id, r.observation, r.active_ambiguities, (r.parts || []).map(p => p.observation)]),
                     b.results.map(r => [r.rule_id, r.observation, r.active_ambiguities, (r.parts || []).map(p => p.observation)]));
    assert.equal(a.status, b.status);
  }
});
