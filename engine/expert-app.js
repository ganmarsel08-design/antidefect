/*
 * Антидефект — этап 7. Логика страницы engine/expert.html (четыре экрана).
 * Текст документа выводится только через textContent (никакого innerHTML с данными документа).
 * Результаты — только предварительные; окончательный вывод не формируется. Только синтетические данные.
 */
(function () {
  'use strict';
  const D = window.ANTIDEFECT_DATA, X = window.AntidefectExtract, CB = window.AntidefectCaseBuilder, V = window.AntidefectExpertView, DX = window.AntidefectDocx, RP = window.AntidefectReport;
  const env = { RulesEngine: window.RulesEngine, Derive: window.RulesDerive, db: D.rules, expertDecisions: D.expert_decisions };
  const DD = D.rules.data_dictionary;
  const RULE = Object.fromEntries(D.rules.rules.map(r => [r.rule_id, r]));
  const PROT = { rds: 'РДС', nek: 'НЭК', nec: 'НЭК', sepsis: 'Сепсис' };
  const DERIVED = new Set(window.RulesDerive.DERIVED_FIELDS || []);
  const isInput = f => DD[f] && !DD[f].derived && !DD[f].derived_from && !DD[f].superseded_in_revised_rules_by && !DERIVED.has(f);
  const CLS = { 'соответствие': 'ok', 'предварительное отличие': 'diff', 'недостаточно данных': 'nd', 'применимость не установлена': 'nd', 'неоднозначность': 'amb', 'неоднозначность (применимость)': 'amb' };
  const $ = id => document.getElementById(id);

  /** Безопасное построение DOM: строки — только текстовые узлы. */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
    return el;
  }
  const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  const fmt = v => v === undefined ? '—' : Array.isArray(v) ? v.map(x => typeof x === 'object' && x ? Object.values(x).filter(y => y !== null).join(' / ') : x).join('; ') : typeof v === 'boolean' ? (v ? 'да' : 'нет') : String(v);
  const lbl = f => (DD[f] && DD[f].description) || f;

  const S = { text: '', extraction: null, session: null, docx: null, protocols: [], lastFp: null, lastView: null, comments: {}, justif: {}, cur: null };

  // ── навигация
  function go(n) {
    document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.s === String(n)));
    document.querySelectorAll('section').forEach(s => s.classList.toggle('on', s.id === 's' + n));
    if (n === 3 || n === 4) renderResults();
  }
  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => go(+b.dataset.s)));

  // ── экран 1
  for (const s of D.samples) $('sample').appendChild(h('option', { value: s.id }, s.id));
  $('sample').addEventListener('change', () => {
    const s = D.samples.find(x => x.id === $('sample').value); if (!s) return;
    $('text').value = s.text; S.docx = null; clear($('docxmsg'));
    document.querySelectorAll('.prot').forEach(c => { c.checked = c.value === s.protocol; });
  });
  $('docx').addEventListener('change', async () => {
    const f = $('docx').files[0]; clear($('docxmsg')); S.docx = null; if (!f) return;
    try {
      const r = await DX.readDocx(await f.arrayBuffer(), { JSZip: window.JSZip });
      $('text').value = r.text; S.docx = { name: f.name, warnings: r.warnings, complete: r.complete };
      $('docxmsg').appendChild(h('div', { class: r.complete ? 'muted' : 'warnbox' }, r.complete ? `Прочитан файл «${f.name}».` : `Файл «${f.name}» прочитан НЕ полностью: ${r.warnings.join('; ')}. Извлечение будет неполным.`));
    } catch (e) { $('docxmsg').appendChild(h('div', { class: 'warnbox' }, 'DOCX не прочитан: ' + e.message)); }
  });
  function tz() {
    const v = $('tz').value.trim(), ok = /^[+-](0\d|1[0-4]):[0-5]\d$/.test(v);
    $('tzerr').textContent = ok ? '' : 'формат ±ЧЧ:ММ'; return ok ? v : null;
  }
  $('tz').addEventListener('input', tz);
  $('go').addEventListener('click', () => {
    const t = $('text').value, z = tz();
    S.protocols = [...document.querySelectorAll('.prot:checked')].map(c => c.value);
    const err = !t.trim() ? 'Нет текста.' : !z ? 'Укажите часовой пояс организации.' : !$('synth').checked ? 'Подтвердите, что текст синтетический.' : !S.protocols.length ? 'Отметьте протокол(ы) истории.' : '';
    $('goerr').textContent = err; if (err) return;
    S.text = t;
    S.extraction = X.extract(t, { tz: z, documentId: S.docx ? S.docx.name : ($('sample').value || 'вставленный текст'), warnings: S.docx ? S.docx.warnings : [] });
    S.session = CB.createSession({ extraction: S.extraction, actor: 'эксперт', synthetic: true });
    S.lastFp = null; S.lastView = null; S.comments = {}; S.justif = {};
    document.querySelectorAll('nav button').forEach(b => { b.disabled = false; });
    renderData(); go(2);
  });

  // ── экран 2
  function renderSource() {
    const pre = clear($('src')); const frs = [];
    for (const it of S.session.items) for (const f of (it.candidate.fragments || [])) frs.push({ s: f.start, e: f.end, id: it.candidate.id });
    frs.sort((a, b) => a.s - b.s || b.e - a.e);
    let pos = 0;
    for (const f of frs) {
      if (f.s < pos) continue;
      pre.appendChild(document.createTextNode(S.text.slice(pos, f.s)));
      pre.appendChild(h('mark', { 'data-c': f.id, class: S.cur === f.id ? 'cur' : null }, S.text.slice(f.s, f.e)));
      pos = f.e;
    }
    pre.appendChild(document.createTextNode(S.text.slice(pos)));
  }
  function focusFragment(id) { S.cur = id; renderSource(); const m = $('src').querySelector(`mark[data-c="${id}"]`); if (m && m.scrollIntoView) m.scrollIntoView({ block: 'center' }); }

  function parseValue(old, raw) {
    if (typeof old === 'number') { const n = Number(raw.replace(',', '.')); if (Number.isNaN(n)) throw new Error('нужно число'); return n; }
    if (typeof old === 'boolean') { if (/^(да|true)$/i.test(raw)) return true; if (/^(нет|false)$/i.test(raw)) return false; throw new Error('нужно «да» или «нет»'); }
    if (old !== null && typeof old === 'object') return JSON.parse(raw);
    return raw;
  }

  function row(it) {
    const c = it.candidate, st = it.status;
    const sc = st === CB.STATUS.OK ? 's-ok' : st === CB.STATUS.EDITED ? 's-ed' : st === CB.STATUS.REJECTED ? 's-rej' : '';
    let valCell;
    if (c.timeline && !('value' in c)) {
      valCell = h('div', null, h('div', { class: 'tl' }, c.timeline.map((t, i) => h('label', { class: t.v ? 't' : 'f' },
        h('input', { type: 'radio', name: 'tl-' + c.id, checked: it.choice && it.choice.index === i, onchange: () => { CB.choose(S.session, c.id, i); renderData(); } }),
        ' ', t.at ? t.at.slice(0, 16).replace('T', ' ') : (t.date + ' (без времени)'), h('br'), h('b', null, t.v ? 'да' : 'нет')))),
        h('span', { class: 'muted' }, 'Динамика во времени. Движок принимает одно значение — выберите, какое передать.'));
    } else if (c.alternatives) {
      valCell = h('div', null, c.alternatives.map((a, i) => h('label', { style: 'display:block' }, h('input', { type: 'radio', name: 'alt-' + c.id, checked: it.choice && it.choice.index === i, onchange: () => { CB.choose(S.session, c.id, i); renderData(); } }), ' ', fmt(a.value))),
        h('span', { class: 'muted' }, 'В тексте разные значения — выберите одно.'));
    } else valCell = h('b', null, fmt(it.value));
    const frs = c.manual ? [h('span', { class: 'muted' }, 'внесено врачом')] : (c.fragments || []).map(f => h('div', { class: 'frag', onclick: () => focusFragment(c.id) }, '«' + f.text + '»'));
    const edit = () => {
      const td = tr.querySelector('.vcell'); clear(td);
      const inp = h('input', { value: typeof it.value === 'object' ? JSON.stringify(it.value) : fmt(it.value), style: 'width:95%' });
      const msg = h('span', { class: 'err' });
      td.append(inp, h('button', { onclick: () => { try { CB.edit(S.session, c.id, parseValue(it.value, inp.value.trim())); renderData(); } catch (e) { msg.textContent = e.message; } } }, 'Сохранить'), msg);
      inp.focus();
    };
    const tr = h('tr', { 'data-c': c.id, 'data-field': c.field },
      h('td', null, c.critical ? h('span', { class: 'crit', title: 'критическое' }, '★ ') : null, lbl(c.field), h('div', { class: 'code' }, c.field), c.note ? h('div', { class: 'muted' }, c.note) : null),
      h('td', { class: 'vcell' }, valCell), h('td', null, frs),
      h('td', null, h('span', { class: 'st ' + sc }, st)),
      h('td', { style: 'white-space:nowrap' },
        h('button', { title: 'подтвердить', 'data-act': 'ok', disabled: CB.needsChoice(c) && !it.choice, onclick: () => { CB.confirm(S.session, c.id); renderData(); } }, '✓'),
        h('button', { title: 'исправить', 'data-act': 'ed', onclick: edit }, '✎'),
        h('button', { title: 'отклонить', 'data-act': 'rej', onclick: () => { CB.reject(S.session, c.id); renderData(); } }, '✕')));
    return tr;
  }

  function renderData() {
    const s = S.session, b = CB.build(s);
    $('cnt').textContent = `Найдено: ${s.items.filter(x => !x.candidate.manual).length} · решено ${b.completeness.decided} из ${b.completeness.total}`;
    const dw = clear($('docxwarn'));
    if (s.warnings.length) dw.appendChild(h('div', { class: 'warnbox' }, 'Извлечение неполное — часть документа не прочитана: ' + s.warnings.join('; ')));
    const groups = new Map();
    for (const it of s.items) { const g = it.candidate.group; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(it); }
    const G = clear($('groups'));
    for (const [g, its] of groups) {
      const nc = its.filter(it => !it.candidate.critical && it.status === CB.STATUS.NEW && !CB.needsChoice(it.candidate)).length;
      G.appendChild(h('div', { class: 'grp', 'data-group': g },
        h('h4', null, g, h('span', { class: 'sp' }, `${its.length} · критических ${its.filter(x => x.candidate.critical).length}`),
          h('button', { 'data-bulk': g, disabled: !nc, onclick: () => { CB.confirmGroup(s, g); renderData(); } }, `Подтвердить некритические (${nc})`)),
        h('table', null, its.map(row))));
    }
    // ограничение движка для динамики и альтернативные результаты
    const A = clear($('alts'));
    const alts = V.timelineAlternatives(env, s, CB, S.protocols);
    for (const a of alts) A.appendChild(h('div', { class: 'lim', 'data-alt': a.field }, h('b', null, 'Ограничение текущего движка. '), a.limitation, ' Пока значение не выбрано, поле не передаётся в проверку.',
      a.variants.map(v => h('div', null, `Если передать «${v.value ? 'да' : 'нет'}» (${v.at ? v.at.slice(0, 16).replace('T', ' ') : v.date + ', без времени'}): `,
        v.changed.length ? v.changed.map(x => `${x.rule_id} — ${x.label}`).join('; ') : 'результаты правил не меняются'))));
    // недостающие для отмеченных протоколов сведения
    const need = clear($('need'));
    const have = new Set(s.items.filter(x => x.status !== CB.STATUS.REJECTED).map(x => x.candidate.field));
    const pref = S.protocols.map(p => ({ 'РДС': 'RDS', 'НЭК': 'NEC', 'Сепсис': 'SEP' })[p]);
    const req = new Set();
    for (const r of D.rules.rules) if (pref.some(p => r.rule_id.startsWith(p))) for (const d of r.required_data) if (isInput(d.field)) req.add(d.field);
    const miss = [...req].filter(f => !have.has(f) && DD[f]);
    const genta = s.items.some(x => x.candidate.field === 'gentamicin_given' && x.status !== CB.STATUS.REJECTED);
    if (genta && !have.has('postnatal_age_days')) need.appendChild(h('div', { class: 'warnbox', 'data-need': 'postnatal_age_days' }, 'Постнатальный возраст не найден: он нужен для сверки дозы гентамицина с таблицей стр. 18. Программа возраст из дат не вычисляет — при необходимости внесите его вручную.'));
    if (miss.length) need.appendChild(h('div', { class: 'miss' }, 'Не найдено в тексте (значение не придумывается): ' + miss.map(f => f).join(', ')));
    const mf = clear($('mfield'));
    for (const f of Object.keys(DD).filter(f => isInput(f) && !have.has(f)).sort()) mf.appendChild(h('option', { value: f }, f + ' — ' + lbl(f).slice(0, 50)));
    const J = clear($('jr'));
    if (!s.journal.length) J.appendChild(document.createTextNode('Пока пусто.'));
    for (const j of s.journal.slice().reverse()) J.appendChild(h('div', { 'data-seq': j.seq }, `${j.at.slice(0, 19).replace('T', ' ')} · ${j.actor} · ${j.action}` + (j.field ? ` · ${j.field}` : '') + (j.group ? ` · группа «${j.group}» (${j.candidate_ids.length})` : '') + (j.action === 'исправлено' || j.action === 'выбор значения' || j.action === 'внесено врачом' ? ` · ${fmt(j.from)} → ${fmt(j.to)}` : '')));
    $('fin').disabled = !b.completeness.complete;
    modeBar(b); renderSource();
    if (S.lastFp !== null) $('stale').hidden = CB.fingerprint(b) === S.lastFp;
    updateExport();
  }
  function updateExport() {
    if (!S.session) return;
    const e = RP.exportState(CB.build(S.session), S.lastFp, !!S.lastView, CB.fingerprint);
    $('exp').disabled = !e.allowed;
    $('expn').textContent = e.allowed ? '' : 'Выгрузка недоступна: ' + e.reasons.join('; ') + '.';
  }
  function sourceNote(b) {
    return b.completeness.source_complete ? null : h('div', { class: 'warnbox', 'data-source-incomplete': '' },
      'Исходный документ прочитан НЕ полностью: ' + b.completeness.source_warnings.join('; ') + '. Это не полная проверка всего документа — сведения из непрочитанных частей не проверялись.');
  }
  function modeBar(b) {
    const m = $('mode'), st = RP.auditState(b);
    if (st.full) { m.className = 'mode full'; m.textContent = `Проверка данных завершена: решение есть по всем ${b.completeness.total} сведениям; документ прочитан полностью. Результаты — предварительные.`; }
    else if (st.review_complete) { m.className = 'mode part'; m.textContent = `Решение есть по всем ${b.completeness.total} найденным сведениям, но исходный документ прочитан НЕ полностью — это не полная проверка документа. Результаты предварительные.`; }
    else { m.className = 'mode part'; m.textContent = `Частичная проверка: в проверку правил передано ${b.completeness.used} из ${b.completeness.total} сведений. Результаты неполные и предварительные.`; }
  }
  $('madd').addEventListener('click', () => {
    const f = $('mfield').value, raw = $('mval').value.trim(); $('merr').textContent = '';
    if (!f || !raw) { $('merr').textContent = 'выберите поле и значение'; return; }
    const t = DD[f].type;
    try {
      const v = t === 'number' || t === 'integer' ? parseValue(0, raw) : t === 'tri' || t === 'bool' ? parseValue(true, raw) : t === 'list' ? JSON.parse(raw) : raw;
      CB.addManual(S.session, f, v); $('mval').value = ''; renderData();
    } catch (e) { $('merr').textContent = e.message; }
  });
  $('prev').addEventListener('click', () => go(3));
  $('fin').addEventListener('click', () => go(4));

  // ── экраны 3–4
  function compute() { const b = CB.build(S.session); S.lastView = V.view(env, b, S.protocols); S.lastFp = CB.fingerprint(b); S.lastAlts = V.timelineAlternatives(env, S.session, CB, S.protocols); }
  $('recalc').addEventListener('click', () => { compute(); renderResults(); updateExport(); });
  $('showhidden').addEventListener('change', () => renderResults());

  function partialNote() {
    const c = S.lastView.completeness;
    return c.complete ? null : h('div', { class: 'warnbox' }, `Частичный анализ: результаты построены по ${c.used} подтверждённым или исправленным сведениям из ${c.total}. ${c.pending} не проверено, ${c.rejected} отклонено — они в проверку не переданы.`);
  }
  function renderResults() {
    if (!S.session) return;
    if (!S.lastView) compute();
    const b = CB.build(S.session);
    $('stale').hidden = CB.fingerprint(b) === S.lastFp;
    const v = S.lastView;
    clear($('partial3')).appendChild(partialNote() || document.createTextNode(''));
    clear($('source3')).appendChild(sourceNote(b) || document.createTextNode(''));
    clear($('source4')).appendChild(sourceNote(b) || document.createTextNode(''));
    updateExport();
    $('hc').textContent = v.hidden.length;
    const list = v.shown.concat($('showhidden').checked ? v.hidden : []);
    const C = clear($('cards'));
    if (!list.length) C.appendChild(h('p', { class: 'muted' }, 'Нет правил для показа: по переданным сведениям применимость правил не установлена.'));
    const used = S.lastView && b.case.sources;
    for (const r of list) {
      const R = RULE[r.rule_id], q = (R.source.quotes || [])[0] || {};
      const w = v.ui_warnings.find(x => x.rule_id === r.rule_id);
      const cls = w ? 'nd' : (CLS[r.label] || '');
      const linked = R.protocol_conflicts || [];
      const alt = (S.lastAlts || []).flatMap(a => a.variants.map(x => ({ a, x, ch: x.changed.find(y => y.rule_id === r.rule_id) }))).filter(z => z.ch);
      const dataUsed = R.required_data.map(d => d.field).filter(f => used[f]);
      C.appendChild(h('div', { class: 'card ' + cls, 'data-rule': r.rule_id },
        h('div', null, h('b', null, r.rule_id), ' · ', PROT[R.protocol] || R.protocol,
          h('span', { class: 'pill ' + cls, 'data-label': r.label }, (w ? 'соответствует проверенному фрагменту' : r.label) + ' · предварительно'),
          v.partial ? h('span', { class: 'pill nd' }, 'данные не полностью подтверждены') : null),
        h('div', null, R.requirement.description),
        h('div', { class: 'q' }, `Протокол: «${q.text || ''}»` + (q.page ? ` (стр. ${q.page})` : '')),
        dataUsed.length ? h('div', { class: 'q' }, 'Данные истории: ', dataUsed.map(f => h('span', { class: 'frag', title: used[f].fragment || 'внесено врачом' }, `${f} = ${fmt(b.case.data[f])}` + (used[f].fragment ? ` («${used[f].fragment}»)` : ' (внесено врачом)') + '; '))) : null,
        r.parts.length ? h('div', null, r.parts.map(p => h('span', { class: 'pill ' + (CLS[p.label] || '') }, `${p.part_id}: ${p.label}`))) : null,
        (r.raw.card && r.raw.card.labels || []).length ? h('div', { class: 'q' }, r.raw.card.labels.map(l => typeof l === 'string' ? l : (l.text || l.label || JSON.stringify(l))).join(' · ')) : null,
        w ? h('div', { class: 'warnbox', 'data-warn': r.rule_id }, w.text) : null,
        linked.length ? h('div', { class: 'cf' }, linked.map(id => v.active_conflicts.includes(id) ? `Активный конфликт ${id} — решает эксперт. ` : `Связанный конфликт ${id} (в этом случае не активен). `)) : null,
        alt.map(z => h('div', { class: 'lim' }, `Ограничение движка (${z.a.field}): при передаче «${z.x.value ? 'да' : 'нет'}» (${z.x.at ? z.x.at.slice(0, 16).replace('T', ' ') : z.x.date + ', без времени'}) — ${z.ch.label}.`)),
        r.missing_data.length ? h('div', { class: 'miss' }, 'Недостаёт: ' + r.missing_data.join(', ')) : null,
        justifBlock(r.rule_id),
        h('label', { class: 'muted' }, 'Комментарий эксперта (сохраняется с автором и датой; результат не меняет):', h('input', { 'data-comment': r.rule_id, value: (S.comments[r.rule_id] || {}).text || '', onchange: e => { S.comments[r.rule_id] = { text: e.target.value, at: new Date().toISOString(), by: S.session.actor }; note('комментарий', r.rule_id, e.target.value); } }))));
    }
    // сводка
    clear($('partial4')).appendChild(partialNote() || document.createTextNode(''));
    const c = v.counts, K = clear($('kpi'));
    for (const [t, col, n] of [['соответствие', '#dcefe3', c['соответствие'] || 0], ['предварительное отличие', '#f6d5d1', c['предварительное отличие'] || 0],
      ['недостаточно данных', '#e5e7ea', (c['недостаточно данных'] || 0) + (c['применимость не установлена'] || 0)], ['неоднозначность', '#fbe5c4', (c['неоднозначность'] || 0) + (c['неоднозначность (применимость)'] || 0)]])
      K.appendChild(h('div', { class: 'k', style: 'background:' + col, 'data-kpi': t }, h('b', null, n), t));
    $('cfl').textContent = `Активные конфликты протоколов: ${v.active_conflicts.join(', ') || 'нет'}. Окончательный вывод: не формируется.`;
    const T = clear($('sum'));
    T.appendChild(h('tr', null, h('th', null, 'Правило'), h('th', null, 'Результат (предварительно)'), h('th', null, 'Комментарий эксперта')));
    for (const r of v.shown) { const w = v.ui_warnings.find(x => x.rule_id === r.rule_id); T.appendChild(h('tr', null, h('td', null, r.rule_id), h('td', null, w ? 'соответствует проверенному фрагменту; возрастная таблица не проверена' : r.label), h('td', null, (S.comments[r.rule_id] || {}).text || '—'))); }
  }
  const jStatus = fr => !fr ? 'Обоснование введено вручную и не связано с документом.'
    : fr.ambiguous ? `Фрагмент «${fr.text}» встречается в истории ${fr.occurrences} раз — место однозначно не установлено, источник не считается достоверно привязанным. Уточните цитату.`
    : `Привязан фрагмент истории (позиция ${fr.start}): «${fr.text}»`;
  function justifBlock(id) {
    const j = S.justif[id] || { text: '', fragment: null };
    const status = h('div', { class: 'muted', 'data-jstatus': id }, !j.text ? '' : jStatus(j.fragment));
    const txt = h('input', { 'data-jtext': id, value: j.text || '', placeholder: 'текст обоснования' });
    const frg = h('input', { 'data-jfrag': id, value: j.fragment ? j.fragment.text : '', placeholder: 'фрагмент истории (точная цитата), необязательно' });
    const save = () => {
      const fr = frg.value.trim() ? RP.bindFragment(S.text, frg.value) : null;
      if (frg.value.trim() && !fr) { status.textContent = 'Фрагмент не найден в тексте истории — не привязан.'; return; }
      S.justif[id] = { text: txt.value.trim(), fragment: fr, by: S.session.actor, at: new Date().toISOString() };
      note('обоснование', id, txt.value.trim() + (fr ? ` [фрагмент: ${fr.text}]` : ' [введено вручную]'));
      status.textContent = !txt.value.trim() ? '' : jStatus(fr);
    };
    return h('div', { class: 'muted' }, 'Документированное обоснование отклонения (привязывает врач; результат не меняет):', txt, frg,
      h('button', { 'data-jsave': id, onclick: save }, 'Сохранить обоснование'), status);
  }
  function note(kind, rule, text) {
    S.session.journal.push({ seq: S.session.journal.length + 1, at: new Date().toISOString(), actor: S.session.actor, action: kind, rule_id: rule, field: null, from: null, to: text, fragment: null });
  }

  $('exp').addEventListener('click', () => {
    const b = CB.build(S.session);
    const e = RP.exportState(b, S.lastFp, !!S.lastView, CB.fingerprint);
    if (!e.allowed) { updateExport(); return; } // устаревший или неполный результат не выгружается
    const html = RP.buildReport({ view: S.lastView, built: b, journal: S.session.journal, documentId: S.session.document_id, tz: S.session.tz, text: S.text,
      sourceWarnings: b.completeness.source_warnings, comments: S.comments, justifications: S.justif, generatedAt: new Date().toISOString() });
    // data:-ссылка; имя файла только латиницей: кириллица в имени файла может сбросить его в «download»
    const a = h('a', { href: 'data:application/msword;charset=utf-8,' + encodeURIComponent('\ufeff' + html), download: 'antidefect-PREDVARITELNO-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.doc' });
    document.body.appendChild(a); a.click(); a.remove();
  });

  window.__antidefectState = S; // для браузерных тестов
}());
