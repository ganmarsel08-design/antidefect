// Этап 8, S8-4 (проект) — сквозные проверки ВЫГРУЗКИ по новому контракту: аналоги тестов stage7-review № 3, 4, 4
// (в диагностике — № 14–16). Тесты этапа 7 не меняются. Подтверждение времени здесь — техническая симуляция
// (tools/time-confirm-sim.js), а не доказательство фактической корректности времён.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const X = require('../extract/extract.js');
const CB = require('../case-builder.js');
const V = require('../expert-view.js');
const RP = require('../expert-report.js');
const SIM = require('./tools/time-confirm-sim.js');
const env = { RulesEngine: require('../rules-engine.js'), Derive: require('../derive.js'), db: require('../../rules/pilot-rules.json'), expertDecisions: require('../../rules/expert-decisions.json') };
const EX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/stage7/stage7-extraction-gold.json'), 'utf8'));
const H = id => EX.histories.find(h => h.id === id);
const REASON = 'синтетический сценарий: врач сверил время по записи';
const sessionOf = (text, warnings) => CB.createSession({ extraction: X.extract(text, { tz: '+05:00', documentId: 'тест', warnings }), actor: 'эксперт-тест' });

/** Путь этапа 7 без явного подтверждения времени (как в stage7-review). */
function reviewPlain(s) {
  for (const it of s.items) if (CB.needsChoice(it.candidate)) CB.choose(s, it.candidate.id, 0);
  for (const it of s.items) if (it.status === CB.STATUS.NEW && !CB.needsTimeConfirm(it)) CB.confirm(s, it.candidate.id);
}
/** То же + явное (поэлементное у списков) подтверждение каждого времени записи. */
function reviewExplicit(s) {
  for (const it of s.items) if (CB.needsChoice(it.candidate)) CB.choose(s, it.candidate.id, 0, CB.needsTimeConfirm(it) ? { timeIsEvent: true, basisReason: REASON } : undefined);
  for (const it of s.items) if (it.status === CB.STATUS.NEW) CB.confirm(s, it.candidate.id, CB.needsTimeConfirm(it) ? SIM.confirmOpts(it, REASON) : undefined);
}
const report = (s, text, extra) => { const b = CB.build(s); return { b, html: RP.buildReport(Object.assign({ view: V.view(env, b, extra.protocols), built: b, journal: s.journal, documentId: 'тест', tz: '+05:00', text, comments: {}, justifications: {}, generatedAt: 'т' }, extra.o || {})) }; };
const escRe = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RP_esc = RP.esc;

/** Каждое рисковое время в выгрузке: точная цитата из текста и основание (у списка — поэлементно). */
function assertTimeRows(s, html, text) {
  let n = 0;
  for (const it of s.items) {
    if (!CB.needsTimeConfirm(it) || it.status === CB.STATUS.REJECTED) continue;
    const el = CB.riskyElems(it.candidate);
    if (el.length) for (const e of el) {
      assert.ok(text.includes(e.fragment), 'цитата элемента — точный фрагмент истории');
      assert.match(html, new RegExp(escRe(it.candidate.field) + ' №' + (e.index + 1) + '</td><td>[^<]+</td><td>«' + escRe(RP_esc(e.fragment)) + '».*?</td><td>' + escRe(RP_esc(REASON)) + ' — элемент №' + (e.index + 1)), it.candidate.field + ' №' + (e.index + 1));
      n++;
    } else {
      const f = it.choice ? it.choice.fragment : it.candidate.fragment;
      assert.ok(text.includes(f), 'цитата — точный фрагмент истории');
      assert.match(html, new RegExp('<td>' + escRe(it.candidate.field) + '</td><td>[^<]+</td><td>«' + escRe(RP_esc(f)) + '».*?</td><td>' + escRe(RP_esc(REASON)) + '</td>'), it.candidate.field);
      n++;
    }
  }
  assert.ok(n > 0, 'в истории есть время записи / неизвестного типа');
  assert.doesNotMatch(html, /НЕ ПОДТВЕРЖДЕНО/);
  assert.doesNotMatch(html, /основание отсутствует|цитата отсутствует/);
}

test('№14 (stage7-review 3): «все сведения решены» ≠ «документ прочитан полностью» — с явным подтверждением времени', () => {
  const text = H('СИН-СЕП-01').text;
  const s = sessionOf(text, ['не прочитано: надпись (текстовое поле) — 1 шт.']); reviewExplicit(s);
  const { b, html } = report(s, text, { protocols: ['Сепсис'], o: { sourceWarnings: ['не прочитано: надпись (текстовое поле) — 1 шт.'] } });
  assert.deepEqual(RP.auditState(b), { review_complete: true, source_complete: false, full: false });
  assert.match(html, /ИСХОДНЫЙ ДОКУМЕНТ ПРОЧИТАН НЕ ПОЛНОСТЬЮ: не прочитано: надпись/);
  assert.doesNotMatch(html, /исходный документ прочитан полностью/);
  assertTimeRows(s, html, text);
  const s2 = sessionOf(text); reviewExplicit(s2);
  assert.equal(RP.auditState(CB.build(s2)).full, true);
});

