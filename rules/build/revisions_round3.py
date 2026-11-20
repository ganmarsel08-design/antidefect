# Слой правок третьего круга (схема rules-0.3). Выполняется внутри build_rules.py после слоя этапа 6
# и после определения противоречий CF-001–CF-005 (они не меняются).
#
# Основание — решения врача Ислам М.И. от 20.11.2026 по 8 вопросам третьего круга (после заключения ChatGPT),
# ранее утверждённые решения по SEP-008 (19.11 20:01/20:06), SEP-009 (20:11), SEP-010 (21:23) и технические
# исправления Т1–Т8; разрешение на реализацию пакета в PR №7 от 20.11.2026 06:27.
#
# Изменяются только 12 правил со статусом «Изменить»: RDS-003, RDS-008, RDS-009 (ранее защищённые — строго по
# решению врача), NEC-003, NEC-004, NEC-005, NEC-008, SEP-005, SEP-006, SEP-008, SEP-009, SEP-010.
# RDS-001, RDS-002, RDS-004, RDS-005, RDS-006 и остальные 13 правил не затрагиваются.
# Ни одна блокировка не удаляется; новых — три (SEP-005-A3, SEP-006-A4, SEP-008-A3): 25 → 28.
# Новые противоречия CF-006, CF-007 — предлагаемые (решение врача), активны только при реальном расхождении.
# Вопросы Q01–Q24 не закрываются; новых нормативных порогов длительности нет (Q14 открыт).

ROUND3_CHANGED = ['RDS-003', 'RDS-008', 'RDS-009', 'NEC-003', 'NEC-004', 'NEC-005', 'NEC-008',
                  'SEP-005', 'SEP-006', 'SEP-008', 'SEP-009', 'SEP-010']
ROUND3_UNTOUCHED_PROTECTED = ['RDS-001', 'RDS-002', 'RDS-004', 'RDS-005', 'RDS-006']
ROUND3_NEW_BLOCKING = ['SEP-005-A3', 'SEP-006-A4', 'SEP-008-A3']
R3_TAG = 'rules-0.3 (третий круг, решение врача 20.11.2026)'

