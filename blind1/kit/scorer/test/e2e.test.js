// Сквозная проверка оценщика на техническом примере test/tech (не клинический набор).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const REPO = process.env.ANTIDEFECT_REPO || '/home/claude/antidefect';
const S = path.resolve(__dirname, '..'), TECH = path.join(__dirname, 'tech'), SETS = path.join(S, '..', 'field-sets.json');
const run = (args, ok = true) => { const r = cp.spawnSync(process.execPath, args, { cwd: S, encoding: 'utf8' }); if (ok) assert.equal(r.status, 0, r.stderr + r.stdout); return r; };
const val = input => cp.spawnSync('python3', ['-I', '-B', path.join(S, 'validate.py'), '--input', input, '--dict', path.join(REPO, 'rules/pilot-rules.json'), '--sets', SETS, '--technical-test'], { encoding: 'utf8' });

test('формальная проверка: технический пример проходит; искажённая цитата и неверный тип — замечания', () => {
  assert.equal(val(TECH).status, 0);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b1v-')); fs.cpSync(TECH, d, { recursive: true });
  const g = JSON.parse(fs.readFileSync(path.join(d, 'blind1-gold.json'), 'utf8'));
  g.histories[0].facts[0].quote = 'нет такого текста'; g.histories[0].facts[1].value = '1250';
  g.histories[1].facts[0].location = 'table';
  fs.writeFileSync(path.join(d, 'blind1-gold.json'), JSON.stringify(g));
  const r = val(d); assert.equal(r.status, 1);
  const e = JSON.parse(r.stdout).errors.join('\n');
  assert.match(e, /цитата не найдена/); assert.match(e, /не соответствует типу number/); assert.match(e, /ТЕХ-02\/Т2-F1: цитата не найдена в месте table/);
});

function kitCopy() { // копия комплекта (без releases) для проверок подмены
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b1k-'));
  for (const x of ['blind1-method.md', 'blind1-author-package.md', 'field-sets.json', 'CHANGES-1.1-1.2.md', 'CHANGES-1.2-1.3.md', 'CHANGES-1.3-1.4.md', 'scorer', 'tools', 'freeze']) fs.cpSync(path.join(S, '..', x), path.join(d, x), { recursive: true });
  return d;
}
const runIn = (kit, args) => cp.spawnSync(process.execPath, args, { cwd: path.join(kit, 'scorer'), encoding: 'utf8' });

test('прогон и оценка (технический режим): повтор запрещён; результаты только для чтения; оценка проверяет RUN-MANIFEST', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'b1r-')), 'res');
  const noFreeze = run(['run.js', '--repo', REPO, '--input', TECH, '--out', out], false);
  assert.equal(noFreeze.status, 2); assert.match(noFreeze.stderr, /нет --freeze/);
  run(['run.js', '--repo', REPO, '--input', TECH, '--out', out, '--technical-test']);
  assert.equal(run(['run.js', '--repo', REPO, '--input', TECH, '--out', out, '--technical-test'], false).status, 2);
  run(['score.js', '--repo', REPO, '--input', TECH, '--results', out, '--technical-test']);
  const again = run(['score.js', '--repo', REPO, '--input', TECH, '--results', out, '--technical-test'], false);
  assert.equal(again.status, 2); assert.match(again.stderr, /посторонние файлы/);
  const m = JSON.parse(fs.readFileSync(path.join(out, 'metrics.json'), 'utf8'));
  assert.equal(m.extraction_e2e.recall.n, 8); assert.equal(m.unread_facts, 2);
  assert.equal(m.docx_reading.unread_detection.k, 4); assert.equal(m.docx_reading.false_warnings, 0);
  assert.equal(m.zero.dose.status, 'не проверен'); assert.equal(m.traps.deleted_tracked_text['выдержана'], 1);
  assert.equal(m.schema, 'blind1-metrics-1.4'); assert.equal(m.rules_impact_causes.stress.false_compliance_total, 0); assert.ok(m.rules_impact_causes.cautious.all_discrepancies);
  const man = JSON.parse(fs.readFileSync(path.join(out, 'MANIFEST.json'), 'utf8'));
  assert.ok(man.files['report.md'] && man.files['extraction/ТЕХ-02.json'] && man.kit_manifest_sha256);
  assert.equal(fs.statSync(path.join(out, 'metrics.json')).mode & 0o222, 0);
  assert.equal(fs.statSync(path.join(out, 'extraction', 'ТЕХ-01.json')).mode & 0o222, 0);
});

