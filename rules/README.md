# База медицинских правил (пилот, этап 5)

`pilot-rules.json` — 30 правил-кандидатов: РДС (№4/2016), НЭК (№185/2023), бактериальный сепсис (№185/2023), по 10 на протокол.
Отчёт с цитатами и неоднозначностями: `docs/stage5-rules-pilot-report.md`.

## Поля правила
| Поле | Смысл |
|---|---|
| `rule_id` | `RDS-001`, `NEC-001`, `SEP-001` … |
| `doc_id`, `protocol` | связь с записью реестра этапа 4 и конкретной редакцией (`protocols.<id>.edition`, SHA-256 локального PDF) |
| `source.section`, `source.quotes[]` | раздел и точные цитаты `{page, text, sha256}`; хэш — от нормализованного текста |
| `applicability` | описание и машинное условие (`all`/`any`, операции `eq gt gte lt lte in is_true is_false present`) |
| `requirement` | требуемое действие/ограничение и машинная проверка |
| `normativity`, `normativity_marker` | `обязательно` / `рекомендуется` / `может_применяться` / `не_рекомендуется` / `противопоказано`, по слову цитаты |
| `exceptions_and_caveats` | оговорки протокола |
| `required_data` | поля синтетического случая (словарь — `data_dictionary`) |
| `evidence_level` | только если указан в документе, со страницей |
| `ambiguities[]` | вопросы врачу (`decision: null`) |
| `conflicts_with` | правила того же протокола, которые могут противоречить |
| `status`, `expert_confirmation` | `кандидат, ожидает экспертного подтверждения`, `null` |

## Принципы
- Неподтверждённые правила не дают окончательного вывода о качестве лечения. `engine/rules-engine.js` возвращает `final_conclusion: null` и статус «Требуется оценка эксперта»/«Недостаточно данных».
- Отклонение может быть обосновано врачом (`justifications[rule_id] = {text, author}`); обоснование передаётся эксперту и не меняет наблюдение автоматически.
- Дозы и показания — только из цитат. Пилот принимает только синтетические случаи (`synthetic: true`).

## Проверка
```
python3 rules/verify_rules.py rules/pilot-rules.json --registry registry/protocols-registry.json --pdf-dir <папка PDF>
ANTIDEFECT_PDF_DIR=<папка PDF> python3 -m unittest rules/test_rules.py
node --test engine/test/rules.test.js
```
PDF в репозиторий не входят (их SHA-256 — в реестре).
