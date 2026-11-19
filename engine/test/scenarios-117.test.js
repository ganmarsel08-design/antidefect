'use strict';
// Регрессия: 117 синтетических сценариев архива экспертизы (90 базовых T1–T3 + 27 граничных EDGE-01…27)
// на базе rules-0.2. Только синтетические данные.
// T1 — полные данные: «совпадает» или сохранённая блокировка.
// T2 — критические поля не указаны: «Недостаточно данных» или блокировка; «нет данных» не подменяется на «нет».
// T3 — отличие с обоснованием: «отличается» с сохранённым обоснованием или блокировка.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const E = require('../rules-engine.js');

const DB = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'rules', 'pilot-rules.json'), 'utf8'));
const ED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'rules', 'expert-decisions.json'), 'utf8'));
const O = E.OBS;
const run = (data, justifications) => E.evaluate(DB, { synthetic: true, data, justifications }, { expert_decisions: ED });
const res = (o, id) => o.results.find(r => r.rule_id === id);
const at = (d, hm) => `2026-01-${String(d).padStart(2, '0')}T${hm}+05:00`;
const J = (id, extra) => ({ [id]: Object.assign({ text: 'синтетическое обоснование', author: 'врач-синтетик', recorded_at: at(9, '12:00') }, extra || {}) });
const part = (r, id) => r.parts.find(p => p.part_id === id);
const cfs = o => o.conflicts.map(c => c.id);
const CONFIRMED = ['RDS-001', 'RDS-002', 'RDS-003', 'RDS-004', 'RDS-005', 'RDS-006', 'RDS-008', 'RDS-009'];

function safe(o) {
  assert.equal(o.final_conclusion, null);
  assert.ok(E.ALLOWED_STATUSES.includes(o.status));
  for (const r of o.results) assert.equal(r.final, false);
}

// ---- 8 подтверждённых правил: данные строятся из их условий (как в базовой линии этапа 5) ----
function leaf(n, want) {
  const v = n.value;
  switch (n.op) {
    case 'is_true': return want; case 'is_false': return !want;
    case 'eq': return want ? v : (typeof v === 'number' ? v + 1 : '__другое__');
    case 'in': return want ? v[0] : '__другое__';
    case 'gt': return want ? v + 1 : v; case 'gte': return want ? v : v - 1;
    case 'lt': return want ? v - 1 : v; case 'lte': return want ? v : v + 1;
    case 'present': return want ? 'есть' : null;
  }
}
function assign(node, want, out) {
  if (node.all) { if (want) node.all.forEach(c => assign(c, true, out)); else assign(node.all[0], false, out); return; }
  if (node.any) { if (want) assign(node.any[0], true, out); else node.any.forEach(c => assign(c, false, out)); return; }
  if (!(node.field in out)) out[node.field] = leaf(node, want);
}
const fieldsOf = n => n.all ? n.all.flatMap(fieldsOf) : n.any ? n.any.flatMap(fieldsOf) : [n.field];
function generated(rule) {
  const base = {}; assign(rule.applicability.condition, true, base);
  const t1 = { ...base }; assign(rule.requirement.check, true, t1);
  const t2 = { ...base }; for (const f of fieldsOf(rule.requirement.check)) delete t2[f];
  const t3 = { ...base }; assign(rule.requirement.check, false, t3);
  return { t1, t2, t3 };
}