# ---------- словарь данных ----------
R3_DATA = {
 # входные
 'benzylpenicillin_dose_units_per_kg': ('Разовая доза бензилпенициллина в Ед/кг (хранится в исходных единицах; в мг/кг без проверенного коэффициента не пересчитывается)', 'Ед/кг', 'number', None, None),
 'pn_stopped_at': ('Время прекращения парентерального питания (одного записанного курса)', 'дата-время', 'datetime', None, None),
 # вычисляемые (engine/derive.js)
 'benzylpenicillin_text_regimen_match': ('Назначение совпадает с текстом п. 6 (25 мг/кг каждые 12 ч; 8 ч при очень тяжёлом состоянии) (вычисляется)', 'да/нет', 'derived',
     ['benzylpenicillin_dose_per_kg', 'benzylpenicillin_interval_h', 'very_severe_condition'], None),
 'benzylpenicillin_table_regimen_status': ('Сверка с таблицей препаратов стр. 18 (50 000 Ед/кг/доза каждые 8 ч): matches — совпадает, differs — отличается, not_comparable — доза не в Ед/кг, сопоставить нельзя (вычисляется)', 'значение', 'derived',
     ['benzylpenicillin_interval_h', 'benzylpenicillin_dose_units_per_kg'], ['matches', 'differs', 'not_comparable']),
 'benzylpenicillin_regimen_sources_diverge': ('Назначение соответствует одному положению протокола (текст п. 6 или таблица стр. 18) и расходится с другим либо не сопоставимо с ним (вычисляется; CF-006)', 'да/нет', 'derived',
     ['benzylpenicillin_text_regimen_match', 'benzylpenicillin_table_regimen_status'], None),
 'gentamicin_text_regimen_match': ('Назначение совпадает с текстом п. 7 (5 мг/кг; 36 ч, короче — при очень больном ребёнке с грамотрицательным посевом) (вычисляется)', 'да/нет', 'derived',
     ['gentamicin_dose_per_kg', 'gentamicin_interval_h', 'very_ill', 'gram_negative_culture'], None),
 'gentamicin_table_check_status': ('Сверка с таблицей стр. 18: checked — выполнена, no_age_data — нет ГВ или постнатального возраста, no_regimen_data — нет дозы или интервала (вычисляется)', 'значение', 'derived',
     ['gestational_age_weeks', 'postnatal_age_days', 'gentamicin_dose_per_kg', 'gentamicin_interval_h'], ['checked', 'no_age_data', 'no_regimen_data']),
 'gentamicin_table_band': ('Режим(ы) таблицы стр. 18 для ГВ и постнатального возраста ребёнка (вычисляется, показывается)', 'текст', 'derived',
     ['gestational_age_weeks', 'postnatal_age_days'], None),
 'gentamicin_table_boundary': ('Возраст на пересекающейся или неопределённой границе групп таблицы (ровно 28 сут при ГВ ≤29 нед; ровно 7 сут при ГВ 30–34 нед) (вычисляется)', 'да/нет', 'derived',
     ['gestational_age_weeks', 'postnatal_age_days'], None),
 'gentamicin_table_regimen_match': ('Назначение совпадает с режимом таблицы стр. 18 для этого ребёнка (при границе — с любым из двух) (вычисляется)', 'да/нет', 'derived',
     ['gestational_age_weeks', 'postnatal_age_days', 'gentamicin_dose_per_kg', 'gentamicin_interval_h'], None),
 'gentamicin_regimen_sources_diverge': ('Назначение соответствует одному положению протокола (текст п. 7 или таблица стр. 18) и расходится с другим (вычисляется; только при выполненной сверке с таблицей; CF-007)', 'да/нет', 'derived',
     ['gentamicin_text_regimen_match', 'gentamicin_table_regimen_match'], None),
 'nec_day_counts_disagree': ('Отсчёты «не ранее 7-го дня» от начала и от подтверждения НЭК дают разную оценку или один неизвестен (вычисляется)', 'да/нет', 'derived',
     ['nec_day_from_onset_at_feeding_resumption', 'nec_day_from_confirmation_at_feeding_resumption'], None),
 'pn_stopped_before_nec_onset': ('Записанный курс ПП прекращён до начала НЭК (вычисляется)', 'да/нет', 'derived',
     ['pn_stopped_at', 'nec_onset_at'], None),
 'intubation_needed_status': ('Интубация для стабилизации: required — потребовалась, not_required — не потребовалась, no_record — сведений нет (вычисляется; отсутствие записи ≠ «нет»)', 'значение', 'derived',
     ['intubation_needed_for_stabilization'], ['required', 'not_required', 'no_record']),
 'surfactant_fio2_indication_status': ('Самостоятельное показание по FiO₂ (ГВ <26 нед и FiO₂ >0,30; ГВ >26 нед и FiO₂ >0,40): met / not_met / unknown (вычисляется)', 'значение', 'derived',
     ['gestational_age_weeks', 'fio2'], ['met', 'not_met', 'unknown']),
 'blood_culture_before_antibiotics_resolved': ('Посев крови взят до первой дозы: ручная запись, а при её отсутствии — вычисление по отметкам забора и введения (как SEP-002); противоречие — нет данных (вычисляется)', 'да/нет', 'derived',
     ['blood_culture_before_antibiotics', 'culture_drawn_before_first_dose'], None),
 'blood_culture_before_antibiotics_basis': ('Основа значения «посев до первой дозы»: manual — ручная запись, computed — вычислено по отметкам, conflict — ручная запись противоречит отметкам (вычисляется)', 'значение', 'derived',
     ['blood_culture_before_antibiotics', 'culture_drawn_before_first_dose'], ['manual', 'computed', 'conflict']),
 'benzylpenicillin_dose_units_not_comparable': ('Назначение нельзя сопоставить с текстом п. 6 и таблицей стр. 18 из-за единиц дозы (мг/кг против Ед/кг или записаны обе без проверенного коэффициента); расхождение не установлено (вычисляется)', 'да/нет', 'derived',
     ['benzylpenicillin_dose_per_kg', 'benzylpenicillin_dose_units_per_kg', 'benzylpenicillin_interval_h', 'very_severe_condition'], None),
 'benzylpenicillin_dose_units_equivalence': ('Эквивалентность записей дозы в мг/кг и Ед/кг: «не подтверждена» — без проверенного коэффициента (вычисляется, показывается)', 'текст', 'derived',
     ['benzylpenicillin_dose_per_kg', 'benzylpenicillin_dose_units_per_kg'], None),
 'gentamicin_dose_sources_diverge': ('Часть «доза»: доза совпадает ровно с одним положением (текст п. 7 или таблица стр. 18) при установленном расхождении режима (вычисляется)', 'да/нет', 'derived',
     ['gentamicin_text_regimen_match', 'gentamicin_table_regimen_match'], None),
 'gentamicin_interval_sources_diverge': ('Часть «интервал»: интервал совпадает ровно с одним положением (текст п. 7 или таблица стр. 18) при установленном расхождении режима (вычисляется)', 'да/нет', 'derived',
     ['gentamicin_text_regimen_match', 'gentamicin_table_regimen_match'], None),
 'abx_course_hours_exact': ('Длительность курса в часах без округления — для условий (вычисляется; показывается abx_course_hours, 4 знака)', 'часы', 'derived',
     ['abx_course_started_at', 'abx_course_ended_at', 'course_completed'], None),
 'pn_stop_onset_same_time': ('Время прекращения ПП совпадает со временем начала НЭК — порядок событий не установлен (вычисляется)', 'да/нет', 'derived',
     ['pn_stopped_at', 'nec_onset_at'], None),
 'daily_clinical_exam_status': ('Ежедневный клинический осмотр при продлении: documented — документирован, not_documented — не документирован, no_record — нет записи (вычисляется)', 'значение', 'derived',
     ['daily_clinical_exam_documented'], ['documented', 'not_documented', 'no_record']),
}
for k, (desc, unit, typ, dfrom, vals) in R3_DATA.items():
    assert k not in DATA and k not in DICTIONARY, k
    DATA[k] = (desc, unit)
    e = {'description': desc, 'unit': unit, 'type': typ}
    if vals: e['values'] = vals
    if typ == 'tri': e['false_means'] = FALSE_MEANS
    if dfrom: e['derived_from'] = dfrom
    e['since'] = 'rules-0.3'
    DICTIONARY[k] = e

