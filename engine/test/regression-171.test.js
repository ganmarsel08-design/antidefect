'use strict';
// Регрессия 171 синтетического случая (третий круг): 90 базовых + 27 граничных (архив) + 40 исправлений этапа 6 + 14 ТАБ.
// Входы и отпечатки результатов заморожены на коммите 2eeb6ae (fixtures/cases-171.json, fixtures/baseline-171-2eeb6ae.json).
// Правило проверки: случай, не названный в EXPECTED, обязан дать побайтово тот же отпечаток, что на 2eeb6ae.
// Случай из EXPECTED обязан измениться ровно так, как записано (исход, активные неоднозначности, новые противоречия,
// добавленные и убранные подписи), с указанием решения, по которому изменение согласовано.
// Р1–Р8 — решения врача 20.11.2026 по 8 вопросам третьего круга; Т1–Т8 — технические исправления.
// Только синтетические данные.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const E = require('../rules-engine.js');
const { digest, digestRule } = require('./fixtures/digest-171.js');

const ROOT = path.join(__dirname, '..', '..');
const DB = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'pilot-rules.json'), 'utf8'));
const ED = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'expert-decisions.json'), 'utf8'));
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cases-171.json'), 'utf8')).cases;
const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'baseline-171-2eeb6ae.json'), 'utf8')).results;
const O = E.OBS;
const UNTOUCHED = ['RDS-001', 'RDS-002', 'RDS-004', 'RDS-005', 'RDS-006'];
const run = c => E.evaluate(DB, { synthetic: true, data: JSON.parse(JSON.stringify(c.data)), justifications: c.justifications || undefined }, { expert_decisions: ED });

