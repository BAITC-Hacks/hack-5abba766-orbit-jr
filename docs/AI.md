# AI-зона: что реализовано

Реализует разделы 9–10 [BACKEND.md](BACKEND.md). Типы берутся из
[contracts/backend.ts](../contracts/backend.ts), своих параллельных типов зона не заводит.

| Файл | Роль |
|---|---|
| `frontend/src/server/ai/prompt.ts` | System-промпт, компактный snapshot, JSON-схема структурированного вывода |
| `frontend/src/server/ai/adapter.ts` | Вызов провайдера, бюджет времени, отображение сбоев в `FallbackReason` |
| `frontend/src/server/ai/response-validator.ts` | Zod + семантическая проверка, сборка `RecommendationCard[]` |
| `frontend/src/server/domain/baseline.ts` | Воспроизводимый baseline из раздела 9 и карточки для `rules_fallback` |

## Как это вызывать

Сервис рекомендаций (зона бэкенда) собирает `AiRankingInput` и делает:

```ts
const attempt = await rankWithModel(input)          // adapter.ts
if (attempt.ok) {
  const checked = validateRanking(attempt.output, input)   // response-validator.ts
  if (checked.ok) return { version, mode: 'ai', fallback_reason: null,
                           recommendations: checked.cards, empty_reason: null }
}
// иначе baseline с конкретной причиной
return { version, mode: 'rules_fallback',
         fallback_reason: attempt.ok ? 'invalid_response' : attempt.reason,
         recommendations: baselineCards(input, signals), empty_reason: null }
```

`rankWithModel` не бросает исключений: отсутствие ключа, таймаут, ошибка провайдера
и не-JSON возвращаются как `missing_api_key` / `provider_timeout` / `provider_error` /
`invalid_response`. Пустой набор кандидатов — это `mode: 'no_candidates'`, решается
до вызова зоны; адаптер провайдера в этом случае не трогает.

Повторная проверка `DomainVersion` после ответа модели (раздел 10, `STALE_RECOMMENDATION`)
делается в сервисе — зона не читает БД и не знает о транзакциях.

## Что проверяет валидатор

Отклоняет и роняет в baseline, если: `candidate_id` нет в snapshot; выбор повторяется;
выборов больше `min(limit, число кандидатов)`; `fact_id` принадлежит другому кандидату;
процитированные факты покрывают меньше трёх категорий из
`grade / skill_gap / history / target_requirement`; альтернатива неизвестна или сама
попала в рекомендации.

Карточка собирается из серверного `Candidate`. Модель возвращает только идентификаторы —
`AiRankingOutput` не содержит полей со свободным текстом, и валидатор ничего текстового
от модели не принимает.

## Чего baseline пока не считает — нужно от бэкенда

Порядок сравнения из раздела 9 требует двух величин, которых **нет в типе `Candidate`**:

1. **Выгода от `unlocks_event_ids`.** В кандидате лежат только id открываемых событий,
   без их приростов, поэтому `weighted_unlocked_gain` посчитать не из чего.
2. **Негативные исходы по последним трём участиям того же события.** В кандидате нет
   истории участий.

Обе передаются параметром `BaselineSignals` (`unlockedWeightedGain`, `negativeOutcomes`),
по умолчанию пустые — тогда сравнение вырождается в шаги 1, 2 (прямая часть), 4 и 5.
Либо сервис заполняет эти карты, либо в `Candidate` добавляются два поля. Пока ни того,
ни другого нет, baseline работает не полностью по спецификации.

## Конфигурация

Серверные переменные из раздела 16: `LLM_API_KEY`, `LLM_MODEL` (по умолчанию
`gpt-4o-mini`), `LLM_TIMEOUT_MS` (по умолчанию 8000). Не `NEXT_PUBLIC_*`.
`isAiConfigured()` отражает наличие конфигурации для `HealthView.ai_configured`
и не ходит к провайдеру.

## Проверки

```
cd frontend
npm run test        # vitest, 33 теста, ключ не нужен
npm run typecheck
```

## Что не проверено

Живого вызова провайдера не было — ключа не было. Латентность против бюджета 8 секунд,
доля ответов, проходящих валидатор, и размер payload на полном каталоге неизвестны.
Заявлять, что AI лучше baseline, нельзя до фактического замера.