# ---------- помощники ----------
def r3(rid):
    assert rid in ROUND3_CHANGED, rid
    return RB[rid]
def r3_amb(rid, aid, change, **kv):
    a = [x for x in r3(rid)['ambiguities'] if x['id'] == aid]
    assert len(a) == 1, aid
    a = a[0]
    for k in ('text', 'id'): assert k not in kv, k
    a.update(kv)
    a.setdefault('round3_changes', []).append(change)
    return a
def r3_amb_new(rid, aid, text, when, part=None, parts=None):
    r = r3(rid)
    exp = f"{rid}-A{len(r['ambiguities']) + 1}"
    assert aid == exp, (aid, exp)
    a = {'id': aid, 'text': text, 'blocking': 'when', 'scope': 'requirement', 'decision_by': 'врач-эксперт', 'decision': None, 'blocks_when': when}
    if part: a['part'] = part
    if parts: a['parts'] = list(parts)
    a['added'] = R3_TAG
    r['ambiguities'].append(a)
def r3_card(rid, cid, label, when=None, quotes=(), show_when_not_applicable=False, hide_when_ambiguity=None, first=False):
    r = r3(rid)
    assert cid not in {c['id'] for c in r.get('card_labels', [])}, (rid, cid)
    c = {'id': cid, 'label': label}
    if when is not None: c['when'] = when
    if first: c['first'] = True
    if show_when_not_applicable: c['show_when_not_applicable'] = True
    if hide_when_ambiguity: c['hide_when_ambiguity'] = list(hide_when_ambiguity)
    if quotes: c['quotes'] = [CQ6(p, pg, t) for p, pg, t in quotes]
    c['added'] = R3_TAG
    r.setdefault('card_labels', []).append(c)
def r3_card_get(rid, cid):
    c = [x for x in r3(rid).get('card_labels', []) if x['id'] == cid]
    assert len(c) == 1, (rid, cid)
    return c[0]
def r3_need(rid, *fields):
    r = r3(rid)
    have = {d['field'] for d in r['required_data']}
    for f in fields:
        if f not in have: r['required_data'].append({'field': f, 'description': DATA[f][0], 'unit': DATA[f][1]})
def r3_display(rid, *fields):
    r = r3(rid)
    cur = r.setdefault('display_fields', [])
    for f in fields:
        assert f in DATA, f
        if f not in cur: cur.append(f)
def r3_quotes(rid, *qs):
    r = r3(rid)
    have = {q['text'] for q in r['source']['quotes']}
    for p, t in qs:
        assert t not in have, (rid, t)
        r['source']['quotes'].append(Q(p, t))
def r3_revise(rid, decision, basis, changes):
    r3(rid)['revision_round3'] = {'schema': 'rules-0.3', 'date': '2026-11-20', 'round3_decision': decision, 'decided_by': 'Ислам М.И. (врач-эксперт)',
                                  'basis': basis, 'changes': changes}

# Цитаты таблицы препаратов протокола сепсиса (стр. 18) — фрагменты строк таблицы в том виде, как они идут в PDF.
T_BENZ = [('sepsis', 18, 'Бензилпенициллин Сепсис'), ('sepsis', 18, 'младше 7 суток 50 000'),
          ('sepsis', 18, 'старше 7 суток 50 000 Ед/кг/доза в/в каждые 8 часов')]
X_BENZ = [('sepsis', 12, 'Бензилпенициллин назначается в дозе 25 мг/кг через каждые 12 часов.'),
          ('sepsis', 13, 'состояние ребенка оценивается очень тяжелым следует рассмотреть возможность сокращения интервала между дозами через каждые 8 часов.')]
T_GENT = [('sepsis', 18, 'Гентамицин 29 недель и меньше:'), ('sepsis', 18, '0 – 7 суток каждые 48 часов'),
          ('sepsis', 18, '8 – 28 суток каждые 36 часов по 4 мг/кг в/в 28 суток и старше каждые 24 часа по 4 мг/кг 30-34 недель: младше 7 суток каждые 36 часов по 4,5 мг/кг старше 7 суток каждые 24 часа по 4 мг/кг 35 недель и старше: каждые 24 часа по 4 мг/кг')]
