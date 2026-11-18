/*
 * Антидефект — модуль «Отклонение от протокола + обоснование».
 * ТЗ v0.4 (docs/deviation-module-spec.md): модель данных, независимые проверки,
 * детерминированный механизм статусов, подтверждения с происхождением, журнал решений эксперта.
 *
 * Модуль только читает входные данные и ничего в них не меняет.
 * Не использует ИИ и сеть. Работает в браузере (window.DeviationEngine) и в Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DeviationEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '0.8.0-stage4';
  const OFFICIAL_EVIDENCE = Object.freeze(['подтверждено_официальным_PDF', 'подтверждено_выдержкой_официального_сайта', 'подтверждено_протоколом_ОКК']);
  const PROTOCOL_TYPES = Object.freeze(['диагностика_и_лечение', 'медицинское_вмешательство', 'реабилитация', 'не_установлен']);
  const TEST_ASSURANCE = 'тестовое подтверждение в браузере (без авторизации и защищённого журнала)';
  const ANALYSIS_BASIS = 'анализируются только сведения, введённые в карточку вручную; текст истории болезни программа не разбирает';

  const STATUS = Object.freeze({
    URGENT: 'Требуется срочная оценка эксперта',
    EXPERT: 'Требуется оценка эксперта',
    INSUFFICIENT: 'Недостаточно данных',
    COMPLIANT: 'Соответствует протоколу',
    JUSTIFIED: 'Обоснованное отклонение',
    INCOMPLETE: 'Отклонение документировано не полностью',
    POTENTIAL_DEFECT: 'Потенциальный дефект' // только решением эксперта
  });
  const AUTO_STATUSES = Object.freeze([STATUS.URGENT, STATUS.EXPERT, STATUS.INSUFFICIENT,
    STATUS.COMPLIANT, STATUS.JUSTIFIED, STATUS.INCOMPLETE]);
  const ALL_STATUSES = Object.freeze(AUTO_STATUSES.concat([STATUS.POTENTIAL_DEFECT]));

  const RELATION = Object.freeze({
    OK: 'соответствует', DIFF: 'отличается',
    NOT_REG: 'не_урегулировано', UNKNOWN: 'невозможно_проверить'
  });
  const INDICATIONS = Object.freeze({
    CONFIRMED: 'подтверждены', NOT_CONFIRMED: 'не_подтверждены', INSUFFICIENT: 'недостаточно_данных'
  });
  const DOC = Object.freeze({
    FOUND: 'найдено', FRAGMENT: 'не_найдено_во_фрагменте', FULL: 'не_найдено_в_полной_истории'
  });
  const DOC_LABEL = Object.freeze({
    physician_note: 'запись врача с обоснованием',
    risk_benefit: 'оценка пользы и рисков',
    monitoring: 'мониторинг эффективности и безопасности',
    consilium: 'консилиум',
    consent: 'информированное согласие'
  });
  const REGISTRY_STATUS = Object.freeze(['действует', 'заменён', 'не проверен']);
  const SIGNAL_KINDS = Object.freeze(['возможное_противопоказание', 'возможное_превышение_дозы',
    'возможное_несоответствие_пути_введения', 'возможное_несоответствие_интервала']);
  const SEVERITY = Object.freeze(['низкая', 'средняя', 'высокая', 'критическая']);
  const CONFIDENCE = Object.freeze(['низкая', 'средняя', 'высокая']);
  const APPLICABILITY = Object.freeze(['совпадает', 'частично', 'не_совпадает', 'не_определено']);
  const REGIMEN = Object.freeze(['совпадает', 'частично', 'нет', 'не_определено']);
  const BIB_METHODS = Object.freeze(['manual', 'pubmed_api']);
  const SIGNAL_LEVEL = Object.freeze({ URGENT: 'срочно', EXPERT: 'эксперт', WARNING: 'предупреждение' });

  const NOT_REG_STATEMENT = 'прямая рекомендация не найдена в проверенном наборе применимых протоколов';

  const DEFAULT_CONFIG = Object.freeze({
    consilium_mandatory: false,        // true только при указании основания
    consilium_basis: '',               // нормативный или локальный документ
    extra_required_documentation_for_deviation: []
  });

  function isStr(x) { return typeof x === 'string' && x.trim().length > 0; }
  function uniq(a) { return Array.from(new Set(a)); }
  function rank(list, v) { return list.indexOf(v); }

  /* ---------- Подтверждения с происхождением ----------
   * Библиографическая проверка и экспертная оценка учитываются только если созданы
   * функциями attest* этого экземпляра модуля (с указанием, кто и когда проверил).
   * Объекты из входного JSON, импорта или вставки подтверждением не считаются.
   * Ограничение: защищает от случайного или импортированного «подтверждения»,
   * но не от умышленной подделки в браузере. Для реальной работы нужна
   * серверная подпись и учётные записи (вне этапа 3). */
  const ATTESTED = new WeakSet();
  function seal(kind, o) { const a = Object.freeze(Object.assign({ kind, test_only: true, assurance: TEST_ASSURANCE }, o)); ATTESTED.add(a); return a; }
  // Клинический контекст, к которому привязана экспертная оценка применимости исследования
  function contextFingerprint(d) {
    return stableStr({ patient_ref: d.patient_ref, order: d.order || null,
      indications: d.indications ? { value: d.indications.value, facts: (d.indications.facts || []).map(f => f.text) } : null });
  }
  function sourceKey(v) { return String(v.citation || '').trim() + '|' + String(v.pmid || '').trim() + '|' + String(v.doi || '').trim(); }
  function stableStr(x) {
    if (Array.isArray(x)) return '[' + x.map(stableStr).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + stableStr(x[k])).join(',') + '}';
    return JSON.stringify(x === undefined ? null : x);
  }
  function isAttested(x, kind) { return !!x && typeof x === 'object' && ATTESTED.has(x) && x.kind === kind; }

  function attestBibliographic(o) {
    const e = [];
    o = o || {};
    if (typeof o.found !== 'boolean') e.push('не указано, найден ли источник');
    if (o.found === true && typeof o.metadata_match !== 'boolean') e.push('не указано, совпадают ли метаданные');
    if (!BIB_METHODS.includes(o.method)) e.push('способ проверки: manual или pubmed_api');
    if (!isStr(o.checked_by)) e.push('не указано, кто проверил');
    if (e.length) return { ok: false, errors: e };
    return { ok: true, attestation: seal('bibliographic', {
      found: o.found, metadata_match: o.found ? o.metadata_match : false, method: o.method,
      checked_by: o.checked_by.trim(), checked_at: o.checked_at || new Date().toISOString(),
      ref: isStr(o.ref) ? o.ref.trim() : '' }) };
  }

  function attestExpertAssessment(o) {
    const e = [];
    o = o || {};
    if (!APPLICABILITY.includes(o.applicability)) e.push('применимость: недопустимое значение');
    if (!REGIMEN.includes(o.regimen_match)) e.push('соответствие схемы: недопустимое значение');
    if (!isStr(o.assessed_by)) e.push('не указано, кто оценил');
    if (!o.context || !o.context.order) e.push('не передан клинический контекст назначения (данные проверки)');
    if (!isStr(o.source_key)) e.push('не указан оцениваемый источник');
    if (e.length) return { ok: false, errors: e };
    return { ok: true, attestation: seal('expert_assessment', {
      context_fingerprint: contextFingerprint(o.context), source_key: o.source_key.trim(),
      applicability: o.applicability, regimen_match: o.regimen_match,
      assessed_by: o.assessed_by.trim(), role: isStr(o.role) ? o.role.trim() : '',
      at: o.at || new Date().toISOString(), comment: isStr(o.comment) ? o.comment.trim() : '' }) };
  }

  function attestRegistryCompleteness(o) {
    const e = [];
    o = o || {};
    if (!isStr(o.confirmed_by)) e.push('не указано, кто подтвердил полноту реестра');
    if (typeof o.total !== 'number') e.push('не указано число протоколов в реестре');
    if (!Array.isArray(o.checked_protocols) || !o.checked_protocols.filter(isStr).length) e.push('не указан перечень проверенных протоколов');
    if (!isStr(o.registry_version)) e.push('не указана версия реестра');
    if (!isStr(o.basis)) e.push('не указано основание сверки');
    if (e.length) return { ok: false, errors: e };
    // В тестовой версии подтверждение эксперта — только заявление о полноте.
    // Уровень «сверено с официальными источниками» появится с верифицированным реестром (этап 4).
    return { ok: true, attestation: seal('registry_completeness', {
      confirmed_by: o.confirmed_by.trim(), total: o.total,
      checked_protocols: Object.freeze(o.checked_protocols.filter(isStr).map(x => x.trim())),
      registry_version: o.registry_version.trim(), basis: o.basis.trim(),
      verification: 'заявлено_экспертом',
      at: o.at || new Date().toISOString() }) };
  }

  /* ---------- Защищённая передача данных реестра ----------
   * official_evidence и currency_verified учитываются, только если запись получена
   * функцией registryEntry из реестра, загруженного loadRegistry. Те же поля во входных
   * данных игнорируются. Применимость редакции на дату помощи вычисляется здесь,
   * а не принимается со входа. Ограничение тестовой версии — как у attest*: для реальной
   * работы реестр должен приходить с сервера с подписью. */
  const REGISTRIES = new WeakSet();
  function loadRegistry(reg) {
    const e = [];
    if (!reg || !Array.isArray(reg.protocols)) return { ok: false, errors: ['нет списка protocols'] };
    if (!isStr(reg.version)) e.push('нет версии реестра');
    const byId = new Map();
    reg.protocols.forEach((p, i) => {
      if (!isStr(p.doc_id)) e.push('protocols[' + i + ']: нет doc_id');
      else if (byId.has(p.doc_id)) e.push('doc_id не уникален: ' + p.doc_id);
      else byId.set(p.doc_id, Object.freeze({
        doc_id: p.doc_id, protocol_no: String(p.approval && p.approval.no || ''),
        approved: p.approval && p.approval.date_iso, protocol_type: p.protocol_type,
        registry_status: p.registry_status, valid_to: p.valid_to || null,
        official_evidence: p.official_check && p.official_check.result,
        currency_verified: !!(p.currency_check && p.currency_check.result === 'новее_редакции_не_найдено' && p.currency_check.basis)
      }));
    });
    if (e.length) return { ok: false, errors: e };
    const h = Object.freeze({ version: reg.version, size: byId.size, _map: byId });
    REGISTRIES.add(h);
    return { ok: true, registry: h };
  }
  function registryEntry(h, docId, careDate, extra) {
    if (!h || !REGISTRIES.has(h)) return { ok: false, errors: ['реестр не загружен через loadRegistry'] };
    const p = h._map.get(docId);
    if (!p) return { ok: false, errors: ['документ ' + docId + ' отсутствует в реестре'] };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(careDate || ''))) return { ok: false, errors: ['дата помощи: ГГГГ-ММ-ДД'] };
    const valid = p.currency_verified && p.approved && p.approved <= careDate && (!p.valid_to || careDate < p.valid_to) ? 'да' : 'не_определено';
    return { ok: true, entry: seal('registry_entry', Object.assign({}, extra || {}, {
      doc_id: p.doc_id, protocol_no: p.protocol_no, protocol_type: p.protocol_type, registry_status: p.registry_status,
      official_evidence: p.official_evidence, currency_verified: p.currency_verified,
      valid_on_care_date: valid, care_date: careDate, registry_version: h.version })) };
  }

  /* ---------- Проверка структуры ---------- */

  // Простая проверка: 12 цифр подряд (возможный ИИН). Это НЕ обезличивание.
  const IIN_LIKE = /(^|\D)\d{12}(?!\d)/;

  function validate(d, config) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, config || {});
    const e = [];
    if (!d || typeof d !== 'object') return ['нет входных данных'];
    if (!isStr(d.id)) e.push('нет id');
    if (!isStr(d.patient_ref)) e.push('нет patient_ref (псевдоним пациента)');
    if (d.history_scope !== 'full' && d.history_scope !== 'fragment') e.push('history_scope: full или fragment');
    if (!d.order || !isStr(d.order.text)) e.push('нет order.text');

    const pc = d.protocol_check;
    if (!pc || !Object.values(RELATION).includes(pc.relation)) e.push('protocol_check.relation: недопустимое значение');
    else if (!Array.isArray(pc.searched)) e.push('protocol_check.searched должен быть массивом');
    else pc.searched.forEach((s, i) => {
      if (!isStr(s.protocol_no) && !isStr(s.doc_id)) e.push('searched[' + i + ']: нет идентификатора документа (doc_id или номер)');
      if (s.protocol_type != null && !PROTOCOL_TYPES.includes(s.protocol_type)) e.push('searched[' + i + ']: недопустимый тип протокола');
      if (s.registry_status != null && !REGISTRY_STATUS.includes(s.registry_status)) e.push('searched[' + i + ']: статус в реестре: действует / заменён / не проверен');
    });

    if (!d.indications || !Object.values(INDICATIONS).includes(d.indications.value)) e.push('indications.value: недопустимое значение');
    if (!d.documentation || typeof d.documentation !== 'object') e.push('нет documentation');
    else {
      for (const k of Object.keys(d.documentation)) {
        if (!DOC_LABEL[k]) e.push('documentation: неизвестный пункт ' + k);
        else if (!Object.values(DOC).includes(d.documentation[k])) e.push('documentation.' + k + ': недопустимое значение');
      }
    }
    (d.required_documentation || []).forEach(k => { if (!DOC_LABEL[k]) e.push('required_documentation: неизвестный пункт ' + k); });

    if (d.history_scope === 'fragment') {
      if (d.indications && d.indications.value === INDICATIONS.NOT_CONFIRMED)
        e.push('по фрагменту истории нельзя установить «показания не подтверждены» — укажите «недостаточно_данных»');
      if (d.documentation) for (const k of Object.keys(d.documentation))
        if (d.documentation[k] === DOC.FULL) e.push('documentation.' + k + ': «не найдено в полной истории» при history_scope=fragment');
    }

    (d.signals || []).forEach((s, i) => {
      const p = 'signals[' + i + ']: ';
      if (!SIGNAL_KINDS.includes(s.kind)) e.push(p + 'недопустимый вид');
      if (!SEVERITY.includes(s.severity)) e.push(p + 'нет серьёзности');
      if (!CONFIDENCE.includes(s.confidence)) e.push(p + 'нет уверенности');
      if (typeof s.confirmed !== 'boolean') e.push(p + 'не указана подтверждённость');
      if (!isStr(s.requirement_quote)) e.push(p + 'нет цитаты требования');
      if (!isStr(s.fact)) e.push(p + 'нет факта из истории');
      if (!isStr(s.source)) e.push(p + 'нет источника факта');
    });
    (d.conflicts || []).forEach((c, i) => {
      if (!isStr(c.a) || !isStr(c.b)) e.push('conflicts[' + i + ']: нужны оба противоречащих факта');
    });
    (d.evidence || []).forEach((v, i) => {
      const p = 'evidence[' + i + ']: ';
      if (typeof v.presented !== 'boolean') e.push(p + 'не указано, предъявлен ли источник');
      if (v.presented && !isStr(v.citation) && !isStr(v.pmid) && !isStr(v.doi)) e.push(p + 'нет описания источника');
    });

    if (cfg.consilium_mandatory && !isStr(cfg.consilium_basis))
      e.push('настройки: обязательный консилиум без указания основания не принимается');

    if (IIN_LIKE.test(JSON.stringify(d)))
      e.push('во входных данных есть последовательность из 12 цифр (возможный ИИН) — используйте псевдоним');
    return e;
  }

  /* ---------- Отношение к протоколу ---------- */

  function docName(s) { return s.doc_id ? '«' + s.doc_id + '»' : '№' + s.protocol_no; }
  function docKey(s) { return s.doc_id || s.protocol_no; }
  /* Положительный вывод возможен, только если реестр несёт официальное подтверждение документа
     и проверку актуальности редакции. Ручная отметка статуса или подтверждение эксперта
     без этих данных реестра положительный вывод не разблокирует. */
  function editionProblem(s) {
    if (s.valid_on_care_date !== 'да') return 'редакция протокола ' + docName(s) + ' на дату оказания помощи не подтверждена';
    if (s.registry_status !== 'действует' && s.registry_status !== 'заменён') return 'актуальность протокола ' + docName(s) + ' в реестре не проверена';
    if (!isAttested(s, 'registry_entry')) return 'сведения о протоколе ' + docName(s) + ' получены не из загруженного реестра (входным данным не доверяем)';
    if (!OFFICIAL_EVIDENCE.includes(s.official_evidence)) return 'протокол ' + docName(s) + ' не подтверждён официальным документом в реестре (ручной отметки недостаточно)';
    if (s.currency_verified !== true) return 'актуальность редакции протокола ' + docName(s) + ' не проверена по официальным данным (ручной отметки недостаточно)';
    return '';
  }
  function findSearched(pc, match) {
    if (match.doc_id) {
      const f = pc.searched.filter(s => s.doc_id === match.doc_id);
      return f.length === 1 ? { sp: f[0] } : { err: f.length ? 'документ «' + match.doc_id + '» встречается в перечне несколько раз' : 'документ «' + match.doc_id + '» отсутствует в перечне просмотренных' };
    }
    const f = pc.searched.filter(s => s.protocol_no === match.protocol_no);
    if (f.length > 1) return { err: 'номер заседания №' + match.protocol_no + ' не идентифицирует документ однозначно (в перечне ' + f.length + ' документа) — укажите doc_id' };
    return f.length ? { sp: f[0] } : { err: 'протокол №' + match.protocol_no + ' отсутствует в перечне просмотренных' };
  }

  function deriveRelation(d) {
    const pc = d.protocol_check, notes = [], warnings = [], unconfirmed = [];
    let relation = pc.relation, source = 'supplied';
    const match = pc.match || null;
    const ranges = match && match.ranges && typeof match.ranges === 'object' ? match.ranges : null;

    if (ranges && Object.keys(ranges).length) {
      source = 'ranges';
      const params = (d.order && d.order.params) || {};
      const outside = [], absent = [];
      for (const name of Object.keys(ranges)) {
        const r = ranges[name], v = params[name];
        if (typeof v !== 'number' || Number.isNaN(v)) { absent.push(name); continue; }
        if ((r.min != null && v < r.min) || (r.max != null && v > r.max))
          outside.push(name + ' = ' + v + ' вне диапазона протокола [' + (r.min == null ? '−∞' : r.min) + '; ' + (r.max == null ? '+∞' : r.max) + ']');
      }
      if (outside.length) { relation = RELATION.DIFF; notes.push.apply(notes, outside); }
      else if (absent.length) { relation = RELATION.UNKNOWN; notes.push('в назначении нет значения параметра: ' + absent.join(', ')); }
      else relation = RELATION.OK;
      if (relation !== pc.relation)
        warnings.push('заявленное отношение «' + pc.relation + '» заменено результатом сравнения с диапазонами: «' + relation + '»');
    }

    let statement = '';
    if (relation === RELATION.OK || relation === RELATION.DIFF) {
      const hasRef = match && (isStr(match.doc_id) || isStr(match.protocol_no)) && isStr(match.section) && isStr(match.quote);
      const found = hasRef ? findSearched(pc, match) : null;
      const sp = found && found.sp;
      if (!hasRef) { relation = RELATION.UNKNOWN; notes.push('нет ссылки на протокол (документ, раздел, дословная цитата)'); }
      else if (!sp) { relation = RELATION.UNKNOWN; notes.push(found.err); }
      else if (sp.valid_on_care_date !== 'да') {
        relation = RELATION.UNKNOWN;
        notes.push('редакция протокола ' + docName(sp) + ' на дату оказания помощи не подтверждена (' + (sp.valid_on_care_date || 'не указано') + ')');
      } else {
        statement = 'протокол ' + docName(sp) + ', раздел «' + match.section + '»: «' + match.quote + '»';
        const pr = editionProblem(sp);
        if (pr) unconfirmed.push(pr);
      }
    }
    if (relation === RELATION.NOT_REG) {
      const cov = pc.registry_coverage;
      if (!pc.searched.length || !cov || typeof cov.total !== 'number' || !Array.isArray(cov.missing_applicable)) {
        relation = RELATION.UNKNOWN;
        notes.push('«не урегулировано» нельзя установить без перечня просмотренных протоколов и сведений о полноте реестра');
      } else if (cov.missing_applicable.length) {
        relation = RELATION.UNKNOWN;
        notes.push('реестр неполный: не внесены применимые протоколы (' + cov.missing_applicable.join(', ') + ') — «не урегулировано» установить нельзя');
      } else {
        statement = NOT_REG_STATEMENT + ' (просмотрены: ' + pc.searched.map(docName).join(', ') + ')';
        const ca = cov.completeness_attestation;
        const covers = isAttested(ca, 'registry_completeness') && ca.total === cov.total &&
          pc.searched.every(sp => ca.checked_protocols.includes(docKey(sp)));
        if (!covers) {
          statement += '; полнота реестра заявлена, но не подтверждена';
          unconfirmed.push('полнота реестра применимых протоколов заявлена, но не подтверждена экспертом (с перечнем проверенных протоколов)');
        } else if (ca.verification !== 'сверено_с_официальными_источниками') {
          statement += '; полнота реестра подтверждена экспертом, сверка с официальными источниками не проведена';
          unconfirmed.push('реестр применимых протоколов не сверен с официальными источниками (этап 4)');
        }
        pc.searched.forEach(s => { const pr = editionProblem(s); if (pr) unconfirmed.push(pr); });
      }
    }
    if (relation === RELATION.UNKNOWN && !notes.length) notes.push('отношение к протоколу невозможно проверить');
    return { relation, source, statement, notes, warnings, unconfirmed };
  }

  /* ---------- Научное обоснование ---------- */

  function assessEvidence(list, d) {
    const ctx = contextFingerprint(d);
    const out = { qualifies: false, needs_expert: [], gaps: [], items: [], warnings: [] };
    const presented = (list || []).filter(v => v.presented);
    if (!presented.length) { out.gaps.push('источник не предъявлен'); return out; }
    for (const v of presented) {
      const name = '«' + (v.citation || v.pmid || v.doi) + '»';
      const b = v.bibliographic, ea = v.expert_assessment;
      let verdict;
      if (b && !isAttested(b, 'bibliographic')) out.warnings.push('источник ' + name + ': результат библиографической проверки во входных данных не подтверждён проверяющим и не учитывается');
      if (ea && !isAttested(ea, 'expert_assessment')) out.warnings.push('источник ' + name + ': экспертная оценка во входных данных не подтверждена и не учитывается');

      const eaValid = isAttested(ea, 'expert_assessment') && ea.context_fingerprint === ctx && ea.source_key === sourceKey(v);
      if (isAttested(ea, 'expert_assessment') && !eaValid) out.warnings.push('источник ' + name + ': после экспертной оценки изменились клинический контекст, схема назначения или источник — оценка не учитывается');
      if (!isAttested(b, 'bibliographic')) {
        verdict = 'библиография не подтверждена';
        out.needs_expert.push('источник ' + name + ': нужна библиографическая проверка с указанием проверяющего');
      } else if (!(b.found === true && b.metadata_match === true)) {
        verdict = 'не прошёл библиографическую проверку';
        out.gaps.push('источник ' + name + ' не прошёл библиографическую проверку');
      } else if (!eaValid) {
        verdict = isAttested(ea, 'expert_assessment') ? 'нужна повторная экспертная оценка' : 'ждёт экспертной оценки';
        out.needs_expert.push(isAttested(ea, 'expert_assessment')
          ? 'источник ' + name + ': клинический контекст или схема назначения изменились после оценки — нужна повторная экспертная оценка'
          : 'источник ' + name + ' найден, но применимость и схема не оценены экспертом');
      } else {
        const a = ea.applicability, r = ea.regimen_match;
        if (a === 'не_совпадает' || r === 'нет') {
          verdict = 'не применим';
          out.gaps.push('источник ' + name + ' не применим к пациенту или схеме (оценка эксперта)');
        } else if (a === 'не_определено' || r === 'не_определено') {
          verdict = 'применимость не определена';
          out.needs_expert.push('источник ' + name + ': применимость или схема не определены');
        } else if (a === 'частично' || r === 'частично') {
          if (v.transfer_rationale_documented === true) { verdict = 'принят (частичное совпадение, перенос обоснован)'; out.qualifies = true; }
          else { verdict = 'частичное совпадение без обоснования переноса'; out.needs_expert.push('источник ' + name + ' совпадает частично, запись врача о причине переноса данных не найдена'); }
        } else { verdict = 'принят'; out.qualifies = true; }
      }
      out.items.push({ source: v.citation || v.pmid || v.doi, verdict });
    }
    if (out.qualifies) { out.needs_expert = []; out.gaps = []; }
    else if (out.needs_expert.length) out.gaps = [];
    return out;
  }

  /* Пороги тестовой версии:
   * критическая — срочно (при наличии цитаты требования, факта и источника, проверено в validate);
   * высокая — срочно, если подтверждён или уверенность не ниже средней, иначе эксперт;
   * средняя — эксперт (повышение срочности — решением эксперта);
   * низкая — предупреждение, статус не меняет. */
  function signalLevel(s) {
    if (s.severity === 'критическая') return SIGNAL_LEVEL.URGENT;
    if (s.severity === 'высокая')
      return (s.confirmed === true || rank(CONFIDENCE, s.confidence) >= rank(CONFIDENCE, 'средняя')) ? SIGNAL_LEVEL.URGENT : SIGNAL_LEVEL.EXPERT;
    if (s.severity === 'средняя') return SIGNAL_LEVEL.EXPERT;
    return SIGNAL_LEVEL.WARNING;
  }

  function composeHeadline(status, documentation, positiveBlocked) {
    let h = status;
    if (positiveBlocked) h += ' (положительный вывод заблокирован: протокол или реестр не подтверждены)';
    if (documentation.state === 'неполная') h += '; документация неполная: ' + documentation.missing_items.join(', ');
    else if (documentation.state === 'не_определена') h += '; полнота документации не определена (предоставлен фрагмент)';
    return h;
  }

  /* ---------- Отпечаток входных данных (для устаревания результата) ---------- */
  function stable(x) {
    if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}';
    return JSON.stringify(x === undefined ? null : x);
  }
  function fingerprint(d) { return stable(d); }
  function isStale(result, currentInput) { return !result || !result.ok || result.input_fingerprint !== fingerprint(currentInput); }
  function usesAttestation(d) {
    const ev = (d.evidence || []).some(v => isAttested(v.bibliographic, 'bibliographic') || isAttested(v.expert_assessment, 'expert_assessment'));
    const rc = d.protocol_check && d.protocol_check.registry_coverage;
    return ev || !!(rc && isAttested(rc.completeness_attestation, 'registry_completeness'));
  }

  /* ---------- Механизм статусов ---------- */

  function evaluate(d, config) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, config || {});
    const errors = validate(d, cfg);
    if (errors.length) return { ok: false, errors };

    const rel = deriveRelation(d);
    const relation = rel.relation;
    const ind = d.indications.value;
    const isDeviation = relation === RELATION.DIFF || relation === RELATION.NOT_REG;
    const reasons = rel.notes.slice(), warnings = rel.warnings.slice(), recommendations = [], missing = [];

    // Полнота документации — отдельно от клинического статуса
    const required = uniq((d.required_documentation || []).concat(isDeviation
      ? ['physician_note'].concat(cfg.extra_required_documentation_for_deviation || [], cfg.consilium_mandatory ? ['consilium'] : [])
      : []));
    const absentKeys = required.filter(k => !Object.values(DOC).includes(d.documentation[k]));
    if (absentKeys.length) return { ok: false, errors: absentKeys.map(k => 'не указан результат поиска обязательной записи: ' + k) };
    const docMissing = [], docUnknown = [];
    required.forEach(k => {
      if (d.documentation[k] === DOC.FULL) docMissing.push(k);
      else if (d.documentation[k] === DOC.FRAGMENT) docUnknown.push(k);
    });
    const documentation = {
      state: !required.length ? 'не_требуется' : docMissing.length ? 'неполная' : docUnknown.length ? 'не_определена' : 'полная',
      required, missing: docMissing, unknown: docUnknown,
      missing_items: docMissing.map(k => DOC_LABEL[k]), unknown_items: docUnknown.map(k => DOC_LABEL[k])
    };

    const signals = (d.signals || []).map(s => Object.assign({}, s, { level: signalLevel(s) }));
    const urgentS = signals.filter(s => s.level === SIGNAL_LEVEL.URGENT);
    const expertS = signals.filter(s => s.level === SIGNAL_LEVEL.EXPERT);
    signals.filter(s => s.level === SIGNAL_LEVEL.WARNING)
      .forEach(s => warnings.push('предупреждение (низкая серьёзность): ' + s.kind + ' — ' + s.fact));
    const conflicts = (d.conflicts || []).slice();
    const conflict_detected = conflicts.length > 0;
    const evidence = isDeviation ? assessEvidence(d.evidence, d) : null;
    if (evidence) warnings.push.apply(warnings, evidence.warnings);

    let status;
    if (urgentS.length) {
      status = STATUS.URGENT;
      urgentS.forEach(s => reasons.push('срочный сигнал: ' + s.kind + ' (серьёзность ' + s.severity + ', уверенность ' + s.confidence + (s.confirmed ? ', подтверждён' : '') + ')'));
    } else if (conflict_detected || expertS.length) {
      status = STATUS.EXPERT;
      conflicts.forEach(c => reasons.push('противоречие: «' + c.a + '» и «' + c.b + '»'));
      expertS.forEach(s => reasons.push('сигнал для экспертной проверки: ' + s.kind + ' (серьёзность ' + s.severity + ', уверенность ' + s.confidence + ')'));
    } else {
      const ins = [];
      if (relation === RELATION.UNKNOWN) ins.push('отношение к протоколу невозможно проверить');
      if (ind === INDICATIONS.INSUFFICIENT) ins.push('показания: недостаточно данных');
      if (isDeviation && docUnknown.length) ins.push('при отклонении не найдено во фрагменте: ' + documentation.unknown_items.join(', '));
      if (ins.length) { status = STATUS.INSUFFICIENT; reasons.push.apply(reasons, ins); }
      else if (relation === RELATION.OK && ind === INDICATIONS.CONFIRMED) {
        status = STATUS.COMPLIANT; reasons.push('назначение в пределах протокола, показания подтверждены');
      } else if (isDeviation) {
        if (ind === INDICATIONS.NOT_CONFIRMED) missing.push('показания у пациента не подтверждены (проверена полная история)');
        if (!evidence.qualifies && !evidence.needs_expert.length) missing.push.apply(missing, evidence.gaps);
        documentation.missing_items.forEach(x => missing.push(x + ' — не найдено в полной истории'));
        if (missing.length) status = STATUS.INCOMPLETE;
        else if (!evidence.qualifies) { status = STATUS.EXPERT; reasons.push.apply(reasons, evidence.needs_expert); }
        else { status = STATUS.JUSTIFIED; reasons.push('показания подтверждены', 'источник прошёл библиографическую проверку и принят экспертом', 'запись врача с обоснованием найдена'); }
      } else {
        status = STATUS.INCOMPLETE;
        missing.push('показания у пациента не подтверждены (проверена полная история)');
      }
    }

    // Неподтверждённая редакция или актуальность протокола блокирует положительный вывод
    let positive_blocked = false;
    if ((status === STATUS.COMPLIANT || status === STATUS.JUSTIFIED) && rel.unconfirmed.length) {
      positive_blocked = true;
      reasons.push('предварительный вывод «' + status + '» не может быть окончательным: ' + rel.unconfirmed.join('; '));
      status = STATUS.EXPERT;
    } else if (rel.unconfirmed.length) warnings.push.apply(warnings, rel.unconfirmed);

    // Рекомендации (не влияют на статус)
    const highRisk = urgentS.length + expertS.length > 0 || (d.order && (d.order.off_label === true || d.order.high_risk === true));
    if (highRisk && d.documentation.consilium !== DOC.FOUND && !(cfg.consilium_mandatory && isDeviation))
      recommendations.push('рекомендуется консилиум (высокий риск: ' + [urgentS.length + expertS.length ? 'сигнал безопасности' : '', d.order.off_label ? 'вне инструкции' : '', d.order.high_risk ? 'отметка высокого риска' : ''].filter(Boolean).join(', ') + ')');
    if (isDeviation) ['risk_benefit', 'monitoring'].forEach(k => {
      if (!required.includes(k) && d.documentation[k] !== DOC.FOUND) recommendations.push('желательно отразить: ' + DOC_LABEL[k]);
    });

    return {
      ok: true, engine_version: VERSION, id: d.id,
      analysis_basis: ANALYSIS_BASIS, evaluated_at: new Date().toISOString(), input_fingerprint: fingerprint(d),
      test_confirmations_used: usesAttestation(d),
      status, status_set_by: 'auto', positive_blocked, blocked_by: positive_blocked ? rel.unconfirmed.slice() : [],
      headline: composeHeadline(status, documentation, positive_blocked),
      clinical: { relation, relation_source: rel.source, indications: ind, statement: rel.statement },
      documentation,
      conflict_detected, conflicts,
      safety: { signals, urgent: urgentS.length > 0 },
      evidence,
      reasons: uniq(reasons), missing: uniq(missing), recommendations, warnings: uniq(warnings),
      original: null, history: []
    };
  }

  /* ---------- Решение эксперта (журнал) ---------- */

  function applyExpertOverride(result, o) {
    const errs = [];
    if (!result || !result.ok) errs.push('нет результата проверки');
    ['who', 'status', 'reason', 'source'].forEach(k => { if (!o || !isStr(o[k])) errs.push('не указано: ' + k); });
    if (o && isStr(o.status) && !ALL_STATUSES.includes(o.status)) errs.push('неизвестный статус: ' + o.status);
    if (result && result.ok && o && o.current_input !== undefined && isStale(result, o.current_input))
      errs.push('исходные данные изменены после проверки — результат устарел, сначала выполните повторную проверку');
    if (errs.length) return { ok: false, errors: errs };
    const original = result.original || { status: result.status, status_set_by: result.status_set_by, headline: result.headline, reasons: result.reasons.slice() };
    const entry = { at: o.at || new Date().toISOString(), who: o.who, event: 'решение эксперта', from: result.status, to: o.status,
      reason: o.reason, source: o.source, test_only: true, assurance: TEST_ASSURANCE };
    return Object.assign({}, result, {
      status: o.status, status_set_by: 'expert',
      headline: composeHeadline(o.status, result.documentation, false) + ' (решение эксперта, тестовое)',
      original, history: (result.history || []).concat([entry])
    });
  }

  /* Повторная проверка после изменения данных: новый результат, история сохраняется */
  function reevaluate(prev, d, config) {
    const r = evaluate(d, config);
    if (!r.ok || !prev || !prev.ok) return r;
    const at = new Date().toISOString();
    r.prior_results = (prev.prior_results || []).concat([{ evaluated_at: prev.evaluated_at, status: prev.status,
      status_set_by: prev.status_set_by, headline: prev.headline, input_fingerprint: prev.input_fingerprint, superseded_at: at }]);
    r.history = (prev.history || []).concat([{ at, who: 'программа', event: 'повторная проверка', from: prev.status, to: r.status,
      reason: 'исходные данные изменены', source: 'автоматически' }]);
    return r;
  }

  /* Черновик обоснования: только по результату движка и введённым фактам */
  function buildJustificationDraft(d, r) {
    if (!r || !r.ok) return { ok: false, errors: ['нет результата проверки'] };
    if (isStale(r, d)) return { ok: false, errors: ['результат устарел — выполните повторную проверку'] };
    const rel = r.clinical.relation;
    const L = [];
    L.push('ТЕСТОВЫЙ ЧЕРНОВИК. Основа: ' + ANALYSIS_BASIS + '.');
    L.push('Пациенту ' + d.patient_ref + ' назначено: ' + d.order.text + (isStr(d.order.date_time) ? ' (' + d.order.date_time.replace('T', ' ') + ')' : '') + '.');
    if (rel === RELATION.NOT_REG) L.push('Результат проверки по протоколам: ' + r.clinical.statement + '.');
    else if (rel === RELATION.DIFF) L.push('Результат проверки по протоколам: назначение отличается от требования (' + r.clinical.statement + ').');
    else if (rel === RELATION.OK) L.push('Результат проверки по протоколам: назначение в пределах протокола (' + r.clinical.statement + '); обоснование отклонения не требуется.');
    else L.push('Отношение назначения к протоколу установить не удалось (' + uniq(r.reasons.filter(x => x.indexOf('отношение') >= 0 || x.indexOf('протокол') >= 0 || x.indexOf('реестр') >= 0)).join('; ') +
      '). Утверждать, что протокол данный вопрос не регулирует, на этом основании нельзя.');
    const facts = (d.indications.facts || []).map(f => f.text).filter(isStr);
    L.push('Клинические показания по данным истории: ' + (facts.length ? facts.join('; ') : '[указать по истории]') + '.');
    const ev = (d.evidence || []).filter(v => v.presented);
    L.push('Научное обоснование: ' + (ev.length ? ev.map(v => (v.citation || '') + (v.pmid ? ' (PMID ' + v.pmid + ')' : v.doi ? ' (DOI ' + v.doi + ')' : '') +
      (r.evidence ? ' — ' + ((r.evidence.items.find(x => x.source === (v.citation || v.pmid || v.doi)) || {}).verdict || 'не оценён') : '')).join('; ') : '[источник не указан]') + '.');
    const doc = k => d.documentation[k] === DOC.FOUND ? 'отражено' : (d.documentation[k] === DOC.FRAGMENT ? 'не найдено в предоставленном фрагменте' : 'не найдено в истории');
    L.push('Решение врача с обоснованием: ' + doc('physician_note') + '. Оценка пользы и рисков: ' + doc('risk_benefit') + '. Мониторинг: ' + doc('monitoring') + '.');
    if (r.status === STATUS.JUSTIFIED) L.push('По введённым данным условия обоснованного отклонения выполнены. Это не означает, что назначение доказанно правильное.');
    else {
      L.push('Предварительная оценка программы: «' + r.status + '». Обоснование пока не может считаться достаточным.');
      if (r.positive_blocked) L.push('Вывод предварительный: ' + r.blocked_by.join('; ') + '.');
      if (r.missing.length) L.push('Не хватает: ' + r.missing.join('; ') + '.');
    }
    if (rel !== RELATION.OK) L.push('Отсутствие прямой рекомендации в протоколе само по себе не является основанием для квалификации назначения как дефекта.');
    L.push('Окончательная оценка — за врачебной комиссией.');
    return { ok: true, text: L.join('\n'), cautious: r.status !== STATUS.JUSTIFIED, relation: rel };
  }

  return {
    VERSION, STATUS, AUTO_STATUSES, ALL_STATUSES, RELATION, INDICATIONS, DOC, DOC_LABEL, REGISTRY_STATUS,
    SIGNAL_KINDS, SEVERITY, CONFIDENCE, OFFICIAL_EVIDENCE, PROTOCOL_TYPES, APPLICABILITY, REGIMEN, BIB_METHODS, SIGNAL_LEVEL,
    DEFAULT_CONFIG, NOT_REG_STATEMENT, IIN_LIKE,
    validate, evaluate, applyExpertOverride, signalLevel,
    attestBibliographic, attestExpertAssessment, attestRegistryCompleteness, isAttested, loadRegistry, registryEntry,
    fingerprint, isStale, reevaluate, contextFingerprint, sourceKey, buildJustificationDraft, TEST_ASSURANCE, ANALYSIS_BASIS
  };
});
