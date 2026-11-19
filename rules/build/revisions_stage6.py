# Слой правок этапа 6 (схема rules-0.2). Выполняется внутри build_rules.py после блокировок этапа 5.
#
# Основание каждой правки — итоговое ТЗ «Антидефект» от 19.11.2026 (второй круг экспертизы) и уточнения C1–C7:
#   17 «Утвердить» (план Claude без изменений): RDS-007, RDS-010, NEC-002…007, NEC-009, SEP-001, SEP-002, SEP-004…009;
#   5 «Изменить» (редакция врача, §3 ТЗ): NEC-001, NEC-008, NEC-010, SEP-003, SEP-010;
#   C1 — NEC-010-A4; C2 — SEP-003-A2 на два случая; C3 — «Курс продолжается…»; C4 — подписи SEP-010; C5 — CF-001 без изменений.
# Восемь подтверждённых правил (RDS-001–006, RDS-008, RDS-009) здесь не упоминаются и не изменяются.
# Неоднозначности этапа 5 не перенумеровываются и не удаляются; их blocking/scope/blocks_when не меняются.
# Клинические вопросы Q01–Q23 этим слоем не решаются.

CONFIRMED_UNCHANGED = ['RDS-001', 'RDS-002', 'RDS-003', 'RDS-004', 'RDS-005', 'RDS-006', 'RDS-008', 'RDS-009']
NEW_BLOCKING = ['RDS-007-A2', 'RDS-010-A2', 'NEC-005-A1', 'NEC-006-A2', 'NEC-009-A1', 'NEC-010-A4', 'SEP-003-A2', 'SEP-006-A3']