X_GENT = [('sepsis', 13, 'Гентамицин вводится в начальной дозе 5 мг/кг, при этом следует помнить, что:'),
          ('sepsis', 13, 'данные, рассмотренные для руководства, поддерживают начальную дозу 5 мг/кг каждые 36 часов, вводимую однократно;')]
COURSE_DURATION = 'Длительность курса: {abx_course_days} календарных сут, {abx_course_hours} ч; первая доза — {abx_course_started_at}, последняя — {abx_course_ended_at}'

# ======================= РДС (ранее защищённые; только по решению врача) =======================
# RDS-003 — решение 6: A2 и при «сведений об интубации нет»; три состояния; другие показания сохраняются.
r3_amb('RDS-003', 'RDS-003-A2', 'blocks_when: + ветка «сведений об интубации нет» у ребёнка с РДС или риском РДС при отсутствии самостоятельного показания по FiO₂',
       blocks_when=ANY(ALL(F('antenatal_steroids_given', 'is_false'), F('intubation_needed_for_stabilization', 'is_false')),
                       ALL(ANY(F('rds_risk', 'is_true'), F('rds_diagnosed', 'is_true')),
                           F('antenatal_steroids_given', 'is_false'), F('intubation_needed_status', 'eq', 'no_record'),
                           F('surfactant_fio2_indication_status', 'in', ['not_met', 'unknown']))),
       machine_note='С rules-0.3 неоднозначность действует и тогда, когда сведений о необходимости интубации нет (отсутствие записи не считается «не потребовалась»), если нет самостоятельного показания по FiO₂.')
r3_display('RDS-003', 'intubation_needed_status', 'surfactant_fio2_indication_status')
r3_card('RDS-003', 'intubation_no_record', 'Сведений о том, потребовалась ли интубация для стабилизации, нет — отсутствие записи не считается «не потребовалась»',
        when=F('intubation_needed_status', 'eq', 'no_record'))
r3_revise('RDS-003', 'Изменить', ['решение врача 20.11.2026, п. 6', 'Т6'], ['RDS-003-A2: условие расширено на «сведений нет»', 'три состояния интубации', 'подпись карточки'])

# RDS-008 — решение 8: вычисление по отметкам при отсутствии ручного поля; ручное не перезаписывается.
RB['RDS-008']['requirement'] = {'description': RB['RDS-008']['requirement']['description'] + ' (при отсутствии ручной записи — по отметкам времени забора и введения первой дозы, как SEP-002)',
                                'check': F('blood_culture_before_antibiotics_resolved', 'is_true')}
r3_need('RDS-008', 'blood_culture_before_antibiotics_resolved')
r3_display('RDS-008', 'blood_culture_before_antibiotics', 'blood_culture_drawn_at', 'first_abx_dose_administered_at', 'culture_drawn_before_first_dose', 'blood_culture_before_antibiotics_basis')
r3_card('RDS-008', 'computed_from_timestamps', 'Ручной записи нет — значение вычислено по отметкам забора крови ({blood_culture_drawn_at}) и введения первой дозы ({first_abx_dose_administered_at}), как в SEP-002',
        when=F('blood_culture_before_antibiotics_basis', 'eq', 'computed'))
r3_card('RDS-008', 'manual_vs_timestamps_conflict', 'Ручная запись «посев до первой дозы» противоречит отметкам забора крови ({blood_culture_drawn_at}) и введения первой дозы ({first_abx_dose_administered_at}) — «Недостаточно данных», требуется пояснение эксперту',
        when=F('blood_culture_before_antibiotics_basis', 'eq', 'conflict'))
r3_revise('RDS-008', 'Изменить', ['решение врача 20.11.2026, п. 8', 'Т7'], ['проверка по blood_culture_before_antibiotics_resolved', 'вычисление по отметкам при отсутствии ручного поля', 'противоречие показывается'])

# RDS-009 — решение 5: A1 условная (доза ≠ 200 мг/кг); нет дозы — «Недостаточно данных».
r3_amb('RDS-009', 'RDS-009-A1', 'blocking: always → when (доза ≠ 200 мг/кг)', blocking='when',
       blocks_when=ANY(F('surfactant_initial_dose_mg_kg', 'lt', 200), F('surfactant_initial_dose_mg_kg', 'gt', 200)),
       machine_note='С rules-0.3 неоднозначность действует только при документированной дозе, отличной от 200 мг/кг; при дозе ровно 200 мг/кг блокировки нет; без достоверной дозы — «Недостаточно данных».')
r3_revise('RDS-009', 'Изменить', ['решение врача 20.11.2026, п. 5'], ['RDS-009-A1: постоянная → условная'])