// Явный перечень согласованных изменений результатов ранее существовавших случаев (60 из 171).
const EXPECTED = {
  "RDS-003-T1": {"from":"CONSISTENT","to":"AMBIGUOUS_PENDING","amb":["RDS-003-A2"],"cf_added":[],"labels_added":["intubation_no_record"],"labels_removed":[],"why":"Р6: RDS-003-A2 и при «сведений об интубации нет» (ребёнок с РДС/риском, нет показания по FiO₂)"},
  "RDS-003-T2": {"from":"NOT_ASSESSED","to":"AMBIGUOUS_PENDING","amb":["RDS-003-A2"],"cf_added":[],"labels_added":["intubation_no_record","gaps_behind_ambiguity"],"labels_removed":[],"why":"Р6: RDS-003-A2 и при «сведений об интубации нет» (ребёнок с РДС/риском, нет показания по FiO₂)"},
  "RDS-003-T3": {"from":"DIFFERS","to":"AMBIGUOUS_PENDING","amb":["RDS-003-A2"],"cf_added":[],"labels_added":["intubation_no_record"],"labels_removed":["differs"],"why":"Р6: RDS-003-A2 и при «сведений об интубации нет» (ребёнок с РДС/риском, нет показания по FiO₂)"},
  "RDS-008-T2": {"from":"NOT_ASSESSED","to":"NOT_ASSESSED","amb":[],"cf_added":[],"labels_added":[],"labels_removed":[],"why":"Р8: проверка по blood_culture_before_antibiotics_resolved (ручное поле или отметки); меняется имя недостающего поля"},
  "RDS-009-T1": {"from":"AMBIGUOUS_PENDING","to":"CONSISTENT","amb":[],"cf_added":[],"labels_added":[],"labels_removed":[],"why":"Р5: RDS-009-A1 условная — 200 мг/кг без блокировки, без дозы — нет данных"},
  "RDS-009-T2": {"from":"AMBIGUOUS_PENDING","to":"NOT_ASSESSED","amb":[],"cf_added":[],"labels_added":[],"labels_removed":["gaps_behind_ambiguity"],"why":"Р5: RDS-009-A1 условная — 200 мг/кг без блокировки, без дозы — нет данных"},
  "NEC-003-T1": {"from":"AMBIGUOUS_PENDING","to":"CONSISTENT","amb":[],"cf_added":[],"labels_added":[],"labels_removed":["gaps_behind_ambiguity"],"why":"Р2: NEC-003-A1 только на часть «возобновление»; прекращение кормления оценивается"},
  "NEC-003-T3": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["NEC-003-A1"],"cf_added":[],"labels_added":[],"labels_removed":[],"why":"Р2: NEC-003-A1 только на часть «возобновление»; прекращение кормления оценивается"},
  "NEC-004-T1": {"from":"AMBIGUOUS_PENDING","to":"NOT_ASSESSED","amb":[],"cf_added":[],"labels_added":[],"labels_removed":["gaps_behind_ambiguity"],"why":"Р3: NEC-004-A1 условная (часть «срок»); улучшение — отдельная часть"},
  "NEC-004-T2": {"from":"AMBIGUOUS_PENDING","to":"NOT_ASSESSED","amb":[],"cf_added":[],"labels_added":[],"labels_removed":["gaps_behind_ambiguity"],"why":"Р3: NEC-004-A1 условная (часть «срок»); улучшение — отдельная часть"},
  "NEC-004-T3": {"from":"AMBIGUOUS_PENDING","to":"DIFFERS","amb":[],"cf_added":[],"labels_added":["differs"],"labels_removed":["gaps_behind_ambiguity"],"why":"Р3: NEC-004-A1 условная (часть «срок»); улучшение — отдельная часть"},
  "NEC-005-T2": {"from":"NOT_ASSESSED","to":"NOT_ASSESSED","amb":[],"cf_added":[],"labels_added":[],"labels_removed":[],"why":"Р3 (NEC-004-A1 условная): в случае со стадией НЭК II правило NEC-004 больше не даёт неоднозначность без данных — общий статус случая «Недостаточно данных»","status":"Недостаточно данных"},
  "NEC-006-T2": {"from":"NOT_ASSESSED","to":"NOT_ASSESSED","amb":[],"cf_added":[],"labels_added":[],"labels_removed":[],"why":"Р3 (NEC-004-A1 условная): в случае со стадией НЭК II правило NEC-004 больше не даёт неоднозначность без данных — общий статус случая «Недостаточно данных»","status":"Недостаточно данных"},
  "NEC-008-T1": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["NEC-008-A1"],"cf_added":[],"labels_added":["course_duration"],"labels_removed":[],"why":"Р4: A1 без изменений; показ длительности курса (сутки, часы, первая и последняя доза)"},
  "NEC-008-T3": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["NEC-008-A1"],"cf_added":[],"labels_added":["course_duration"],"labels_removed":[],"why":"Р4: A1 без изменений; показ длительности курса (сутки, часы, первая и последняя доза)"},
  "NEC-010-T2": {"from":"NOT_ASSESSED","to":"NOT_ASSESSED","amb":[],"cf_added":[],"labels_added":[],"labels_removed":[],"why":"Р3 (NEC-004-A1 условная): в случае со стадией НЭК II правило NEC-004 больше не даёт неоднозначность без данных — общий статус случая «Недостаточно данных»","status":"Недостаточно данных"},
  "SEP-003-T1": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-003-A2"],"cf_added":[],"labels_added":[],"labels_removed":["gaps_behind_ambiguity"],"why":"Т3: пробелы данных за неоднозначностью — только поля, от которых зависит ответ"},
  "SEP-005-T1": {"from":"CONSISTENT","to":"AMBIGUOUS_PENDING","amb":["SEP-005-A3"],"cf_added":["CF-006"],"labels_added":["sources_diverge"],"labels_removed":[],"why":"Р1: CF-006 и SEP-005-A3 — режим совпадает с одним положением протокола и расходится с другим"},
  "SEP-006-T1": {"from":"CONSISTENT","to":"CONSISTENT","amb":[],"cf_added":[],"labels_added":["table_not_checked"],"labels_removed":[],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
  "SEP-006-T2": {"from":"NOT_ASSESSED","to":"NOT_ASSESSED","amb":[],"cf_added":[],"labels_added":["table_not_checked"],"labels_removed":[],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
  "SEP-006-T3": {"from":"DIFFERS","to":"DIFFERS","amb":[],"cf_added":[],"labels_added":["table_not_checked"],"labels_removed":[],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
  "SEP-008-T1": {"from":"CONSISTENT","to":"CONSISTENT","amb":[],"cf_added":[],"labels_added":["course_duration"],"labels_removed":[],"why":"решение 19.11 20:06: SEP-008-A3 (>5 календарных суток при ≤120 ч); показ длительности"},
  "SEP-008-T3": {"from":"DIFFERS","to":"DIFFERS","amb":[],"cf_added":[],"labels_added":["course_duration"],"labels_removed":[],"why":"решение 19.11 20:06: SEP-008-A3 (>5 календарных суток при ≤120 ч); показ длительности"},
  "SEP-009-T1": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-009-A1"],"cf_added":[],"labels_added":["course_duration"],"labels_removed":[],"why":"решение 19.11 20:11: показ длительности; A1 без изменений"},
  "SEP-009-T3": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-009-A1"],"cf_added":[],"labels_added":["course_duration"],"labels_removed":[],"why":"решение 19.11 20:11: показ длительности; A1 без изменений"},
  "SEP-010-T1": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-010-A2"],"cf_added":[],"labels_added":["course_duration"],"labels_removed":[],"why":"решение 19.11 21:23: A1 только при положительном посеве; осмотр — три состояния; причина и обоснование раздельно; показ длительности"},
  "SEP-010-T3": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-010-A2"],"cf_added":[],"labels_added":["daily_exam_no_record","course_duration"],"labels_removed":["daily_exam"],"why":"решение 19.11 21:23: A1 только при положительном посеве; осмотр — три состояния; причина и обоснование раздельно; показ длительности"},
  "EDGE-08": {"from":"AMBIGUOUS_PENDING","to":"CONSISTENT","amb":[],"cf_added":[],"labels_added":[],"labels_removed":["gaps_behind_ambiguity"],"why":"Р2: NEC-003-A1 только на часть «возобновление»; прекращение кормления оценивается"},
  "EDGE-09": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["NEC-004-A1"],"cf_added":[],"labels_added":[],"labels_removed":["gaps_behind_ambiguity"],"why":"Р3: NEC-004-A1 условная (часть «срок»); улучшение — отдельная часть"},
  "EDGE-18": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-003-A2"],"cf_added":[],"labels_added":[],"labels_removed":["gaps_behind_ambiguity"],"why":"Т3: пробелы данных за неоднозначностью — только поля, от которых зависит ответ"},
  "EDGE-21": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-006-A3"],"cf_added":[],"labels_added":["table_band"],"labels_removed":[],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
  "EDGE-22": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-006-A1"],"cf_added":[],"labels_added":["table_not_checked"],"labels_removed":["dose_q24"],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
  "EDGE-24": {"from":"CONSISTENT","to":"CONSISTENT","amb":[],"cf_added":[],"labels_added":["course_duration"],"labels_removed":[],"why":"решение 19.11 20:06: SEP-008-A3 (>5 календарных суток при ≤120 ч); показ длительности"},
  "EDGE-25": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-009-A1"],"cf_added":[],"labels_added":["course_duration"],"labels_removed":[],"why":"решение 19.11 20:11: показ длительности; A1 без изменений"},
  "EDGE-26": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-010-A1","SEP-010-A2"],"cf_added":[],"labels_added":["course_duration"],"labels_removed":[],"why":"решение 19.11 21:23: A1 только при положительном посеве; осмотр — три состояния; причина и обоснование раздельно; показ длительности"},
  "EDGE-27": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-010-A2"],"cf_added":[],"labels_added":["extension_justification_found","daily_exam_no_record","course_duration"],"labels_removed":["daily_exam"],"why":"решение 19.11 21:23: A1 только при положительном посеве; осмотр — три состояния; причина и обоснование раздельно; показ длительности"},
  "ИСП-D1": {"from":"CONSISTENT","to":"AMBIGUOUS_PENDING","amb":["SEP-005-A3"],"cf_added":["CF-006"],"labels_added":["sources_diverge"],"labels_removed":[],"why":"Р1: CF-006 и SEP-005-A3 — режим совпадает с одним положением протокола и расходится с другим"},
  "ИСП-D7": {"from":"CONSISTENT","to":"AMBIGUOUS_PENDING","amb":["SEP-005-A3"],"cf_added":["CF-006"],"labels_added":["sources_diverge"],"labels_removed":[],"why":"Р1: CF-006 и SEP-005-A3 — режим совпадает с одним положением протокола и расходится с другим"},
  "ИСП-D8": {"from":"CONSISTENT","to":"AMBIGUOUS_PENDING","amb":["SEP-005-A3"],"cf_added":["CF-006"],"labels_added":["sources_diverge"],"labels_removed":[],"why":"Р1: CF-006 и SEP-005-A3 — режим совпадает с одним положением протокола и расходится с другим"},
  "ИСП-D16": {"from":"CONSISTENT","to":"AMBIGUOUS_PENDING","amb":["SEP-005-A3"],"cf_added":["CF-006"],"labels_added":["sources_diverge"],"labels_removed":[],"why":"Р1: CF-006 и SEP-005-A3 — режим совпадает с одним положением протокола и расходится с другим"},
  "ИСП-D18": {"from":"CONSISTENT","to":"AMBIGUOUS_PENDING","amb":["SEP-005-A3"],"cf_added":["CF-006"],"labels_added":["sources_diverge"],"labels_removed":[],"why":"Р1: CF-006 и SEP-005-A3 — режим совпадает с одним положением протокола и расходится с другим"},
  "ИСП-D11": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-006-A3"],"cf_added":[],"labels_added":["table_not_checked"],"labels_removed":[],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
  "ИСП-D12": {"from":"CONSISTENT","to":"CONSISTENT","amb":[],"cf_added":[],"labels_added":["table_not_checked"],"labels_removed":[],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
  "ИСП-D13": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-006-A3"],"cf_added":[],"labels_added":["table_not_checked"],"labels_removed":[],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
  "ИСП-I1": {"from":"AMBIGUOUS_PENDING","to":"NOT_ASSESSED","amb":[],"cf_added":[],"labels_added":[],"labels_removed":["gaps_behind_ambiguity"],"why":"Р3: NEC-004-A1 условная (часть «срок»); улучшение — отдельная часть"},
  "ИСП-T13а": {"from":"DIFFERS","to":"AMBIGUOUS_PENDING","amb":["SEP-008-A3"],"cf_added":[],"labels_added":["course_duration","days_hours_diverge"],"labels_removed":["differs"],"why":"решение 19.11 20:06: SEP-008-A3 (>5 календарных суток при ≤120 ч); показ длительности"},
  "ТАБ-B1": {"from":"DIFFERS","to":"AMBIGUOUS_PENDING","amb":["SEP-005-A3"],"cf_added":["CF-006"],"labels_added":["sources_diverge","table_not_comparable"],"labels_removed":["differs"],"why":"Р1: CF-006 и SEP-005-A3 — режим совпадает с одним положением протокола и расходится с другим"},
  "ТАБ-B2": {"from":"DIFFERS","to":"AMBIGUOUS_PENDING","amb":["SEP-005-A3"],"cf_added":["CF-006"],"labels_added":["sources_diverge","table_not_comparable"],"labels_removed":["differs"],"why":"Р1: CF-006 и SEP-005-A3 — режим совпадает с одним положением протокола и расходится с другим"},
  "ТАБ-B3": {"from":"CONSISTENT","to":"AMBIGUOUS_PENDING","amb":["SEP-005-A3"],"cf_added":["CF-006"],"labels_added":["sources_diverge","table_not_comparable"],"labels_removed":[],"why":"Р1: CF-006 и SEP-005-A3 — режим совпадает с одним положением протокола и расходится с другим"},
  "ТАБ-B4": {"from":"CONSISTENT","to":"AMBIGUOUS_PENDING","amb":["SEP-005-A3"],"cf_added":["CF-006"],"labels_added":["sources_diverge"],"labels_removed":[],"why":"Р1: CF-006 и SEP-005-A3 — режим совпадает с одним положением протокола и расходится с другим"},
  "ТАБ-B5": {"from":"DIFFERS","to":"AMBIGUOUS_PENDING","amb":["SEP-005-A3"],"cf_added":["CF-006"],"labels_added":["dose_units","sources_diverge"],"labels_removed":["differs"],"why":"Р1: CF-006 и SEP-005-A3 — режим совпадает с одним положением протокола и расходится с другим"},
  "ТАБ-G1": {"from":"DIFFERS","to":"AMBIGUOUS_PENDING","amb":["SEP-006-A4"],"cf_added":["CF-007"],"labels_added":["table_band","sources_diverge"],"labels_removed":["differs"],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
  "ТАБ-G2": {"from":"CONSISTENT","to":"AMBIGUOUS_PENDING","amb":["SEP-006-A4"],"cf_added":["CF-007"],"labels_added":["table_band","sources_diverge"],"labels_removed":[],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
  "ТАБ-G3": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-006-A3","SEP-006-A4"],"cf_added":["CF-007"],"labels_added":["table_band","sources_diverge"],"labels_removed":[],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
  "ТАБ-G4": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-006-A3","SEP-006-A4"],"cf_added":["CF-007"],"labels_added":["table_band","table_boundary","sources_diverge"],"labels_removed":[],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
  "ТАБ-G5": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-006-A3","SEP-006-A4"],"cf_added":["CF-007"],"labels_added":["table_band","table_boundary","sources_diverge"],"labels_removed":[],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
  "ТАБ-G6": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-006-A3","SEP-006-A4"],"cf_added":["CF-007"],"labels_added":["table_band","sources_diverge"],"labels_removed":[],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
  "ТАБ-G7": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-006-A3","SEP-006-A4"],"cf_added":["CF-007"],"labels_added":["table_band","table_boundary","sources_diverge"],"labels_removed":[],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
  "ТАБ-G8": {"from":"AMBIGUOUS_PENDING","to":"AMBIGUOUS_PENDING","amb":["SEP-006-A3","SEP-006-A4"],"cf_added":["CF-007"],"labels_added":["table_band","sources_diverge"],"labels_removed":[],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
  "ТАБ-G9": {"from":"CONSISTENT","to":"AMBIGUOUS_PENDING","amb":["SEP-006-A4"],"cf_added":["CF-007"],"labels_added":["table_band","sources_diverge"],"labels_removed":[],"why":"Р1: CF-007 и SEP-006-A4; сверка с таблицей стр. 18 по ГВ и возрасту; Q24 скрыт при SEP-006-A1 (Т5)"},
};

test('171 случай: состав и происхождение', () => {
  assert.equal(CASES.length, 171);
  assert.equal(new Set(CASES.map(c => c.id)).size, 171);
  const by = g => CASES.filter(c => c.group === g).length;
  assert.deepEqual([by('базовый'), by('граничный'), by('исправления этапа 6')], [90, 27, 40]);
  assert.equal(CASES.filter(c => c.id.startsWith('ТАБ-')).length, 14);
  for (const c of CASES) assert.ok(BASE[c.id], c.id);
  const archive = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'scenario-archive-ids.json'), 'utf8'));
  assert.deepEqual(CASES.filter(c => c.group === 'базовый').map(c => c.id), archive.base);
});

test('171 случай: неперечисленные — побайтово как на 2eeb6ae; перечисленные — ровно как согласовано', () => {
  let same = 0, changed = 0;
  for (const c of CASES) {
    const o = run(c);
    assert.equal(o.final_conclusion, null, c.id);
    for (const r of o.results) { assert.equal(r.final, false, c.id); assert.equal(r.expert_review_required, true, c.id); }
    const d = digest(o, c.rule);
    const b = Object.assign({}, BASE[c.id]); delete b.protected;
    const e = EXPECTED[c.id];
    if (!e) { assert.deepEqual(d, b, c.id); same++; continue; }
    changed++;
    assert.notDeepEqual(d, b, `${c.id}: в перечне, но не изменился`);
    assert.equal(b.rule.observation, O[e.from], `${c.id} было`);
    assert.equal(d.rule.observation, O[e.to], `${c.id} стало`);
    assert.deepEqual(d.rule.active_ambiguities, e.amb, `${c.id} неоднозначности`);
    assert.deepEqual(d.conflicts.filter(x => !b.conflicts.includes(x)), e.cf_added, `${c.id} противоречия`);
    assert.deepEqual(b.conflicts.filter(x => !d.conflicts.includes(x)), [], `${c.id}: противоречие пропало`);
    const bl = b.rule.labels.map(x => x[0]), dl = d.rule.labels.map(x => x[0]);
    assert.deepEqual(dl.filter(x => !bl.includes(x)), e.labels_added, `${c.id} подписи добавлены`);
    assert.deepEqual(bl.filter(x => !dl.includes(x)), e.labels_removed, `${c.id} подписи убраны`);
    if (e.status) assert.equal(d.status, e.status, c.id);
    assert.ok(typeof e.why === 'string' && e.why.length > 10, c.id);
  }
  assert.equal(changed, Object.keys(EXPECTED).length);
  assert.equal(same + changed, 171);
  assert.equal(changed, 60);
});

test('171 случай: RDS-001, RDS-002, RDS-004, RDS-005, RDS-006 дают тот же результат во всех случаях', () => {
  for (const c of CASES) {
    const o = run(c);
    for (const id of UNTOUCHED) assert.deepEqual(digestRule(o.results.find(r => r.rule_id === id)), BASE[c.id].protected[id], `${c.id} ${id}`);
  }
});

test('171 случай: окончательных дефектов и выводов нет; «отличается» только с весом и подписью об экспертной оценке', () => {
  for (const c of CASES) {
    const o = run(c);
    assert.ok(E.ALLOWED_STATUSES.includes(o.status));
    for (const r of o.results) if (r.observation === O.DIFFERS) {
      assert.ok(r.observation_weight, `${c.id} ${r.rule_id}`);
      assert.ok(r.card.labels.some(l => l.id === 'differs' && /требуется оценка эксперта$/.test(l.text)), `${c.id} ${r.rule_id}`);
    }
  }
});