# ---------- словарь данных: тип каждого поля ----------
# tri — да/нет/нет данных (false — только документированное «нет»); enum — значения; number; text;
# datetime — отметка с датой, временем и часовым поясом; list — список записей; object; derived — вычисляет engine/derive.js.
NEW_DATA = {
 # хронология и события (M2)
 'sbi_excluded_at':('Время, когда тяжёлая бактериальная инфекция исключена (запись врача)','дата-время'),
 'antibiotics_stopped_at':('Время отмены антибактериальной терапии','дата-время'),
 'abx_decision_justification':('Обоснование начала или неначала АБТ (текст записи)','текст'),
 'local_abx_protocol_ref':('Ссылка на протокол антибиотикотерапии отделения','текст'),
 'hours_sbi_excluded_to_abx_stop':('Часов от исключения ТБИ до отмены АБТ (вычисляется)','часы'),
 'abx_stopped_after_sbi_exclusion':('АБТ отменена позже исключения ТБИ (вычисляется)','да/нет'),
 'blood_gases':('Газы крови за время ИВЛ: {drawn_at, paco2_mmhg, ph}','список'),
 'paco2_hypocapnia_threshold':('Порог PaCO₂ для гипокапнии, принятый в отделении (протокол порог не задаёт)','мм рт. ст.'),
 'threshold_source':('Источник порога PaCO₂ (документ, пункт)','текст'),
 'vent_changes':('Изменения настроек ИВЛ: {at, parameter, from, to}','список'),
 'blood_gas_count':('Число анализов газов крови с PaCO₂ (вычисляется)','число'),
 'hypocapnia_episode_count':('Число анализов с PaCO₂ ниже порога из источника (вычисляется)','число'),
 'minutes_hypocapnia_to_vent_change':('Минут от первого эпизода гипокапнии до первого изменения ИВЛ (вычисляется)','минуты'),
 'nec_suspected_at':('Время возникновения подозрения на НЭК','дата-время'),
 'feeding_at_nec_suspicion':('Энтеральное питание на момент подозрения: active — проводилось, already_stopped — уже не проводилось','значение'),
 'feeding_stopped_before_suspicion_at':('Когда питание было прекращено до подозрения (если известно)','дата-время'),
 'enteral_feeding_stopped_at':('Время прекращения энтерального кормления после подозрения','дата-время'),
 'ng_tube_present_at_suspicion':('Назогастральный зонд уже стоял на момент подозрения','да/нет'),
 'ng_tube_functioning_at_suspicion':('Стоящий зонд исправно функционировал на момент подозрения','да/нет'),
 'ng_tube_placed':('Назогастральный зонд установлен после подозрения','да/нет'),
 'ng_tube_placed_at':('Время установки назогастрального зонда','дата-время'),
 'ng_tube_size_f':('Размер зонда (показывается, не проверяется)','F'),
 'ng_decompression_documented':('Документирована декомпрессия через зонд (показывается)','да/нет'),
 'minutes_suspicion_to_feeding_stop':('Минут от подозрения до прекращения кормления (вычисляется, показывается)','минуты'),
 'minutes_suspicion_to_ng_tube':('Минут от подозрения до установки зонда (вычисляется, показывается)','минуты'),
 'uvc_present':('На момент подозрения стоял пупочный венозный катетер (ПВК)','да/нет'),
 'uvc_removed':('ПВК удалён','да/нет'),
 'uvc_removed_at':('Время удаления ПВК','дата-время'),
 'uac_present':('На момент подозрения стоял пупочный артериальный катетер (ПАК)','да/нет'),
 'uac_removed':('ПАК удалён','да/нет'),
 'uac_removed_at':('Время удаления ПАК','дата-время'),
 'alternative_access_available':('Был ли другой сосудистый доступ','да/нет'),
 'retention_reason':('Причина сохранения катетера (текст записи)','текст'),
 'replacement_plan':('План замены доступа (текст записи)','текст'),
 'nec_onset_at':('Время начала заболевания (НЭК)','дата-время'),
 'nec_confirmed_at':('Время подтверждения диагноза НЭК','дата-время'),
 'nec_diagnosed_at':('Время установленного диагноза НЭК (для отсчёта рентгенологического контроля)','дата-время'),
 'gi_passage_restored_at':('Время восстановления пассажа по ЖКТ','дата-время'),
 'improvement_signs':('Признаки улучшения (стр. 12): '+', '.join(['abdomen_not_distended_not_tender','no_pathological_gastric_residuals','ileus_resolved','spontaneous_stool','labs_normalized','no_us_bowel_wall_inflammation','no_ascites','peristalsis_restored'])+' — да/нет каждый','объект'),
 'enteral_feeding_resumed_at':('Время возобновления энтеральной нагрузки','дата-время'),
 'feeding_decision_documented':('Решение о возобновлении нагрузки записано','да/нет'),
 'nec_day_from_onset_at_feeding_resumption':('День заболевания (от начала) при возобновлении нагрузки; 1 — день начала (вычисляется)','сутки'),
 'nec_day_from_confirmation_at_feeding_resumption':('День от подтверждения НЭК при возобновлении нагрузки; 1 — день подтверждения (вычисляется)','сутки'),
 'feeding_resumed_after_passage_restored':('Нагрузка возобновлена не раньше восстановления пассажа (вычисляется)','да/нет'),
 'improvement_achieved':('Отмечены все признаки улучшения со стр. 12 (вычисляется; любой «нет» → нет)','да/нет'),
 'improvement_signs_documented_count':('Число отмеченных признаков улучшения (вычисляется)','число'),
 'pn_running_at_nec_onset':('Полное ПП уже проводилось на момент начала НЭК','да/нет'),
 'pn_started_at':('Время начала полного парентерального питания','дата-время'),
 'pn_type':('Вид ПП: full — полное, partial — частичное (например, без липидов), glucose_only — только глюкоза','значение'),
 'pn_start_illness_day':('День заболевания, в который начато ПП; 1 — день начала НЭК (вычисляется)','сутки'),
 'xrays':('Рентгенограммы: {at, position: horizontal/vertical/lateral, reason: planned/urgent, result}','список'),
 'deterioration_at':('Время клинического ухудшения','дата-время'),
 'xray_count':('Число рентгенограмм с полной отметкой времени (вычисляется)','число'),
 'hours_diagnosis_to_first_xray':('Часов от диагноза до первого снимка (вычисляется)','часы'),
 'max_hours_between_xrays':('Наибольший интервал между снимками после диагноза (вычисляется)','часы'),
 'xray_vertical_or_lateral_after_deterioration':('После ухудшения был снимок вертикально или в латеропозиции (вычисляется)','да/нет'),
 'abx_regimen':('Полная схема антибактериальной терапии (список препаратов)','список'),
 'metronidazole_given_at':('Время первой дозы метронидазола','дата-время'),
 'other_antianaerobic_drug':('Иной антианаэробный препарат вместо метронидазола','текст'),
 'microbiology_considered':('Учтены результаты посевов и госпитальная флора (запись)','да/нет'),
 'clinical_pharmacologist_involved':('Участие клинического фармаколога (показывается; Q23)','да/нет'),
 'abx_course_started_at':('Время первой дозы курса АБТ','дата-время'),
 'abx_course_ended_at':('Время последней дозы курса АБТ','дата-время'),
 'course_completed':('Курс АБТ завершён','да/нет'),
 'drug_changes':('Смены препарата в курсе: {at, from, to} (курс не перезапускают)','список'),
 'interruptions':('Перерывы в курсе: {from, to} (показываются; Q14)','список'),
 'stabilization_documented':('Устойчивая стабилизация клинико-лабораторного статуса документирована','да/нет'),
 'gi_function_restored':('Функция ЖКТ восстановлена','да/нет'),
 'abx_course_days':('Длительность курса в календарных сутках от первой до последней дозы (вычисляется; только для завершённого курса; Q14)','сутки'),
 'abx_course_hours':('Длительность курса в часах (вычисляется, показывается)','часы'),
 'abx_drug_change_count':('Число смен препарата (вычисляется)','число'),
 'abx_interruption_count':('Число перерывов (вычисляется)','число'),
 'surgeon_consult_status':('Консультация хирурга: done — проведена, documented_not_done — записано, что не проводилась, no_record — записи нет','значение'),
 'surgeon_consult_at':('Время консультации хирурга','дата-время'),
 'surgeon_consult_format':('Формат консультации: in_person — очно, remote — дистанционно','значение'),
 'surgeon_conclusion':('Заключение хирурга (текст)','текст'),
 'surgeon_recommendations':('Рекомендации хирурга (текст)','текст'),
 'routing_decision':('Решение о дальнейшей маршрутизации (текст)','текст'),
 'in_facility_with_neonatal_surgical_beds':('В организации есть неонатальные хирургические койки (сам по себе не доказывает перевод)','да/нет'),
 'surgical_department_available':('В организации есть неонатальная (детская) хирургическая служба','да/нет'),
 'current_department':('Фактическое отделение пребывания: nicu — ОРИТН, neonatal_surgery — хирургическое отделение, other','значение'),
 'surgeon_following':('Ребёнок наблюдается/ведётся хирургом','да/нет'),
 'transfer_type':('Перевод: intra_facility — внутрибольничный, inter_facility — межбольничный, not_indicated_or_deferred — не показан/отложен','значение'),
 'transfer_destination':('Куда переведён / планируется перевод','текст'),
 'transfer_decision_at':('Время решения о переводе','дата-время'),
 'transferred_at':('Время перевода','дата-время'),
 'transport_stable':('Ребёнок транспортабелен','да/нет'),
 'transport_contraindications_documented':('Противопоказания к транспортировке документированы','да/нет'),
 'surgical_bed_available':('Хирургическая койка доступна','да/нет'),
 'transfer_delay_reason':('Причина задержки перевода (текст)','текст'),
 'transfer_justification':('Обоснование решения о переводе/отсрочке (текст)','текст'),
 'reassessment_plan':('План повторной оценки (текст)','текст'),
 'surgical_consilium_decision':('Решение хирурга/консилиума о маршрутизации (текст)','текст'),
 'hours_transfer_decision_to_transfer':('Часов от решения до перевода (вычисляется, показывается)','часы'),
 'sepsis_indication_identified_at':('Время выявления показания к АБТ','дата-время'),
 'indication_event_type':('Событие, от которого отмечено показание (признак «Красного флага», факторы риска, решение врача и т. п.)','текст'),
 'first_abx_dose_ordered_at':('Время назначения первой дозы антибиотика','дата-время'),
 'first_abx_dose_administered_at':('Время фактического введения первой дозы антибиотика','дата-время'),
 'minutes_indication_to_first_dose':('Минут от выявления показания до введения первой дозы (вычисляется)','минуты'),
 'blood_culture_drawn_at':('Время забора крови на посев','дата-время'),
 'culture_result_at':('Время получения результата посева (не время забора)','дата-время'),
 'sample_volume_ml':('Объём крови на посев (показывается; Q20)','мл'),
 'sample_site':('Место забора: separate_vein / umbilical_vein / infusion_catheter / other (показывается; Q20)','значение'),
 'culture_drawn_before_first_dose':('Кровь на посев взята раньше введения первой дозы (вычисляется)','да/нет'),
 'immunoglobulin_purpose':('Цель введения ИГ: sepsis_treatment_or_prophylaxis — лечение/профилактика сепсиса, other_indication — другое самостоятельное показание','значение'),
 'immunoglobulin_use_type':('Вид назначения ИГ при сепсисе: routine — рутинное, individualized — индивидуальное','значение'),
 'immunoglobulin_indication_text':('Показание к ИГ (текст записи)','текст'),
 'indication_source':('Источник показания (документ)','текст'),
 'clinical_evidence':('Особое клиническое основание (текст записи)','текст'),
 'consilium_documented':('Решение консилиума о назначении ИГ документировано','да/нет'),
 'research_reference':('Ссылка на научную публикацию / иной документ','текст'),
 'evidence_applicability_review':('Оценка применимости источника (заполняет эксперт)','текст'),
 'ig_special_basis_documented':('Документировано особое клиническое основание: консилиум или текст основания (вычисляется)','да/нет'),
 'ig_use_individualized_with_basis':('Индивидуальное назначение ИГ с документированным особым основанием (вычисляется)','да/нет'),
 'initial_empirical_regimen':('Первичная эмпирическая схема: benzylpenicillin+gentamicin / ampicillin+gentamicin / другое','значение'),
 'drug_availability':('Наличие препаратов: {drug, available, checked_at, source}','список'),
 'local_antibiogram_ref':('Ссылка на местную антибиотикограмму','текст'),
 'prior_abx':('Предшествующая АБТ (текст)','текст'),
 'weight_kg':('Масса тела на дату назначения','кг'),
 'weight_date':('Дата измерения массы','дата'),
 'benzylpenicillin_dose_mg':('Разовая доза бензилпенициллина','мг'),
 'local_practice_ref':('Ссылка на местную практику / СОП (показывается; не заменяет протокол)','текст'),
 'benzylpenicillin_dose_per_kg':('Доза бензилпенициллина на кг: из мг и массы, иначе записанная в мг/кг (вычисляется)','мг/кг'),
 'gentamicin_dose_mg':('Начальная доза гентамицина','мг'),
 'postnatal_age_days':('Постнатальный возраст','сутки'),
 'creatinine_umol_l':('Креатинин (показывается)','мкмоль/л'),
 'urine_output_ml_kg_h':('Диурез (показывается)','мл/кг/ч'),
 'gentamicin_level':('Концентрация гентамицина в крови, если определялась (показывается; п. 7d)','мг/л'),
 'gram_negative_culture':('Посев показывает грамотрицательную инфекцию','да/нет'),
 'very_ill':('Ребёнок выглядит очень больным (оценка врача, п. 7c)','да/нет'),
 'gentamicin_dose_per_kg':('Начальная доза гентамицина на кг: из мг и массы, иначе записанная в мг/кг (вычисляется)','мг/кг'),
 'crp_samples':('Анализы СРБ: {drawn_at, purpose: baseline/control, result_at}','список'),
 'hours_first_dose_to_control_crp':('Часов от первой введённой дозы до забора контрольного СРБ (вычисляется)','часы'),
 'sepsis_onset':('Начало сепсиса: early — ранний (РНС), late — поздний (ПНС)','значение'),
 'abx_review_36_48h_documented':('Запись о пересмотре АБТ через 36/48 ч (показывается; Q21)','да/нет'),
 'crp_trend':('Динамика СРБ (текст)','текст'),
 'pct_trend':('Динамика ПКТ (текст)','текст'),
 'pathogen':('Возбудитель (показывается)','текст'),
 'infection_focus':('Очаг инфекции (показывается)','текст'),
 'extension_reason':('Причины продления более 7 дней (стр. 15): not_fully_recovered, pathogen_identified, nec, osteomyelitis, catheter_associated_infection, other','список'),
 'extension_justification_status':('Обоснование продления в доступной документации: found — найдено, not_found_in_documentation — не найдено','значение'),
 'daily_clinical_exam_documented':('Клинический осмотр не реже 1 раза в 24 ч при продлении документирован','да/нет'),
 'disease_stage_dynamics':('Стадия и динамика заболевания (текст)','текст'),
 'extension_reason_count':('Число записанных причин продления из перечня стр. 15 (вычисляется)','число'),
}
for k, v in NEW_DATA.items():
    assert k not in DATA, k
    DATA[k] = v