# ======================= НЭК =======================
# NEC-003 — решение 2: A1 только для части «возобновление»; прекращение кормления проверяется самостоятельно.
r3_amb('NEC-003', 'NEC-003-A1', 'область: правило целиком → часть «resume»', part='resume')
r3_revise('NEC-003', 'Изменить', ['решение врача 20.11.2026, п. 2'], ['NEC-003-A1 ограничена частью «возобновление»'])

# NEC-004 — решение 3: A1 условная (разные оценки двух отсчётов или один неизвестен), только часть «срок».
r3_amb('NEC-004', 'NEC-004-A1', 'blocking: always → when (отсчёты расходятся); область: часть «term»', blocking='when',
       blocks_when=F('nec_day_counts_disagree', 'is_true'), part='term',
       machine_note='С rules-0.3: если отсчёты от начала заболевания и от подтверждения НЭК дают одинаковую оценку относительно 7-го дня, блокировки нет; разные оценки или один отсчёт неизвестен — неоднозначность. Улучшение — отдельная часть.')
r3_display('NEC-004', 'nec_day_counts_disagree')
r3_revise('NEC-004', 'Изменить', ['решение врача 20.11.2026, п. 3'], ['NEC-004-A1: постоянная → условная, только часть «срок»'])

# NEC-005 — решение 7: время прекращения ПП; хронология начало → прекращение → начало НЭК. Новой блокировки нет.
r3_display('NEC-005', 'pn_stopped_at', 'pn_stopped_before_nec_onset', 'pn_stop_onset_same_time')
r3_card('NEC-005', 'pn_stop_onset_same_time', 'Время прекращения ПП ({pn_stopped_at}) совпадает со временем начала НЭК — порядок событий не установлен, проводилось ли ПП на момент заболевания, не определяется',
        when=F('pn_stop_onset_same_time', 'is_true'))
r3_card('NEC-005', 'pn_stopped_before_onset', 'ПП прекращено ({pn_stopped_at}) до начала НЭК ({nec_onset_at}) — записанный курс на момент заболевания не проводился; начало нового курса не записано',
        when=F('pn_stopped_before_nec_onset', 'is_true'))
RB['NEC-005']['exceptions_and_caveats'].append('Ограничение (rules-0.3): поле pn_stopped_at описывает один записанный курс ПП; при нескольких курсах одно время прекращения не описывает все эпизоды — хронологию оценивает эксперт.')
r3_revise('NEC-005', 'Изменить', ['решение врача 20.11.2026, п. 7', 'Т8'], ['поле pn_stopped_at', 'проверка хронологии ПП'])

# NEC-008 — решение 4: A1 остаётся постоянной; показ длительности.
r3_card('NEC-008', 'course_duration', COURSE_DURATION, when=F('abx_course_hours', 'present'))
r3_display('NEC-008', 'abx_course_started_at', 'abx_course_ended_at')
RB['NEC-008']['exceptions_and_caveats'].append('Решение врача 20.11.2026: NEC-008-A1 остаётся постоянной — длительность курса не заменяет клиническую стабилизацию и восстановление функции ЖКТ. Правило для НЭК I «в течение 5 дней» (стр. 14) в пилот не добавлено — перечень будущего расширения базы.')
r3_revise('NEC-008', 'Изменить', ['решение врача 20.11.2026, п. 4'], ['показ календарных суток, часов, первой и последней дозы'])

# ======================= Сепсис =======================
# SEP-005 — решение 1: CF-006, условная SEP-005-A3, доза в Ед/кг в исходных единицах.
r3_amb_new('SEP-005', 'SEP-005-A3', 'Назначение соответствует одному положению протокола и расходится с другим либо не может быть с ним сопоставлено: текст п. 6 (стр. 12–13: 25 мг/кг каждые 12 ч, 8 ч — при очень тяжёлом состоянии) и таблица препаратов (стр. 18: сепсис — 50 000 Ед/кг/доза в/в каждые 8 часов). Доза в мг/кг и Ед/кг без проверенного коэффициента для конкретной формы препарата не пересчитывается. Какое положение применимо — решает эксперт (CF-006); до решения не выдаётся ни «совпадает», ни «отличается».',
           ANY(F('benzylpenicillin_regimen_sources_diverge', 'is_true'), F('benzylpenicillin_dose_units_not_comparable', 'is_true')))
r3_amb('SEP-005', 'SEP-005-A1', 'пояснение: таблица стр. 18 сверена в третьем круге',
       machine_note='С rules-0.3 таблица препаратов (стр. 18) сверена: бензилпенициллин при сепсисе — 50 000 Ед/кг/доза каждые 8 часов (младше и старше 7 суток); расхождение с текстом п. 6 — CF-006 и SEP-005-A3.')
r3_quotes('SEP-005', *[(p, t) for _, p, t in T_BENZ])
r3_display('SEP-005', 'benzylpenicillin_interval_h', 'very_severe_condition', 'benzylpenicillin_dose_units_per_kg', 'benzylpenicillin_text_regimen_match', 'benzylpenicillin_table_regimen_status', 'benzylpenicillin_regimen_sources_diverge',
            'benzylpenicillin_dose_units_not_comparable', 'benzylpenicillin_dose_units_equivalence')
