#!/usr/bin/env node
// Антидефект — слепое тестирование №1. ЗАМОРОЗКА входных данных (метод 1.4, раздел 3, шаг 4).
// node freeze.js --repo <рабочая копия> --input <распакованный архив> --archive <blind1-source.zip> --out <blind1-freeze.json>
// Перед заморозкой: проверка комплекта и программы; формальная проверка validate.py без ошибок. Повторная заморозка в тот же файл запрещена.
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const C = require('./common.js'), V = require('./verify.js');
const arg = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
try {
  const repo = path.resolve(arg('repo')), input = path.resolve(arg('input')), out = path.resolve(arg('out'));
  if (fs.existsSync(out)) throw new V.IntegrityError(`заморозка уже существует: ${out}`);
  const k = V.verifyKit(); V.verifyProgram(k.manifest, repo);
  const args = ['-I', '-B', path.join(__dirname, 'validate.py'), '--input', input, '--dict', path.join(repo, 'rules/pilot-rules.json'), '--sets', path.join(V.KIT, 'field-sets.json')];
  if (process.argv.includes('--technical-test')) args.push('--technical-test');
  const v = cp.spawnSync('python3', args, { encoding: 'utf8' });
  if (v.status !== 0) throw new V.IntegrityError('формальная проверка не пройдена — архив возвращается автору:\n' + v.stdout + v.stderr);
  const files = V.listFiles(input);
  const f = {
    schema: 'blind1-freeze-1.4', frozen_at: new Date().toISOString(), manifest_sha256: k.manifest_sha256,
    archive: arg('archive') ? { name: path.basename(arg('archive')), sha256: C.sha256File(arg('archive')) } : null,
    validation: JSON.parse(v.stdout), technical_test: process.argv.includes('--technical-test'),
    input_files: Object.fromEntries(files.map(x => [x, C.sha256File(path.join(input, x))])),
  };
  fs.writeFileSync(out, JSON.stringify(f, null, 1) + '\n'); fs.chmodSync(out, 0o444);
  console.log(`заморожено: ${files.length} файлов → ${out}\nSHA-256 заморозки: ${C.sha256File(out)}`);
} catch (e) { console.error('ОСТАНОВ: ' + e.message); process.exit(2); }
