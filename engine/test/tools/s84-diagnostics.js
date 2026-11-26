// Этап 8, S8-4 — диагностика: почему неизменённые тесты этапа 7 падают при правиле «время записи / unknown не становится
// временем события без явного подтверждения». Ничего не меняет; только читает синтетические истории этапа 7.
// node engine/test/tools/s84-diagnostics.js [--json]
'use strict';
const fs = require('fs'), path = require('path');
const X = require('../../extract/extract.js'), CB = require('../../case-builder.js'), V = require('../../expert-view.js');
const env = { RulesEngine: require('../../rules-engine.js'), Derive: require('../../derive.js'), db: require('../../../rules/pilot-rules.json'), expertDecisions: require('../../../rules/expert-decisions.json') };
const DIR = path.join(__dirname, '..', 'fixtures/stage7');
const EX = JSON.parse(fs.readFileSync(path.join(DIR, 'stage7-extraction-gold.json'), 'utf8'));
const TE = JSON.parse(fs.readFileSync(path.join(DIR, 'stage7-engine-technical.json'), 'utf8'));
const SIM = require('./time-confirm-sim.js');
const TZ = '+05:00', OK = { timeIsEvent: true, basisReason: 'диагностика S8-4 (техническая симуляция): явное подтверждение врачом' };
const okFor = it => SIM.confirmOpts(it, OK.basisReason);
let k = 0; const now = () => new Date(Date.UTC(2026, 10, 20, 9, 0, k++)).toISOString();
const labels = v => v.rules.map(r => [r.rule_id, r.label]);

function risky(h) {
  const s = CB.createSession({ extraction: X.extract(h.text, { tz: TZ, documentId: h.id }), actor: 'диаг', now });
  const out = [];
  for (const it of s.items) {
    const c = it.candidate, bases = [];
    if (c.timeline_basis) c.timeline_basis.forEach((b, i) => bases.push({ index: i, basis: b.time_basis, at: c.timeline[i].at }));
    else if (c.alternatives) c.alternatives.forEach((a, i) => bases.push({ index: i, basis: a.time_basis || null }));
    else if (c.time_basis_items) c.time_basis_items.forEach((x, i) => bases.push({ index: i, basis: x.time_basis }));
    else bases.push({ index: null, basis: CB.basisOf(c) });
    const r = bases.filter(b => b.basis === 'document_time' || b.basis === 'unknown');
    if (r.length) out.push({ field: c.field, critical: !!c.critical, risky: r, fragment: (c.fragment || (c.fragments && c.fragments[0] && c.fragments[0].text) || '').slice(0, 90), time_source: c.time_source || null });
  }
  return out;
}

/** Путь этапа 7 + явное подтверждение времени записи там, где без него confirm/choose отказывают. */
function reviewExplicit(s, pick) {
  for (const it of s.items) if (CB.needsChoice(it.candidate)) CB.choose(s, it.candidate.id, pick || 0, OK);
  for (const it of s.items) if (it.candidate.critical && it.status === CB.STATUS.NEW) CB.confirm(s, it.candidate.id, CB.needsTimeConfirm(it) ? okFor(it) : undefined);
  for (const g of [...new Set(s.items.map(i => i.candidate.group))]) CB.confirmGroup(s, g);
  for (const it of s.items) if (it.status === CB.STATUS.NEW && CB.needsTimeConfirm(it)) CB.confirm(s, it.candidate.id, okFor(it));
}

function endToEnd(h) {
  const t = TE.histories.find(x => x.id === h.id);
  const variants = t.variants ? Object.keys(t.variants).map((v, i) => [v, i]) : [[null, 0]];
  return variants.map(([v, i]) => {
    const ref = v ? t.variants[v] : t;
    const s = CB.createSession({ extraction: X.extract(h.text, { tz: TZ, documentId: h.id }), actor: 'диаг', now });
    reviewExplicit(s, i);
    const b = CB.build(s), view = V.view(env, b, [h.protocol]);
    const diff = [];
    if (!b.completeness.complete) diff.push('не все сведения решены');
    for (const f of new Set([...Object.keys(b.case.data), ...Object.keys(ref.input)]))
      if (JSON.stringify(b.case.data[f]) !== JSON.stringify(ref.input[f])) diff.push('данные ' + f + ': ' + JSON.stringify(b.case.data[f]) + ' ≠ эталон ' + JSON.stringify(ref.input[f]));
    if (JSON.stringify(labels(view)) !== JSON.stringify(ref.all_rules.map(r => [r.rule_id, r.label]))) diff.push('метки правил');
    if (JSON.stringify(view.shown.map(r => r.rule_id)) !== JSON.stringify(ref.shown_by_default.map(r => r.rule_id))) diff.push('показанные правила');
    if (JSON.stringify(view.ui_warnings) !== JSON.stringify(ref.ui_warnings)) diff.push('предупреждения');
    return { variant: v, equal: diff.length === 0, diff };
  });
}

module.exports = { risky, endToEnd, reviewExplicit, EX, TE, OK };
if (require.main !== module) return;
const rep = EX.histories.map(h => ({ id: h.id, protocol: h.protocol, risky: risky(h), explicit: endToEnd(h) }));
if (process.argv.includes('--json')) { console.log(JSON.stringify(rep, null, 2)); process.exit(0); }
for (const r of rep) {
  console.log(`\n## ${r.id} (${r.protocol})`);
  for (const x of r.risky) console.log(`- ${x.field}${x.critical ? ' ★' : ''}: ${x.risky.map(b => (b.index === null ? '' : '#' + b.index + ' ') + b.basis + (b.at ? ' ' + b.at : '')).join('; ')} — «${x.fragment}»${x.time_source ? ' [' + x.time_source + ']' : ''}`);
  for (const e of r.explicit) console.log(`  явное подтверждение${e.variant ? ' (' + e.variant + ')' : ''}: ${e.equal ? 'движок = технический эталон' : 'РАСХОЖДЕНИЕ: ' + e.diff.join('; ')}`);
}