// ---- 22 исправленных правил: явные синтетические данные по новой модели ----
const COURSE = (d1, d2, extra) => Object.assign({ course_completed: true, abx_course_started_at: at(d1, '10:00'), abx_course_ended_at: at(d2, '10:00') }, extra || {});
const R22 = {
  'RDS-007': {
    t1: { rds_diagnosed: true, serious_bacterial_infection_excluded: true, antibiotics_started: true, sbi_excluded_at: at(2, '10:00'), antibiotics_stopped_at: at(2, '10:00') },
    t2: { rds_diagnosed: true, serious_bacterial_infection_excluded: true, antibiotics_started: true, sbi_excluded_at: at(2, '10:00') },
    t3: { rds_diagnosed: true, serious_bacterial_infection_excluded: true, antibiotics_started: true, sbi_excluded_at: at(2, '10:00'), antibiotics_stopped_at: at(2, '14:00') },
    exp: [O.CONSISTENT, O.NOT_ASSESSED, O.AMBIGUOUS_PENDING] },
  'RDS-010': {
    t1: { mechanical_ventilation: true, blood_gases: [{ drawn_at: at(1, '10:00'), paco2_mmhg: 44 }], paco2_hypocapnia_threshold: 35, threshold_source: 'синтетический СОП ОРИТН' },
    t2: { mechanical_ventilation: true },
    t3: { mechanical_ventilation: true, blood_gases: [{ drawn_at: at(1, '10:00'), paco2_mmhg: 28 }], paco2_hypocapnia_threshold: 35, threshold_source: 'синтетический СОП ОРИТН', vent_changes: [{ at: at(1, '10:30'), parameter: 'PIP', from: 22, to: 19 }] },
    exp: [O.CONSISTENT, O.NOT_ASSESSED, O.AMBIGUOUS_PENDING] },
  'NEC-001': {
    t1: { nec_suspected: true, nec_suspected_at: at(3, '10:00'), feeding_at_nec_suspicion: 'active', enteral_feeding_stopped: true, enteral_feeding_stopped_at: at(3, '10:05'), ng_tube_placed: true, ng_tube_placed_at: at(3, '10:15') },
    t2: { nec_suspected: true, feeding_at_nec_suspicion: 'unknown', ng_tube_placed: true },
    t3: { nec_suspected: true, feeding_at_nec_suspicion: 'active', enteral_feeding_stopped: false, ng_tube_placed: true },
    exp: [O.CONSISTENT, O.NOT_ASSESSED, O.DIFFERS] },
  'NEC-002': {
    t1: { nec_suspected: true, uvc_present: true, uvc_removed: true, uac_present: false },
    t2: { nec_suspected: true, uvc_present: true, uac_present: false },
    t3: { nec_suspected: true, uvc_present: true, uvc_removed: false, uac_present: false, retention_reason: 'единственный доступ' },
    exp: [O.CONSISTENT, O.NOT_ASSESSED, O.DIFFERS] },
  'NEC-003': {
    t1: { nec_stage: '1б', gi_passage_restored: false, enteral_feeding_stopped: true },
    t2: { nec_stage: '1б' },
    t3: { nec_stage: '1б', gi_passage_restored: false, enteral_feeding_stopped: false, enteral_feeding_resumed_at: at(4, '10:00') },
    exp: [O.AMBIGUOUS_PENDING, O.NOT_ASSESSED, O.AMBIGUOUS_PENDING] },
  'NEC-004': {
    t1: { nec_stage: '2а', nec_onset_at: at(1, '10:00'), nec_confirmed_at: at(1, '18:00'), enteral_feeding_resumed_at: at(8, '10:00'), improvement_signs: Object.fromEntries(['abdomen_not_distended_not_tender', 'no_pathological_gastric_residuals', 'ileus_resolved', 'spontaneous_stool', 'labs_normalized', 'no_us_bowel_wall_inflammation', 'no_ascites', 'peristalsis_restored'].map(k => [k, true])) },
    t2: { nec_stage: '2а' },
    t3: { nec_stage: '2а', nec_onset_at: at(1, '10:00'), nec_confirmed_at: at(1, '18:00'), enteral_feeding_resumed_at: at(4, '10:00') },
    exp: [O.AMBIGUOUS_PENDING, O.AMBIGUOUS_PENDING, O.AMBIGUOUS_PENDING] },
  'NEC-005': {
    t1: { nec_stage: '2б', pn_type: 'full', pn_running_at_nec_onset: true },
    t2: { nec_stage: '2б', pn_running_at_nec_onset: true },
    t3: { nec_stage: '2б', pn_type: 'full', pn_running_at_nec_onset: false, nec_onset_at: at(1, '10:00'), pn_started_at: at(2, '09:00') },
    exp: [O.CONSISTENT, O.NOT_ASSESSED, O.DIFFERS] },
  'NEC-006': {
    t1: { nec_stage: '2б', nec_diagnosed_at: at(1, '10:00'), clinical_deterioration: false, xrays: [{ at: at(3, '10:00'), position: 'horizontal', reason: 'planned' }, { at: at(9, '10:00'), position: 'horizontal', reason: 'planned' }] },
    t2: { nec_stage: '2б', clinical_deterioration: false },
    t3: { nec_stage: '2б', nec_diagnosed_at: at(1, '10:00'), clinical_deterioration: true, deterioration_at: at(2, '08:00'), xrays: [{ at: at(3, '10:00'), position: 'horizontal', reason: 'planned' }] },
    exp: [O.AMBIGUOUS_PENDING, O.NOT_ASSESSED, O.AMBIGUOUS_PENDING] },
  'NEC-007': {
    t1: { nec_stage: '2б', antibiotics_started: true, metronidazole_given: true },
    t2: { nec_stage: '2б', antibiotics_started: true },
    t3: { nec_stage: '2б', antibiotics_started: true, metronidazole_given: false, other_antianaerobic_drug: 'клиндамицин' },
    exp: [O.CONSISTENT, O.NOT_ASSESSED, O.DIFFERS] },
  'NEC-008': {
    t1: { nec_stage: '2б', antibiotics_started: true, ...COURSE(1, 11) },
    t2: { nec_stage: '2б', antibiotics_started: true, course_completed: true, abx_course_started_at: at(1, '10:00') },
    t3: { nec_stage: '2б', antibiotics_started: true, ...COURSE(1, 7) },
    exp: [O.AMBIGUOUS_PENDING, O.AMBIGUOUS_PENDING, O.AMBIGUOUS_PENDING] },
  'NEC-009': {
    t1: { nec_stage: '1б', facility_level: 2, surgeon_consult_status: 'done', surgeon_consult_format: 'in_person' },
    t2: { nec_stage: '1б', facility_level: 2, surgeon_consult_status: 'no_record' },
    t3: { nec_stage: '1б', facility_level: 2, surgeon_consult_status: 'documented_not_done' },
    exp: [O.CONSISTENT, O.NOT_ASSESSED, O.DIFFERS] },
  'NEC-010': {
    t1: { nec_stage: '2б', surgical_department_available: false, current_department: 'other', transferred_to_surgery: true },
    t2: { nec_stage: '2б' },
    t3: { nec_stage: '2б', surgical_department_available: false, current_department: 'nicu', transferred_to_surgery: false, transport_stable: false, transfer_delay_reason: 'нестабильная гемодинамика' },
    exp: [O.CONSISTENT, O.NOT_ASSESSED, O.DIFFERS] },
  'SEP-001': {
    t1: { red_flag_count: 1, antibiotics_started: true, sepsis_indication_identified_at: at(1, '10:00'), first_abx_dose_administered_at: at(1, '10:40') },
    t2: { antibiotics_started: true },
    t3: { red_flag_count: 1, antibiotics_started: true, sepsis_indication_identified_at: at(1, '10:00'), first_abx_dose_administered_at: at(1, '12:00') },
    exp: [O.AMBIGUOUS_PENDING, O.NOT_ASSESSED, O.AMBIGUOUS_PENDING] },
  'SEP-002': {
    t1: { sepsis_suspected: true, antibiotics_started: true, blood_culture_drawn_at: at(1, '09:40'), first_abx_dose_administered_at: at(1, '10:00') },
    t2: { sepsis_suspected: true, antibiotics_started: true, first_abx_dose_administered_at: at(1, '10:00') },
    t3: { sepsis_suspected: true, antibiotics_started: true, blood_culture_drawn_at: at(1, '11:00'), first_abx_dose_administered_at: at(1, '10:00') },
    exp: [O.CONSISTENT, O.NOT_ASSESSED, O.DIFFERS] },
  'SEP-003': {
    t1: { sepsis_suspected: true, immunoglobulin_given: true, immunoglobulin_purpose: 'other_indication', immunoglobulin_indication_text: 'иное показание (синтетика)' },
    t2: { sepsis_suspected: true, immunoglobulin_given: true },
    t3: { sepsis_suspected: true, immunoglobulin_given: true, immunoglobulin_purpose: 'sepsis_treatment_or_prophylaxis', immunoglobulin_use_type: 'routine' },
    exp: [O.AMBIGUOUS_PENDING, O.NOT_ASSESSED, O.DIFFERS] },
  'SEP-004': {
    t1: { early_onset_sepsis_suspected: true, antibiotics_started: true, initial_empirical_regimen: 'ampicillin+gentamicin' },
    t2: { early_onset_sepsis_suspected: true, antibiotics_started: true },
    t3: { early_onset_sepsis_suspected: true, antibiotics_started: true, initial_empirical_regimen: 'другое', drug_availability: [{ drug: 'гентамицин', available: false, checked_at: at(1, '09:00'), source: 'аптека' }] },
    exp: [O.CONSISTENT, O.NOT_ASSESSED, O.DIFFERS] },
  'SEP-005': {
    t1: { early_onset_sepsis_suspected: true, benzylpenicillin_given: true, meningitis: false, benzylpenicillin_dose_mg: 30, weight_kg: 1.2, benzylpenicillin_interval_h: 12 },
    t2: { early_onset_sepsis_suspected: true, benzylpenicillin_given: true, meningitis: false, benzylpenicillin_dose_mg: 30, benzylpenicillin_interval_h: 12 },
    t3: { early_onset_sepsis_suspected: true, benzylpenicillin_given: true, meningitis: false, benzylpenicillin_dose_mg: 60, weight_kg: 1.2, benzylpenicillin_interval_h: 12 },
    exp: [O.CONSISTENT, O.NOT_ASSESSED, O.DIFFERS] },
  'SEP-006': {
    t1: { early_onset_sepsis_suspected: true, gentamicin_given: true, gentamicin_dose_mg: 6, weight_kg: 1.2, gentamicin_interval_h: 36 },
    t2: { early_onset_sepsis_suspected: true, gentamicin_given: true, gentamicin_dose_mg: 6, weight_kg: 1.2 },
    t3: { early_onset_sepsis_suspected: true, gentamicin_given: true, gentamicin_dose_mg: 9.6, weight_kg: 1.2, gentamicin_interval_h: 36 },
    exp: [O.CONSISTENT, O.NOT_ASSESSED, O.DIFFERS] },
  'SEP-007': {
    t1: { sepsis_suspected: true, antibiotics_started: true, first_abx_dose_administered_at: at(1, '11:00'), crp_samples: [{ drawn_at: at(2, '06:00'), purpose: 'control' }] },
    t2: { sepsis_suspected: true, antibiotics_started: true, first_abx_dose_administered_at: at(1, '11:00'), crp_samples: [{ drawn_at: '2026-01-02', purpose: 'control' }] },
    t3: { sepsis_suspected: true, antibiotics_started: true, first_abx_dose_administered_at: at(1, '17:00'), crp_samples: [{ drawn_at: at(2, '09:00'), purpose: 'control' }] },
    exp: [O.CONSISTENT, O.NOT_ASSESSED, O.DIFFERS] },
  'SEP-008': {
    t1: { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'отрицательный', high_risk_factors: false, ...COURSE(1, 4) },
    t2: { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'отрицательный', high_risk_factors: false, course_completed: true, abx_course_started_at: at(1, '10:00') },
    t3: { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'отрицательный', high_risk_factors: false, ...COURSE(1, 7) },
    exp: [O.CONSISTENT, O.NOT_ASSESSED, O.DIFFERS] },
  'SEP-009': {
    t1: { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'положительный', meningitis: false, ...COURSE(1, 10) },
    t2: { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'положительный', ...COURSE(1, 10) },
    t3: { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'положительный', meningitis: false, ...COURSE(1, 7) },
    exp: [O.AMBIGUOUS_PENDING, O.NOT_ASSESSED, O.AMBIGUOUS_PENDING] },
  'SEP-010': {
    t1: { antibiotics_started: true, meningitis: false, blood_culture_result: 'отрицательный', high_risk_factors: true, ...COURSE(1, 7) },
    t2: { antibiotics_started: true, blood_culture_result: 'отрицательный', high_risk_factors: true, ...COURSE(1, 7) },
    t3: { antibiotics_started: true, meningitis: false, blood_culture_result: 'отрицательный', high_risk_factors: true, ...COURSE(1, 12) },
    exp: [O.AMBIGUOUS_PENDING, O.NOT_ASSESSED, O.AMBIGUOUS_PENDING] },
};

