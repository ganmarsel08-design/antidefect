// Антидефект — слепое тестирование №1. Общие функции оценщика (вне репозитория программы).
'use strict';
const crypto = require('crypto');
const fs = require('fs');

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const sha256File = p => sha256(fs.readFileSync(p));

/** Текст TXT так, как его получает поле ввода страницы: UTF-8, без BOM, переводы строк → \n. */
const normText = s => s.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

const normStr = s => String(s).trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');

/** Каноническое значение по типу поля словаря. */
function canon(v, type) {
  if (v === null || v === undefined) return null;
  if (type === 'number') { const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 'NaN:' + v; }
  if (type === 'tri') return v === true || v === false ? v : 'нелогич:' + v;
  if (type === 'datetime' || type === 'date') return String(v).trim();
  if (type === 'enum') return String(v).trim();
  if (Array.isArray(v)) return v.map(normStr).sort().join('+'); // abx_regimen: набор препаратов
  if (type === 'text') return normStr(v);
  return v;
}
/** Ключ и свойства элементов полей-списков. */
const LIST_KEY = {
  blood_gases: e => e.drawn_at, crp_samples: e => e.drawn_at, xrays: e => e.at,
  vent_changes: e => `${e.at}|${normStr(e.parameter)}`,
};
/** Поля-списки извлекателя (элемент — отдельная единица учёта). abx_regimen — не список: одна запись схемы = одно значение. */
const isList = f => Object.prototype.hasOwnProperty.call(LIST_KEY, f);
function canonElem(f, e) {
  const o = {};
  for (const [k, v] of Object.entries(e || {})) o[k] = v === null || v === undefined ? null : typeof v === 'number' ? v : /^\d+([.,]\d+)?$/.test(String(v)) ? Number(String(v).replace(',', '.')) : /T\d\d:\d\d/.test(String(v)) ? String(v) : normStr(v);
  return o;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Все вхождения подстроки. */
function spans(text, q) {
  const out = []; if (!q) return out;
  let i = text.indexOf(q);
  while (i >= 0) { out.push([i, i + q.length]); i = text.indexOf(q, i + 1); }
  return out;
}
const overlap = (a, b) => a[0] < b[1] && b[0] < a[1];

/** Слова для контроля заимствования (≥3 букв), по три подряд. */
function trigrams(s) {
  const w = normStr(s).split(/[^a-zа-я0-9]+/i).filter(x => x.length >= 3);
  const t = new Set(); for (let i = 0; i + 3 <= w.length; i++) t.add(w.slice(i, i + 3).join(' '));
  return t;
}

/** Детерминированный ГПСЧ (mulberry32). */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** ДИ Уилсона 95%. */
function wilson(k, n) {
  if (!n) return null; const z = 1.959963984540054, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
/** Кластерный бутстреп по историям: pairs = [{num, den}] на историю. */
function clusterBoot(pairs, B, seed) {
  const used = pairs.filter(p => p.den > 0 || p.num > 0); if (!used.length) return null;
  const r = rng(seed), vals = [];
  for (let b = 0; b < B; b++) {
    let n = 0, d = 0; for (let i = 0; i < pairs.length; i++) { const p = pairs[Math.floor(r() * pairs.length)]; n += p.num; d += p.den; }
    if (d > 0) vals.push(n / d);
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  return [vals[Math.floor(0.025 * (vals.length - 1))], vals[Math.ceil(0.975 * (vals.length - 1))]];
}
/** Верхняя 95% граница доли ошибок при k = 0 из N. */
const zeroUpper = n => n > 0 ? 1 - Math.pow(0.05, 1 / n) : null;

module.exports = { sha256, sha256File, normText, normStr, canon, LIST_KEY, isList, canonElem, same, spans, overlap, trigrams, rng, wilson, clusterBoot, zeroUpper };
