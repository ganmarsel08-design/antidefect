// Антидефект — этап 7. Построение уровня 2 (технические результаты движка) и уровня 3 (шаблон врачебной оценки)
// из уровня 1 (stage7-extraction-gold.json). Модуль извлечения здесь НЕ используется: входные данные — эталон.
// Запуск: node engine/test/tools/build-stage7-gold.js [--check]  (--check: сравнить с файлами, ничего не писать)
// Только синтетические данные.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DIR = path.join(ROOT, 'engine/test/fixtures/stage7');
const RulesEngine = require(path.join(ROOT, 'engine/rules-engine.js'));
const Derive = require(path.join(ROOT, 'engine/derive.js'));
const View = require(path.join(ROOT, 'engine/expert-view.js'));
const db = require(path.join(ROOT, 'rules/pilot-rules.json'));
const ed = require(path.join(ROOT, 'rules/expert-decisions.json'));
const env = { RulesEngine, Derive, db, expertDecisions: ed };

const EX = JSON.parse(fs.readFileSync(path.join(DIR, 'stage7-extraction-gold.json'), 'utf8'));
const TZ = EX.facility_utc_offset_default;
const ENGINE_COMMIT = 'c1768a3 (в feature/stage4-registry: 4f36b41)';

function caseFrom(h, pick) {
  const data = { facility_utc_offset: TZ }, sources = {};
  for (const it of h.items) {
    if (it.timeline) {
      const t = it.timeline.length === 1 ? it.timeline[0] : it.timeline[pick];
      data[it.field] = t.v; sources[it.field] = { document: h.id, fragment: t.q, author: 'эталон', confidence: 'подтверждено врачом' };
    } else { data[it.field] = it.value; sources[it.field] = { document: h.id, fragment: it.fragments.join(' | '), author: 'эталон', confidence: 'подтверждено врачом' }; }
  }
  return { synthetic: true, data, sources };
}
const built = c => ({ case: c, completeness: { total: 1, decided: 1, complete: true } });
const strip = v => ({
  final_conclusion: v.final_conclusion, active_conflicts: v.active_conflicts, counts: v.counts,
  shown_by_default: v.shown.map(r => ({ rule_id: r.rule_id, applicability: r.applicability, observation: r.observation, label: r.label, parts: r.parts, missing_data: r.missing_data })),
  hidden_cross_protocol_undetermined: { count: v.hidden.length, rules: v.hidden.map(r => r.rule_id) },
  ui_warnings: v.ui_warnings,
  all_rules: v.rules.map(r => ({ rule_id: r.rule_id, applicability: r.applicability, observation: r.observation, label: r.label })),
});

const TE = { schema: 'stage7-engine-technical-0.3', note: 'Уровень 2. ТЕХНИЧЕСКИЙ эталон: результаты действующего rules-engine.js на данных уровня 1. Проверка воспроизводимости программы, НЕ клиническая экспертиза и не доказательство клинической правильности.', engine_commit: ENGINE_COMMIT, histories: [], ui_test_variants: [] };
const CL = { schema: 'stage7-clinical-assessment-0.3', note: 'Уровень 3. Независимые врачебные оценки ключевых исходов. Заполняет врач-эксперт; программа и Claude поля оценки не заполняют.',
  allowed_values: ['соответствие', 'отличие', 'недостаточно данных', 'неоднозначность', 'применимость не установлена', 'неприменимо'],
  value_notes: { 'применимость не установлена': 'по данным истории нельзя решить, относится ли правило к случаю', 'неприменимо': 'правило к случаю не относится' },
  histories: [] };

for (const h of EX.histories) {
  const prot = [h.protocol];
  const multi = h.items.find(i => i.timeline && i.timeline.length > 1);
  let tech, base;
  if (multi) {
    const vs = multi.timeline.map((t, k) => ({ key: String.fromCharCode(65 + k), t, c: caseFrom(h, k) }));
    tech = { variants: {}, engine_limitation: multi.note };
    for (const v of vs) tech.variants[v.key] = Object.assign({ input_note: `${multi.field} = ${v.t.v} (${v.t.at || v.t.date + ', без времени'})`, input: v.c.data }, strip(View.view(env, built(v.c), prot)));
    base = tech.variants.A;
  } else {
    const c = caseFrom(h);
    tech = Object.assign({ input: c.data }, strip(View.view(env, built(c), prot)));
    base = tech;
  }
  TE.histories.push(Object.assign({ id: h.id, protocol: h.protocol }, tech));
  CL.histories.push({ id: h.id, protocol: h.protocol, author_design_intent: h.intent ? h.intent + ' (замысел автора синтетической истории, не экспертиза)' : null,
    key_items: base.shown_by_default.map(r => {
      let tr = r.label;
      if (tech.variants) { const lb = Object.keys(tech.variants).map(k => k + ': ' + tech.variants[k].all_rules.find(x => x.rule_id === r.rule_id).label); tr = lb.join('; '); }
      return { rule_id: r.rule_id, technical_result: tr, doctor_assessment: null, doctor_comment: null, assessed_by: null, assessed_at: null };
    }) });
}
{ // тестовый вариант: СЕП-01 без постнатального возраста (предупреждение SEP-006)
  const h = EX.histories.find(x => x.id === 'СИН-СЕП-01');
  const c = caseFrom(h); delete c.data.postnatal_age_days; delete c.sources.postnatal_age_days;
  const v = View.view(env, built(c), ['Сепсис']);
  TE.ui_test_variants.push({ id: 'СИН-СЕП-01/без-возраста', derived_from: 'СИН-СЕП-01', change: 'удалено поле postnatal_age_days',
    sep006: v.rules.find(r => r.rule_id === 'SEP-006').label, active_conflicts: v.active_conflicts, ui_warnings: v.ui_warnings });
}
const out = { 'stage7-engine-technical.json': TE, 'stage7-clinical-assessment-template.json': CL };
const check = process.argv.includes('--check');
let diff = 0;
for (const [f, obj] of Object.entries(out)) {
  const s = JSON.stringify(obj, null, 1) + '\n', p = path.join(DIR, f);
  if (check) { if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== s) { diff++; console.error('отличается:', f); } }
  else fs.writeFileSync(p, s);
}
if (check) { if (diff) process.exit(1); console.log('stage7: уровни 2 и 3 совпадают с эталоном уровня 1'); }
else console.log('записано:', Object.keys(out).join(', '), '| ключевых исходов:', CL.histories.reduce((a, h) => a + h.key_items.length, 0));
