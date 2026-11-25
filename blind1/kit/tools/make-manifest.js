#!/usr/bin/env node
// Антидефект — слепое тестирование №1. Единый согласованный манифест комплекта 1.4: программа + методика 1.4 + пакет автора 1.2 + оценщик.
// node tools/make-manifest.js <рабочая копия программы>   (повторная запись запрещена: манифест создаётся один раз)
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const C = require('../scorer/common.js'), V = require('../scorer/verify.js');
const repo = path.resolve(process.argv[2]), KIT = V.KIT;
if (fs.existsSync(V.MANIFEST)) { console.error('ОСТАНОВ: манифест уже существует'); process.exit(2); }
if (cp.execSync('git status --porcelain', { cwd: repo }).toString().trim()) { console.error('ОСТАНОВ: рабочая копия программы изменена'); process.exit(2); }
const PROGRAM = ['engine/extract/extract.js', 'engine/extract/docx.js', 'engine/vendor/jszip/jszip.min.js', 'engine/case-builder.js', 'engine/rules-engine.js',
  'engine/derive.js', 'engine/expert-view.js', 'engine/expert-app.js', 'rules/pilot-rules.json', 'rules/expert-decisions.json'];
const PROTECTED = ['scorer', 'tools'];
const kitFiles = ['blind1-method.md', 'blind1-author-package.md', 'field-sets.json', 'CHANGES-1.1-1.2.md', 'CHANGES-1.2-1.3.md', 'CHANGES-1.3-1.4.md', ...PROTECTED.flatMap(d => V.listFiles(path.join(KIT, d)).map(f => d + '/' + f))];
const bad = kitFiles.filter(f => /__pycache__|\.pyc$|node_modules/.test(f));
if (bad.length) { console.error('ОСТАНОВ: в комплекте непереносимые файлы: ' + bad.join(', ')); process.exit(2); }
const m = {
  schema: 'blind1-manifest-1.4', method_version: V.METHOD_VERSION, author_package_version: V.PACKAGE_VERSION, gold_schema: 'blind1-gold-1.1',
  created_at: new Date().toISOString(), node: process.version,
  note: 'Единый манифест 1.4 (метод 1.4, пакет автора 1.2 без изменений). Зафиксирован до получения и открытия blind1-source.zip. Комплекты 1.1–1.3 сохранены без изменений в releases/.',
  program: { base_commit: cp.execSync('git rev-parse HEAD', { cwd: repo }).toString().trim(), extract_version: require(path.join(repo, 'engine/extract/extract.js')).VERSION,
    files: Object.fromEntries(PROGRAM.map(f => [f, C.sha256File(path.join(repo, f))])) },
  protected_dirs: PROTECTED,
  kit_files: Object.fromEntries(kitFiles.map(f => [f, C.sha256File(path.join(KIT, f))])),
};
fs.mkdirSync(path.dirname(V.MANIFEST), { recursive: true });
fs.writeFileSync(V.MANIFEST, JSON.stringify(m, null, 1) + '\n'); fs.chmodSync(V.MANIFEST, 0o444);
console.log(`манифест: ${Object.keys(m.kit_files).length} файлов комплекта, ${PROGRAM.length} файлов программы; SHA-256 ${C.sha256File(V.MANIFEST)}`);
