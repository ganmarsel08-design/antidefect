// Этап 7 — подтверждение врачом, журнал, сборка случая, сквозной путь «текст → движок», частичный анализ.
// Только синтетические данные.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const X = require('../extract/extract.js');
const CB = require('../case-builder.js');
const V = require('../expert-view.js');
const RulesEngine = require('../rules-engine.js');
const Derive = require('../derive.js');
const db = require('../../rules/pilot-rules.json');
const ed = require('../../rules/expert-decisions.json');
const DIR = path.join(__dirname, 'fixtures/stage7');
const EX = JSON.parse(fs.readFileSync(path.join(DIR, 'stage7-extraction-gold.json'), 'utf8'));
const TE = JSON.parse(fs.readFileSync(path.join(DIR, 'stage7-engine-technical.json'), 'utf8'));
const env = { RulesEngine, Derive, db, expertDecisions: ed };
const TZ = '+05:00';
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 20, 9, 0, tick++)).toISOString();
const session = h => CB.createSession({ extraction: X.extract(h.text, { tz: TZ, documentId: h.id }), actor: 'эксперт-тест', now });
const H = id => EX.histories.find(h => h.id === id);

/** Полная проверка «как врач»: критические — по одному, остальные — группой, динамика — выбор варианта. */
function reviewAll(s, pick) {
  for (const it of s.items) if (CB.needsChoice(it.candidate)) CB.choose(s, it.candidate.id, pick || 0);
  for (const it of s.items) if (it.candidate.critical && it.status === CB.STATUS.NEW) CB.confirm(s, it.candidate.id);
  for (const g of [...new Set(s.items.map(i => i.candidate.group))]) CB.confirmGroup(s, g);
}
const labels = v => v.rules.map(r => [r.rule_id, r.label]);

test('групповое подтверждение пропускает критические значения и поля с выбором', () => {
  const s = session(H('СИН-СЕП-01'));
  const r = CB.confirmGroup(s, 'Инфекция и антибактериальная терапия');
  const crit = s.items.filter(i => i.candidate.group === 'Инфекция и антибактериальная терапия' && i.candidate.critical);
  assert.ok(crit.length > 0);
  for (const it of crit) { assert.equal(it.status, CB.STATUS.NEW); assert.ok(r.skipped.includes(it.candidate.id)); }
  assert.ok(r.confirmed.length > 0);
  const j = s.journal.at(-1);
  assert.equal(j.action, 'групповое подтверждение');
  assert.deepEqual(j.candidate_ids, r.confirmed);
});

test('подтверждение, исправление, отклонение и выбор пишутся в журнал (кто, когда, было → стало, фрагмент)', () => {
  const s = session(H('СИН-НЭК-03'));
  const ga = s.items.find(i => i.candidate.field === 'gestational_age_weeks');
  const tl = s.items.find(i => i.candidate.field === 'gi_passage_restored');
  const pn = s.items.find(i => i.candidate.field === 'pn_type');
  CB.confirm(s, ga.candidate.id);
  CB.edit(s, ga.candidate.id, 33, { reason: 'проверка' });
  CB.reject(s, pn.candidate.id);
  assert.throws(() => CB.confirm(s, tl.candidate.id), /сначала выберите/);
  CB.choose(s, tl.candidate.id, 1);
  const acts = s.journal.map(j => j.action);
  assert.deepEqual(acts, ['подтверждено', 'исправлено', 'отклонено', 'выбор значения']);
  const e = s.journal[1];
  assert.equal(e.actor, 'эксперт-тест'); assert.equal(e.from, 34); assert.equal(e.to, 33); assert.equal(e.fragment, 'срок гестации 34 недели'); assert.ok(e.at);
  assert.equal(s.journal[3].chosen_at, '2026-06-10T16:00+05:00');
  const b = CB.build(s);
  assert.equal(b.case.data.gestational_age_weeks, 33);
  assert.equal(b.case.sources.gestational_age_weeks.confidence, 'исправлено врачом');
  assert.equal(b.case.data.gi_passage_restored, true);
  assert.ok(!('pn_type' in b.case.data), 'отклонённое не передаётся');
});