ENUM_VALUES = {
 'nec_stage': ['1а', '1б', '2а', '2б', '3а', '3б'], 'facility_level': [1, 2, 3],
 'empirical_regimen': ['benzylpenicillin+gentamicin', 'ampicillin+gentamicin', 'другое'],
 'initial_empirical_regimen': ['benzylpenicillin+gentamicin', 'ampicillin+gentamicin', 'другое'],
 'blood_culture_result': ['положительный', 'отрицательный'],
 'feeding_at_nec_suspicion': ['active', 'already_stopped', 'unknown'],
 'pn_type': ['full', 'partial', 'glucose_only', 'unknown'],
 'surgeon_consult_status': ['done', 'documented_not_done', 'no_record'],
 'surgeon_consult_format': ['in_person', 'remote', 'unknown'],
 'current_department': ['nicu', 'neonatal_surgery', 'other', 'unknown'],
 'transfer_type': ['intra_facility', 'inter_facility', 'not_indicated_or_deferred', 'unknown'],
 'sample_site': ['separate_vein', 'umbilical_vein', 'infusion_catheter', 'other', 'unknown'],
 'immunoglobulin_purpose': ['sepsis_treatment_or_prophylaxis', 'other_indication', 'unknown'],
 'immunoglobulin_use_type': ['routine', 'individualized', 'unknown'],
 'sepsis_onset': ['early', 'late', 'unknown'],
 'extension_justification_status': ['found', 'not_found_in_documentation', 'unknown'],
}
TEXT_FIELDS = {'surfactant_drug', 'abx_decision_justification', 'local_abx_protocol_ref', 'threshold_source', 'retention_reason', 'replacement_plan',
 'other_antianaerobic_drug', 'surgeon_conclusion', 'surgeon_recommendations', 'routing_decision', 'transfer_destination', 'transfer_delay_reason',
 'transfer_justification', 'reassessment_plan', 'surgical_consilium_decision', 'indication_event_type', 'immunoglobulin_indication_text',
 'indication_source', 'clinical_evidence', 'research_reference', 'evidence_applicability_review', 'local_antibiogram_ref', 'prior_abx',
 'local_practice_ref', 'crp_trend', 'pct_trend', 'pathogen', 'infection_focus', 'disease_stage_dynamics'}
LIST_FIELDS = {'blood_gases', 'vent_changes', 'xrays', 'abx_regimen', 'drug_changes', 'interruptions', 'drug_availability', 'crp_samples', 'extension_reason'}
DERIVED_FROM = {
 'hours_sbi_excluded_to_abx_stop': ['sbi_excluded_at', 'antibiotics_stopped_at'],
 'abx_stopped_after_sbi_exclusion': ['sbi_excluded_at', 'antibiotics_stopped_at'],
 'blood_gas_count': ['blood_gases'],
 'hypocapnia_episode_count': ['blood_gases', 'paco2_hypocapnia_threshold', 'threshold_source'],
 'minutes_hypocapnia_to_vent_change': ['blood_gases', 'paco2_hypocapnia_threshold', 'threshold_source', 'vent_changes'],
 'minutes_suspicion_to_feeding_stop': ['nec_suspected_at', 'enteral_feeding_stopped_at'],
 'minutes_suspicion_to_ng_tube': ['nec_suspected_at', 'ng_tube_placed_at'],
 'nec_day_from_onset_at_feeding_resumption': ['nec_onset_at', 'enteral_feeding_resumed_at'],
 'nec_day_from_confirmation_at_feeding_resumption': ['nec_confirmed_at', 'enteral_feeding_resumed_at'],
 'feeding_resumed_after_passage_restored': ['enteral_feeding_resumed_at', 'gi_passage_restored', 'gi_passage_restored_at'],
 'improvement_achieved': ['improvement_signs'], 'improvement_signs_documented_count': ['improvement_signs'],
 'pn_start_illness_day': ['nec_onset_at', 'pn_started_at'],
 'xray_count': ['xrays'], 'hours_diagnosis_to_first_xray': ['nec_diagnosed_at', 'xrays'], 'max_hours_between_xrays': ['nec_diagnosed_at', 'xrays'],
 'xray_vertical_or_lateral_after_deterioration': ['deterioration_at', 'xrays'],
 'abx_course_days': ['abx_course_started_at', 'abx_course_ended_at', 'course_completed'],
 'abx_course_hours': ['abx_course_started_at', 'abx_course_ended_at', 'course_completed'],
 'abx_drug_change_count': ['drug_changes'], 'abx_interruption_count': ['interruptions'],
 'extension_reason_count': ['extension_reason'],
 'hours_transfer_decision_to_transfer': ['transfer_decision_at', 'transferred_at'],
 'minutes_indication_to_first_dose': ['sepsis_indication_identified_at', 'first_abx_dose_ordered_at', 'first_abx_dose_administered_at'],
 'culture_drawn_before_first_dose': ['blood_culture_drawn_at', 'first_abx_dose_administered_at', 'culture_result_at'],
 'ig_special_basis_documented': ['consilium_documented', 'clinical_evidence'],
 'ig_use_individualized_with_basis': ['immunoglobulin_use_type', 'consilium_documented', 'clinical_evidence'],
 'benzylpenicillin_dose_per_kg': ['benzylpenicillin_dose_mg', 'weight_kg', 'benzylpenicillin_dose_mg_kg'],
 'gentamicin_dose_per_kg': ['gentamicin_dose_mg', 'weight_kg', 'gentamicin_initial_dose_mg_kg'],
 'hours_first_dose_to_control_crp': ['first_abx_dose_administered_at', 'crp_samples'],
}
FALSE_MEANS = 'только документированное «нет»; отсутствие записи или «unknown» — нет данных'

def field_type(k, unit):
    if k in DERIVED_FROM: return 'derived'
    if k in ENUM_VALUES: return 'enum'
    if k in LIST_FIELDS: return 'list'
    if k == 'improvement_signs': return 'object'
    if k in TEXT_FIELDS: return 'text'
    if unit == 'дата-время': return 'datetime'
    if unit == 'дата': return 'date'
    if unit == 'да/нет': return 'tri'
    return 'number'

# Поля этапа 5, которые исправленные правила больше не читают (поле остаётся в словаре; подтверждённые правила не затронуты).
SUPERSEDED = {
 'antibiotics_start_minutes': ['sepsis_indication_identified_at', 'first_abx_dose_administered_at'],
 'crp_18_24h_after_start': ['first_abx_dose_administered_at', 'crp_samples'],
 'antibiotic_days': ['abx_course_started_at', 'abx_course_ended_at', 'course_completed'],
 'hypocapnia_documented': ['blood_gases', 'paco2_hypocapnia_threshold', 'threshold_source'],
 'umbilical_catheter_present': ['uvc_present', 'uac_present'],
 'umbilical_catheter_removed': ['uvc_removed', 'uac_removed'],
 'ng_tube_decompression': ['ng_tube_present_at_suspicion', 'ng_tube_functioning_at_suspicion', 'ng_tube_placed'],
 'enteral_feeding_resumed_day': ['nec_onset_at', 'nec_confirmed_at', 'enteral_feeding_resumed_at'],
 'parenteral_nutrition_started_day': ['nec_onset_at', 'pn_started_at', 'pn_running_at_nec_onset', 'pn_type'],
 'xray_48h_after_diagnosis': ['nec_diagnosed_at', 'xrays'],
 'xray_vertical_or_lateral_at_deterioration': ['deterioration_at', 'xrays'],
 'surgeon_consulted': ['surgeon_consult_status', 'surgeon_consult_format'],
 'immunoglobulin_indication_documented': ['immunoglobulin_purpose', 'immunoglobulin_use_type'],
}
DICTIONARY = {}
for k, (desc, unit) in DATA.items():
    e = {'description': desc, 'unit': unit, 'type': field_type(k, unit)}
    if k in ENUM_VALUES: e['values'] = ENUM_VALUES[k]
    if e['type'] == 'tri': e['false_means'] = FALSE_MEANS
    if k in DERIVED_FROM: e['derived_from'] = DERIVED_FROM[k]
    if k not in NEW_DATA: e['since'] = 'rules-0.1'
    if k in SUPERSEDED: e['superseded_in_revised_rules_by'] = SUPERSEDED[k]
    DICTIONARY[k] = e