r3_card('SEP-005', 'dose_units', 'Доза записана в Ед/кг: {benzylpenicillin_dose_units_per_kg} Ед/кг — хранится в исходных единицах; с «25 мг/кг» без проверенного коэффициента не сопоставляется',
        when=F('benzylpenicillin_dose_units_per_kg', 'present'))
r3_card('SEP-005', 'sources_diverge', 'Назначение соответствует одному положению протокола и расходится с другим (или не сопоставимо с ним): текст п. 6 (стр. 12–13) и таблица препаратов (стр. 18) — CF-006, решает эксперт',
        when=F('benzylpenicillin_regimen_sources_diverge', 'is_true'), quotes=X_BENZ + T_BENZ)
r3_card('SEP-005', 'table_not_comparable', 'Сопоставить назначение с текстом п. 6 (стр. 12–13) и таблицей препаратов (стр. 18) нельзя: доза записана в других единицах или в обеих без проверенного коэффициента — связанное противоречие CF-006; расхождение в этом случае не установлено, решает эксперт',
        when=F('benzylpenicillin_dose_units_not_comparable', 'is_true'))
r3_card('SEP-005', 'dose_units_equivalence_unverified', 'Доза записана и в мг/кг ({benzylpenicillin_dose_per_kg} мг/кг), и в Ед/кг ({benzylpenicillin_dose_units_per_kg} Ед/кг): эквивалентность записей без проверенного коэффициента не подтверждается, пересчёт не выполняется',
        when=F('benzylpenicillin_dose_units_equivalence', 'present'))
r3_revise('SEP-005', 'Изменить', ['решение врача 20.11.2026, п. 1', 'К1', 'сценарии ТАБ-B1–B5'], ['CF-006', 'SEP-005-A3 (условная)', 'поле дозы в Ед/кг'])

# SEP-006 — решение 1: CF-007, условная SEP-006-A4; все возрастные интервалы и границы 7 и 28 суток; Q24 — не при A1.
r3_amb_new('SEP-006', 'SEP-006-A4', 'Назначение соответствует одному положению протокола и расходится с другим: текст п. 7 (стр. 13: начальная доза 5 мг/кг, каждые 36 часов) и возрастные режимы таблицы препаратов (стр. 18: по гестационному и постнатальному возрасту). На пересекающейся или неопределённой границе групп таблицы (ровно 28 суток при ГВ ≤29 нед, ровно 7 суток при ГВ 30–34 нед) возможны оба соседних режима. Какое положение применимо — решает эксперт (CF-007); соответствие тексту не подтверждается автоматически, если применимая таблица даёт другой режим.',
           F('gentamicin_regimen_sources_diverge', 'is_true'), parts=['dose', 'interval'])
# Исправление после проверки (20.11.2026, п. 1): блокируется только часть, по которой расходятся положения.
RB['SEP-006']['ambiguities'][-1]['blocks_when_by_part'] = {
    'dose': ALL(F('gentamicin_regimen_sources_diverge', 'is_true'), F('gentamicin_dose_sources_diverge', 'is_true')),
    'interval': ALL(F('gentamicin_regimen_sources_diverge', 'is_true'), F('gentamicin_interval_sources_diverge', 'is_true'))}
r3_quotes('SEP-006', *[(p, t) for _, p, t in T_GENT])
r3_display('SEP-006', 'gentamicin_interval_h', 'gentamicin_text_regimen_match', 'gentamicin_table_check_status', 'gentamicin_table_band', 'gentamicin_table_boundary', 'gentamicin_table_regimen_match', 'gentamicin_regimen_sources_diverge',
            'gentamicin_dose_sources_diverge', 'gentamicin_interval_sources_diverge')
r3_card('SEP-006', 'table_band', 'Таблица препаратов (стр. 18) для ГВ {gestational_age_weeks} нед и возраста {postnatal_age_days} сут: {gentamicin_table_band}',
        when=F('gentamicin_table_band', 'present'))
r3_card('SEP-006', 'table_boundary', 'Возраст {postnatal_age_days} сут — на границе групп таблицы, где формулировки пересекаются или не определяют этот день: возможны оба режима, выбор делает эксперт',
        when=F('gentamicin_table_boundary', 'is_true'))
r3_card('SEP-006', 'table_not_checked', 'Сверка с таблицей препаратов (стр. 18) не выполнена: не указан гестационный или постнатальный возраст',
        when=F('gentamicin_table_check_status', 'eq', 'no_age_data'))
r3_card('SEP-006', 'sources_diverge', 'Назначение соответствует одному положению протокола и расходится с другим: текст п. 7 (стр. 13) и возрастной режим таблицы препаратов (стр. 18) — CF-007, решает эксперт',
        when=F('gentamicin_regimen_sources_diverge', 'is_true'), quotes=X_GENT + T_GENT)
