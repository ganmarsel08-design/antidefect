/*
 * Антидефект — этап 7. Подготовка результатов движка к показу эксперту (без изменения исходов движка).
 *
 * - вызывает RulesEngine.evaluate на случае, собранном case-builder (только подтверждённые значения);
 * - делит правила на показываемые и скрытые: скрыты по умолчанию только правила НЕ отмеченных врачом
 *   протоколов, применимость которых не установлена; применимые правила любых протоколов показываются;
 * - добавляет предупреждения интерфейса о неполноте проверки (SEP-006 без постнатального возраста);
 *   исход движка при этом не переписывается;
 * - для полей с несколькими наблюдениями во времени, по которым врач ещё не выбрал значение,
 *   считает альтернативные результаты (ограничение движка: он принимает одно значение поля).
 *
 * Только синтетические данные на этапе 7.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AntidefectExpertView = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OBS = {
    'совпадает_с_буквальным_прочтением': 'соответствие',
    'отличается_от_буквального_прочтения': 'предварительное отличие',
    'не_оценено_нет_данных': 'недостаточно данных',
    'неоднозначность_ожидает_экспертного_решения': 'неоднозначность',
    'неоднозначность_маршрутизации': 'неоднозначность',
    'правило_неприменимо': 'неприменимо',
    'правило_не_используется': 'не используется',
  };
  const PREFIX = { 'РДС': 'RDS', 'НЭК': 'NEC', 'Сепсис': 'SEP' };
  const label = r => r.applicability === 'не_определено' ? 'применимость не установлена'
    : r.applicability === 'зависит_от_неоднозначности' ? 'неоднозначность (применимость)'
    : (OBS[r.observation] || r.observation);

  const SEP006_NO_AGE = 'Соответствует проверенному фрагменту текста. Возрастная таблица не проверена: отсутствует постнатальный возраст.';

  function uiWarnings(results, data, Derive) {
    const w = [];
    const r = results.find(x => x.rule_id === 'SEP-006');
    if (r && r.applicability === 'применимо') {
      const d = Derive.derive(data).data;
      if (d.gentamicin_table_check_status === 'no_age_data') w.push({ rule_id: 'SEP-006', kind: 'неполная проверка', text: SEP006_NO_AGE, engine_outcome_unchanged: true });
    }
    return w;
  }

  /**
   * view(env, built, protocols) — env = {RulesEngine, Derive, db, expertDecisions}; built = CaseBuilder.build();
   * protocols — протоколы, отмеченные врачом на экране 1 (['РДС','НЭК','Сепсис']).
   */
  function view(env, built, protocols) {
    const data = built.case.data;
    const o = env.RulesEngine.evaluate(env.db, built.case, { expert_decisions: env.expertDecisions });
    if (o.final_conclusion !== null && o.final_conclusion !== undefined) throw new Error('движок вернул окончательный вывод — недопустимо на этапе 7');
    const own = (protocols || []).map(p => PREFIX[p]).filter(Boolean);
    const rules = o.results.map(r => ({
      rule_id: r.rule_id, applicability: r.applicability, observation: r.observation, label: label(r),
      parts: (r.parts || []).map(p => ({ part_id: p.part_id, applicability: p.applicability, observation: p.observation, label: label(p) })),
      missing_data: r.missing_data || [], own_protocol: own.some(p => r.rule_id.startsWith(p)), raw: r,
    }));
    const shown = rules.filter(r => r.applicability !== 'неприменимо' && (r.own_protocol || r.applicability !== 'не_определено'));
    const hidden = rules.filter(r => r.applicability === 'не_определено' && !r.own_protocol);
    const counts = {};
    for (const r of shown) counts[r.label] = (counts[r.label] || 0) + 1;
    return {
      final_conclusion: null,
      active_conflicts: (o.conflicts || []).map(c => c.id || c),
      rules, shown, hidden, counts,
      ui_warnings: uiWarnings(o.results, data, env.Derive),
      completeness: built.completeness,
      partial: !built.completeness.complete,
    };
  }

  /**
   * Альтернативные результаты для полей с несколькими наблюдениями во времени, по которым нет выбора врача.
   * Возвращает [{field, variants:[{value, at|date, fragment, changed:[{rule_id,label,base_label}]}]}].
   * Базовый результат — без этого поля (оно не передаётся, пока врач не выбрал значение).
   */
  function timelineAlternatives(env, session, CaseBuilder, protocols) {
    const out = [];
    const base = view(env, CaseBuilder.build(session), protocols);
    for (const it of session.items) {
      const c = it.candidate;
      if (!Array.isArray(c.timeline) || 'value' in c || it.choice || it.status === CaseBuilder.STATUS.REJECTED) continue;
      const variants = c.timeline.map(t => {
        const b = CaseBuilder.build(session);
        b.case.data[c.field] = t.v;
        const v = view(env, b, protocols);
        const changed = v.rules.filter(r => { const o = base.rules.find(x => x.rule_id === r.rule_id); return o && o.label !== r.label; })
          .map(r => ({ rule_id: r.rule_id, label: r.label, base_label: base.rules.find(x => x.rule_id === r.rule_id).label }));
        return { value: t.v, at: t.at, date: t.date, fragment: t.fragment.text, changed, active_conflicts: v.active_conflicts };
      });
      out.push({ field: c.field, candidate_id: c.id, limitation: 'Движок принимает одно значение поля; наблюдения во времени сохраняются, выбор делает врач.', variants });
    }
    return out;
  }

  return { view, timelineAlternatives, label, SEP006_NO_AGE, OBS };
}));
