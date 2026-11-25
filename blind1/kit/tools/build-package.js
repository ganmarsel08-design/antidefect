#!/usr/bin/env node
// Антидефект — слепое тестирование №1. Сборка пакета автора 1.2 и списков полей оценщика из словаря программы.
// node tools/build-package.js <рабочая копия программы> [--check]
//  • blind1-author-package.md = package-src/head.md + таблица ВСЕХ исходных полей словаря (по алфавиту, без частей и критичности)
//    + package-src/tail.md с таблицей 30 правил;
//  • field-sets.json (только для оценщика): часть A — поля, которые программа заявляет как извлекаемые (по именам полей
//    в extract.js, без шаблонов); часть B — прочие исходные поля; критические — часть A по CRITICAL программы.
// --check: не записывать, сравнить с существующими файлами (детерминированность).
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2]), KIT = path.resolve(__dirname, '..'), check = process.argv.includes('--check');
const R = require(path.join(ROOT, 'rules/pilot-rules.json'));
const E = require(path.join(ROOT, 'engine/extract/extract.js'));
const src = fs.readFileSync(path.join(ROOT, 'engine/extract/extract.js'), 'utf8');
const dd = R.data_dictionary;
const esc = s => String(s == null ? '' : s).replace(/\|/g, '/').replace(/\n/g, ' ');
const T = { number: 'число', tri: 'да/нет', text: 'текст', enum: 'перечень', datetime: 'дата-время', list: 'список', object: 'объект', date: 'дата' };
const raw = Object.entries(dd).filter(([, v]) => v.type !== 'derived');
const A = new Set([...src.matchAll(/f: '([a-z0-9_]+)'/g)].map(m => m[1]));
const fields = `Всего ${raw.length} полей.\n\n| Поле | Описание (не образец формулировки!) | Тип | Единица / допустимые значения |\n|---|---|---|---|\n` +
  raw.slice().sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `| \`${k}\` | ${esc(v.description)} | ${T[v.type] || v.type} | ${esc(v.values ? v.values.join(', ') : v.unit || '')} |`).join('\n') + '\n';
const rules = '| Правило | Протокол | Требование |\n|---|---|---|\n' + R.rules.map(r => `| ${r.rule_id} | ${{ rds: 'РДС', nek: 'НЭК', sepsis: 'Сепсис' }[r.protocol]} | ${esc(r.requirement.description)} |`).join('\n') + '\n';
const head = fs.readFileSync(path.join(__dirname, 'package-src/head.md'), 'utf8');
const tail = fs.readFileSync(path.join(__dirname, 'package-src/tail.md'), 'utf8').replace('{{RULES}}', rules);
const pkg = head + fields + tail;
const pa = raw.map(([k]) => k).filter(k => A.has(k)), pb = raw.map(([k]) => k).filter(k => !A.has(k));
const sets = JSON.stringify({ partA: pa, partB: pb, critical: pa.filter(k => E.CRITICAL.test(k)) }, null, 1) + '\n';
const out = { 'blind1-author-package.md': pkg, 'field-sets.json': sets };
let bad = 0;
for (const [f, c] of Object.entries(out)) {
  const p = path.join(KIT, f);
  if (check) { if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== c) { console.error('не совпадает: ' + f); bad++; } }
  else fs.writeFileSync(p, c);
}
console.log(check ? (bad ? 'ПРОВЕРКА НЕ ПРОЙДЕНА' : 'пакет и списки полей воспроизводятся') : `записано: часть A ${pa.length}, часть B ${pb.length}, критических ${pa.filter(k => E.CRITICAL.test(k)).length}`);
process.exit(bad ? 1 : 0);
