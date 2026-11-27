// Оценщик 1.5 (набор №2): изменения относительно 1.4. Только синтетические данные.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const M = require('../match.js');
const KIT = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(KIT, '..', '..');

test('1.5: время первой дозы не считается дозовым полем; дозы — считаются', () => {
  for (const f of ['first_abx_dose_administered_at', 'abx_course_started_at']) assert.ok(!M.DOSE.test(f), f);
  for (const f of ['gentamicin_dose_mg', 'benzylpenicillin_dose_mg_kg', 'benzylpenicillin_dose_units_per_kg', 'gentamicin_dose_per_kg', 'surfactant_initial_dose_mg_kg']) assert.ok(M.DOSE.test(f), f);
});

test('1.5: часть правила без метки движка — «часть не оценивалась», без причин; не «иное»', () => {
  const src = fs.readFileSync(path.join(KIT, 'scorer/impact.js'), 'utf8');
  assert.match(src, /b === undefined \? 'часть не оценивалась'/);
  assert.match(src, /\(a === b \|\| b === undefined\) \? \[\]/);
});

function validate(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-'));
  fs.cpSync(path.join(KIT, 'scorer/test/tech'), dir, { recursive: true });
  const gp = path.join(dir, 'blind1-gold.json'); const g = JSON.parse(fs.readFileSync(gp, 'utf8')); mutate(g); fs.writeFileSync(gp, JSON.stringify(g));
  const r = spawnSync('python3', ['-I', '-B', path.join(KIT, 'scorer/validate.py'), '--input', dir, '--dict', path.join(REPO, 'rules/pilot-rules.json'), '--sets', path.join(KIT, 'field-sets.json'), '--technical-test'], { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) });
  return r.stdout + r.stderr;
}

test('1.5: ловушка «any», противоречащая действующему факту той же цитаты, — ошибка набора', () => {
  const base = validate(() => {});
  assert.doesNotMatch(base, /противоречит действующему факту/);
  const out = validate(g => { const h = g.histories[0]; const f = h.facts.find(x => x.field === 'gestational_age_weeks');
    h.traps.push({ tid: 'Т1-T9', type: 'abbreviation', quote: f.quote, location: 'body', field: f.field, must_not_value: 'any', correct_reading: 'тест' }); });
  assert.match(out, /must_not_value=\\?"any\\?" противоречит действующему факту Т1-F1/);
});

test('1.5: time_kind — только event_time (время записи фактом не размечается)', () => {
  assert.doesNotMatch(validate(g => { g.histories[1].facts.find(x => x.field === 'blood_culture_drawn_at').time_kind = 'event_time'; }), /недопустимое time_kind/);
  assert.match(validate(g => { g.histories[1].facts.find(x => x.field === 'blood_culture_drawn_at').time_kind = 'document_time'; }), /недопустимое time_kind/);
  assert.match(validate(g => { g.histories[1].facts.find(x => x.field === 'blood_culture_drawn_at').time_kind = 'record'; }), /недопустимое time_kind/);
});
