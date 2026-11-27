// Оценщик 1.5: функциональные тесты (поведение вывода, а не regex исходника). Только синтетические данные.
// Ревью ChatGPT к e0d946b: тип времени сквозно, «часть не оценивалась», дозовые поля, дубли списков, инвариантность к порядку.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const M = require('../match.js');
const I = require('../impact.js');
const KIT = path.resolve(__dirname, '..', '..');
const REPO = process.env.ANTIDEFECT_REPO || path.resolve(KIT, '..', '..');

const dd = { blood_culture_drawn_at: { type: 'datetime' }, first_abx_dose_administered_at: { type: 'datetime' }, gentamicin_dose_mg: { type: 'number' },
  blood_gases: { type: 'list' }, xrays: { type: 'list' }, gi_passage_restored: { type: 'tri' } };
const sets = { partA: Object.keys(dd), critical: [] };
const text = 'Кровь на посев взята 02.03.2026 07:30. Доза 5 мг. 02.03.2026 07:30 pH 7,3 PaCO2 30. 02.03.2026 07:30 pH 7,2 PaCO2 60.';
const at = q => { const s = text.indexOf(q); return { start: s, end: s + q.length, text: q }; };
const fact = (fid, field, value, quote, extra) => Object.assign({ fid, field, value, quote, location: 'body', record_status: 'current', time_basis: null }, extra || {});
const H = (facts, traps) => ({ id: 'ТЕХ', protocol: 'Сепсис', format: 'txt', facts, traps: traps || [] });
const T = '2026-03-02T07:30+05:00';
const run = (gk, cand) => {
  const h = H([fact('F1', 'blood_culture_drawn_at', T, 'взята 02.03.2026 07:30', gk === undefined ? {} : { time_kind: gk })]);
  const c = Object.assign({ id: 'c1', field: 'blood_culture_drawn_at', value: T, fragments: [at('взята 02.03.2026 07:30')] }, cand);
  const r = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [c] } });
  return { r, u: r.units[0], z: M.zeroCounts(r) };
};

test('тип времени: время записи (эталон) выдано за время события → ошибка О, молчаливая, в нулевом критерии времени; значение верное, но не засчитано', () => {
  const { u, z } = run('document_time', { time_basis: 'event_time' });
  assert.equal(u.cls, 'О'); assert.equal(u.silent, true); assert.equal(u.timeErr, true); assert.match(u.sub, /время записи выдано за время события/);
  assert.equal(z.time.k, 1);
});
test('тип времени: document_time/unknown у кандидата при document_time в эталоне — верно; отсутствие time_basis не засчитывается как событие', () => {
  for (const tb of ['document_time', 'unknown', undefined]) { const { u, z } = run('document_time', tb === undefined ? {} : { time_basis: tb }); assert.equal(u.cls, 'В', String(tb)); assert.equal(z.time.k, 0); }
});
test('тип времени: событие в эталоне — event_time верно; document_time/unknown/нет — значение верно, «требует подтверждения»', () => {
  assert.equal(run('event_time', { time_basis: 'event_time' }).u.tk.tkConfirm, false);
  for (const tb of ['document_time', 'unknown', undefined]) { const { u } = run('event_time', tb === undefined ? {} : { time_basis: tb }); assert.equal(u.cls, 'В'); assert.equal(u.tk.tkConfirm, true, String(tb)); }
});
test('тип времени: у факта эталона нет time_kind — помечается, не молча', () => {
  assert.equal(run(undefined, { time_basis: 'event_time' }).u.tk.tkMissing, true);
});
test('тип времени: альтернативы — верное значение в альтернативе с event_time при document_time не становится однозначной ошибкой', () => {
  const { u, z } = run('document_time', { value: undefined, alternatives: [{ value: T, fragments: [at('взята 02.03.2026 07:30')], time_basis: 'event_time' }, { value: '2026-03-02T08:30+05:00', fragments: [] }] });
  assert.equal(u.cls, 'ВА'); assert.equal(u.tk.tkErr, true); assert.equal(z.time.k, 0);
});
test('тип времени: элементы списка (time_basis_items) — document_time эталона выдан за event_time → ошибка элемента', () => {
  const el = { drawn_at: T, ph: 7.3, paco2_mmhg: 30 };
  const h = H([fact('F1', 'blood_gases', el, '07:30 pH 7,3 PaCO2 30', { time_kind: 'document_time' })]);
  const mk = tb => ({ candidates: [{ id: 'c', field: 'blood_gases', value: [el], fragments: [at('07:30 pH 7,3 PaCO2 30')], time_basis_items: [{ index: 0, time_basis: tb }] }] });
  const bad = M.scoreHistory({ h, text, dd, sets, extraction: mk('event_time') });
  assert.equal(bad.units[0].cls, 'О'); assert.equal(bad.units[0].timeErr, true); assert.equal(M.zeroCounts(bad).time.k, 1);
  const ok = M.scoreHistory({ h, text, dd, sets, extraction: mk('document_time') });
  assert.equal(ok.units[0].cls, 'В');
});

