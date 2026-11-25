// Антидефект — слепое тестирование №1. Проверка целостности перед заморозкой, прогоном и оценкой (метод 1.4, раздел 2).
// Останавливает процесс при изменении любого защищённого файла: программы, комплекта оценщика, методики, входных данных.
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const C = require('./common.js');

const KIT = path.resolve(__dirname, '..');
const MANIFEST_NAME = 'blind1-manifest-1.4.json';
const MANIFEST = path.join(KIT, 'freeze', MANIFEST_NAME);
const METHOD_VERSION = 'blind1-method-1.4', PACKAGE_VERSION = 'blind1-author-1.2'; // пакет автора 1.2 утверждён и не менялся

class IntegrityError extends Error {}
const fail = m => { throw new IntegrityError(m); };

function listFiles(dir, base = dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out.push(...listFiles(p, base)); else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** Комплект оценщика и методика: все файлы манифеста на месте и с верными хэшами; в защищённых каталогах нет лишних файлов. */
function verifyKit(kit = KIT) {
  const mp = path.join(kit, 'freeze', MANIFEST_NAME);
  if (!fs.existsSync(mp)) fail(`нет манифеста комплекта freeze/${MANIFEST_NAME}`);
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  if (m.schema !== 'blind1-manifest-1.4' || m.method_version !== METHOD_VERSION || m.author_package_version !== PACKAGE_VERSION) fail('версии в манифесте не соответствуют методу 1.4 и пакету автора 1.2');
  for (const [f, h] of Object.entries(m.kit_files)) {
    const p = path.join(kit, f);
    if (!fs.existsSync(p)) fail(`нет файла комплекта: ${f}`);
    if (C.sha256File(p) !== h) fail(`изменён файл комплекта: ${f}`);
  }
  for (const d of m.protected_dirs) {
    const extra = listFiles(path.join(kit, d)).map(f => d + '/' + f).filter(f => !(f in m.kit_files));
    if (extra.length) fail(`лишние файлы в защищённом каталоге: ${extra.join(', ')}`);
  }
  const method = fs.readFileSync(path.join(kit, 'blind1-method.md'), 'utf8');
  if (!method.includes(`Версия метода: **${METHOD_VERSION}**`)) fail('файл методики не является версией 1.4');
  if (!fs.readFileSync(path.join(kit, 'blind1-author-package.md'), 'utf8').includes(`Версия задания: ${PACKAGE_VERSION}.`)) fail('пакет автора не является версией 1.2');
  return { manifest: m, manifest_sha256: C.sha256File(mp) };
}

/** Программа: HEAD = базовый коммит, хэши файлов программы. */
function verifyProgram(m, repo) {
  const head = cp.execSync('git rev-parse HEAD', { cwd: repo }).toString().trim();
  if (head !== m.program.base_commit) fail(`HEAD ${head} ≠ базовый коммит ${m.program.base_commit}`);
  for (const [f, h] of Object.entries(m.program.files)) if (C.sha256File(path.join(repo, f)) !== h) fail(`изменён файл программы: ${f}`);
  return head;
}

/** Входные данные: заморозка ссылается на этот манифест; полный комплект файлов, без лишних, с верными хэшами. */
function verifyInput(freezePath, input, manifestSha) {
  const f = JSON.parse(fs.readFileSync(freezePath, 'utf8'));
  if (f.schema !== 'blind1-freeze-1.4') fail('заморозка не версии 1.4');
  if (f.manifest_sha256 !== manifestSha) fail('заморозка сделана для другого манифеста комплекта');
  const have = listFiles(input);
  const missing = Object.keys(f.input_files).filter(x => !have.includes(x)), extra = have.filter(x => !(x in f.input_files));
  if (missing.length) fail(`нет входных файлов: ${missing.join(', ')}`);
  if (extra.length) fail(`лишние входные файлы: ${extra.join(', ')}`);
  for (const [x, h] of Object.entries(f.input_files)) if (C.sha256File(path.join(input, x)) !== h) fail(`входной файл не совпадает с заморозкой: ${x}`);
  return { freeze: f, freeze_sha256: C.sha256File(freezePath) };
}

/** Полная проверка. technical: без заморозки входных данных (только для технических примеров). */
function verifyAll({ repo, input, freeze, technical }) {
  const k = verifyKit();
  const head = verifyProgram(k.manifest, repo);
  let fz = null;
  if (freeze) fz = verifyInput(freeze, input, k.manifest_sha256);
  else if (!technical) fail('нет --freeze: прогон без заморозки разрешён только для технических примеров (--technical-test)');
  return { head, manifest_sha256: k.manifest_sha256, freeze_sha256: fz ? fz.freeze_sha256 : null, manifest: k.manifest };
}

module.exports = { verifyKit, verifyProgram, verifyInput, verifyAll, listFiles, IntegrityError, KIT, MANIFEST, MANIFEST_NAME, METHOD_VERSION, PACKAGE_VERSION };
