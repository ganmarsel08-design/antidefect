# Модуль «Отклонение от протокола + обоснование»

Этапы 1–3 ТЗ v0.6 (`docs/deviation-module-spec.md`): модель данных, независимые проверки, механизм статусов, подтверждения с происхождением, журнал решений эксперта и простой интерфейс аудита. Реестр протоколов и инструкций не подключён (этап 4). Тестовая версия: только синтетические данные.

- `deviation-engine.js` — модуль без зависимостей, без ИИ и без сети. В браузере доступен как `window.DeviationEngine`, в Node — через `require`.
- `audit.html` — интерфейс аудита. Открыть в браузере (рядом должен лежать `deviation-engine.js`). Кнопка «Загрузить синтетический пример» показывает весь сценарий.
- `test/deviation.test.js` — 34 синтетических случая и проверки порогов, подтверждений, полноты реестра, черновика, устаревания, валидации, журнала, неизменности входа (55 тестов).

## Применение базы правил (этапы 5–6)

- `rules-engine.js` — применяет `rules/pilot-rules.json` к синтетическому случаю; никогда не выдаёт окончательного вывода (`final_conclusion: null`). В браузере сначала подключить `derive.js` (`window.RulesDerive`), затем `rules-engine.js` (`window.RulesEngine`).
- `derive.js` — вычисляемые поля и хронология по отметкам времени (этап 6, M2/M3).
- `test/rules.test.js` (этап 5), `test/stage6.test.js` (инварианты и приёмочные тесты этапа 6), `test/scenarios-117.test.js` (117 сценариев архива экспертизы).
- Третий круг: `test/round3.test.js` (приёмочные тесты решений врача 20.11.2026), `test/regression-171.test.js` (171 случай: неперечисленные — как на 2eeb6ae, перечисленные — по явному списку), `test/fixtures/cases-171.json` и `baseline-171-2eeb6ae.json` (замороженные входы и отпечатки), `test/mutation-check.js` (31 мутация), `test/regression-b6b9999.test.js` + `test/fixtures/baseline-171-b6b9999.json` (снимок 171 случая по всем 30 правилам, снятый кодом коммита b6b9999 через `test/tools/freeze-baseline-171.js`; тест воспроизводит снимок из истории git), `test/ui/rules-card.scenario.js` (карточки базы правил в браузере; `audit.html` их не показывает — это интерфейс модуля отклонений).

```js
const out = RulesEngine.evaluate(db, { synthetic: true, data, sources, justifications }, { expert_decisions });
// out.results[i].observation, .parts, .card (карточка эксперта: подписи, цитаты, факты, хронология, недостающие данные)
```

## Запуск тестов

```
node --test engine/test/*.test.js
```

Нужен Node.js 18 или новее.

## Использование

```js
const r = DeviationEngine.evaluate(deviation, config);   // r.ok, r.status, r.headline, r.missing ...
const b = DeviationEngine.attestBibliographic({found, metadata_match, method: 'manual', checked_by});
const a = DeviationEngine.attestExpertAssessment({applicability, regimen_match, assessed_by});
const r2 = DeviationEngine.applyExpertOverride(r, {who, status, reason, source});
```

Все данные в тестах синтетические: препараты, дозы, диапазоны и цитаты вымышлены и не являются клиническими рекомендациями. Реальные данные пациентов не использовать до проверки требований РК.

## Сценарий интерфейса

`engine/test/ui/audit-ui.scenario.js` — проход по интерфейсу в браузере (Playwright): пример, подтверждения, полнота реестра, устаревание, повторная проверка, черновик при «невозможно проверить».

```
npm i playwright && npx playwright install chromium
node engine/test/ui/audit-ui.scenario.js
```
