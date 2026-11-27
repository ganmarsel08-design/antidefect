#!/usr/bin/env node
// Антидефект — слепое тестирование №1. ОЦЕНКА результатов прогона (разделы 4–8 метода 1.1).
// node score.js --repo <рабочая копия> --input <распакованный архив> --freeze <blind1-freeze.json> --results <results-v1>
// Перед оценкой повторно проверяются комплект, программа, входные данные и неизменность сырых результатов прогона (RUN-MANIFEST.json).
// Пишет в <results>: matching.json, reading.json, rules-impact.json, metrics.json, report.md, MANIFEST.json; файлы — только для чтения.
'use strict';
const fs = require('fs'), path = require('path');
const C = require('./common.js');
const M = require('./match.js');
const RD = require('./reading.js');
const I = require('./impact.js');
const V = require('./verify.js');

const B = 10000, SEED = 20261121;
const THR = { recall: 0.90, recall_critical: 0.95, precision: 0.95, docx_unread: 1.0 };

function aggregate(perHist, numF, denF) {
  const pairs = perHist.map(h => ({ num: numF(h), den: denF(h) }));
  const k = pairs.reduce((a, p) => a + p.num, 0), n = pairs.reduce((a, p) => a + p.den, 0);
  return { k, n, p: n ? k / n : null, wilson: C.wilson(k, n), cluster: C.clusterBoot(pairs, B, SEED) };
}
const cnt = (us, pred) => us.filter(pred).length;
const pct = x => x === null || x === undefined ? '—' : (100 * x).toFixed(1) + '%';
const ci = a => a ? `${pct(a[0])}–${pct(a[1])}` : '—';

function extractionMetrics(rs, sets) {
  const crit = new Set(sets.critical);
  const found = u => u.cls === 'В' || u.cls === 'ВА';
  const lpSingle = r => r.lp.filter(x => x.single).length;
  return {
    recall: aggregate(rs, r => cnt(r.units, found), r => r.units.length),
    recall_strict: aggregate(rs, r => cnt(r.units, u => u.cls === 'В'), r => r.units.length),
    recall_critical: aggregate(rs, r => cnt(r.units, u => crit.has(u.field) && found(u)), r => cnt(r.units, u => crit.has(u.field))),
    precision: aggregate(rs, r => cnt(r.units, u => u.cls === 'В'), r => cnt(r.units, u => u.cls === 'В' || u.cls === 'О') + lpSingle(r)),
    precision_found: aggregate(rs, r => cnt(r.units, u => u.cls === 'В'), r => cnt(r.units, u => u.cls === 'В' || u.cls === 'О')),
    classes: ['В', 'ВА', 'П', 'О'].reduce((o, c) => (o[c] = rs.reduce((a, r) => a + cnt(r.units, u => u.cls === c), 0), o), {}),
    lp_single: rs.reduce((a, r) => a + lpSingle(r), 0), lp_alt: rs.reduce((a, r) => a + r.lp.filter(x => !x.single).length, 0),
    time_kind_confirm: rs.reduce((a, r) => a + cnt(r.units, u => u.tk && u.tk.tkConfirm), 0), // значение верно, но время события подано как запись/неизвестное — требует подтверждения
    time_kind_doc_as_event: rs.reduce((a, r) => a + cnt(r.units, u => u.tk && u.tk.tkErr), 0),
    time_kind_gold_missing: rs.reduce((a, r) => a + cnt(r.units, u => u.tk && u.tk.tkMissing), 0),
    wrong_place: rs.reduce((a, r) => a + cnt(r.units, u => (u.cls === 'В' || u.cls === 'ВА') && u.fragOk === false), 0),
  };
}

