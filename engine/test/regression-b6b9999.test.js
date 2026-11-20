'use strict';
// Регрессия 171 синтетического случая относительно отдельного замороженного снимка коммита b6b9999
// (fixtures/baseline-171-b6b9999.json, получен кодом и базой правил самого b6b9999 — tools/freeze-baseline-171.js).
// Сравниваются все 30 правил и значимые поля экспертного вывода (неоднозначности, части, подписи, противоречия, статус).
// Ожидание (исправления после независимой проверки, решение врача 20.11.2026): 163 случая совпадают полностью,
// ровно 8 — ТАБ-B1, B2, B3, G1, G2, G3, G4, G6 — изменены согласованно, их итоговые исходы не изменились.
// Только синтетические данные.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const T = require('./tools/freeze-baseline-171.js');

const ROOT = path.join(__dirname, '..', '..');
const COMMIT = 'b6b99990b9b4ff07b4e70e6d049ef4ebc48afb19';
const SNAP = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'baseline-171-b6b9999.json'), 'utf8'));
const CASES = T.loadCases();
const CUR = T.evaluateAll(ROOT, CASES).results;
const CHANGED = ['ТАБ-B1', 'ТАБ-B2', 'ТАБ-B3', 'ТАБ-G1', 'ТАБ-G2', 'ТАБ-G3', 'ТАБ-G4', 'ТАБ-G6'];
const ruleOf = (n, id) => n.rules.find(r => r.rule_id === id);

test('снимок b6b9999: коммит, 171 случай, контрольные суммы сходятся с сохранёнными результатами', () => {
  assert.equal(SNAP.commit, COMMIT);
  assert.equal(Object.keys(SNAP.results).length, 171);
  assert.deepEqual(Object.keys(SNAP.results), CASES.map(c => c.id));
  for (const c of CASES) {
    assert.equal(SNAP.results[c.id].rules.length, 30, c.id);
    assert.equal(T.caseHash(SNAP.results[c.id]), SNAP.case_sha256[c.id], c.id);
  }
  assert.equal(T.snapshotHash(CASES.map(c => c.id), SNAP.case_sha256), SNAP.snapshot_sha256);
});

test('снимок b6b9999 воспроизводится кодом самого b6b9999 из истории git (если история доступна)', t => {
  let tmp;
  try {
    execFileSync('git', ['-C', ROOT, 'cat-file', '-e', COMMIT + '^{commit}'], { stdio: 'ignore' });
  } catch (e) { t.skip('нет истории git с коммитом b6b9999 (нужен checkout с fetch-depth: 0)'); return; }
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-b6b9999-'));
  for (const f of ['engine/derive.js', 'engine/rules-engine.js', 'rules/pilot-rules.json', 'rules/expert-decisions.json']) {
    fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(tmp, f), execFileSync('git', ['-C', ROOT, 'show', `${COMMIT}:${f}`]));
  }
  const again = T.build(tmp, COMMIT);
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(again.snapshot_sha256, SNAP.snapshot_sha256);
  assert.deepEqual(again.results, SNAP.results);
});

test('171 случай против b6b9999: 163 совпадают полностью, ровно 8 согласованно изменены', () => {
  const same = [], changed = [];
  for (const c of CASES) (T.caseHash(CUR[c.id]) === SNAP.case_sha256[c.id] ? same : changed).push(c.id);
  assert.equal(same.length + changed.length, 171);
  assert.deepEqual(changed, CHANGED);
  assert.equal(same.length, 163);
  for (const c of CASES) assert.equal(CUR[c.id].final_conclusion, null, c.id);
});

test('8 изменённых случаев: изменено только правило случая; общий итог, статус и итог правила прежние', () => {
  for (const id of CHANGED) {
    const c = CASES.find(x => x.id === id), a = SNAP.results[id], b = CUR[id];
    assert.equal(b.status, a.status, id);
    for (const r of a.rules) {
      const n = ruleOf(b, r.rule_id);
      if (r.rule_id !== c.rule) assert.deepEqual(n, r, `${id} ${r.rule_id}`);
      else { assert.notDeepEqual(n, r, id); assert.equal(n.observation, r.observation, id); assert.deepEqual(n.active_ambiguities, r.active_ambiguities, id); }
    }
  }
});

test('ТАБ-B1–B3: CF-006 больше не активно, подпись о расхождении заменена подписью о несопоставимости единиц (п. 3)', () => {
  for (const id of ['ТАБ-B1', 'ТАБ-B2', 'ТАБ-B3']) {
    const a = SNAP.results[id], b = CUR[id];
    assert.deepEqual(a.conflicts.filter(x => !b.conflicts.includes(x)), ['CF-006'], id);
    assert.deepEqual(b.conflicts.filter(x => !a.conflicts.includes(x)), [], id);
    const la = ruleOf(a, 'SEP-005').labels.map(l => l[0]), lb = ruleOf(b, 'SEP-005').labels.map(l => l[0]);
    assert.ok(la.includes('sources_diverge') && !lb.includes('sources_diverge'), id);
    assert.ok(lb.includes('table_not_comparable'), id);
    const { labels: _x, ...ra } = ruleOf(a, 'SEP-005'); const { labels: _y, ...rb } = ruleOf(b, 'SEP-005');
    assert.deepEqual(rb, ra, `${id}: кроме подписей ничего не изменилось`);
  }
});

test('ТАБ-G1–G4, G6: изменены только исходы частей SEP-006 (п. 1); противоречия и подписи прежние', () => {
  const EXP = { 'ТАБ-G1': ['совпадает_с_буквальным_прочтением', 'A4'], 'ТАБ-G2': ['совпадает_с_буквальным_прочтением', 'A4'],
    'ТАБ-G3': ['A3+A4', 'совпадает_с_буквальным_прочтением'], 'ТАБ-G4': ['A3+A4', 'совпадает_с_буквальным_прочтением'], 'ТАБ-G6': ['A3+A4', 'совпадает_с_буквальным_прочтением'] };
  const fmt = p => p[2].length ? p[2].map(x => x.replace('SEP-006-', '')).join('+') : p[1];
  for (const [id, [dose, interval]] of Object.entries(EXP)) {
    const a = SNAP.results[id], b = CUR[id];
    assert.deepEqual(b.conflicts, a.conflicts, id);
    const ra = ruleOf(a, 'SEP-006'), rb = ruleOf(b, 'SEP-006');
    assert.deepEqual(rb.labels, ra.labels, id);
    assert.deepEqual(rb.parts.map(fmt), [dose, interval], id);
    const { parts: _x, ...ka } = ra; const { parts: _y, ...kb } = rb;
    assert.deepEqual(kb, ka, `${id}: кроме частей ничего не изменилось`);
  }
});
