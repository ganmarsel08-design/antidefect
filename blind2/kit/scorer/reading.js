// Антидефект — слепое тестирование №1. Оценка ЧТЕНИЯ DOCX отдельно от извлечения (раздел 4а метода 1.1).
// Эталон чтения — docx-text/<ID>.json автора: {body:[{kind:'paragraph',text}|{kind:'table',rows:[[cell,...],...]}], unread:[{type,text}], deleted:[text]}.
'use strict';
const C = require('./common.js');

/** Текст по эталону чтения в соглашении метода: абзац — строка; строка таблицы — ячейки через « | ». */
function refText(ref) {
  const lines = [];
  for (const b of ref.body) {
    if (b.kind === 'table') for (const row of b.rows) lines.push(row.map(c => String(c).trim()).join(' | '));
    else lines.push(b.text);
  }
  return lines.join('\n');
}
const tokens = s => s.split(/\s+/).filter(t => t && t !== '|');

/** Длина наибольшей общей подпоследовательности слов (O(n·m) памяти по строке). */
function lcs(a, b) {
  let prev = new Int32Array(b.length + 1), cur = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev]; cur.fill(0);
  }
  return prev[b.length];
}

const WARN = {
  textbox: /надпись/, image: /рисунок/, embedded_object: /внедрённый объект/, header: /колонтитул \(header/, footer: /колонтитул \(footer/,
  footnote: /не прочитано: сноски/, endnote: /концевые сноски/, comment: /примечания рецензента/,
};

/**
 * scoreReading({id, ref, programText, warnings})
 * Таблица, прочитанная полностью, ошибкой не является; соглашение о разделителе ячеек на метрики не влияет (разделители исключены).
 */
function scoreReading({ id, ref, programText, warnings }) {
  const rt = tokens(refText(ref)), pt = tokens(programText);
  const l = lcs(rt, pt);
  const expected = [...new Set((ref.unread || []).map(u => u.type))];
  const det = expected.map(t => ({ type: t, detected: warnings.some(w => WARN[t] && WARN[t].test(w)) }));
  // ложные предупреждения: тип сообщён, но такого элемента нет; «рисунок» допустим при надписи (надпись хранится внутри рисунка DrawingML)
  const reported = Object.keys(WARN).filter(t => warnings.some(w => WARN[t].test(w)));
  const covered = t => expected.includes(t) || (t === 'image' && expected.includes('textbox'));
  const falseWarn = reported.filter(t => !covered(t));
  // утечки: текст непрочитываемых элементов или удалённый текст оказался в прочитанном
  const leaks = [];
  for (const u of ref.unread || []) if (u.text && u.text.trim().length >= 8 && programText.includes(u.text.trim())) leaks.push({ from: u.type, text: u.text });
  for (const d of ref.deleted || []) if (d && d.trim().length >= 4 && programText.includes(d.trim())) leaks.push({ from: 'удалённый текст', text: d });
  return {
    id, ref_tokens: rt.length, program_tokens: pt.length, lcs: l,
    body_recall: rt.length ? l / rt.length : null, body_precision: pt.length ? l / pt.length : null,
    expected_unread: det, detected: det.filter(d => d.detected).length, false_warnings: falseWarn, leaks, warnings,
  };
}

module.exports = { refText, scoreReading, tokens, lcs, WARN };
