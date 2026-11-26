/*
 * Антидефект — этап 7. Предварительная выгрузка: можно ли выгружать и что попадает в документ.
 *
 * Выгрузка запрещена, если: решение есть не по всем сведениям; расчёт не выполнялся; данные изменены
 * после последнего расчёта (карточки устарели). Неполное чтение исходного документа выгрузку не запрещает,
 * но документ получает явное предупреждение и не называется полной проверкой.
 * Комментарий эксперта и обоснование отклонения входят в выгрузку; обоснование показывается с привязанным
 * фрагментом истории или с предупреждением, что оно введено вручную и с документом не связано.
 * Обоснование не меняет результат движка и не считается клинически подтверждённым.
 * Только синтетические данные на этапе 7. Окончательный вывод не формируется.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AntidefectReport = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  /** Состояние проверки: два независимых признака + итог. */
  function auditState(built) {
    const c = built.completeness;
    return {
      review_complete: !!c.complete,          // по каждому извлечённому сведению есть решение врача
      source_complete: !!c.source_complete,   // исходный документ прочитан полностью
      full: !!c.complete && !!c.source_complete,
    };
  }

  /** Можно ли выгружать: {allowed, reasons[]}. fingerprint — функция отпечатка данных (CaseBuilder.fingerprint). */
  function exportState(built, lastFp, hasView, fingerprint) {
    const reasons = [];
    if (!built.completeness.complete) reasons.push('решение есть не по всем сведениям');
    if (!hasView || lastFp === null || lastFp === undefined) reasons.push('проверка правил не выполнялась');
    else if (fingerprint(built) !== lastFp) reasons.push('данные изменены после последнего расчёта — нажмите «Пересчитать»');
    return { allowed: reasons.length === 0, reasons };
  }

  /** Число вхождений фрагмента в текст (без перекрытий). */
  const occurrences = (text, f) => (f ? text.split(f).length - 1 : 0);

  /**
   * Привязка фрагмента обоснования к тексту истории: только точное совпадение.
   * Если фрагмент встречается несколько раз, привязка неоднозначна (ambiguous:true): позиция первого вхождения
   * не выдаётся за установленный источник.
   */
  function bindFragment(text, fragment) {
    const f = String(fragment || '').trim();
    if (!f) return null;
    const i = text.indexOf(f);
    if (i < 0) return null;
    const n = occurrences(text, f);
    return { text: f, start: i, end: i + f.length, occurrences: n, ambiguous: n > 1 };
  }

  /** Проверка, что привязанный фрагмент действительно стоит в тексте на указанном месте. */
  const fragmentValid = (text, fr) => !!fr && text.slice(fr.start, fr.end) === fr.text;

  /**
   * buildReport({view, built, journal, documentId, tz, text, sourceWarnings, comments, justifications, generatedAt})
   * comments[rule] = {text, by, at}; justifications[rule] = {text, fragment:{text,start,end}|null, by, at}
   */
  /**
   * Время событий (S8-4): у каждого времени записи / неизвестного типа в выгрузке — тип, точная цитата из истории и
   * основание врача; у списка — поэлементно. Неподтверждённые — отдельно, с пометкой «в расчёт не передано».
   */
  const BL = { document_time: 'время записи врача', unknown: 'время неизвестного типа', event_time: 'время события' };
  const RK = b => b === 'document_time' || b === 'unknown';
  function timeSection(o) {
    const src = (o.built.case && o.built.case.sources) || {}, rows = [];
    const q = f => (f ? '«' + esc(f) + '»' + (o.text && occurrences(o.text, f) > 1 ? ` <b>(встречается в документе ${occurrences(o.text, f)} раз — место однозначно не установлено)</b>` : '') : '<b>цитата отсутствует</b>');
    for (const [field, x] of Object.entries(src)) {
      if (Array.isArray(x.time_basis_items)) {
        for (const e of x.time_basis_items) if (RK(e.time_basis))
          rows.push(`<tr data-time-field="${esc(field)}"><td>${esc(field)} №${(e.index | 0) + 1}</td><td>${esc(BL[e.time_basis])}</td><td>${q(e.fragment)}</td><td>${e.time_confirmation ? esc(e.time_confirmation) : '<b>основание отсутствует</b>'}</td></tr>`);
      } else if (RK(x.time_basis))
        rows.push(`<tr data-time-field="${esc(field)}"><td>${esc(field)}</td><td>${esc(BL[x.time_basis])}</td><td>${q(x.fragment)}</td><td>${x.time_confirmation ? esc(x.time_confirmation) : '<b>основание отсутствует</b>'}</td></tr>`);
    }
    const un = (o.built.completeness && o.built.completeness.time_unconfirmed) || [];
    const NO = '<td><b>НЕ ПОДТВЕРЖДЕНО врачом как время события — в расчёт не передано</b></td></tr>';
    for (const u of un) {
      if (u.elements && u.elements.length) for (const e of u.elements) rows.push(`<tr data-time-field="${esc(u.field)}" data-unconfirmed><td>${esc(u.field)} №${(e.index | 0) + 1}</td><td>${esc(BL[u.time_basis] || u.time_basis)}</td><td>${q(e.fragment)}</td>` + NO);
      else rows.push(`<tr data-time-field="${esc(u.field)}" data-unconfirmed><td>${esc(u.field)}</td><td>${esc(BL[u.time_basis] || u.time_basis)}</td><td>${q(u.fragment)}</td>` + NO);
    }
    if (!rows.length) return '';
    return `<h2>Время событий: тип и подтверждение врача</h2>
<p>Время записи врача и время неизвестного типа становятся временем события только по явному подтверждению врача с основанием.</p>
<table border="1" cellpadding="4"><tr><th>Сведение</th><th>Тип времени</th><th>Цитата из истории</th><th>Основание врача</th></tr>
${rows.join('\n')}</table>`;
  }

  function buildReport(o) {
    const st = auditState(o.built), v = o.view;
    const rules = v.shown.map(r => r.rule_id);
    for (const k of Object.keys(o.comments || {}).concat(Object.keys(o.justifications || {}))) if (!rules.includes(k)) rules.push(k);
    const warn = [];
    if (!st.source_complete) warn.push(`ИСХОДНЫЙ ДОКУМЕНТ ПРОЧИТАН НЕ ПОЛНОСТЬЮ: ${(o.sourceWarnings || []).join('; ')}. Это не полная проверка всего документа — сведения из непрочитанных частей не проверялись.`);
    if (!st.review_complete) warn.push('Решение есть не по всем сведениям.');
    const row = id => {
      const r = v.rules.find(x => x.rule_id === id) || { label: '—' };
      const w = (v.ui_warnings || []).find(x => x.rule_id === id);
      const c = (o.comments || {})[id], j = (o.justifications || {})[id];
      let jcell = '';
      if (j && j.text) {
        jcell = esc(j.text) + `<br><small>${esc(j.by || '')}, ${esc(j.at || '')}</small><br>`;
        const occ = j.fragment ? occurrences(o.text, j.fragment.text) : 0;
        if (j.fragment && fragmentValid(o.text, j.fragment) && occ > 1) jcell += `<b>Внимание: фрагмент «${esc(j.fragment.text)}» встречается в документе ${occ} раз — место в истории однозначно не установлено; источник не считается достоверно привязанным.</b>`;
        else if (j.fragment && fragmentValid(o.text, j.fragment)) jcell += `Фрагмент истории (позиция ${j.fragment.start}): «${esc(j.fragment.text)}»`;
        else if (j.fragment) jcell += '<b>Внимание: указанный фрагмент не найден в документе.</b>';
        else jcell += '<b>Внимание: обоснование введено вручную и не связано с документом.</b>';
      }
      return `<tr><td>${esc(id)}</td><td>${esc(w ? r.label + ' — ' + w.text : r.label)}</td>` +
        `<td>${c && c.text ? esc(c.text) + `<br><small>${esc(c.by || '')}, ${esc(c.at || '')}</small>` : ''}</td><td>${jcell}</td></tr>`;
    };
    return `<html><head><meta charset="utf-8"><title>ПРЕДВАРИТЕЛЬНО</title></head><body>
<h1>ПРЕДВАРИТЕЛЬНО — черновик, не экспертное заключение</h1>
${warn.map(w => `<p style="color:#a00;font-weight:bold">${esc(w)}</p>`).join('\n')}
<p>Документ: ${esc(o.documentId)}. Данные синтетические. Часовой пояс организации: ${esc(o.tz)}. Сформировано: ${esc(o.generatedAt)}.</p>
<p>Статус: ${st.full ? 'решение врача есть по всем извлечённым сведениям; исходный документ прочитан полностью' : st.review_complete ? 'решение врача есть по всем извлечённым сведениям; исходный документ прочитан НЕ полностью' : 'частичная проверка'}. Окончательный вывод программа не формирует.</p>
<p>Активные конфликты протоколов: ${esc((v.active_conflicts || []).join(', ') || 'нет')}.</p>
<p>Обоснования и комментарии эксперта не меняют результат проверки правил и не считаются клинически подтверждёнными.</p>
<table border="1" cellpadding="4"><tr><th>Правило</th><th>Результат (предварительно)</th><th>Комментарий эксперта</th><th>Обоснование отклонения</th></tr>
${rules.map(row).join('\n')}</table>
${timeSection(o)}
<h2>Журнал</h2><ol>${(o.journal || []).map(j => `<li>${esc(j.at)} · ${esc(j.actor)} · ${esc(j.action)} ${esc(j.field || j.rule_id || '')}</li>`).join('')}</ol>
</body></html>`;
  }

  return { auditState, exportState, bindFragment, fragmentValid, occurrences, buildReport, esc };
}));