test('№14: без явного подтверждения времени проверка не завершена, выгрузка закрыта, в черновике — «НЕ ПОДТВЕРЖДЕНО» с цитатой', () => {
  const text = H('СИН-СЕП-01').text;
  const s = sessionOf(text); reviewPlain(s);
  const { b, html } = report(s, text, { protocols: ['Сепсис'] });
  assert.equal(RP.auditState(b).review_complete, false);
  assert.equal(RP.exportState(b, CB.fingerprint(b), true, CB.fingerprint).allowed, false);
  assert.match(html, /Решение есть не по всем сведениям/);
  for (const u of b.completeness.time_unconfirmed) {
    if (u.elements.length) { for (const e of u.elements) { assert.ok(text.includes(e.fragment));
      assert.match(html, new RegExp('<td>' + escRe(u.field) + ' №' + (e.index + 1) + '</td><td>[^<]+</td><td>«' + escRe(RP_esc(e.fragment)) + '».*?</td><td><b>НЕ ПОДТВЕРЖДЕНО')); } continue; }
    assert.ok(text.includes(u.fragment));
    assert.match(html, new RegExp('<td>' + escRe(u.field) + '</td><td>[^<]+</td><td>«' + escRe(RP_esc(u.fragment)) + '».*?</td><td><b>НЕ ПОДТВЕРЖДЕНО врачом как время события — в расчёт не передано</b>'), u.field);
  }
  assert.ok(b.completeness.time_unconfirmed.some(u => u.field === 'blood_culture_drawn_at'));
  assert.ok(b.completeness.time_unconfirmed.some(u => u.field === 'crp_samples' && u.elements.length === 2), 'список — поэлементно');
});

test('№14: статус, выставленный в обход подтверждения, не делает проверку завершённой и не открывает выгрузку', () => {
  const text = H('СИН-СЕП-01').text;
  const s = sessionOf(text); reviewExplicit(s);
  const it = s.items.find(i => i.candidate.field === 'blood_culture_drawn_at');
  it.time_confirmation = null;                 // обход: статус OK, подтверждения нет
  const { b, html } = report(s, text, { protocols: ['Сепсис'] });
  assert.equal(it.status, CB.STATUS.OK);
  assert.equal(b.completeness.complete, false);
  assert.ok(!('blood_culture_drawn_at' in b.case.data));
  assert.equal(RP.exportState(b, CB.fingerprint(b), true, CB.fingerprint).allowed, false);
  assert.match(html, /data-time-field="blood_culture_drawn_at" data-unconfirmed/);
});

test('№15 (stage7-review 4): выгрузка с обоснованием и фрагментом; время газов крови — поэлементно с цитатой и основанием', () => {
  const text = H('СИН-РДС-02').text;
  const s = sessionOf(text); reviewExplicit(s);
  const fr = RP.bindFragment(text, 'смеситель в родзале № 2 неисправен');
  const { b, html } = report(s, text, { protocols: ['РДС'], o: { justifications: { 'RDS-004': { text: 'Неисправность оборудования', fragment: fr, by: 'эксперт', at: 'т' } } } });
  assert.equal(b.completeness.complete, true);
  assert.match(html, new RegExp(`Неисправность оборудования.*Фрагмент истории \\(позиция ${fr.start}\\): «смеситель в родзале № 2 неисправен»`, 's'));
  assert.match(html, /<td>RDS-004<\/td><td>предварительное отличие<\/td>/);
  assertTimeRows(s, html, text);
  assert.match(html, /data-time-field="blood_gases"/);
});

test('№16 (stage7-review 4): повторяющийся фрагмент — неоднозначность и в обосновании, и в цитате времени', () => {
  const text = H('СИН-НЭК-01').text;
  const s = sessionOf(text); reviewExplicit(s);
  const fr = RP.bindFragment(text, 'рентгенография в горизонтальном положении');
  const { b, html } = report(s, text, { protocols: ['НЭК'], o: { justifications: { 'NEC-006': { text: 'Контроль выполнен', fragment: fr, by: 'эксперт', at: 'т' } } } });
  assert.equal(b.completeness.complete, true);
  assert.match(html, /Контроль выполнен.*встречается в документе 3 раз/s);
  assertTimeRows(s, html, text);
  // цитата времени, встречающаяся в тексте несколько раз, помечается как неоднозначная
  for (const it of s.items) for (const e of CB.riskyElems(it.candidate)) if (RP.occurrences(text, e.fragment) > 1)
    assert.match(html, new RegExp('«' + escRe(RP_esc(e.fragment)) + '» <b>\\(встречается в документе'));
});