# ---------- помощники правок ----------
def Q(page, text): return {'page': page, 'text': text, 'sha256': hashlib.sha256(norm_text(text).encode()).hexdigest()}
def CQ6(prot, page, text): return {'protocol': prot, 'page': page, 'text': text, 'sha256': hashlib.sha256(norm_text(text).encode()).hexdigest()}
def rule(rid):
    assert rid not in CONFIRMED_UNCHANGED, rid
    return RB[rid]
def add_quotes(rid, *qs):
    r = rule(rid)
    have = {q['text'] for q in r['source']['quotes']}
    for p, t in qs:
        assert t not in have, (rid, t)
        r['source']['quotes'].append(Q(p, t))
def need_more(rid, *fields):
    r = rule(rid)
    have = {d['field'] for d in r['required_data']}
    for f in fields:
        if f not in have: r['required_data'].append({'field': f, 'description': DATA[f][0], 'unit': DATA[f][1]})
def display(rid, *fields):
    for f in fields: assert f in DATA, f
    rule(rid)['display_fields'] = list(fields)
def amb_set(rid, aid, **kv):
    a = [x for x in rule(rid)['ambiguities'] if x['id'] == aid]
    assert len(a) == 1, aid
    a = a[0]
    for k in ('blocking', 'scope', 'blocks_when', 'text', 'id'): assert k not in kv, k
    a.update(kv)
def amb_new(rid, aid, text, blocking, scope='requirement', when=None, part=None, parts=None, by_part=None):
    r = rule(rid)
    exp = f"{rid}-A{len(r['ambiguities']) + 1}"
    assert aid == exp, (aid, exp)
    a = {'id': aid, 'text': text, 'blocking': blocking, 'scope': scope, 'decision_by': 'врач-эксперт', 'decision': None}
    if when is not None: a['blocks_when'] = when
    if part is not None: a['part'] = part
    if parts is not None: a['parts'] = parts
    if by_part is not None: a['blocks_when_by_part'] = by_part
    a['added'] = 'rules-0.2 (этап 6)'
    r['ambiguities'].append(a)
def card(rid, cid, label, when=None, first=False, quotes=()):
    c = {'id': cid, 'label': label}
    if when is not None: c['when'] = when
    if first: c['first'] = True
    if quotes: c['quotes'] = [CQ6(p, pg, t) for p, pg, t in quotes]
    rule(rid).setdefault('card_labels', []).append(c)
def part(pid, desc, check, app=None):
    p = {'part_id': pid, 'description': desc}
    if app is not None: p['applicability'] = {'description': app[0], 'condition': app[1]}
    p['check'] = check
    return p
def requirement(rid, desc, check=None, parts=None):
    assert (check is None) != (parts is None)
    rule(rid)['requirement'] = {'description': desc, 'check': check} if parts is None else {'description': desc, 'parts': parts}
def applicability(rid, desc, cond):
    rule(rid)['applicability'] = {'description': desc, 'condition': cond}
def revise(rid, decision, basis, models):
    rule(rid)['revision'] = {'schema': 'rules-0.2', 'date': '2026-11-19', 'round2_decision': decision, 'basis': basis, 'model_changes': models}

COURSE_RUNNING = 'Курс продолжается. Окончательная длительность пока не оценивается'
EXT_DOCUMENTED = 'Продление документировано. Требуется экспертная оценка клинического обоснования'
EXT_NOT_FOUND = 'Обоснование не найдено в доступной документации'
COURSE_FIELDS = ['abx_course_started_at', 'abx_course_ended_at', 'course_completed', 'abx_course_days']
COURSE_DISPLAY = ['abx_course_hours', 'drug_changes', 'interruptions', 'abx_drug_change_count', 'abx_interruption_count']

# ======================= РДС =======================
# RDS-007 — «Утвердить»: две части; RDS-007-A1 относится к части «начало» (условие её применения совпадает
# с прежним условием правила, поэтому A1 действует ровно там же); новая RDS-007-A2 — часть «отмена».
applicability('RDS-007', 'диагноз РДС', F('rds_diagnosed', 'is_true'))
requirement('RDS-007', 'а) АБТ начата, пока ТБИ не исключена; б) после исключения ТБИ АБТ прекращена как можно быстрее', parts=[
  part('start', 'Начало АБТ, пока тяжёлая бактериальная инфекция не исключена', F('antibiotics_started', 'is_true'),
       ('ТБИ не исключена', F('serious_bacterial_infection_excluded', 'is_false'))),
  part('stop', 'Прекращение АБТ после исключения ТБИ «как можно быстрее» (число часов протокол не задаёт; интервал показывается)',
       F('abx_stopped_after_sbi_exclusion', 'is_false'),
       ('АБТ начата и ТБИ исключена', ALL(F('antibiotics_started', 'is_true'), F('serious_bacterial_infection_excluded', 'is_true')))),
])
amb_set('RDS-007', 'RDS-007-A1', part='start')
amb_new('RDS-007', 'RDS-007-A2', '«Прекратить как можно быстрее, как только будет исключена реализация ТБИ» (стр. 9) не задано во времени: допустимую задержку отмены после исключения ТБИ определяет эксперт (Q10). Интервал показывается в карточке.',
        'when', when=F('abx_stopped_after_sbi_exclusion', 'is_true'), part='stop')
add_quotes('RDS-007', (9, 'В каждом неонатальном отделении должны разрабатываться собственные протоколы по использованию антибиотиков, основанных на анализе спектра возбудителей, вызывающих ранний сепсис;'))
need_more('RDS-007', 'sbi_excluded_at', 'antibiotics_stopped_at', 'abx_stopped_after_sbi_exclusion')
display('RDS-007', 'hours_sbi_excluded_to_abx_stop', 'red_flag_count', 'risk_factor_or_sign_count', 'abx_decision_justification', 'local_abx_protocol_ref')
revise('RDS-007', 'Утвердить', ['ТЗ §4.1', 'план 22 правил: RDS-007'], ['M1', 'M2', 'M4'])

# RDS-010 — «Утвердить»: три части; эпизод гипокапнии сам по себе не даёт «отличается» (новая RDS-010-A2).
requirement('RDS-010', 'а) газы крови за время ИВЛ есть; б) гипокапния определена по порогу PaCO₂ из указанного источника; в) реакция врача на эпизод гипокапнии', parts=[
  part('gases', 'Газы крови за время ИВЛ есть (нет ни одного анализа — нет данных, а не «совпадает»)', F('blood_gas_count', 'gte', 1)),
  part('hypocapnia', 'Наличие гипокапнии определено по порогу PaCO₂ из указанного источника (порог в протоколе не задан и не придумывается)', F('hypocapnia_episode_count', 'gte', 0)),
  part('response', 'Реакция врача на эпизод гипокапнии: динамика PaCO₂ и изменения настроек ИВЛ', F('minutes_hypocapnia_to_vent_change', 'gte', 0),
       ('был эпизод гипокапнии', F('hypocapnia_episode_count', 'gte', 1))),
])
amb_set('RDS-010', 'RDS-010-A1', machine_note='С rules-0.2 порог берётся только из поля paco2_hypocapnia_threshold с указанным источником threshold_source; без источника — «Недостаточно данных» (Q11).')
amb_new('RDS-010', 'RDS-010-A2', 'Что считать «не избежали гипокапнии» — единичный эпизод, его длительность или отсутствие коррекции ИВЛ — протокол не определяет (Q11). Эпизод показывается эксперту вместе с динамикой PaCO₂ и изменениями ИВЛ; сам по себе он не даёт «отличается».',
        'always', part='response')
add_quotes('RDS-010', (8, 'Настройки МВ должны чаще регулироваться для обеспечения оптимального объема легких;'),
           (8, 'необходимо пошагово изменять PEEP с оценкой уровней FiO2, CO2 и наблюдения за механикой дыхания.'))