test('в движок передаются только подтверждённые и исправленные значения', () => {
  const s = session(H('СИН-СЕП-01'));
  const b0 = CB.build(s);
  assert.deepEqual(b0.case.data, { facility_utc_offset: TZ });
  assert.equal(b0.completeness.complete, false);
  assert.equal(b0.completeness.used, 0);
  CB.confirm(s, s.items.find(i => i.candidate.field === 'weight_kg').candidate.id);
  const b1 = CB.build(s);
  assert.deepEqual(Object.keys(b1.case.data).sort(), ['facility_utc_offset', 'weight_kg']);
});

test('частичный анализ пересчитывается по фактически подтверждённому, а не берётся из полного эталона', () => {
  const h = H('СИН-СЕП-01'), t = TE.histories.find(x => x.id === h.id);
  const s = session(h);
  const v0 = V.view(env, CB.build(s), ['Сепсис']);
  assert.equal(v0.partial, true);
  assert.equal(v0.counts['соответствие'] || 0, 0, 'при 0 подтверждённых нет «соответствий» из эталона');
  assert.notDeepEqual(labels(v0), t.all_rules.map(r => [r.rule_id, r.label]));
  // подтверждены только АБТ начата, время посева и время первой дозы: RDS-008 считается по ним
  for (const f of ['antibiotics_started', 'blood_culture_drawn_at', 'first_abx_dose_administered_at']) CB.confirm(s, s.items.find(i => i.candidate.field === f).candidate.id);
  const v1 = V.view(env, CB.build(s), ['Сепсис']);
  assert.equal(v1.partial, true);
  assert.notEqual(v0.rules.find(r => r.rule_id === 'RDS-008').label, 'соответствие');
  assert.equal(v1.rules.find(r => r.rule_id === 'RDS-008').label, 'соответствие');
  assert.notDeepEqual(labels(v1), t.all_rules.map(r => [r.rule_id, r.label]), 'частичный результат не равен полному эталону');
  assert.equal(v1.final_conclusion, null);
});

test('карточки устаревают только после реальной правки: отпечаток данных меняется лишь при изменении передаваемых значений', () => {
  const s = session(H('СИН-РДС-01'));
  const fp0 = CB.fingerprint(CB.build(s));
  assert.equal(CB.fingerprint(CB.build(s)), fp0, 'повторная сборка без действий — не устарело');
  const id = s.items.find(i => i.candidate.field === 'cpap_pressure_cmh2o').candidate.id;
  CB.confirm(s, id);
  const fp1 = CB.fingerprint(CB.build(s));
  assert.notEqual(fp1, fp0);
  CB.edit(s, id, 6);
  assert.equal(CB.fingerprint(CB.build(s)), fp1, 'исправление на то же значение не меняет данные');
  CB.edit(s, id, 7);
  assert.notEqual(CB.fingerprint(CB.build(s)), fp1);
});

test('значение, внесённое врачом вручную: без фрагмента, источник «введено врачом», в журнале', () => {
  const s = session(H('СИН-СЕП-01'));
  const age = s.items.find(i => i.candidate.field === 'postnatal_age_days');
  CB.reject(s, age.candidate.id);
  CB.addManual(s, 'postnatal_age_days', 0, { reason: 'по дате рождения' });
  const b = CB.build(s);
  assert.equal(b.case.data.postnatal_age_days, 0);
  assert.equal(b.case.sources.postnatal_age_days.confidence, 'введено врачом');
  assert.equal(b.case.sources.postnatal_age_days.fragment, null);
  assert.equal(s.journal.at(-1).action, 'внесено врачом');
  assert.throws(() => CB.addManual(s, 'weight_kg', 1), /уже есть/);
});