function main() {
  const arg = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
  const repo = path.resolve(arg('repo')), input = path.resolve(arg('input')), res = path.resolve(arg('results'));
  let ver;
  try {
    ver = V.verifyAll({ repo, input, freeze: arg('freeze'), technical: process.argv.includes('--technical-test') });
    const rm = path.join(res, 'RUN-MANIFEST.json');
    if (!fs.existsSync(rm)) throw new V.IntegrityError('нет RUN-MANIFEST.json прогона');
    const runFiles = JSON.parse(fs.readFileSync(rm, 'utf8')).files;
    for (const [f, h] of Object.entries(runFiles)) if (!fs.existsSync(path.join(res, f)) || C.sha256File(path.join(res, f)) !== h) throw new V.IntegrityError(`изменён результат прогона: ${f}`);
    const extra = V.listFiles(res).filter(f => f !== 'RUN-MANIFEST.json' && !(f in runFiles));
    if (extra.length) throw new V.IntegrityError(`в каталоге результатов посторонние файлы (оценка уже выполнялась?): ${extra.join(', ')}`);
    const ri = JSON.parse(fs.readFileSync(path.join(res, 'run-info.json'), 'utf8'));
    if (ri.kit_manifest_sha256 !== ver.manifest_sha256 || ri.freeze_sha256 !== ver.freeze_sha256) throw new V.IntegrityError('прогон выполнен с другим манифестом или заморозкой');
  } catch (e) { if (e instanceof V.IntegrityError) { console.error('ОСТАНОВ: ' + e.message); process.exit(2); } throw e; }
  const sets = JSON.parse(fs.readFileSync(path.join(V.KIT, 'field-sets.json'), 'utf8'));
  const env = I.loadEnv(repo), dd = env.db.data_dictionary;
  const gold = JSON.parse(fs.readFileSync(path.join(input, 'blind1-gold.json'), 'utf8'));
  const tz = gold.facility_utc_offset;
  
  const E = Object.fromEntries(gold.histories.map(h => [h.id, JSON.parse(fs.readFileSync(path.join(res, 'extraction', h.id + '.json'), 'utf8'))]));

  // 1. сопоставление: сквозное (документ → программа) и, для DOCX, по эталону чтения
  const e2e = gold.histories.map(h => M.scoreHistory({ h, text: E[h.id].text, extraction: E[h.id].extraction, dd, sets }));
  const ref = gold.histories.filter(h => h.format === 'docx' && E[h.id].ref && !E[h.id].ref.missing)
    .map(h => M.scoreHistory({ h, text: E[h.id].ref.text, extraction: E[h.id].ref.extraction, dd, sets }));
  // контроль заимствования формулировок
  for (const r of e2e) for (const u of r.units) {
    const d = C.trigrams((dd[u.field] || {}).description || ''), q = C.trigrams(u.quote || '');
    u.borrowed = [...q].some(t => d.has(t));
    const f = gold.histories.find(h => h.id === r.history).facts.find(x => x.fid === u.fids[0]);
    u.time_basis = f ? f.time_basis || null : null;
  }
  // 2. чтение DOCX
  const reading = gold.histories.filter(h => h.format === 'docx').map(h => {
    const refp = path.join(input, 'docx-text', h.id + '.json');
    if (!fs.existsSync(refp)) return { id: h.id, missing_reference: true };
    if (E[h.id].docx && E[h.id].docx.error) return { id: h.id, read_error: E[h.id].docx };
    return RD.scoreReading({ id: h.id, ref: JSON.parse(fs.readFileSync(refp, 'utf8')), programText: E[h.id].text, warnings: E[h.id].docx.warnings });
  });
  // 3. влияние на правила
  const impact = gold.histories.map(h => I.impactHistory(env, h, E[h.id].extraction, tz, {
    sets, format: h.format, programText: E[h.id].text, warnings: (E[h.id].docx && E[h.id].docx.warnings) || [],
    refExtraction: h.format === 'docx' && E[h.id].ref && !E[h.id].ref.missing ? E[h.id].ref.extraction : null }));

  // 4. метрики
  const zs = e2e.map(M.zeroCounts);
  const zero = {};
  for (const k of ['dose', 'time', 'negplan']) {
    const kk = zs.reduce((a, z) => a + z[k].k, 0), n = zs.reduce((a, z) => a + z[k].n, 0);
    zero[k] = { k: kk, n, upper95: kk === 0 ? C.zeroUpper(n) : null, status: n === 0 ? 'не проверен' : kk === 0 ? 'выполнен' : 'не выполнен', items: zs.flatMap(z => z[k].items) };
  }
  for (const mode of ['stress', 'cautious']) {
    const fc = impact.map(r => I.falseCompliance(r, mode));
    const kk = fc.reduce((a, x) => a + x.k, 0), n = fc.reduce((a, x) => a + x.n, 0);
    zero['false_compliance_' + mode] = { k: kk, n, upper95: kk === 0 ? C.zeroUpper(n) : null, status: n === 0 ? 'не проверен' : kk === 0 ? 'выполнен' : 'не выполнен', items: fc.flatMap(x => x.items) };
  }
  const rd = reading.filter(r => r.expected_unread);
  const unreadExp = rd.reduce((a, r) => a + r.expected_unread.length, 0), unreadDet = rd.reduce((a, r) => a + r.detected, 0);
  const metrics = {
    schema: 'blind1-metrics-1.4', kit_manifest_sha256: ver.manifest_sha256, freeze_sha256: ver.freeze_sha256, generated_at: new Date().toISOString(), bootstrap: { B, seed: SEED, unit: 'история' },
    thresholds: THR,
    extraction_e2e: extractionMetrics(e2e, sets),
    extraction_docx_e2e: extractionMetrics(e2e.filter(r => r.format === 'docx'), sets),
    extraction_docx_reference_text: extractionMetrics(ref, sets),
    extraction_txt: extractionMetrics(e2e.filter(r => r.format === 'txt'), sets),
    by_protocol: Object.fromEntries(['РДС', 'НЭК', 'Сепсис'].map(p => [p, extractionMetrics(e2e.filter(r => r.protocol === p), sets)])),
    borrowed: {
      borrowed: aggregate(e2e, r => cnt(r.units, u => u.borrowed && (u.cls === 'В' || u.cls === 'ВА')), r => cnt(r.units, u => u.borrowed)),
      not_borrowed: aggregate(e2e, r => cnt(r.units, u => !u.borrowed && (u.cls === 'В' || u.cls === 'ВА')), r => cnt(r.units, u => !u.borrowed)),
    },
    by_time_basis: Object.fromEntries(['explicit', 'date_from_heading', 'relative_computed', 'date_only'].map(t => [t, aggregate(e2e, r => cnt(r.units, u => u.time_basis === t && (u.cls === 'В' || u.cls === 'ВА')), r => cnt(r.units, u => u.time_basis === t))])),
    zero,
    docx_reading: {
      unread_detection: { k: unreadDet, n: unreadExp, p: unreadExp ? unreadDet / unreadExp : null, status: unreadExp === 0 ? 'не проверен' : unreadDet === unreadExp ? 'выполнен' : 'не выполнен' },
      false_warnings: rd.reduce((a, r) => a + r.false_warnings.length, 0), leaks: rd.reduce((a, r) => a + r.leaks.length, 0),
      body_recall_min: rd.length ? Math.min(...rd.map(r => r.body_recall)) : null, body_precision_min: rd.length ? Math.min(...rd.map(r => r.body_precision)) : null,
      missing_reference: reading.filter(r => r.missing_reference).map(r => r.id), read_errors: reading.filter(r => r.read_error).map(r => r.id),
    },
    unread_facts: e2e.reduce((a, r) => a + r.unreadFacts.length, 0),
    traps: (() => { const o = {}; for (const r of e2e) for (const t of r.traps) { o[t.type] = o[t.type] || { сработала: 0, выдержана: 0, 'не проверяема': 0 }; o[t.type][t.status === 'сработала' ? 'сработала' : t.status === 'выдержана' ? 'выдержана' : 'не проверяема']++; } return o; })(),
    rules_impact: Object.fromEntries(['stress', 'cautious'].map(m => [m, impact.flatMap(r => r.modes[m].pairs).reduce((o, p) => (o[p.cls] = (o[p.cls] || 0) + 1, o), {})])),
    rules_impact_causes: Object.fromEntries(['stress', 'cautious'].map(m => {
      const ps = impact.flatMap(r => r.modes[m].pairs).filter(p => p.cls !== 'совпадает');
      const by = (sel) => { const o = {}; for (const p of ps.filter(sel)) for (const c of (p.cause_set.length ? p.cause_set : ['причина не установлена'])) o[c] = (o[c] || 0) + 1; return o; };
      return [m, { all_discrepancies: by(() => true), false_compliance: by(p => p.cls === 'ложное предварительное соответствие'),
        false_compliance_total: ps.filter(p => p.cls === 'ложное предварительное соответствие').length }];
    })),
    part_b_facts: gold.histories.reduce((a, h) => a + h.facts.filter(f => !sets.partA.includes(f.field)).length, 0),
    missing_clinical: gold.histories.reduce((a, h) => a + (h.missing_clinical || []).length, 0),
  };

  // 5. запись
  const W = (f, o) => fs.writeFileSync(path.join(res, f), typeof o === 'string' ? o : JSON.stringify(o, null, 1) + '\n');
  W('matching.json', { e2e, docx_reference_text: ref });
  W('reading.json', reading);
  W('rules-impact.json', impact);
  W('metrics.json', metrics);
  W('report.md', report(metrics, e2e, impact, reading, gold));
  const files = V.listFiles(res).filter(f => f !== 'MANIFEST.json');
  W('MANIFEST.json', { schema: 'blind1-results-manifest-1.4', kit_manifest_sha256: ver.manifest_sha256, freeze_sha256: ver.freeze_sha256, files: Object.fromEntries(files.map(f => [f, C.sha256File(path.join(res, f))])) });
  (function ro(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) ro(p); else fs.chmodSync(p, 0o444); } })(res);
  console.log('оценка записана:', res);
}