r3_card_get('SEP-006', 'dose_q24')['hide_when_ambiguity'] = ['SEP-006-A1']
r3_revise('SEP-006', 'Изменить', ['решение врача 20.11.2026, п. 1', 'К2', 'Т5', 'сценарии ТАБ-G1–G9'], ['CF-007', 'SEP-006-A4 (условная)', 'подпись Q24 скрыта при активной SEP-006-A1'])

# SEP-008 — решение 19.11 (20:01, 20:06): SEP-008-A3; показ суток, часов и отметок.
r3_amb_new('SEP-008', 'SEP-008-A3', 'Курс завершён, длительность больше 5 календарных суток, но не больше 120 часов (время первой и последней дозы документировано): оценки по календарным суткам и по часам расходятся. Автоматического «отличается» нет — требуется экспертное решение; методика подсчёта длительности — Q14.',
           ALL(F('abx_course_days', 'gt', 5), F('abx_course_hours_exact', 'lte', 120)))
r3_display('SEP-008', 'abx_course_started_at', 'abx_course_ended_at')
r3_card('SEP-008', 'course_duration', COURSE_DURATION, when=F('abx_course_hours', 'present'))
r3_card('SEP-008', 'days_hours_diverge', 'Расхождение способов подсчёта: {abx_course_days} календарных сут, но {abx_course_hours} ч (не более 120 ч) — экспертное решение, методика — Q14',
        when=ALL(F('abx_course_days', 'gt', 5), F('abx_course_hours_exact', 'lte', 120)))
r3_revise('SEP-008', 'Изменить', ['решение врача 19.11.2026 20:01 и 20:06'], ['SEP-008-A3 (условная)', 'показ суток, часов и отметок'])

# SEP-009 — решение 19.11 (20:11): A1 без изменений; информационная подпись SEP-009-A2 без блокировки.
r3_card('SEP-009', 'a2_benzylpenicillin_info', 'Схема бензилпенициллин + гентамицин: правило машинно применяется только к ампициллину + гентамицину; распространяется ли положение на эту схему — вопрос SEP-009-A2 (информационно, без блокировки)',
        when=ALL(F('empirical_regimen', 'eq', 'benzylpenicillin+gentamicin'), F('blood_culture_result', 'eq', 'положительный')), show_when_not_applicable=True)
r3_card('SEP-009', 'course_duration', COURSE_DURATION, when=F('abx_course_hours', 'present'))
r3_display('SEP-009', 'abx_course_started_at', 'abx_course_ended_at')
r3_revise('SEP-009', 'Утвердить поведение (реализована информационная подпись)', ['решение врача 19.11.2026 20:11'], ['информационная подпись SEP-009-A2', 'показ суток, часов и отметок'])

# SEP-010 — решение 19.11 (21:23): A1 условная (положительный посев), A2 постоянная; причина и обоснование раздельно; осмотр — три состояния.
r3_amb('SEP-010', 'SEP-010-A1', 'blocking: always → when (положительный посев)', blocking='when', blocks_when=F('blood_culture_result', 'eq', 'положительный'),
       machine_note='С rules-0.3 неоднозначность 7/10 суток (CF-002) действует только при положительном посеве; A2 («ровно 7 или не более 7») остаётся постоянной.')
c = r3_card_get('SEP-010', 'extension_documented')
c['label'] = 'Указана причина продления ({extension_reason_count} из перечня стр. 15) — запись причины не доказывает обоснованность выбранной длительности'
c['round3_changes'] = ['подпись разделена: причина продления отдельно от клинического обоснования (Т2)']
r3_card('SEP-010', 'extension_justification_found', 'Клиническое обоснование продления найдено в документации — его достаточность оценивает эксперт',
        when=ALL(F('abx_course_days', 'gt', 7), F('extension_justification_status', 'eq', 'found')))
d = r3_card_get('SEP-010', 'daily_exam')
d['label'] = 'Продление более 7 суток при отрицательном посеве: ежедневный клинический осмотр (не реже 1 раза в 24 ч) — документирован'
d['when'] = ALL(F('abx_course_days', 'gt', 7), F('blood_culture_result', 'eq', 'отрицательный'), F('daily_clinical_exam_status', 'eq', 'documented'))
d['round3_changes'] = ['осмотр: три состояния (Т2)']
r3_card('SEP-010', 'daily_exam_not_documented', 'Продление более 7 суток при отрицательном посеве: ежедневный клинический осмотр (не реже 1 раза в 24 ч) — не документирован',
        when=ALL(F('abx_course_days', 'gt', 7), F('blood_culture_result', 'eq', 'отрицательный'), F('daily_clinical_exam_status', 'eq', 'not_documented')))
