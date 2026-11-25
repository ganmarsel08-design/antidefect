// Этап 7 — три уровня эталона, сгенерированные данные страницы, неизменность клинической базы и движка.
// Только синтетические данные.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(__dirname, 'fixtures/stage7');
const rd = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

test('уровни 2 и 3 воспроизводятся из уровня 1 (build-stage7-gold.js --check)', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'engine/test/tools/build-stage7-gold.js'), '--check'], { stdio: 'pipe' });
});

test('engine/expert-data.js — точная копия базы правил и решений (build-expert-data.js --check)', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'engine/test/tools/build-expert-data.js'), '--check'], { stdio: 'pipe' });
  const src = fs.readFileSync(path.join(ROOT, 'engine/expert-data.js'), 'utf8');
  const D = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
  assert.deepEqual(D.rules, JSON.parse(fs.readFileSync(path.join(ROOT, 'rules/pilot-rules.json'), 'utf8')));
  assert.deepEqual(D.expert_decisions, JSON.parse(fs.readFileSync(path.join(ROOT, 'rules/expert-decisions.json'), 'utf8')));
  assert.equal(D.samples.length, 9);
});

test('уровень 2 — технический, не клинический: окончательного вывода нет нигде', () => {
  const T = rd('stage7-engine-technical.json');
  assert.match(T.note, /НЕ клиническая экспертиза/);
  assert.equal(T.histories.length, 9);
  for (const h of T.histories) for (const v of (h.variants ? Object.values(h.variants) : [h])) {
    assert.equal(v.final_conclusion, null);
    assert.equal(v.all_rules.length, 30);
  }
  assert.deepEqual(Object.keys(T.histories.find(h => h.id === 'СИН-НЭК-03').variants), ['A', 'B']);
});

test('уровень 3 — 79 оценок, все пустые; «применимость не установлена» отдельно от «неприменимо»', () => {
  const C = rd('stage7-clinical-assessment-template.json');
  const items = C.histories.flatMap(h => h.key_items);
  assert.equal(items.length, 79);
  for (const k of items) { assert.equal(k.doctor_assessment, null); assert.equal(k.doctor_comment, null); assert.equal(k.assessed_by, null); }
  assert.ok(C.allowed_values.includes('применимость не установлена'));
  assert.ok(C.allowed_values.includes('неприменимо'));
  assert.equal(new Set(C.allowed_values).size, C.allowed_values.length);
  assert.notEqual(C.value_notes['применимость не установлена'], C.value_notes['неприменимо']);
});

test('клиническая база и движок не изменены относительно feature/stage4-registry после merge PR №7 (4f36b41)', t => {
  let base;
  try { base = f => execFileSync('git', ['show', '4f36b41:' + f], { cwd: ROOT, maxBuffer: 64 << 20 }); }
  catch (e) { t.skip('нет git'); return; }
  try { base('engine/rules-engine.js'); } catch (e) { t.skip('нет коммита 4f36b41 (нужен fetch-depth: 0)'); return; }
  for (const f of ['rules/pilot-rules.json', 'rules/expert-decisions.json', 'engine/rules-engine.js', 'engine/derive.js'])
    assert.ok(base(f).equals(fs.readFileSync(path.join(ROOT, f))), f + ' изменён');
  // data/protocols.json (рабочий файл программы в main) в этой ветке отсутствует и не создаётся
  assert.ok(!fs.existsSync(path.join(ROOT, 'data/protocols.json')));
});

test('база правил: 30 правил, 28 блокирующих неоднозначностей, 7 конфликтов CF-001–CF-007', () => {
  const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules/pilot-rules.json'), 'utf8'));
  assert.equal(db.rules.length, 30);
  assert.deepEqual(db.protocol_conflicts.map(c => c.id), ['CF-001', 'CF-002', 'CF-003', 'CF-004', 'CF-005', 'CF-006', 'CF-007']);
  const blocking = db.rules.flatMap(r => r.ambiguities || []).filter(a => a.blocking && a.blocking !== 'no');
  assert.equal(blocking.length, 28);
  for (const r of db.rules) assert.equal(r.expert_confirmation, null);
});
