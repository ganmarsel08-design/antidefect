// Этап 8: неизменённый набор тестов этапа 7 как КОНТРОЛЬ.
// Запускает тесты этапа 7 как есть и проверяет, что упали ровно ожидаемые тесты с ожидаемыми сообщениями
// (fixtures/stage8/stage7-control-expected.json), и честно печатает итог «N из 249 значений».
// Запуск: node engine/test/tools/stage7-control.js [--ui]   (--ui: также браузерный сценарий этапа 7)
// Только синтетические данные.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const EXP = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine/test/fixtures/stage8/stage7-control-expected.json'), 'utf8'));
const X = require(path.join(ROOT, 'engine/extract/extract.js'));
const EX = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine/test/fixtures/stage7/stage7-extraction-gold.json'), 'utf8'));
let bad = [];

// 1) счёт значений уровня 1 (значение совпало — без проверки фрагментов; честный итог)
let total = 0, matched = 0; const missing = [];
for (const h of EX.histories) {
  const got = new Map(X.extract(h.text, { tz: EX.facility_utc_offset_default }).candidates.map(c => [c.field, c]));
  for (const it of h.items) {
    total++; const c = got.get(it.field);
    const ok = c && (it.timeline ? (c.timeline || []).length === it.timeline.length : JSON.stringify(c.value) === JSON.stringify(it.value));
    if (ok) matched++; else missing.push(h.id + ' ' + it.field);
  }
}
console.log(`этап 7 (неизменённый контроль): значения ${matched} из ${total}`);
if (total !== EXP.values.total || matched !== EXP.values.expected_matched) bad.push(`ожидалось ${EXP.values.expected_matched} из ${EXP.values.total}`);
const expMissing = EXP.incompatibilities.filter(x => x.history).map(x => x.history + ' ' + x.field).sort();
if (JSON.stringify(missing.sort()) !== JSON.stringify(expMissing)) bad.push('не совпали значения: ' + JSON.stringify(missing));

// 2) тесты этапа 7 как есть
const files = [...new Set(EXP.expected_failing_tests.map(t => t.file))];
for (const f of fs.readdirSync(path.join(ROOT, 'engine/test')).filter(n => /^stage7-.*\.test\.js$/.test(n))) {
  const rel = 'engine/test/' + f; if (!files.includes(rel)) files.push(rel);
}
for (const rel of files) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', rel], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
  // авария процесса не должна выглядеть как «ожидаемые падения» (ревью ChatGPT к e690664)
  if (r.error) { bad.push(`${rel}: процесс не запустился или прерван: ${r.error.message}`); continue; }
  if (r.signal) { bad.push(`${rel}: процесс завершён сигналом ${r.signal}`); continue; }
  const out = (r.stdout || '') + (r.stderr || ''); const lines = out.split('\n');
  const num = k => { const m = new RegExp('^# ' + k + ' (\\d+)$', 'm').exec(out); return m ? +m[1] : null; };
  const nT = num('tests'), nP = num('pass'), nF = num('fail'), nC = num('cancelled'), nS = num('skipped'), nTd = num('todo');
  const expCount = (EXP.expected_test_counts || {})[rel];
  if (nT === null || nP === null || nF === null) bad.push(`${rel}: нет итоговых счётчиков TAP — прогон неполный`);
  else {
    if (nT === 0) bad.push(`${rel}: выполнено 0 тестов`);
    if (nP + nF !== nT || nC || nS || nTd) bad.push(`${rel}: счётчики не сходятся (tests ${nT}, pass ${nP}, fail ${nF}, cancelled ${nC}, skipped ${nS}, todo ${nTd})`);
    if (expCount === undefined) bad.push(`${rel}: число тестов не записано в ожидаемом списке`);
    else if (nT !== expCount) bad.push(`${rel}: выполнено ${nT} тестов, ожидалось ${expCount}`);
  }
  if (r.status === 0 && nF) bad.push(`${rel}: код выхода 0 при упавших тестах`);
  if (r.status !== 0 && nF === 0) bad.push(`${rel}: код выхода ${r.status} без упавших тестов — авария`);
  const failed = [];
  for (let i = 0; i < lines.length; i++) { const m = /^not ok \d+ - (.*)$/.exec(lines[i]); if (m) { let j = i + 1, body = ''; while (j < lines.length && !/^(?:not )?ok \d+ - /.test(lines[j])) body += lines[j++] + '\n'; failed.push({ name: m[1].trim(), body }); } }
  const exp = EXP.expected_failing_tests.filter(t => t.file === rel);
  const pass = (out.match(/^ok \d+ - /mg) || []).length;
  if (nF !== null && failed.length !== nF) bad.push(`${rel}: разобрано падений ${failed.length}, по счётчику ${nF}`);
  if (nP !== null && pass !== nP) bad.push(`${rel}: разобрано успешных ${pass}, по счётчику ${nP}`);
  console.log(`${rel}: прошло ${pass}, упало ${failed.length} (ожидаемо ${exp.length})`);
  for (const f of failed) {
    const e = exp.find(t => t.name === f.name);
    if (!e) { bad.push(`${rel}: неожиданно упал «${f.name}»`); continue; }
    for (const s of e.must_include) if (!f.body.includes(s)) bad.push(`${rel}: «${f.name}» упал по другой причине (нет «${s}»)`);
    console.log(`  ожидаемая несовместимость ${e.ids.join(', ')}: ${f.name}`);
  }
  for (const e of exp) if (!failed.some(f => f.name === e.name)) bad.push(`${rel}: ожидалось падение «${e.name}», а тест прошёл — обновите список несовместимостей`);
}

// 3) браузерный сценарий этапа 7 как есть
if (process.argv.includes('--ui')) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'engine/test/ui/expert.scenario.js')], { cwd: ROOT, encoding: 'utf8', env: process.env, timeout: 600000 });
  if (r.error || r.signal) bad.push(`UI: процесс прерван (${r.error ? r.error.message : r.signal})`);
  const out = (r.stdout || '') + (r.stderr || '');
  const sm = /этап 7, браузер: (\d+)\/(\d+)/.exec(out);
  if (!sm) bad.push('UI: нет итоговой строки «этап 7, браузер: N/M» — прогон неполный');
  else if (+sm[1] !== EXP.expected_ui.passed || +sm[2] !== EXP.expected_ui.total) bad.push(`UI: ${sm[1]}/${sm[2]}, ожидалось ${EXP.expected_ui.passed}/${EXP.expected_ui.total}`); console.log(out.split('\n').filter(l => /браузер:/.test(l)).join('\n'));
  const fails = out.split('\n').filter(l => /^FAIL /.test(l)).map(l => l.slice(5).trim());
  for (const f of fails) { const e = EXP.expected_failing_ui_steps.find(s => f.startsWith(s.step)); if (!e) bad.push(`UI: неожиданно упал шаг «${f}»`); else console.log(`  ожидаемая несовместимость ${e.ids.join(', ')}: ${f}`); }
  for (const e of EXP.expected_failing_ui_steps) if (!fails.some(f => f.startsWith(e.step))) bad.push(`UI: ожидалось падение «${e.step}»`);
}

if (bad.length) { console.error('КОНТРОЛЬ ЭТАПА 7 НЕ ПРОЙДЕН:\n- ' + bad.join('\n- ')); process.exit(1); }
console.log(`контроль этапа 7: отличия ровно ожидаемые (${EXP.incompatibilities.map(x => x.id).join(', ')}); прочие тесты этапа 7 проходят без изменений`);