r3_card('SEP-010', 'daily_exam_no_record', 'Продление более 7 суток при отрицательном посеве: о ежедневном клиническом осмотре нет записи',
        when=ALL(F('abx_course_days', 'gt', 7), F('blood_culture_result', 'eq', 'отрицательный'), F('daily_clinical_exam_status', 'eq', 'no_record')))
r3_card('SEP-010', 'course_duration', COURSE_DURATION, when=F('abx_course_hours', 'present'))
r3_display('SEP-010', 'abx_course_started_at', 'abx_course_ended_at', 'daily_clinical_exam_status')
# Исправление после проверки (20.11.2026, п. 2): подписи о продлении более 7 суток — только когда больше 7 суток и по календарным
# датам, и по точным часам (> 168 ч = 7 × 24). Граница 168 ч выбирает подпись и не является нормативным порогом (Q14 открыт).
for cid in ('extension_documented', 'extension_not_found', 'extension_justification_found', 'daily_exam', 'daily_exam_not_documented', 'daily_exam_no_record'):
    cl = r3_card_get('SEP-010', cid)
    assert cl['when']['all'][0] == F('abx_course_days', 'gt', 7), cid
    cl['when']['all'].insert(1, F('abx_course_hours_exact', 'gt', 168))
    cl.setdefault('round3_changes', []).append('показ только при > 7 календарных суток и > 168 ч (исправление после проверки, п. 2)')
r3_card('SEP-010', 'counts_diverge_7', 'По календарным суткам — {abx_course_days} сут, по часам — {abx_course_hours} ч (не более 168 ч = 7 × 24): превышение 7 суток не установлено, нарушение или обоснованность продления не оцениваются — методика подсчёта, Q14',
        when=ALL(F('abx_course_days', 'gt', 7), F('abx_course_hours_exact', 'lte', 168)))
RB['SEP-010']['exceptions_and_caveats'].append('Решение врача 19.11.2026: продление более 7 суток не утверждается при расхождении календарных суток и часов до решения Q14; показываются сутки, часы, первая и последняя доза.')
r3_revise('SEP-010', 'Изменить', ['решение врача 19.11.2026 (пакет 21:23)', 'Т1', 'Т2'], ['SEP-010-A1: постоянная → условная (положительный посев)', 'причина и обоснование продления раздельно', 'осмотр: три состояния', 'подписи только при применимости (engine)'])

# ======================= Противоречия CF-006, CF-007 (предлагаемые) =======================
CONFLICTS.append({'id': 'CF-006', 'type': 'противоречие', 'rules': ['SEP-005'], 'related_rules': [],
  'description': 'Бензилпенициллин при раннем сепсисе без менингита: текст п. 6 (стр. 12–13) — 25 мг/кг каждые 12 часов (8 часов при очень тяжёлом состоянии); таблица препаратов того же протокола (стр. 18) — 50 000 Ед/кг/доза в/в каждые 8 часов. Расхождение показывается, только когда назначение соответствует одному положению и расходится с другим (или доза не сопоставима по единицам), а не при каждом назначении бензилпенициллина.',
  'active_when': F('benzylpenicillin_regimen_sources_diverge', 'is_true'),
  'quotes': [CQ(p, pg, t) for p, pg, t in X_BENZ + T_BENZ],
  'status': 'предлагаемое противоречие (решение врача 20.11.2026, п. 1); приоритет положений решает эксперт', 'added': R3_TAG})
CONFLICTS.append({'id': 'CF-007', 'type': 'противоречие', 'rules': ['SEP-006'], 'related_rules': [],
  'description': 'Гентамицин при раннем сепсисе: текст п. 7 (стр. 13) — начальная доза 5 мг/кг каждые 36 часов; таблица препаратов того же протокола (стр. 18) — режимы по гестационному и постнатальному возрасту (≤29 нед: 0–7 сут 5 мг/кг каждые 48 ч, 8–28 сут 4 мг/кг каждые 36 ч, 28 сут и старше 4 мг/кг каждые 24 ч; 30–34 нед: младше 7 сут 4,5 мг/кг каждые 36 ч, старше 7 сут 4 мг/кг каждые 24 ч; ≥35 нед 4 мг/кг каждые 24 ч). Расхождение показывается, только когда сверка с таблицей выполнена и назначение соответствует одному положению, но расходится с другим.',
  'active_when': F('gentamicin_regimen_sources_diverge', 'is_true'),
  'quotes': [CQ(p, pg, t) for p, pg, t in X_GENT + T_GENT],
  'status': 'предлагаемое противоречие (решение врача 20.11.2026, п. 1); приоритет положений решает эксперт', 'added': R3_TAG})

assert [c['id'] for c in CONFLICTS] == ['CF-001', 'CF-002', 'CF-003', 'CF-004', 'CF-005', 'CF-006', 'CF-007']
assert sorted(r['rule_id'] for r in rules if 'revision_round3' in r) == sorted(ROUND3_CHANGED)
assert sum(1 for r in rules for a in r['ambiguities'] if a.get('blocking') in ('always', 'when')) == 28