test('оценка останавливается, если сырой результат прогона изменён после прогона', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'b1t-')), 'res');
  run(['run.js', '--repo', REPO, '--input', TECH, '--out', out, '--technical-test']);
  const p = path.join(out, 'extraction', 'ТЕХ-01.json'); fs.chmodSync(p, 0o644);
  const r = JSON.parse(fs.readFileSync(p, 'utf8')); r.extraction.candidates = []; fs.writeFileSync(p, JSON.stringify(r));
  const s = run(['score.js', '--repo', REPO, '--input', TECH, '--results', out, '--technical-test'], false);
  assert.equal(s.status, 2); assert.match(s.stderr, /изменён результат прогона: extraction\/ТЕХ-01.json/);
});

test('заморозка → прогон → оценка; изменённый, лишний и недостающий входной файл — останов', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b1f-')), inp = path.join(d, 'input'); fs.cpSync(TECH, inp, { recursive: true });
  const frz = path.join(d, 'freeze.json');
  run(['freeze.js', '--repo', REPO, '--input', inp, '--out', frz, '--technical-test']);
  assert.equal(run(['freeze.js', '--repo', REPO, '--input', inp, '--out', frz, '--technical-test'], false).status, 2);
  run(['run.js', '--repo', REPO, '--input', inp, '--freeze', frz, '--out', path.join(d, 'res')]);
  run(['score.js', '--repo', REPO, '--input', inp, '--freeze', frz, '--results', path.join(d, 'res')]);
  const mk = () => { const i2 = fs.mkdtempSync(path.join(d, 'in-')); fs.cpSync(TECH, i2, { recursive: true }); return i2; };
  let i2 = mk(); fs.appendFileSync(path.join(i2, 'blind1-gold.json'), ' ');
  let r = run(['run.js', '--repo', REPO, '--input', i2, '--freeze', frz, '--out', path.join(d, 'r2')], false);
  assert.equal(r.status, 2); assert.match(r.stderr, /входной файл не совпадает с заморозкой: blind1-gold.json/);
  i2 = mk(); fs.writeFileSync(path.join(i2, 'лишний.txt'), 'x');
  r = run(['run.js', '--repo', REPO, '--input', i2, '--freeze', frz, '--out', path.join(d, 'r3')], false);
  assert.equal(r.status, 2); assert.match(r.stderr, /лишние входные файлы: лишний.txt/);
  i2 = mk(); fs.rmSync(path.join(i2, 'docx-text', 'ТЕХ-02.json'));
  r = run(['run.js', '--repo', REPO, '--input', i2, '--freeze', frz, '--out', path.join(d, 'r4')], false);
  assert.equal(r.status, 2); assert.match(r.stderr, /нет входных файлов: docx-text\/ТЕХ-02.json/);
  r = run(['score.js', '--repo', REPO, '--input', i2, '--freeze', frz, '--results', path.join(d, 'res')], false);
  assert.equal(r.status, 2); assert.match(r.stderr, /нет входных файлов/);
});

test('заморозка отказывает, если формальная проверка не пройдена', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b1g-')), inp = path.join(d, 'input'); fs.cpSync(TECH, inp, { recursive: true });
  const g = JSON.parse(fs.readFileSync(path.join(inp, 'blind1-gold.json'), 'utf8')); g.histories[0].facts[0].quote = 'нет такого текста';
  fs.writeFileSync(path.join(inp, 'blind1-gold.json'), JSON.stringify(g));
  const r = run(['freeze.js', '--repo', REPO, '--input', inp, '--out', path.join(d, 'f.json'), '--technical-test'], false);
  assert.equal(r.status, 2); assert.match(r.stderr, /формальная проверка не пройдена/); assert.ok(!fs.existsSync(path.join(d, 'f.json')));
});