need_more('RDS-010', 'blood_gases', 'paco2_hypocapnia_threshold', 'threshold_source', 'vent_changes', 'blood_gas_count', 'hypocapnia_episode_count', 'minutes_hypocapnia_to_vent_change')
display('RDS-010', 'blood_gases', 'vent_changes')
rule('RDS-010')['exceptions_and_caveats'].append('Цитаты о регулировке настроек МВ и пошаговом изменении PEEP (стр. 8) — контекст для оценки реакции врача, не отдельные требования.')
revise('RDS-010', 'Утвердить', ['ТЗ §4.2', 'план 22 правил: RDS-010'], ['M1', 'M2', 'M3'])

# ======================= НЭК =======================
# NEC-001 — «Изменить» (§3.1): статус на момент подозрения; повторное прекращение питания и повторная установка зонда не требуются.
requirement('NEC-001', 'а) энтеральное кормление не проводится после подозрения (прекращено или уже не проводилось); б) действует назогастральный зонд для декомпрессии (установлен или исправный зонд уже стоял)', parts=[
  part('feeding', 'Кормление прекращено при подозрении, либо на момент подозрения уже не проводилось (повторного «прекращения» не требуется)',
       ANY(F('feeding_at_nec_suspicion', 'eq', 'already_stopped'), ALL(F('feeding_at_nec_suspicion', 'eq', 'active'), F('enteral_feeding_stopped', 'is_true')))),
  part('ng_tube', 'Назогастральный зонд установлен, либо исправный зонд уже стоял на момент подозрения (повторной установки не требуется)',
       ANY(ALL(F('ng_tube_present_at_suspicion', 'is_true'), F('ng_tube_functioning_at_suspicion', 'is_true')), F('ng_tube_placed', 'is_true'))),
])
need_more('NEC-001', 'feeding_at_nec_suspicion', 'ng_tube_present_at_suspicion', 'ng_tube_functioning_at_suspicion', 'ng_tube_placed', 'nec_suspected_at', 'enteral_feeding_stopped_at', 'ng_tube_placed_at')
display('NEC-001', 'feeding_stopped_before_suspicion_at', 'minutes_suspicion_to_feeding_stop', 'minutes_suspicion_to_ng_tube', 'ng_tube_size_f', 'ng_decompression_documented')
rule('NEC-001')['exceptions_and_caveats'].append('Редакция врача (19.11.2026): на момент подозрения ребёнок мог уже не получать энтеральное питание, а зонд мог уже стоять и исправно работать — оценивается статус на момент подозрения.')
revise('NEC-001', 'Изменить', ['ТЗ §3.1'], ['M1', 'M2', 'M3'])

# NEC-002 — «Утвердить»: ПВК и ПАК раздельно.
applicability('NEC-002', 'подозрение на НЭК при стоящем пупочном венозном или артериальном катетере',
              ALL(F('nec_suspected', 'is_true'), ANY(F('uvc_present', 'is_true'), F('uac_present', 'is_true'))))
requirement('NEC-002', 'удалены стоявшие пупочный венозный (ПВК) и артериальный (ПАК) катетеры', parts=[
  part('uvc', 'ПВК удалён', F('uvc_removed', 'is_true'), ('стоял ПВК', F('uvc_present', 'is_true'))),
  part('uac', 'ПАК удалён', F('uac_removed', 'is_true'), ('стоял ПАК', F('uac_present', 'is_true'))),
])
need_more('NEC-002', 'uvc_present', 'uvc_removed', 'uac_present', 'uac_removed')
display('NEC-002', 'uvc_removed_at', 'uac_removed_at', 'alternative_access_available', 'retention_reason', 'replacement_plan')
revise('NEC-002', 'Утвердить', ['ТЗ §4.3', 'план 22 правил: NEC-002'], ['M1', 'M2', 'M4'])

SIGNS_Q = (12, 'признаки улучшения - нет вздутия и болезненности живота, отсутствие патологического отделяемого из желудка, разрешение пареза кишечника, появление самостоятельного стула, нормализация лабораторных показателей, отсутствие УЗИ-признаков активного воспаления кишечной стенки, асцита, восстановление перистальтики кишечника;')
# NEC-003 — «Утвердить»: прекращение и возобновление раздельно; NEC-003-A1 остаётся «всегда» (Q22 открыт).
requirement('NEC-003', 'а) энтеральная нагрузка исключена; б) возобновление — не раньше восстановления пассажа', parts=[
  part('stop', 'Энтеральная нагрузка исключена до восстановления пассажа', F('enteral_feeding_stopped', 'is_true')),
  part('resume', 'Возобновление нагрузки не раньше восстановления функции пассажа', F('feeding_resumed_after_passage_restored', 'is_true'),
       ('нагрузка возобновлялась', F('enteral_feeding_resumed_at', 'present'))),
])
add_quotes('NEC-003', SIGNS_Q)
need_more('NEC-003', 'enteral_feeding_resumed_at', 'feeding_resumed_after_passage_restored')
display('NEC-003', 'nec_onset_at', 'gi_passage_restored_at', 'improvement_signs', 'improvement_achieved', 'improvement_signs_documented_count',
        'nec_day_from_onset_at_feeding_resumption', 'feeding_decision_documented')
card('NEC-003', 'no_improvement', 'Признаков улучшения (стр. 12) нет', when=F('improvement_achieved', 'is_false'))
revise('NEC-003', 'Утвердить', ['ТЗ §4.4', 'план 22 правил: NEC-003'], ['M2'])

# NEC-004 — «Утвердить»: два отсчёта (от начала и от подтверждения) рядом; признаки улучшения — отдельная часть.
requirement('NEC-004', 'а) возобновление нагрузки не ранее 7-го дня — оба отсчёта (от начала заболевания и от подтверждения НЭК); б) при достижении клинико-лабораторного улучшения', parts=[
  part('term', 'Не ранее 7-го дня: показываются оба отсчёта, один не подменяет другой',
       ALL(F('nec_day_from_onset_at_feeding_resumption', 'gte', 7), F('nec_day_from_confirmation_at_feeding_resumption', 'gte', 7))),
  part('improvement', 'Возобновление при клинико-лабораторном улучшении (признаки — стр. 12; машинно: отмечены все признаки)', F('improvement_achieved', 'is_true')),
])
amb_set('NEC-004', 'NEC-004-A1', machine_note='С rules-0.2 день считается программой по отметкам nec_onset_at и nec_confirmed_at (календарные дни, 1 — день события); показываются оба отсчёта.')
add_quotes('NEC-004', SIGNS_Q)
need_more('NEC-004', 'nec_onset_at', 'nec_confirmed_at', 'enteral_feeding_resumed_at', 'nec_day_from_onset_at_feeding_resumption', 'nec_day_from_confirmation_at_feeding_resumption', 'improvement_signs', 'improvement_achieved')
display('NEC-004', 'improvement_signs_documented_count')
card('NEC-004', 'no_improvement', 'Признаков улучшения (стр. 12) нет', when=F('improvement_achieved', 'is_false'))
revise('NEC-004', 'Утвердить', ['ТЗ §4.5', 'план 22 правил: NEC-004'], ['M2'])

# NEC-005 — «Утвердить»: ПП уже шло или начато в 1-й день; только полное ПП; частичное — новая NEC-005-A1.
requirement('NEC-005', 'полное ПП уже проводилось на момент начала НЭК или начато в 1-й день заболевания (инфузия только глюкозы — не ПП)',
            check=ALL(F('pn_type', 'eq', 'full'), ANY(F('pn_running_at_nec_onset', 'is_true'), F('pn_start_illness_day', 'lte', 1))))
amb_new('NEC-005', 'NEC-005-A1', 'Считать ли началом ПП частичное парентеральное питание (например, без липидов): протокол говорит о «полном парентеральном питании» (стр. 11) — решает эксперт (Q12).',
        'when', when=F('pn_type', 'eq', 'partial'))
add_quotes('NEC-005', (11, 'полное парентеральное питание из расчета физиологической потребности ребенка данного веса и срока гестации согласно протоколу парентерального питания;'))
need_more('NEC-005', 'pn_type', 'pn_running_at_nec_onset', 'pn_start_illness_day', 'nec_onset_at', 'pn_started_at')
revise('NEC-005', 'Утвердить', ['ТЗ §4.6', 'план 22 правил: NEC-005'], ['M2', 'M4'])