for (const h of EX.histories) {
  test(`сквозной путь ${h.id}: текст → извлечение → проверка врачом → движок = технический эталон`, () => {
    const t = TE.histories.find(x => x.id === h.id);
    const variants = t.variants ? Object.keys(t.variants).map((k, i) => [k, i]) : [[null, 0]];
    for (const [k, i] of variants) {
      const ref = k ? t.variants[k] : t;
      const s = session(h); reviewAll(s, i);
      const b = CB.build(s);
      assert.equal(b.completeness.complete, true);
      assert.deepEqual(b.case.data, ref.input, 'данные для движка совпадают с эталоном');
      const v = V.view(env, b, [h.protocol]);
      assert.deepEqual(labels(v), ref.all_rules.map(r => [r.rule_id, r.label]));
      assert.deepEqual(v.shown.map(r => r.rule_id), ref.shown_by_default.map(r => r.rule_id));
      assert.deepEqual(v.hidden.map(r => r.rule_id), ref.hidden_cross_protocol_undetermined.rules);
      assert.deepEqual(v.active_conflicts, ref.active_conflicts);
      assert.deepEqual(v.ui_warnings, ref.ui_warnings);
      assert.equal(v.final_conclusion, null);
    }
  });
}

test('скрытие правил: применимое правило другого протокола показывается (RDS-008 в истории сепсиса)', () => {
  const s = session(H('СИН-СЕП-02')); reviewAll(s);
  const v = V.view(env, CB.build(s), ['Сепсис']);
  assert.ok(v.shown.some(r => r.rule_id === 'RDS-008'));
  assert.ok(v.hidden.every(r => r.applicability === 'не_определено' && !r.rule_id.startsWith('SEP')));
  assert.equal(v.hidden.length, TE.histories.find(x => x.id === 'СИН-СЕП-02').hidden_cross_protocol_undetermined.count);
});

test('SEP-006 без постнатального возраста: предупреждение о непроверенной таблице, исход движка не меняется', () => {
  const s = session(H('СИН-СЕП-01')); reviewAll(s);
  CB.reject(s, s.items.find(i => i.candidate.field === 'postnatal_age_days').candidate.id);
  const b = CB.build(s);
  const v = V.view(env, b, ['Сепсис']);
  const raw = RulesEngine.evaluate(db, b.case, { expert_decisions: ed }).results.find(r => r.rule_id === 'SEP-006');
  assert.equal(v.rules.find(r => r.rule_id === 'SEP-006').observation, raw.observation, 'исход движка не переписан');
  assert.deepEqual(v.ui_warnings.map(w => w.text), [V.SEP006_NO_AGE]);
  const tv = TE.ui_test_variants[0];
  assert.equal(v.rules.find(r => r.rule_id === 'SEP-006').label, tv.sep006);
});

test('НЭК-03: без выбора врача поле не передаётся; показываются альтернативные результаты NEC-003', () => {
  const s = session(H('СИН-НЭК-03'));
  for (const it of s.items) if (!CB.needsChoice(it.candidate)) { if (it.candidate.critical) CB.confirm(s, it.candidate.id); }
  for (const g of [...new Set(s.items.map(i => i.candidate.group))]) CB.confirmGroup(s, g);
  const b = CB.build(s);
  assert.equal(b.completeness.complete, false);
  assert.ok(!('gi_passage_restored' in b.case.data));
  const alts = V.timelineAlternatives(env, s, CB, ['НЭК']);
  assert.equal(alts.length, 1);
  assert.equal(alts[0].field, 'gi_passage_restored');
  const yes = alts[0].variants.find(x => x.value === true);
  assert.deepEqual(yes.changed.find(c => c.rule_id === 'NEC-003').label, 'неприменимо');
  assert.match(alts[0].limitation, /одно значение/);
});