test('подмена комплекта: изменённый файл оценщика, лишний файл, .pyc, отсутствующий пакет автора, другая версия методики — останов', () => {
  const k1 = kitCopy(); fs.appendFileSync(path.join(k1, 'scorer', 'match.js'), '\n// подмена');
  let r = runIn(k1, ['run.js', '--repo', REPO, '--input', TECH, '--out', path.join(k1, 'res'), '--technical-test']);
  assert.equal(r.status, 2); assert.match(r.stderr, /изменён файл комплекта: scorer\/match.js/);
  const k2 = kitCopy(); fs.writeFileSync(path.join(k2, 'scorer', 'extra.js'), '');
  r = runIn(k2, ['run.js', '--repo', REPO, '--input', TECH, '--out', path.join(k2, 'res'), '--technical-test']);
  assert.equal(r.status, 2); assert.match(r.stderr, /лишние файлы в защищённом каталоге: scorer\/extra.js/);
  const k3 = kitCopy(); fs.mkdirSync(path.join(k3, 'scorer', '__pycache__')); fs.writeFileSync(path.join(k3, 'scorer', '__pycache__', 'validate.cpython-313.pyc'), 'x');
  r = runIn(k3, ['score.js', '--repo', REPO, '--input', TECH, '--results', path.join(k3, 'res'), '--technical-test']);
  assert.equal(r.status, 2); assert.match(r.stderr, /лишние файлы в защищённом каталоге/);
  const k4 = kitCopy(); fs.rmSync(path.join(k4, 'blind1-author-package.md'));
  r = runIn(k4, ['run.js', '--repo', REPO, '--input', TECH, '--out', path.join(k4, 'res'), '--technical-test']);
  assert.equal(r.status, 2); assert.match(r.stderr, /нет файла комплекта: blind1-author-package.md/);
  const k5 = kitCopy(); const mp = path.join(k5, 'freeze', 'blind1-manifest-1.4.json'); fs.chmodSync(mp, 0o644);
  const m = JSON.parse(fs.readFileSync(mp, 'utf8')); m.method_version = 'blind1-method-1.3'; fs.writeFileSync(mp, JSON.stringify(m));
  r = runIn(k5, ['run.js', '--repo', REPO, '--input', TECH, '--out', path.join(k5, 'res'), '--technical-test']);
  assert.equal(r.status, 2); assert.match(r.stderr, /версии в манифесте не соответствуют методу 1.4/);
});

// --- аудит 1.1 → 1.2: валидатор эталона чтения DOCX ---
function mutateRef(fn) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b1d-')); fs.cpSync(TECH, d, { recursive: true });
  const p = path.join(d, 'docx-text', 'ТЕХ-02.json'); const r = JSON.parse(fs.readFileSync(p, 'utf8')); fn(r); fs.writeFileSync(p, JSON.stringify(r));
  const v = val(d); return { status: v.status, errors: v.status === 1 ? JSON.parse(v.stdout).errors.join('\n') : '' };
}
test('валидатор 1.2: пропущенный дополнительный элемент (примечание) — замечание', () => {
  const v = mutateRef(r => { r.unread = r.unread.filter(u => u.type !== 'comment'); });
  assert.equal(v.status, 1); assert.match(v.errors, /элементы «comment»: в XML 1, в эталоне чтения 0/);
});
test('валидатор 1.2: перестановка таблицы относительно абзаца — замечание о порядке', () => {
  const v = mutateRef(r => { const t = r.body.splice(3, 1)[0]; r.body.splice(2, 0, t); });
  assert.equal(v.status, 1); assert.match(v.errors, /нарушен порядок абзацев и таблиц/);
});
test('валидатор 1.2: неверный текст сноски и колонтитула, лишний рисунок, неверный удалённый текст — замечания', () => {
  const v = mutateRef(r => {
    r.unread.find(u => u.type === 'footnote').text = 'сноска: другое';
    r.unread.find(u => u.type === 'header').type = 'footer';
    r.unread.push({ type: 'image', text: '' });
    r.deleted = ['Срок гестации 26 недель.'];
  });
  assert.equal(v.status, 1);
  assert.match(v.errors, /элементы «footnote»/); assert.match(v.errors, /элементы «header»: в XML 1, в эталоне чтения 0/);
  assert.match(v.errors, /элементы «footer»: в XML 0, в эталоне чтения 1/); assert.match(v.errors, /элементы «image»: в XML 0, в эталоне чтения 1/);
  assert.match(v.errors, /удалённый текст/);
});
test('валидатор 1.2: перестановка строк таблицы и текст ячейки — замечание; исходный эталон проходит', () => {
  assert.equal(mutateRef(() => {}).status, 0);
  const v = mutateRef(r => { r.body[3].rows.reverse(); });
  assert.equal(v.status, 1); assert.match(v.errors, /таблица не совпадает с XML/);
});