# NEC-006 — «Утвердить»: три части; ургентный снимок раньше 48 ч не даёт нарушения (новая NEC-006-A2).
requirement('NEC-006', 'а) первый контроль через 48 ч после диагноза; б) далее 1 раз в неделю; в) при ухудшении — вертикально или латеропозиция', parts=[
  part('first_48h', 'Первый рентгенологический контроль «через 48 часов после установленного диагноза» (часы — от диагноза до первого снимка)', F('hours_diagnosis_to_first_xray', 'gte', 0)),
  part('weekly', 'Далее 1 раз в неделю: интервал между снимками не более 7 суток', F('max_hours_between_xrays', 'lte', 168),
       ('после диагноза не менее двух снимков', F('xray_count', 'gte', 2))),
  part('deterioration', 'При клиническом ухудшении — снимок в вертикальном положении или латеропозиции', F('xray_vertical_or_lateral_after_deterioration', 'is_true'),
       ('клиническое ухудшение', F('clinical_deterioration', 'is_true'))),
])
amb_new('NEC-006', 'NEC-006-A2', '«Через 48 часов» — допустимое окно протокол не указывает; заменяет ли ургентный снимок раньше 48 ч плановый контроль — решает эксперт (Q13). Снимок раньше 48 ч не считается отличием.',
        'when', when=F('xray_count', 'gte', 1), part='first_48h')
need_more('NEC-006', 'nec_diagnosed_at', 'xrays', 'deterioration_at', 'xray_count', 'hours_diagnosis_to_first_xray', 'max_hours_between_xrays', 'xray_vertical_or_lateral_after_deterioration')
rule('NEC-006')['exceptions_and_caveats'].append('Ограничения позиционирования ребёнка — обоснование отклонения для эксперта, а не автоматическое исключение.')
revise('NEC-006', 'Утвердить', ['ТЗ §4.7', 'план 22 правил: NEC-006'], ['M1', 'M2'])

# NEC-007 — «Утвердить»: проверка прежняя; в карточке — вся схема и контекст.
add_quotes('NEC-007', (13, 'комбинация препаратов должна охватывать весь спектр микроорганизмов, поскольку в развитии НЭК чаще всего участвует их ассоциация'),
           (13, 'при назначении препаратов следует учитывать результаты микробиологических посевов, а также типичную для отделения госпитальную микрофлору;'),
           (13, 'контроль эффективности подобранной комбинации антибактериальных препаратов проводят через 48-72 часа после начала терапии с последующим продолжением или сменой;'))
display('NEC-007', 'abx_regimen', 'metronidazole_given_at', 'other_antianaerobic_drug', 'microbiology_considered', 'clinical_pharmacologist_involved')
rule('NEC-007')['exceptions_and_caveats'].append('Иной антианаэробный препарат вместо метронидазола — «отличается» с обоснованием для эксперта, а не «совпадает».')
revise('NEC-007', 'Утвердить', ['ТЗ §4.8', 'план 22 правил: NEC-007'], ['M4'])

# NEC-008 — «Изменить» (§3.2) + C3: только завершённый курс; идущий курс — подпись первой строкой, исход прежний.
requirement('NEC-008', 'АБТ не менее 10 суток — длительность завершённого курса от первой до последней дозы эпизода (смена препарата курс не перезапускает)',
            check=F('abx_course_days', 'gte', 10))
need_more('NEC-008', *COURSE_FIELDS)
display('NEC-008', *COURSE_DISPLAY, 'stabilization_documented', 'gi_function_restored')
card('NEC-008', 'course_running', COURSE_RUNNING, when=F('course_completed', 'is_false'), first=True)
card('NEC-008', 'drug_change', 'Смена препарата курс не перезапускает: длительность — от первой до последней дозы эпизода', when=F('abx_drug_change_count', 'gte', 1))
card('NEC-008', 'interruptions', 'В курсе есть перерывы — они показаны; начинает ли перерыв новый курс, решает эксперт (Q14)', when=F('abx_interruption_count', 'gte', 1))
add_quotes('NEC-008', (13, 'контроль эффективности подобранной комбинации антибактериальных препаратов проводят через 48-72 часа после начала терапии с последующим продолжением или сменой;'))
revise('NEC-008', 'Изменить', ['ТЗ §3.2', 'C3'], ['M2'])

# NEC-009 — «Утвердить»: статус консультации из трёх значений; дистанционная — новая NEC-009-A1.
requirement('NEC-009', 'консультация хирурга проведена', check=F('surgeon_consult_status', 'eq', 'done'))
amb_new('NEC-009', 'NEC-009-A1', 'Засчитывается ли дистанционная (телемедицинская) консультация хирурга как «обеспечить консультацию хирурга» — протокол формат не уточняет (Q15).',
        'when', when=F('surgeon_consult_format', 'eq', 'remote'))
need_more('NEC-009', 'surgeon_consult_status', 'surgeon_consult_format')
display('NEC-009', 'surgeon_consult_at', 'surgeon_conclusion', 'surgeon_recommendations', 'routing_decision')
revise('NEC-009', 'Утвердить', ['ТЗ §4.9', 'план 22 правил: NEC-009'], ['M3'])

# NEC-010 — «Изменить» (§3.3) + C1: признак учреждения не даёт «неприменимо»; ОРИТН в организации с хирургией — NEC-010-A4.
requirement('NEC-010', 'ребёнок находится в хирургическом отделении (неонатальные хирургические койки) или переведён в него',
            check=ANY(F('current_department', 'eq', 'neonatal_surgery'), F('transferred_to_surgery', 'is_true')))
amb_new('NEC-010', 'NEC-010-A4', 'Ребёнок в ОРИТН медицинской организации, где есть неонатальная хирургическая служба: наличие хирургических коек не доказывает выполненный перевод, а отсутствие внутрибольничного перевода не является автоматическим дефектом. Хирургическую маршрутизацию (хирургическое наблюдение, решение консилиума, транспортабельность, план) оценивает эксперт (Q06, Q16).',
        'when', when=ALL(F('surgical_department_available', 'is_true'), F('current_department', 'eq', 'nicu')))
need_more('NEC-010', 'current_department', 'surgical_department_available')
display('NEC-010', 'in_facility_with_neonatal_surgical_beds', 'surgeon_following', 'surgical_consilium_decision', 'transfer_type', 'transfer_destination',
        'transfer_decision_at', 'transferred_at', 'hours_transfer_decision_to_transfer', 'transport_stable', 'transport_contraindications_documented',
        'surgical_bed_available', 'transfer_delay_reason', 'transfer_justification', 'reassessment_plan', 'facility_level')
card('NEC-010', 'not_transportable', 'Документирована нетранспортабельность: причина, решение хирурга/консилиума, план повторной оценки и маршрут — эксперту; задержка перевода не является автоматическим дефектом',
     when=ANY(F('transport_stable', 'is_false'), F('transport_contraindications_documented', 'is_true')))
card('NEC-010', 'level1_context', 'Контекст: для организации I уровня протокол отдельно требует экстренного перевода в организацию 3-го уровня — в пилот как отдельное правило не добавлено',
     when=F('facility_level', 'eq', 1),
     quotes=[('nek', 12, 'В случае выявления больного ребенка с НЭК 1-2а степени в родовспомогательном учреждении первого уровня– обеспечить экстренный перевод в родовспомогательную организацию 3-го уровня;')])
rule('NEC-010')['exceptions_and_caveats'].append('Редакция врача (19.11.2026): нахождение в ОРИТН центра, где есть хирургические койки, не равнозначно нахождению в хирургическом отделении; обязательность конкретного перевода не выводится до решения Q06/Q16.')
revise('NEC-010', 'Изменить', ['ТЗ §3.3', 'C1', 'C5'], ['M2', 'M4'])

# ======================= Сепсис =======================
# SEP-001 — «Утвердить»: интервал по отметкам — от выявления показания до ФАКТИЧЕСКОГО введения; A1/A2 без изменений (Q09).
requirement('SEP-001', 'первая доза антибиотика введена в течение 60 минут от выявления показания (интервал вычисляется по отметкам)',
            check=ALL(F('antibiotics_started', 'is_true'), F('minutes_indication_to_first_dose', 'lte', 60)))