test('дозовые поля: время первой дозы — не доза; негативный функциональный тест (ошибка времени не попадает в дозовый критерий)', () => {
  const h = H([fact('F1', 'first_abx_dose_administered_at', T, 'взята 02.03.2026 07:30', { time_kind: 'event_time' })]);
  const r = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [{ id: 'c', field: 'first_abx_dose_administered_at', value: '2026-03-02T09:00+05:00', time_basis: 'event_time', fragments: [at('взята 02.03.2026 07:30')] }] } });
  const z = M.zeroCounts(r);
  assert.equal(z.dose.n, 0, 'не дозовое поле'); assert.equal(z.dose.k, 0);
  assert.equal(z.time.k, 1, 'ошибка времени учтена во времени');
  const h2 = H([fact('F1', 'gentamicin_dose_mg', 5, 'Доза 5 мг')]);
  const z2 = M.zeroCounts(M.scoreHistory({ h: h2, text, dd, sets, extraction: { candidates: [{ id: 'c', field: 'gentamicin_dose_mg', value: 6, fragments: [at('Доза 5 мг')] }] } }));
  assert.equal(z2.dose.n, 1); assert.equal(z2.dose.k, 1);
});

test('«часть не оценивалась»: функциональный вывод impactHistory (не «иное», причин нет)', () => {
  const env = I.loadEnv(REPO);
  const F = (fid, field, value) => ({ fid, field, value, quote: 'х', location: 'body', record_status: 'current' });
  const facts = [F('1', 'gestational_age_weeks', 29), F('2', 'rds_diagnosed', true), F('3', 'rds_risk', true), F('4', 'cpap_from_birth', true)];
  const r = I.impactHistory(env, { id: 'Т', protocol: 'РДС', facts }, { candidates: [] }, '+05:00');
  const parts = r.modes.stress.pairs.filter(p => p.cls === 'часть не оценивалась');
  assert.ok(parts.length > 0, 'есть пары без метки движка');
  for (const p of parts) { assert.deepEqual(p.fields, []); assert.deepEqual(p.cause_set, []); assert.equal(p.extracted, undefined); }
  assert.ok(!r.modes.stress.pairs.some(p => p.extracted === undefined && p.cls === 'иное'));
});

// ---- дубли и конфликты списков (impact.js / match.js согласованы) ----
const bg = (v, ph, pc) => ({ drawn_at: v, ph, paco2_mmhg: pc });
const gF = (fid, el, extra) => fact(fid, 'blood_gases', el, '07:30 pH 7,3 PaCO2 30', extra);
test('эталон: точный дубль списка сворачивается', () => {
  const g = I.goldData(H([gF('A', bg(T, 7.3, 30)), gF('B', bg(T, 7.3, 30))]), dd, '+05:00');
  assert.equal(g.data.blood_gases.length, 1); assert.deepEqual(g.ambiguous, []);
});
test('эталон: одинаковое время и разные значения — конфликт, поле неоднозначно, не «первый выигрывает»; порядок не влияет', () => {
  const a = I.goldData(H([gF('A', bg(T, 7.3, 30)), gF('B', bg(T, 7.2, 60))]), dd, '+05:00');
  const b = I.goldData(H([gF('B', bg(T, 7.2, 60)), gF('A', bg(T, 7.3, 30))]), dd, '+05:00');
  assert.deepEqual(a.ambiguous, ['blood_gases']); assert.equal(a.data.blood_gases, undefined);
  assert.deepEqual(a, b);
});
test('эталон: разное время — отдельные элементы, порядок фактов не влияет на состав', () => {
  const x = bg(T, 7.3, 30), y = bg('2026-03-02T09:00+05:00', 7.2, 60);
  const a = I.goldData(H([gF('A', x), gF('B', y)]), dd, '+05:00').data.blood_gases;
  const b = I.goldData(H([gF('B', y), gF('A', x)]), dd, '+05:00').data.blood_gases;
  assert.equal(a.length, 2); assert.deepEqual(a.map(e => e.drawn_at).sort(), b.map(e => e.drawn_at).sort());
});
test('оценка совпадения: два элемента с одним временем и разными значениями — две единицы, обе В, при любом порядке фактов и кандидатов', () => {
  const x = bg(T, 7.3, 30), y = bg(T, 7.2, 60);
  const cands = es => ({ candidates: [{ id: 'c', field: 'blood_gases', value: es, fragments: es.map(() => at('07:30 pH 7,3 PaCO2 30')) }] });
  const outs = [];
  for (const fo of [[x, y], [y, x]]) for (const co of [[x, y], [y, x]]) {
    const r = M.scoreHistory({ h: H(fo.map((e, i) => gF('F' + i, e))), text, dd, sets, extraction: cands(co) });
    assert.equal(r.units.length, 2); assert.deepEqual(r.units.map(u => u.cls), ['В', 'В']); assert.ok(r.units.every(u => u.conflict === true));
    outs.push(JSON.stringify(r.units.map(u => [u.key, u.cls]).sort()));
  }
  assert.equal(new Set(outs).size, 1, 'результат не зависит от порядка');
  // кандидат выдал только один из двух: второй — П, а не «верно по первому»
  const r1 = M.scoreHistory({ h: H([gF('F0', x), gF('F1', y)]), text, dd, sets, extraction: cands([y]) });
  assert.deepEqual(r1.units.map(u => u.cls).sort(), ['В', 'П']);
});
test('оценка совпадения: точный дубль в эталоне — одна единица', () => {
  const x = bg(T, 7.3, 30);
  const r = M.scoreHistory({ h: H([gF('A', x), gF('B', x)]), text, dd, sets, extraction: { candidates: [{ id: 'c', field: 'blood_gases', value: [x], fragments: [at('07:30 pH 7,3 PaCO2 30')] }] } });
  assert.equal(r.units.length, 1); assert.equal(r.units[0].cls, 'В'); assert.equal(r.units[0].conflict, undefined);
});
test('два разных рентгенологических исследования в одну минуту — конфликт, не склеиваются', () => {
  const a = { at: T, position: 'vertical', reason: 'urgent', result: 'газ' }, b = { at: T, position: 'lateral', reason: 'urgent', result: 'нет газа' };
  const g = I.goldData(H([fact('A', 'xrays', a, 'х'), fact('B', 'xrays', b, 'х')]), dd, '+05:00');
  assert.deepEqual(g.ambiguous, ['xrays']);
});

