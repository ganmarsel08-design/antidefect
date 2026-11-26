// Этап 8 — проверка самого контроля этапа 7 (stage7-control.js): авария не должна выглядеть как «ожидаемые падения».
// Подменяет только браузерный сценарий (переменная STAGE7_UI_SCRIPT) поддельным скриптом во временной папке.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const CTRL = path.join(__dirname, 'tools/stage7-control.js');
const OK_OUT = "console.log('FAIL DOCX СЕП-03: прочитан полностью, найдено 29 сведений');\nconsole.log('этап 7, браузер: 50/51');\n";
function run(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl-')); const f = path.join(dir, 'fake-ui.js'); fs.writeFileSync(f, body);
  const r = spawnSync(process.execPath, [CTRL, '--ui-only'], { encoding: 'utf8', env: Object.assign({}, process.env, { STAGE7_UI_SCRIPT: f }) });
  return { status: r.status, out: r.stdout + r.stderr };
}
test('ожидаемый вывод и ожидаемый код 1 — контроль проходит', () => { const r = run(OK_OUT + 'process.exit(1);\n'); assert.equal(r.status, 0, r.out); });
test('авария после корректного вывода (код 7) — контроль падает', () => { const r = run(OK_OUT + 'process.exit(7);\n'); assert.notEqual(r.status, 0); assert.match(r.out, /код выхода 7/); });
test('код 0 при ожидаемом падении шага — контроль падает', () => { const r = run(OK_OUT + 'process.exit(0);\n'); assert.notEqual(r.status, 0); assert.match(r.out, /код выхода 0/); });
test('прерывание сигналом после корректного вывода — контроль падает', () => { const r = run(OK_OUT + "process.kill(process.pid, 'SIGTERM');\nsetTimeout(() => {}, 1000);\n"); assert.notEqual(r.status, 0); assert.match(r.out, /прерван|код выхода/); });
test('нет итоговой строки — контроль падает', () => { const r = run("console.log('FAIL DOCX СЕП-03: прочитан полностью, найдено 29 сведений');\nprocess.exit(1);\n"); assert.notEqual(r.status, 0); assert.match(r.out, /нет итоговой строки/); });
test('лишний упавший шаг — контроль падает', () => { const r = run("console.log('FAIL что-то ещё');\n" + OK_OUT + 'process.exit(1);\n'); assert.notEqual(r.status, 0); assert.match(r.out, /неожиданно упал/); });
