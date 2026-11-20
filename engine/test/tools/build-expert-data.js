// Антидефект — этап 7. Генерация engine/expert-data.js: база правил, решения эксперта и 9 синтетических историй
// для страницы engine/expert.html (страница открывается как файл, без сервера и без сети).
// Содержимое — точная копия rules/pilot-rules.json и rules/expert-decisions.json (проверяется тестом).
// Запуск: node engine/test/tools/build-expert-data.js [--check]
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const rd = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const EX = rd('engine/test/fixtures/stage7/stage7-extraction-gold.json');
const data = {
  generated_from: ['rules/pilot-rules.json', 'rules/expert-decisions.json', 'engine/test/fixtures/stage7/stage7-extraction-gold.json (только тексты)'],
  rules: rd('rules/pilot-rules.json'),
  expert_decisions: rd('rules/expert-decisions.json'),
  samples: EX.histories.map(h => ({ id: h.id, protocol: h.protocol, text: h.text })),
};
const out = '/* Сгенерировано engine/test/tools/build-expert-data.js — не редактировать вручную. Только синтетические данные. */\n' +
  'window.ANTIDEFECT_DATA = ' + JSON.stringify(data) + ';\n';
const p = path.join(ROOT, 'engine/expert-data.js');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== out) { console.error('engine/expert-data.js устарел — запустите build-expert-data.js'); process.exit(1); }
  console.log('engine/expert-data.js актуален');
} else { fs.writeFileSync(p, out); console.log('записано engine/expert-data.js', out.length, 'байт'); }
