#!/usr/bin/env node
'use strict';
/*
 * Замороженный снимок результатов 171 синтетического случая на заданной версии кода.
 *
 *   git worktree add /tmp/ad-b6b9999 b6b99990b9b4ff07b4e70e6d049ef4ebc48afb19
 *   node engine/test/tools/freeze-baseline-171.js /tmp/ad-b6b9999 > engine/test/fixtures/baseline-171-b6b9999.json
 *
 * Код движка (engine/derive.js, engine/rules-engine.js), база правил и решения экспертизы берутся ИЗ УКАЗАННОЙ ПАПКИ
 * (версии, с которой снимается база), а не из текущей рабочей копии. Из текущей копии берутся только входы случаев
 * (engine/test/fixtures/cases-171.json — не менялись с b6b9999) и функция нормализации (ниже, в этом файле).
 *
 * Нормализация (одинакова для снимка и для проверки): для каждого случая и каждого из 30 правил —
 *   observation, applicability, active_ambiguities, части [part_id, observation, active_ambiguities, missing_data],
 *   missing_data, missing_reasons, подписи карточки [id, text], пробелы за неоднозначностью, justification_complete;
 * для случая — активные противоречия (id по порядку), общий статус, final_conclusion.
 * Контрольная сумма случая — sha256 от JSON.stringify(нормализованного объекта) в UTF-8 (ключи в фиксированном порядке
 * построения, без пробелов); контрольная сумма снимка — sha256 от строк «id:сумма» случаев в порядке cases-171.json, через \n.
 * Только синтетические данные.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HERE_ROOT = path.resolve(__dirname, '..', '..', '..');

function normalizeRule(r) {
  return {
    rule_id: r.rule_id,
    observation: r.observation,
    applicability: r.applicability,
    active_ambiguities: r.active_ambiguities.slice(),
    parts: (r.parts || []).map(p => [p.part_id, p.observation, p.active_ambiguities.slice(), p.missing_data.slice()]),
    missing_data: r.missing_data.slice(),
    missing_reasons: Object.keys(r.card.missing_reasons || {}).sort().map(k => [k, r.card.missing_reasons[k]]),
    labels: r.card.labels.map(l => [l.id, l.text]),
    gaps: (r.card.data_gaps_behind_ambiguity || []).map(g => g.field),
    justification_complete: r.justification_complete
  };
}
function normalizeCase(o) {
  return {
    rules: o.results.map(normalizeRule),
    conflicts: o.conflicts.map(c => c.id),
    status: o.status,
    final_conclusion: o.final_conclusion
  };
}
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const caseHash = n => sha(JSON.stringify(n));
const snapshotHash = (ids, hashes) => sha(ids.map(id => `${id}:${hashes[id]}`).join('\n'));

function evaluateAll(root, cases) {
  const E = require(path.join(root, 'engine', 'rules-engine.js'));
  const DB = JSON.parse(fs.readFileSync(path.join(root, 'rules', 'pilot-rules.json'), 'utf8'));
  const ED = JSON.parse(fs.readFileSync(path.join(root, 'rules', 'expert-decisions.json'), 'utf8'));
  const out = {};
  for (const c of cases) {
    const o = E.evaluate(DB, { synthetic: true, data: JSON.parse(JSON.stringify(c.data)), justifications: c.justifications || undefined }, { expert_decisions: ED });
    out[c.id] = normalizeCase(o);
  }
  return { results: out, engine: E.VERSION, schema: DB.schema_version };
}

function loadCases() {
  return JSON.parse(fs.readFileSync(path.join(HERE_ROOT, 'engine', 'test', 'fixtures', 'cases-171.json'), 'utf8')).cases;
}

function build(root, commit) {
  const cases = loadCases();
  const { results, engine, schema } = evaluateAll(root, cases);
  const hashes = Object.fromEntries(cases.map(c => [c.id, caseHash(results[c.id])]));
  return {
    note: 'Снимок результатов 171 синтетического случая по всем 30 правилам на указанном коммите; получен кодом и базой правил этого коммита (engine/test/tools/freeze-baseline-171.js). Только синтетические данные.',
    commit, engine, rules_schema: schema,
    normalization: 'см. заголовок engine/test/tools/freeze-baseline-171.js: 30 правил × (исход, применимость, неоднозначности, части, недостающие данные и причины, подписи, пробелы, полнота обоснования) + активные противоречия, статус, final_conclusion',
    hash_method: 'case: sha256(JSON.stringify(normalized)); snapshot: sha256(join("\\n", "id:case_sha256" в порядке cases-171.json))',
    snapshot_sha256: snapshotHash(cases.map(c => c.id), hashes),
    case_sha256: hashes,
    results
  };
}

module.exports = { normalizeRule, normalizeCase, caseHash, snapshotHash, evaluateAll, loadCases, build };

if (require.main === module) {
  const root = process.argv[2];
  if (!root) { console.error('укажите папку с версией кода (git worktree нужного коммита)'); process.exit(2); }
  const { execFileSync } = require('node:child_process');
  let commit = null;
  try { commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (e) { /* не git */ }
  process.stdout.write(JSON.stringify(build(path.resolve(root), commit), null, 1) + '\n');
}