const SC = [];
for (const r of DB.rules) {
  const id = r.rule_id;
  if (CONFIRMED.includes(id)) {
    const g = generated(r);
    SC.push({ id: `${id}-T1`, rule: id, data: g.t1, ok: o => [O.CONSISTENT, O.AMBIGUOUS_PENDING].includes(o) });
    SC.push({ id: `${id}-T2`, rule: id, data: g.t2, ok: o => [O.NOT_ASSESSED, O.AMBIGUOUS_PENDING].includes(o) });
    SC.push({ id: `${id}-T3`, rule: id, data: g.t3, just: J(id), ok: o => [O.DIFFERS, O.AMBIGUOUS_PENDING, O.NOT_APPLIED_ALLOWED].includes(o) });
  } else {
    const f = R22[id];
    assert.ok(f, id);
    ['t1', 't2', 't3'].forEach((t, i) => SC.push({ id: `${id}-T${i + 1}`, rule: id, data: f[t], just: t === 't3' ? J(id) : undefined, exact: f.exp[i] }));
  }
}

test('регрессия: 90 базовых сценариев (T1–T3 по 30 правилам)', () => {
  assert.equal(SC.length, 90);
  const counts = {};
  for (const s of SC) {
    const o = run(s.data, s.just); safe(o);
    const r = res(o, s.rule);
    counts[r.observation] = (counts[r.observation] || 0) + 1;
    if (s.exact) assert.equal(r.observation, s.exact, s.id);
    else assert.ok(s.ok(r.observation), `${s.id}: ${r.observation}`);
    if (s.id.endsWith('T2')) assert.ok(![O.CONSISTENT, O.DIFFERS].includes(r.observation), s.id);
    if (s.id.endsWith('T3') && r.observation === O.DIFFERS) assert.equal(r.justification_complete, true, s.id);
    if (r.observation === O.AMBIGUOUS_PENDING) assert.ok(r.active_ambiguities.length >= 1, s.id);
  }
  assert.ok(counts[O.CONSISTENT] >= 15 && counts[O.DIFFERS] >= 15 && counts[O.NOT_ASSESSED] >= 15, JSON.stringify(counts));
});