need_more('SEP-001', 'minutes_indication_to_first_dose', 'sepsis_indication_identified_at', 'first_abx_dose_administered_at')
display('SEP-001', 'indication_event_type', 'first_abx_dose_ordered_at')
revise('SEP-001', 'Утвердить', ['ТЗ §4.10', 'план 22 правил: SEP-001'], ['M2'])

# SEP-002 — «Утвердить»: время забора против времени введения первой дозы; качество забора — показывается (Q20).
requirement('SEP-002', 'кровь на посев взята до введения первой дозы антибиотика (сравниваются время забора и время введения)',
            check=F('culture_drawn_before_first_dose', 'is_true'))
add_quotes('SEP-002', (6, 'достаточное количество крови (не менее 1 мл); забор крови проводится из отдельной вены, избегать забора крови на посев из вены пуповины; не брать кровь на посев из катетера, который используется для инфузии или введения медикаментов;'))
need_more('SEP-002', 'culture_drawn_before_first_dose', 'blood_culture_drawn_at', 'first_abx_dose_administered_at')
display('SEP-002', 'culture_result_at', 'sample_volume_ml', 'sample_site')
rule('SEP-002')['exceptions_and_caveats'].append('Качество забора (не менее 1 мл, отдельная вена, не из вены пуповины и не из инфузионного катетера) показывается в карточке и не проверяется до решения Q20; повторный посев при каждой смене АБТ не вводится (Q01).')
revise('SEP-002', 'Утвердить', ['ТЗ §4.11', 'план 22 правил: SEP-002'], ['M2'])

# SEP-003 — «Изменить» (§3.4) + C2: рутинно → отличается; индивидуально с основанием или иное показание → SEP-003-A2; цель неизвестна → нет данных.
requirement('SEP-003', 'иммуноглобулин не применяется рутинно для лечения/профилактики сепсиса: индивидуальное назначение с документированным особым основанием или иное самостоятельное показание передаются эксперту',
            check=ANY(F('immunoglobulin_purpose', 'eq', 'other_indication'),
                      ALL(F('immunoglobulin_purpose', 'eq', 'sepsis_treatment_or_prophylaxis'), F('ig_use_individualized_with_basis', 'is_true'))))
amb_new('SEP-003', 'SEP-003-A2', 'Нерутинное применение иммуноглобулина — индивидуальное назначение при сепсисе по документированному особому клиническому основанию (консилиум, проверяемая публикация) или назначение по другому самостоятельному показанию — п. 18 не регламентирует: обоснованность и применимый источник оценивает эксперт (Q19). Публикация или запись показания сами по себе не дают «совпадает».',
        'when', when=ANY(F('immunoglobulin_purpose', 'eq', 'other_indication'),
                         ALL(F('immunoglobulin_purpose', 'eq', 'sepsis_treatment_or_prophylaxis'), F('ig_use_individualized_with_basis', 'is_true'))))
need_more('SEP-003', 'immunoglobulin_purpose', 'immunoglobulin_use_type', 'ig_use_individualized_with_basis')
display('SEP-003', 'immunoglobulin_indication_text', 'indication_source', 'clinical_evidence', 'consilium_documented', 'research_reference', 'evidence_applicability_review', 'ig_special_basis_documented')
rule('SEP-003')['exceptions_and_caveats'].append('Редакция врача (19.11.2026): пункт говорит о нерекомендованности РУТИННОГО применения, а не об абсолютном запрете любого введения; индивидуальное назначение автоматически «соответствующим» не объявляется.')
revise('SEP-003', 'Изменить', ['ТЗ §3.4', 'C2'], ['M4'])

# SEP-004 — «Утвердить»: первичная эмпирическая схема; наличие препарата — отдельное поле и категория обоснования.
requirement('SEP-004', 'первичная эмпирическая схема: бензилпенициллин/ампициллин + гентамицин (последующая коррекция по чувствительности отличием не считается)',
            check=F('initial_empirical_regimen', 'in', ['benzylpenicillin+gentamicin', 'ampicillin+gentamicin']))
add_quotes('SEP-004', (12, 'При эмпирической антибактериальной терапии назначается комбинация антибиотиков узкого спектра действия, эффективных как против грамотрицательных, так и против грамположительных бактерий.'),
           (13, 'При бактериологическом подтверждении сепсиса, вызванного грамотрицательными бактериями, следует бензилпенициллин заменить на антибиотик, чувствительный к выделенному возбудителю сепсиса.'))
need_more('SEP-004', 'initial_empirical_regimen')
display('SEP-004', 'drug_availability', 'local_antibiogram_ref', 'prior_abx', 'empirical_regimen')
rule('SEP-004')['exceptions_and_caveats'].append('Отсутствие препарата в отделении — категория обоснования (что, когда проверено, кто подтвердил, источник); альтернатива остаётся «отличается» с обоснованием, а не «совпадает» (Q02).')
revise('SEP-004', 'Утвердить', ['ТЗ §4.12', 'план 22 правил: SEP-004'], ['M4', 'M6'])

MENINGITIS_Q = (15, 'Продолжительность лечения неонатального сепсиса при подозрении или подтвержденном менингите у детей с ранним и поздним началом сепсиса')
# SEP-005 — «Утвердить»: менингит исключён из применения; доза — из мг и массы.
applicability('SEP-005', 'назначен бензилпенициллин при подозрении на ранний сепсис без менингита',
              ALL(F('early_onset_sepsis_suspected', 'is_true'), F('benzylpenicillin_given', 'is_true'), F('meningitis', 'is_false')))
requirement('SEP-005', '25 мг/кг (доза на кг — из мг и массы на дату назначения); интервал 12 ч (8 ч — если состояние очень тяжёлое)',
            check=ALL(F('benzylpenicillin_dose_per_kg', 'eq', 25), ANY(F('benzylpenicillin_interval_h', 'eq', 12), ALL(F('very_severe_condition', 'is_true'), F('benzylpenicillin_interval_h', 'eq', 8)))))
add_quotes('SEP-005', MENINGITIS_Q, (16, 'бензилпенициллин 50 мг/кг каждые 12 часов, обычно в течение не менее 14 дней'))
need_more('SEP-005', 'meningitis', 'benzylpenicillin_dose_per_kg', 'benzylpenicillin_dose_mg', 'weight_kg')
display('SEP-005', 'weight_date', 'local_practice_ref')
rule('SEP-005')['exceptions_and_caveats'].append('Местная практика 50 мг/кг каждые 12 ч при раннем сепсисе без менингита — «отличается» с обоснованием «местная практика»; норма 25 мг/кг не подменяется, назначений программа не делает (Q03).')
revise('SEP-005', 'Утвердить', ['ТЗ §4.13', 'план 22 правил: SEP-005'], ['M2', 'M4', 'M6'])

# SEP-006 — «Утвердить»: доза и интервал раздельно; п. 7a против п. 7b — новая SEP-006-A3 (своё условие для каждой части).
requirement('SEP-006', 'а) начальная доза 5 мг/кг; б) вторая доза через 36 ч (короче — если ребёнок очень болен и посев грамотрицательный)', parts=[
  part('dose', 'Начальная доза 5 мг/кг (п. 7, 7b)', F('gentamicin_dose_per_kg', 'eq', 5)),
  part('interval', 'Интервал 36 ч; короче — при «очень больном» ребёнке с грамотрицательным посевом (п. 7c)',
       ANY(F('gentamicin_interval_h', 'eq', 36), ALL(F('gentamicin_interval_h', 'lt', 36), F('very_ill', 'is_true'), F('gram_negative_culture', 'is_true')))),
])
amb_new('SEP-006', 'SEP-006-A3', 'П. 7a («от 4 до 7 мг/кг/день, вводимая в разовой дозе») и п. 7b («5 мг/кг каждые 36 часов») расходятся: доза 4–7 мг/кг, отличная от 5, и интервал 24 ч без условий п. 7c не одобряются и не объявляются отличием — решает эксперт (Q04, Q17).',
        'when', parts=['dose', 'interval'],
        by_part={'dose': ANY(ALL(F('gentamicin_dose_per_kg', 'gte', 4), F('gentamicin_dose_per_kg', 'lt', 5)), ALL(F('gentamicin_dose_per_kg', 'gt', 5), F('gentamicin_dose_per_kg', 'lte', 7))),
                 'interval': ALL(F('gentamicin_interval_h', 'eq', 24), ANY(F('very_ill', 'is_false'), F('gram_negative_culture', 'is_false')))})