// ---- валидатор: time_kind обязателен у временных фактов ----
function validate(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15f-'));
  fs.cpSync(path.join(KIT, 'scorer/test/tech'), dir, { recursive: true });
  const gp = path.join(dir, 'blind1-gold.json'); const g = JSON.parse(fs.readFileSync(gp, 'utf8')); mutate(g); fs.writeFileSync(gp, JSON.stringify(g));
  const r = spawnSync('python3', ['-I', '-B', path.join(KIT, 'scorer/validate.py'), '--input', dir, '--dict', path.join(REPO, 'rules/pilot-rules.json'), '--sets', path.join(KIT, 'field-sets.json'), '--technical-test'], { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) });
  return r.stdout + r.stderr;
}
test('валидатор: исходный технический набор проходит; у временного факта нет time_kind — ошибка; time_kind у невременного поля — ошибка', () => {
  assert.doesNotMatch(validate(() => {}), /не указан time_kind|указан у невременного/);
  assert.match(validate(g => { delete g.histories[0].facts.find(x => x.field === 'blood_culture_drawn_at').time_kind; }), /не указан time_kind/);
  assert.match(validate(g => { g.histories[0].facts.find(x => x.field === 'gestational_age_weeks').time_kind = 'event_time'; }), /указан у невременного поля/);
});
test('технический эталон Т1-F4: заголовок записи — document_time, не явное время события (политика PR №15)', () => {
  const g = JSON.parse(fs.readFileSync(path.join(KIT, 'scorer/test/tech/blind1-gold.json'), 'utf8'));
  const f = g.histories[0].facts.find(x => x.fid === 'Т1-F4');
  assert.equal(f.time_kind, 'document_time'); assert.equal(f.time_basis, 'date_from_heading'); assert.equal(f.event_at, null);
});

test('полнота дозовых полей против словаря: все числовые поля с единицей мг, мг/кг, Ед/кг — дозовые; поля времени и «_interval» — нет', () => {
  const db = require(path.join(REPO, 'rules/pilot-rules.json')).data_dictionary;
  const byUnit = Object.entries(db).filter(([, d]) => ['number', 'derived'].includes(d.type) && /^(мг|мг\/кг|Ед\/кг)$/.test(d.unit || '')).map(([f]) => f);
  assert.ok(byUnit.length >= 8, 'в словаре есть дозовые поля');
  for (const f of byUnit) assert.ok(M.DOSE.test(f), 'дозовое по единице, но не в шаблоне: ' + f);
  for (const [f, d] of Object.entries(db)) if (d.type === 'datetime' || /_interval_h$|_minutes$/.test(f)) assert.ok(!M.DOSE.test(f), 'не доза: ' + f);
});
