#!/usr/bin/env node
'use strict';
/*
 * Мутационная проверка тестов (V11; третий круг — ещё 12 мутаций; исправления после проверки — ещё 5): каждая намеренная поломка кода или базы правил должна быть поймана
 * хотя бы одним тестом engine/test/*.test.js. Запуск: node engine/test/mutation-check.js
 * Работает на временной копии репозитория; исходные файлы не меняются. Только синтетические данные.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const SKIP = new Set(['.git', 'node_modules']);

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d); else fs.copyFileSync(s, d);
  }
}
const sub = (from, to) => text => {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`мутация: фрагмент найден ${n} раз: ${from.slice(0, 80)}`);
  return text.replace(from, () => to);
};
const json = fn => text => { const d = JSON.parse(text); fn(d); return JSON.stringify(d, null, 1) + '\n'; };
const rule = (d, id) => d.rules.find(r => r.rule_id === id);

const DERIVE = 'engine/derive.js', ENGINE = 'engine/rules-engine.js', RULES = 'rules/pilot-rules.json';
const MUTATIONS = [
  // --- прежние 6 (этап 6) ---
  ['«unknown» превращается в «нет»', [[DERIVE, sub("if (typeof v === 'string' && UNKNOWN_VALUES.has(v)) { unknown.push(k); continue; }", "if (typeof v === 'string' && UNKNOWN_VALUES.has(v)) { data[k] = false; continue; }")]]],
  ['нарушен порядок осторожности исходов', [[ENGINE, sub('[OBS.AMBIGUOUS_PENDING, OBS.DIFFERS, OBS.NOT_ASSESSED,', '[OBS.AMBIGUOUS_PENDING, OBS.NOT_ASSESSED, OBS.DIFFERS,')]]],
  ['принимается отметка «только дата»', [[DERIVE, sub('if (DATE_RE.test(v)) return { reason: REASON.DATE_ONLY };', "if (DATE_RE.test(v)) v = v + 'T00:00Z';")]]],
  ['удалена NEC-010-A4', [[RULES, json(d => { const r = rule(d, 'NEC-010'); r.ambiguities = r.ambiguities.filter(a => a.id !== 'NEC-010-A4'); })]]],
  ['принимаются введённые вручную вычисляемые значения', [[DERIVE, sub('for (const f of DERIVED_FIELDS) if (has(data, f)) { ignored.push(f); delete data[f]; }', 'for (const f of []) if (has(data, f)) { ignored.push(f); delete data[f]; }')]]],
  ['категория обоснования меняет исход', [[ENGINE, sub('    out.justification_complete = j.complete;\n', "    out.justification_complete = j.complete;\n    if (j.value && j.value.category === 'clinical_indication' && out.observation === OBS.DIFFERS) out.observation = OBS.CONSISTENT;\n")]]],
  // --- новые 4 (исправления этапа 6) ---
  ['RDS-007: нулевой интервал засчитан как «совпадает»', [
    [DERIVE, sub("if (b.ms === a.ms) why('abx_stopped_after_sbi_exclusion', REASON.SAME_TIME);\n      else set('abx_stopped_after_sbi_exclusion', b.ms > a.ms);", "set('abx_stopped_after_sbi_exclusion', b.ms > a.ms);")],
    [RULES, json(d => { rule(d, 'RDS-007').requirement.parts.find(p => p.part_id === 'stop').check.op = 'is_false'; })]]],
  ['RDS-007: прежняя ошибка — отмена до исключения ТБИ засчитана', [[RULES, json(d => { rule(d, 'RDS-007').requirement.parts.find(p => p.part_id === 'stop').check.op = 'is_false'; })]]],
  ['SEP-003: консилиум вместо текста основания', [[DERIVE, sub('const text = nonEmptyText(data.clinical_evidence);', 'const text = nonEmptyText(data.clinical_evidence) || data.consilium_documented === true;')]]],
  ['дозы: возвращён процентный допуск 2 %', [[DERIVE, sub("if (calc !== null && wok) { set(F('dose_per_kg'), calc);", "if (calc !== null && wok) { set(F('dose_per_kg'), (r && !r.reason && Math.abs(calc - r.value) <= 0.02 * r.value) ? r.value : calc);")]]],
  ['календарные сутки по собственному смещению отметки', [[DERIVE, sub('const di = t => Math.floor((t.ms + off * 60000) / 86400000);', 'const di = t => Math.floor((t.ms + t.off * 60000) / 86400000);')]]],
  // --- 3 по дозам ---
  ['дозы: форма записи меняет оценку', [[DERIVE, sub('if (calc !== null && wok) {', 'if (calc !== null && wok && !(r && !r.reason && r.decimals > 0)) {')]]],
  ['дозы: «25,0» становится 25 (точность записи теряется)', [[DERIVE, sub('decimals: m[2] ? m[2].length : 0', 'decimals: 0')]]],
  ['дозы: записанная доза вместо вычисленной', [[DERIVE, sub('if (calc !== null && wok) {', 'if (false) {')]]],
  // --- третий круг (решения врача 20.11.2026) ---
  ['CF-006: постоянная блокировка всех назначений бензилпенициллина', [[DERIVE, sub("set('benzylpenicillin_regimen_sources_diverge', established);", "set('benzylpenicillin_regimen_sources_diverge', true);")]]],
  ['Ед/кг автоматически пересчитаны в мг/кг', [[DERIVE, sub("      const units = num(data, 'benzylpenicillin_dose_units_per_kg');", "      const units = num(data, 'benzylpenicillin_dose_units_per_kg');\n      if (units !== null && !has(data, 'benzylpenicillin_dose_per_kg')) set('benzylpenicillin_dose_per_kg', round(units / 2000, 6));")]]],
  ['CF-007: соответствие тексту подтверждается при другом режиме таблицы (G9)', [[DERIVE, sub('const diverge = (textM === true && tableM === false) || (tableM === true && textM !== true);', 'const diverge = (tableM === true && textM !== true);')]]],
  ['граница 28 суток: только один режим таблицы', [[DERIVE, sub("pna: [28, Infinity], dose: 4, interval: 24, text: '29 недель и меньше, 28 суток и старше", "pna: [29, Infinity], dose: 4, interval: 24, text: '29 недель и меньше, 28 суток и старше")]]],
  ['удалена SEP-006-A4', [[RULES, json(d => { const r = rule(d, 'SEP-006'); r.ambiguities = r.ambiguities.filter(a => a.id !== 'SEP-006-A4'); })]]],
  ['удалена SEP-008-A3', [[RULES, json(d => { const r = rule(d, 'SEP-008'); r.ambiguities = r.ambiguities.filter(a => a.id !== 'SEP-008-A3'); })]]],
  ['NEC-008-A1 снимается при курсе ≥10 суток', [[RULES, json(d => { const a = rule(d, 'NEC-008').ambiguities.find(x => x.id === 'NEC-008-A1'); a.blocking = 'when'; a.blocks_when = { field: 'abx_course_days', op: 'lt', value: 10 }; })]]],
  ['NEC-003-A1 снова блокирует всё правило', [[RULES, json(d => { delete rule(d, 'NEC-003').ambiguities.find(x => x.id === 'NEC-003-A1').part; })]]],
  ['RDS-003: «сведений нет» превращено в «не потребовалась»', [[DERIVE, sub("set('intubation_needed_status', v === true ? 'required' : v === false ? 'not_required' : 'no_record');", "set('intubation_needed_status', v === true ? 'required' : 'not_required');")]]],
  ['RDS-008: вычисление перезаписывает ручную запись', [[DERIVE, sub("      if (manual !== null && computed !== null && manual !== computed) {", "      if (computed !== null) { set('blood_culture_before_antibiotics_resolved', computed); set('blood_culture_before_antibiotics_basis', 'computed'); } else if (manual !== null && computed !== null && manual !== computed) {")]]],
  ['NEC-005: прекращение ПП до НЭК не учитывается', [[DERIVE, sub('      if (before) {', '      if (false) {')]]],
  // --- исправления после независимой проверки (20.11.2026) ---
  ['п. 1: SEP-006-A4 снова блокирует обе части', [[RULES, json(d => { delete rule(d, 'SEP-006').ambiguities.find(a => a.id === 'SEP-006-A4').blocks_when_by_part; })]]],
  ['п. 2: подписи «Продление более 7 суток» при 168 ч', [[RULES, json(d => { for (const c of rule(d, 'SEP-010').card_labels) if (c.when && c.when.all) c.when.all = c.when.all.filter(x => !(x.field === 'abx_course_hours_exact' && x.op === 'gt')); })]]],
  ['п. 3: записи в мг/кг и Ед/кг считаются эквивалентными', [[DERIVE, sub('const both = dose !== null && units !== null;', 'const both = false;')]]],
  ['п. 4: одинаковые отметки ПП и НЭК — «прекращено до НЭК»', [[DERIVE, sub('      if (st.ms === on.ms) {', '      if (false) {')], [DERIVE, sub('const before = st.ms < on.ms;', 'const before = st.ms <= on.ms;')]]],
  ['п. 5: условие 120 ч по округлённым часам', [[DERIVE, sub("set('abx_course_hours_exact', (b.ms - a.ms) / 3600000);", "set('abx_course_hours_exact', round((b.ms - a.ms) / 3600000, 2));")]]],
  ['Т1: подписи показываются у неприменимого правила', [[ENGINE, sub('      if (!ruleApplies && cl.show_when_not_applicable !== true) continue;', '')]]],
];

function runTests(dir) {
  const files = fs.readdirSync(path.join(dir, 'engine', 'test')).filter(f => f.endsWith('.test.js')).map(f => path.join('engine', 'test', f));
  return spawnSync(process.execPath, ['--test', ...files], { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { NODE_TEST_CONTEXT: undefined }) });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antidefect-mut-'));
const clean = path.join(tmp, 'clean');
copyTree(ROOT, clean);
const base = runTests(clean);
if (base.status !== 0) { console.error('Исходный код не проходит тесты — мутационная проверка не имеет смысла'); process.exit(2); }

let caught = 0;
MUTATIONS.forEach(([name, edits], i) => {
  const dir = path.join(tmp, `m${i + 1}`);
  copyTree(clean, dir);
  for (const [file, fn] of edits) { const p = path.join(dir, file); fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))); }
  const r = runTests(dir);
  const m = /# fail (\d+)/.exec(r.stdout || '');
  const failed = r.status !== 0;
  if (failed) caught++;
  console.log(`${String(i + 1).padStart(2)}. ${failed ? 'поймана' : 'НЕ ПОЙМАНА'} — ${name}${m ? ` (упавших тестов: ${m[1]})` : ''}`);
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Итого: поймано ${caught} из ${MUTATIONS.length}`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