function report(m, e2e, impact, reading, gold) {
  const L = [];
  const x = m.extraction_e2e;
  const row = (name, a, thr) => `| ${name} | ${a.k}/${a.n} | ${pct(a.p)} | ${ci(a.cluster)} | ${ci(a.wilson)} | ${thr === undefined ? '—' : '≥ ' + pct(thr)} | ${thr === undefined ? '—' : a.p === null ? 'не проверен' : a.p >= thr ? (a.cluster && a.cluster[0] < thr ? 'выполнен (нижняя граница ниже порога)' : 'выполнен') : 'не выполнен'} |`;
  L.push('# Слепое тестирование извлечения №1 — первичный результат', '', `Сформировано: ${m.generated_at}. Исходные данные: ${gold.histories.length} синтетических историй. Интервалы: кластерный бутстреп по историям (${m.bootstrap.B}, seed ${m.bootstrap.seed}); Уилсон — справочно.`, '');
  L.push('## Пороги', '', '| Критерий | k/N | Значение | ДИ (кластерный) | ДИ (Уилсон) | Порог | Итог |', '|---|---|---|---|---|---|---|');
  L.push(row('Общая полнота', x.recall, THR.recall), row('Полнота критических полей', x.recall_critical, THR.recall_critical), row('Точность значений', x.precision, THR.precision));
  const zr = (name, z) => `| ${name} | ${z.k}/${z.n} | — | ${z.upper95 !== null ? 'верхняя граница доли ≤ ' + pct(z.upper95) : '—'} | — | 0 | ${z.status} |`;
  L.push(zr('Молчаливые ошибки доз и единиц', m.zero.dose), zr('Молчаливые ошибки времени', m.zero.time), zr('Отрицания и планы, принятые за выполненное', m.zero.negplan),
    zr('Ложные предварительные соответствия (стресс)', m.zero.false_compliance_stress), zr('Ложные предварительные соответствия (осторожный)', m.zero.false_compliance_cautious));
  const u = m.docx_reading.unread_detection;
  L.push(`| Выявление неполного чтения DOCX | ${u.k}/${u.n} | ${pct(u.p)} | — | — | 100% | ${u.status} |`, '');
  L.push('## Извлечение: дополнительные показатели', '', '| Срез | Полнота | Строгая полнота | Точность | Точность среди найденных |', '|---|---|---|---|---|');
  for (const [n, a] of [['Все', x], ['DOCX сквозное', m.extraction_docx_e2e], ['DOCX по эталону чтения', m.extraction_docx_reference_text], ['TXT', m.extraction_txt], ...Object.entries(m.by_protocol)])
    L.push(`| ${n} | ${a.recall.k}/${a.recall.n} ${pct(a.recall.p)} | ${pct(a.recall_strict.p)} | ${a.precision.k}/${a.precision.n} ${pct(a.precision.p)} | ${pct(a.precision_found.p)} |`);
  L.push('', `Классы единиц: В ${x.classes['В']}, ВА ${x.classes['ВА']}, П ${x.classes['П']}, О ${x.classes['О']}; ложные извлечения: однозначные ${x.lp_single}, в альтернативах ${x.lp_alt}; верное значение из другого места: ${x.wrong_place}.`, '');
  L.push(`Тип времени: время записи выдано за время события ${x.time_kind_doc_as_event} (ошибка, входит в нулевой критерий времени); значение верно, но время события подано как запись/неизвестное — «требует подтверждения» ${x.time_kind_confirm}; у факта эталона не указан time_kind ${x.time_kind_gold_missing}.`, '');
  L.push(`Контроль заимствования: полнота на фактах с совпадением формулировки с описанием поля — ${m.borrowed.borrowed.k}/${m.borrowed.borrowed.n} (${pct(m.borrowed.borrowed.p)}), на остальных — ${m.borrowed.not_borrowed.k}/${m.borrowed.not_borrowed.n} (${pct(m.borrowed.not_borrowed.p)}).`, '');
  L.push('По основанию времени: ' + Object.entries(m.by_time_basis).map(([k, a]) => `${k} ${a.k}/${a.n}`).join('; ') + '.', '');
  L.push('## Чтение DOCX', '', '| История | Слова эталона | Полнота текста | Точность текста | Ожидаемые непрочитанные | Выявлено | Ложные предупреждения | Утечки |', '|---|---|---|---|---|---|---|---|');
  for (const r of reading) L.push(r.missing_reference ? `| ${r.id} | нет эталона чтения | | | | | | |` : r.read_error ? `| ${r.id} | ошибка чтения: ${r.read_error.message} | | | | | | |`
    : `| ${r.id} | ${r.ref_tokens} | ${pct(r.body_recall)} | ${pct(r.body_precision)} | ${r.expected_unread.map(e => e.type).join(', ') || '—'} | ${r.expected_unread.filter(e => e.detected).map(e => e.type).join(', ') || '—'} | ${r.false_warnings.join(', ') || '—'} | ${r.leaks.length} |`);
  L.push('', `Фактов части A в непрочитываемых местах (в полноту не входят): ${m.unread_facts}.`, '');
  L.push('## Ловушки', '', '| Тип | Сработала | Выдержана | Не проверяема |', '|---|---|---|---|');
  for (const [t, c] of Object.entries(m.traps)) L.push(`| ${t} | ${c['сработала']} | ${c['выдержана']} | ${c['не проверяема']} |`);
  L.push('', '## Таблица ошибок (О, П; ЛП однозначные)', '', '| История | Поле | Класс | Ожидалось | Получено | Цитата / тип |', '|---|---|---|---|---|---|');
  const j = v => v === null || v === undefined ? '—' : String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/\|/g, '/').slice(0, 90);
  for (const r of e2e) {
    for (const un of r.units.filter(q => q.cls === 'О' || q.cls === 'П')) L.push(`| ${r.history} | ${un.field} | ${un.cls}${un.sub ? ' (' + un.sub + ')' : ''}${un.silent ? ', молчаливая' : ''} | ${j(un.expected)} | ${j(un.got)} | ${j(un.quote)} |`);
    for (const l of r.lp.filter(q => q.single)) L.push(`| ${r.history} | ${l.field} | ЛП | — | ${j(l.got)} | ${l.kind} |`);
  }
  L.push('', '## Влияние на правила', '');
  for (const mode of ['stress', 'cautious']) {
    L.push(`**Режим ${mode === 'stress' ? '«стресс» (первое предложенное значение; не модель работы врача)' : '«осторожный» (только однозначные значения)'}:** ` + Object.entries(m.rules_impact[mode]).map(([k, v]) => `${k} — ${v}`).join('; ') + '.', '');
    const rc = m.rules_impact_causes[mode];
    L.push(`Ложные предварительные соответствия — всего ${rc.false_compliance_total} (нулевой критерий считается по всем, независимо от причины). По причинам (пара может иметь несколько причин): ` + (Object.entries(rc.false_compliance).map(([k, v]) => `${k} — ${v}`).join('; ') || 'нет') + '.', '');
    L.push('Все расхождения по причинам: ' + (Object.entries(rc.all_discrepancies).map(([k, v]) => `${k} — ${v}`).join('; ') || 'нет') + '.', '');
    L.push('| История | Правило | Эталон | Извлечение | Класс | Поля и причины |', '|---|---|---|---|---|---|');
    for (const r of impact) for (const p of r.modes[mode].pairs.filter(q => q.cls !== 'совпадает')) L.push(`| ${r.history} | ${p.key} | ${p.gold} | ${p.extracted} | ${p.cls} | ${p.fields.map(f => `${f}: ${(p.causes[f] || []).join(' + ') || 'причина не установлена'}`).join('; ') || '—'} |`);
    L.push('');
  }
  L.push('## Не проверено', '');
  for (const [k, z] of Object.entries(m.zero)) if (z.status === 'не проверен') L.push(`- ${k}: N = 0 — критерий не проверен и выполненным не считается.`);
  if (m.docx_reading.missing_reference.length) L.push(`- Нет эталона чтения: ${m.docx_reading.missing_reference.join(', ')}.`);
  L.push('', `Часть B: ${m.part_b_facts} фактов; недостающие клинические сведения: ${m.missing_clinical} — перечень в эталоне, без порогов.`, '');
  L.push('Результаты технические: врачебные оценки не заполнялись, окончательных клинических заключений нет. Рекомендации по исправлению — в сопроводительном отчёте исполнителя.');
  return L.join('\n') + '\n';
}

if (require.main === module) main();
module.exports = { extractionMetrics, aggregate, report };