// ---- граничные EDGE-01…27 ----
const EDGES = [
  ['EDGE-01', 'RDS-003', { rds_risk: true, gestational_age_weeks: 26, antenatal_steroids_given: true, intubation_needed_for_stabilization: false, fio2: 0.35, surfactant_in_delivery_room: false },
    (r) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.ok(r.active_ambiguities.includes('RDS-003-A1')); }],
  ['EDGE-02', 'RDS-004', { oxygen_given: true, oxygen_via_blender: false },
    (r) => { assert.equal(r.observation, O.DIFFERS); }, 'известное ограничение: подтверждённое правило RDS-004 не различает «при стабилизации» и «после»; область не расширяется (ТЗ §6 п. 6)'],
  ['EDGE-03', 'RDS-008', { antibiotics_started: true, blood_culture_before_antibiotics: true },
    (r) => { assert.equal(r.observation, O.CONSISTENT); }],
  ['EDGE-04', 'RDS-009', { rds_diagnosed: true, surfactant_drug: 'порактант альфа', surfactant_initial_dose_mg_kg: 100 },
    (r) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.ok(r.active_ambiguities.includes('RDS-009-A1')); }],
  ['EDGE-05', 'RDS-010', { mechanical_ventilation: true, blood_gases: [{ drawn_at: at(1, '10:00'), paco2_mmhg: 28 }, { drawn_at: at(1, '12:00'), paco2_mmhg: 38 }], paco2_hypocapnia_threshold: 35, threshold_source: 'синтетический СОП', vent_changes: [{ at: at(1, '10:30'), parameter: 'PIP', from: 22, to: 19 }] },
    (r, o) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.deepEqual(r.active_ambiguities, ['RDS-010-A2']); assert.equal(o.derived.values.minutes_hypocapnia_to_vent_change, 30); }],
  ['EDGE-06', 'NEC-001', { nec_suspected: true, nec_suspected_at: at(3, '10:00'), feeding_at_nec_suspicion: 'active', enteral_feeding_stopped: true, enteral_feeding_stopped_at: at(3, '10:05') },
    (r) => { assert.equal(r.observation, O.NOT_ASSESSED); assert.equal(part(r, 'feeding').observation, O.CONSISTENT); assert.equal(part(r, 'ng_tube').observation, O.NOT_ASSESSED); }],
  ['EDGE-07', 'NEC-002', { nec_suspected: true, uvc_present: true, uvc_removed: false, uac_present: true, uac_removed: true, uac_removed_at: at(3, '11:00'), alternative_access_available: false, retention_reason: 'единственный доступ' },
    (r) => { assert.equal(part(r, 'uac').observation, O.CONSISTENT); assert.equal(part(r, 'uvc').observation, O.DIFFERS); assert.equal(r.observation, O.DIFFERS); assert.equal(r.justification_complete, true); }, null, J('NEC-002', { category: 'clinical_indication' })],
  ['EDGE-08', 'NEC-003', { nec_stage: '1б', gi_passage_restored: false, enteral_feeding_stopped: true, nec_onset_at: at(1, '10:00') },
    (r, o) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.ok(r.active_ambiguities.includes('NEC-003-A1')); assert.ok(cfs(o).includes('CF-003')); }],
  ['EDGE-09', 'NEC-004', { nec_stage: '2а', nec_onset_at: at(1, '10:00'), nec_confirmed_at: at(2, '10:00'), enteral_feeding_resumed_at: at(7, '10:00'), improvement_signs: { abdomen_not_distended_not_tender: false } },
    (r, o) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.ok(r.card.labels.some(l => l.id === 'no_improvement')); assert.equal(o.derived.values.nec_day_from_onset_at_feeding_resumption, 7); assert.equal(o.derived.values.nec_day_from_confirmation_at_feeding_resumption, 6); }],
  ['EDGE-10', 'NEC-005', { nec_stage: '2а', pn_type: 'full', pn_running_at_nec_onset: true },
    (r) => { assert.equal(r.observation, O.CONSISTENT); }],
  ['EDGE-11', 'NEC-006', { nec_stage: '2а', nec_diagnosed_at: at(1, '10:00'), clinical_deterioration: true, deterioration_at: at(2, '08:00'), xrays: [{ at: at(2, '09:00'), position: 'vertical', reason: 'urgent' }] },
    (r) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.equal(part(r, 'deterioration').observation, O.CONSISTENT); assert.ok(r.active_ambiguities.includes('NEC-006-A2')); assert.ok(!r.parts.some(p => p.observation === O.DIFFERS)); }],
  ['EDGE-12', 'NEC-007', { nec_stage: '1а', antibiotics_started: true, metronidazole_given: false },
    (r) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.ok(r.active_ambiguities.includes('NEC-007-A1')); }],
  ['EDGE-13', 'NEC-008', { nec_stage: '2а', antibiotics_started: true, course_completed: false, abx_course_started_at: at(1, '10:00') },
    (r, o) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.equal(r.card.labels[0].text, 'Курс продолжается. Окончательная длительность пока не оценивается'); assert.ok(!('abx_course_days' in o.derived.values)); }],
  ['EDGE-14', 'NEC-009', { nec_stage: '2а', facility_level: 2, surgeon_consult_status: 'done', surgeon_consult_format: 'remote', surgeon_conclusion: 'консервативное лечение' },
    (r, o) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.deepEqual(r.active_ambiguities, ['NEC-009-A1']); assert.ok(cfs(o).includes('CF-001')); }],
  ['EDGE-15', 'NEC-010', { nec_stage: '2а', facility_level: 3, current_department: 'nicu', transferred_to_surgery: false },
    (r, o) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.ok(r.active_ambiguities.includes('NEC-010-A1')); assert.ok(cfs(o).includes('CF-001')); }],
  ['EDGE-16', 'SEP-001', { red_flag_count: 1, antibiotics_started: true, first_abx_dose_administered_at: at(1, '11:00') },
    (r, o) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.ok(r.active_ambiguities.includes('SEP-001-A1')); assert.ok(!('minutes_indication_to_first_dose' in o.derived.values)); }],
  ['EDGE-17', 'SEP-002', { sepsis_suspected: true, antibiotics_started: true, blood_culture_drawn_at: at(1, '09:40'), first_abx_dose_administered_at: at(1, '10:00'), culture_result_at: at(3, '10:00') },
    (r) => { assert.equal(r.observation, O.CONSISTENT); }],
  ['EDGE-18', 'SEP-003', { sepsis_suspected: true, immunoglobulin_given: true, immunoglobulin_purpose: 'other_indication', immunoglobulin_indication_text: 'иное показание (синтетика)' },
    (r) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.deepEqual(r.active_ambiguities, ['SEP-003-A2']); }],
  ['EDGE-19', 'SEP-004', { early_onset_sepsis_suspected: true, antibiotics_started: true, initial_empirical_regimen: 'другое', drug_availability: [{ drug: 'гентамицин', available: false, checked_at: at(1, '09:00'), source: 'аптека' }] },
    (r) => { assert.equal(r.observation, O.DIFFERS); assert.equal(r.justification.category, 'drug_unavailable'); assert.equal(r.justification.drug_unavailable.drug, 'гентамицин'); }, null,
    J('SEP-004', { category: 'drug_unavailable', drug_unavailable: { drug: 'гентамицин', checked_at: at(1, '09:00'), confirmed_by: 'старшая сестра (синтетика)' } })],
  ['EDGE-20', 'SEP-005', { early_onset_sepsis_suspected: true, benzylpenicillin_given: true, meningitis: false, benzylpenicillin_dose_mg_kg: 50, benzylpenicillin_interval_h: 12 },
    (r) => { assert.equal(r.observation, O.DIFFERS); }, null, J('SEP-005', { category: 'local_practice' })],
  ['EDGE-21', 'SEP-006', { early_onset_sepsis_suspected: true, gentamicin_given: true, gentamicin_initial_dose_mg_kg: 4, gentamicin_interval_h: 24, very_ill: false, gestational_age_weeks: 27, postnatal_age_days: 2 },
    (r) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.equal(part(r, 'dose').observation, O.AMBIGUOUS_PENDING); assert.equal(part(r, 'interval').observation, O.AMBIGUOUS_PENDING); assert.deepEqual(r.active_ambiguities, ['SEP-006-A3']); }],
  ['EDGE-22', 'SEP-006', { early_onset_sepsis_suspected: true, gentamicin_given: true, gentamicin_initial_dose_mg_kg: 4, nec_stage: '2а' },
    (r, o) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.ok(r.active_ambiguities.includes('SEP-006-A1')); assert.ok(cfs(o).includes('CF-005')); }],
  ['EDGE-23', 'SEP-007', { sepsis_suspected: true, antibiotics_started: true, first_abx_dose_ordered_at: at(1, '10:00'), first_abx_dose_administered_at: at(1, '11:00'), crp_samples: [{ drawn_at: at(2, '06:00'), purpose: 'control', result_at: at(2, '08:00') }] },
    (r, o) => { assert.equal(r.observation, O.CONSISTENT); assert.equal(o.derived.values.hours_first_dose_to_control_crp, 19); }],
  ['EDGE-24', 'SEP-008', { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'отрицательный', high_risk_factors: false, sepsis_onset: 'early', course_completed: true, abx_course_started_at: at(1, '10:00'), abx_course_ended_at: at(3, '10:00') },
    (r, o) => { assert.equal(r.observation, O.CONSISTENT); assert.equal(o.derived.values.abx_course_hours, 48); assert.ok(r.card.labels.some(l => l.id === 'review_36_48')); }],
  ['EDGE-25', 'SEP-009', { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'положительный', meningitis: false, ...COURSE(1, 7) },
    (r, o) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.ok(r.active_ambiguities.includes('SEP-009-A1')); assert.ok(cfs(o).includes('CF-002')); }],
  ['EDGE-26', 'SEP-010', { antibiotics_started: true, empirical_regimen: 'ampicillin+gentamicin', improving: true, blood_culture_result: 'положительный', meningitis: false, ...COURSE(1, 10) },
    (r, o) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.ok(r.active_ambiguities.includes('SEP-010-A1')); assert.ok(cfs(o).includes('CF-002')); }],
  ['EDGE-27', 'SEP-010', { antibiotics_started: true, blood_culture_result: 'отрицательный', high_risk_factors: true, meningitis: false, nec_stage: '2а', ...COURSE(1, 12), extension_reason: ['nec'], extension_justification_status: 'found' },
    (r) => { assert.equal(r.observation, O.AMBIGUOUS_PENDING); assert.ok(r.card.labels.some(l => l.text === 'Продление документировано. Требуется экспертная оценка клинического обоснования')); assert.ok(r.card.facts.find(f => f.field === 'extension_reason').value.includes('nec')); }],
];

for (const [id, rule, data, judge, limitation, just] of EDGES) {
  test(`${id} ${rule}${limitation ? ' — ' + limitation : ''}`, () => {
    const o = run(data, just); safe(o);
    const r = res(o, rule);
    judge(r, o);
  });
}

test('граничные: 27 сценариев, выполнено 26, EDGE-02 — известное ограничение', () => {
  assert.equal(EDGES.length, 27);
  assert.deepEqual(EDGES.filter(e => e[4]).map(e => e[0]), ['EDGE-02']);
  const archive = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'scenario-archive-ids.json'), 'utf8'));
  assert.deepEqual(EDGES.map(e => [e[0], e[1]]), archive.edges);
  assert.equal(archive.base.length, 90);
  assert.deepEqual(SC.map(s => s.id), archive.base);
});