add_quotes('SEP-006', (13, 'в перечне характеристик препарата рекомендуется дозировка от 4 до 7 мг/кг/день, вводимая в разовой дозе;'),
           (13, 'при принятии решения о последующем режиме дозирования гентамицина необходимо учитывать его концентрацию в крови (при наличии возможности).'))
need_more('SEP-006', 'gentamicin_dose_per_kg', 'gentamicin_dose_mg', 'weight_kg', 'gentamicin_interval_h', 'very_ill', 'gram_negative_culture')
display('SEP-006', 'gestational_age_weeks', 'postnatal_age_days', 'creatinine_umol_l', 'urine_output_ml_kg_h', 'gentamicin_level')
rule('SEP-006')['exceptions_and_caveats'].append('Местная схема «4 мг/кг 1 раз в сутки независимо от гестационного возраста» автоматически не легализуется и не становится назначением: обе части дают неоднозначность SEP-006-A3 (Q04).')
revise('SEP-006', 'Утвердить', ['ТЗ §4.14', 'план 22 правил: SEP-006'], ['M1', 'M4', 'M6'])

# SEP-007 — «Утвердить»: от фактической первой дозы до ЗАБОРА контрольного СРБ (не результата); 18–24 ч включительно.
requirement('SEP-007', 'контрольный СРБ взят через 18–24 ч (включительно) после введения первой дозы', check=ALL(F('hours_first_dose_to_control_crp', 'gte', 18), F('hours_first_dose_to_control_crp', 'lte', 24)))
need_more('SEP-007', 'hours_first_dose_to_control_crp', 'first_abx_dose_administered_at', 'crp_samples')
rule('SEP-007')['exceptions_and_caveats'].append('«Начало антибактериальной терапии» машинно — фактическое введение первой дозы; это рабочее толкование, вопрос Q18 открыт.')
revise('SEP-007', 'Утвердить', ['ТЗ §4.15', 'план 22 правил: SEP-007'], ['M2'])

Q_36_48 = (15, 'через 36/48 часов от начала антибактериальной терапии следует рассмотреть возможность прекращения введения антибиотиков, если:')
Q_INITIAL_RISK = (15, 'Следует оценить возможность прекращения эмпирической антибактериальной терапии после 36/48 часов с учетом: уровня первоначального риска реализации инфекции;')
# SEP-008 — «Утвердить»: 3–5 суток; ранняя отмена при условиях стр. 15 отличием не считается; пересмотр 36/48 ч — показывается (Q21).
requirement('SEP-008', 'терапия прекращена не позднее 5 суток (раньше 3 суток — допустимо при условиях стр. 15; длительность — по отметкам курса)', check=F('abx_course_days', 'lte', 5))
add_quotes('SEP-008', (14, 'Решения через 36 часов у новорожденных с РНС и через 48 часов у новорожденных с ПНС'),
           (15, 'посев крови отрицательный; клиническое состояние ребенка удовлетворительное, клинические признаки возможной инфекции отсутствуют; уровни и тенденции концентрации С-реактивного белка, ПКТ не превышают нормальные показатели.'),
           (13, 'Оценка результатов лечения антибиотиками проводится после трех дней'))
need_more('SEP-008', *COURSE_FIELDS)
display('SEP-008', 'sepsis_onset', 'abx_review_36_48h_documented', 'crp_trend', 'pct_trend', *COURSE_DISPLAY)
card('SEP-008', 'review_36_48', 'Пересмотр через 36 ч (ранний сепсис) / 48 ч (поздний) показывается; неотмена на этих сроках отличием не считается, наличие записи о пересмотре не проверяется (Q21)',
     when=F('sepsis_onset', 'in', ['early', 'late']))
revise('SEP-008', 'Утвердить', ['ТЗ §4.16', 'план 22 правил: SEP-008'], ['M1', 'M2'])

# SEP-009 — «Утвердить»: менингит исключён из применения; A1 и CF-002 без изменений (Q05).
applicability('SEP-009', 'схема ампициллин + гентамицин; улучшение при положительном посеве; нет менингита',
              ALL(F('antibiotics_started', 'is_true'), F('empirical_regimen', 'eq', 'ampicillin+gentamicin'), F('improving', 'is_true'), F('blood_culture_result', 'eq', 'положительный'), F('meningitis', 'is_false')))
requirement('SEP-009', 'длительность 10 суток (по отметкам завершённого курса)', check=F('abx_course_days', 'gte', 10))
add_quotes('SEP-009', MENINGITIS_Q)
need_more('SEP-009', 'meningitis', *COURSE_FIELDS)
display('SEP-009', 'pathogen', 'infection_focus', *COURSE_DISPLAY)
revise('SEP-009', 'Утвердить', ['ТЗ §4.17', 'план 22 правил: SEP-009'], ['M2'])

# SEP-010 — «Изменить» (§3.5) + C3 + C4: подписи карточки; A1/A2 «всегда» и CF-002 без изменений; SEP-010-A4 и CF-006 не добавляются.
requirement('SEP-010', 'длительность 7 суток (по отметкам завершённого курса)', check=F('abx_course_days', 'eq', 7))
add_quotes('SEP-010', (15, 'ребенок еще не полностью выздоровел или целесообразность продолжения обусловлена идентификацией возбудителя при бактериологическом исследовании крови'),
           (15, 'требуется более длительное лечение из-за наличия сопутствующей патологии, такой как некротизирующий энтероколит, остеомиелит или катетер - ассоциированная инфекция'),
           (15, 'При продолжении антибиотикотерапии более 7 дней, несмотря на отрицательный результат посева крови, следует проводить клиническое обследование ребенка не реже одного раза каждые 24 часа.'))
need_more('SEP-010', *COURSE_FIELDS)
display('SEP-010', 'extension_reason', 'extension_reason_count', 'extension_justification_status', 'daily_clinical_exam_documented', 'disease_stage_dynamics', *COURSE_DISPLAY)
card('SEP-010', 'course_running', COURSE_RUNNING, when=F('course_completed', 'is_false'), first=True)
card('SEP-010', 'extension_documented', EXT_DOCUMENTED, when=ALL(F('abx_course_days', 'gt', 7), F('extension_reason_count', 'gte', 1)))
card('SEP-010', 'extension_not_found', EXT_NOT_FOUND, when=ALL(F('abx_course_days', 'gt', 7), F('extension_justification_status', 'eq', 'not_found_in_documentation')))
card('SEP-010', 'daily_exam', 'Продление более 7 суток при отрицательном посеве: показано, документирован ли клинический осмотр не реже 1 раза в 24 ч',
     when=ALL(F('abx_course_days', 'gt', 7), F('blood_culture_result', 'eq', 'отрицательный')))
card('SEP-010', 'shorter_than_7', 'Курс короче 7 суток: протокол допускает решение о прекращении через 36/48 ч с учётом уровня первоначального риска (стр. 15) — показывается эксперту',
     when=F('abx_course_days', 'lt', 7), quotes=[('sepsis',) + Q_36_48, ('sepsis',) + Q_INITIAL_RISK])
rule('SEP-010')['exceptions_and_caveats'].append('Редакция врача (19.11.2026): запись о причине продления не равна доказанной обоснованности выбранной длительности; отсутствие текста обоснования в доступных материалах — «Обоснование не найдено в доступной документации», а не «показаний не было».')
revise('SEP-010', 'Изменить', ['ТЗ §3.5', 'C3', 'C4.1-А', 'C4.2-А'], ['M2'])

REVISED = sorted(r['rule_id'] for r in rules if 'revision' in r)
_used = set()
def _walk(n):
    if not n: return
    if 'all' in n or 'any' in n:
        for x in n.get('all', n.get('any')): _walk(x)
    else: _used.add(n['field'])
for r in rules:
    _walk(r['applicability']['condition'])
    for p in r['requirement'].get('parts', []): _walk(p['check']); _walk((p.get('applicability') or {}).get('condition'))
    _walk(r['requirement'].get('check'))
    for a in r['ambiguities']: _walk(a.get('blocks_when')); [_walk(c) for c in (a.get('blocks_when_by_part') or {}).values()]
for k in SUPERSEDED: assert k not in _used or k in ('benzylpenicillin_dose_mg_kg', 'gentamicin_initial_dose_mg_kg'), k
assert len(REVISED) == 22 and not set(REVISED) & set(CONFIRMED_UNCHANGED), REVISED
