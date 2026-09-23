# Adversarial audit: domain → prompt → validator → recommend

Дата: 2026-09-23. Проверка только локальная; production code не изменён. Все данные — существующие синтетические fixtures, без реальных сотрудников и секретов. Live provider не вызывался.

## Статус после исправления

Root/reliability reviewer добавили runtime completeness guard. Независимый повтор `node --import tsx test-results/astra-audit/adversarial/probe-after.mts` завершился exit 0: 17 stubbed transport calls, 0 внешних. `probe-after-results.json` сохранён отдельно. По одному убраны **только** conditional unlock, history или effort, при сохранении всех остальных фактов: каждый ответ теперь `rules_fallback / invalid_response`. Полные валидные AI-ответы двух domain cases сохранены как `mode=ai` с исходным candidate ID. P2 из раздела ниже исправлен для проверенных случаев; этот раздел оставлен как before evidence, а не описание текущего дефекта.

Контроль оставшейся границы: заведомо неправильный eligible winner с **полным** набором действительных фактов всё ещё принимается `mode=ai`, а quality eval его отвергает. Guard не является скрытой подстановкой baseline ranking и не доказывает правильность выбора. Повторно прошли 10 invalid-output checks, cardinality, employee isolation и single-card contract. Исторический `probe.mts` специально сохраняет ожидания поведения до исправления; текущий код им проверять как passing suite нельзя.

## Воспроизведение и итог до исправления

Из корня orbit-jr: `node --import tsx test-results/astra-audit/adversarial/probe.mts`.

Команда завершилась exit 0. Файл `probe-results.json` содержит 21 наблюдение; 15 вызовов транспорта были подменены in-process `fetch`, внешних запросов 0. Подмена устанавливается до `recommend` и восстанавливается в `finally`; реальные credentials не считываются в отчёт. Она доказывает поведение server boundary при заданном ответе, но не частоту таких ответов live модели.

## Подтверждённая проблема P2: обязательное объяснение остаётся только в prompt

`backend/src/ai/response-validator.ts` проверяет принадлежность ID выбранному кандидату, отсутствие дублей, cardinality и ≥3 категории из grade / skill_gap / history / target_requirement. Он не проверяет обязательные в `SYSTEM_PROMPT` конкретные основания решения:

1. **unlock:** `domain-prerequisite-benefit`, выбранный `prepare-tooling:start:self-paced` имеет нулевую прямую пользу и выигрывает за счёт условной будущей. Ответ с grade + skill_gap + обычным target_requirement, без `...:unlock:future-design-lab`, проходит.
2. **history:** `domain-similar-format-history`, выбранный `new-self-paced-format:start:self-paced` побеждает из-за истории сравниваемых форматов. Те же три категории, без history, проходят.
3. **effort:** `challenge-history-control`, shorter winner с grade + gap + target, без effort, проходит, хотя длительность решает выбор.

В первых двух случаях используются кандидаты из фактического source → domain pipeline. Во всех трёх `recommend` возвращает `mode=ai`; `scoreEvaluation` считает `acceptedAi=true`, но `requiredTopEvidencePass=false`. Валидатор не переводит результат в fallback. Existing тесты сознательно показывают эту границу (`backend/tests/team-ai/challenge-cases.test.ts`, тест `the prerequisite needs its unlock citation even though three ordinary categories validate`; аналог в domain-evaluation.test.ts).

**Пользовательский эффект:** `frontend/src/components/quest/recommendation-card.tsx` фильтрует текст фактов по reason_fact_ids. Следовательно, гарантированно правильные численные эффекты ещё не гарантируют показ решающего объяснения. Для prerequisite UI дополнительно показывает условное открытие по unlocks_event_ids, что уменьшает ущерб, но не заменяет численное основание; пропущенная история вообще не попадает в соответствующую группу. Это дефект enforceable explanation contract, а не обнаруженная утечка, численная галлюцинация или доказанная плохая live рекомендация.

**Проверенные callers:** production `services/recommendations.ts` → `recommend.ts` → `validateProviderRanking`; публичная compatibility-функция `ai/index.ts::rankCandidates` использует тот же validator. `evaluation/metrics.ts` отдельно замечает проблему только у кейсов с authored requiredTopFactIds. `cardsFromRanking` предполагает уже валидированный output и не усиливает семантику; production service его не вызывает.

**Минимальный guard без скрытого baseline override:** ввести консервативный evidence completeness contract для server-generated кандидата: history и effort должны цитироваться при наличии; если кандидат открывает следующие активности, все его факты target_requirement с условной пользой должны цитироваться. Самый аккуратный вариант — domain явно помечает required reason IDs и validator только проверяет inclusion. Более короткий вариант без изменения контракта — требовать имеющиеся history / effort и все target_requirement facts у кандидатов с unlocks_event_ids. Не распознавать «решающий фактор» по свободному тексту, не переставлять кандидатов, не добавлять причины за модель: отклонять неполный ответ и отдавать существующий baseline fallback. Цена консервативного решения — несколько дополнительных ссылок, иногда не решающих для порядка. Это честнее, чем приписывать модели неназванное объяснение. Порядок остаётся модельным.

**Сильнейший контраргумент:** контракт сейчас формально требует лишь три категории, eval сознательно измеряет более высокое качество объяснения; промпт может выполнять эти правила практически безошибочно. Тогда это известное ограничение, а не срочный блокер. **Что изменит вывод:** live omission при стабильном top-1 усилит приоритет; явно ослабленное продуктовое обещание до «цитаты фактически корректны» и нулевая наблюдаемая частота снизят срочность, но не превратят prompt в runtime guarantee.

## Проверенные защитные границы: нарушений не найдено

Каждый из следующих ответов через `recommend` дал `rules_fallback / invalid_response`, причём карточки полностью совпали с baselineCards:

- fact ID другого кандидата;
- выдуманный fact ID;
- дублированный fact ID;
- выдуманный candidate ID;
- собственное численное поле goal_coverage_delta;
- причинная проза `Three declines prove lack of motivation.`;
- больше choices, чем limit;
- пустой choices;
- дублированный candidate;
- точный fact ID с добавленным zero-width символом.

Лимиты 0, 4, 1.5, NaN отклоняются до provider. Подмена истории другого синтетического сотрудника не меняет candidates и signals выбранного сотрудника; имя и employee ID отсутствуют в model payload. Self-alternative удаляется намеренной sanitation, без изменения порядка/фактов.

## Injection: поверхность подтверждена, успешная live атака НЕ подтверждена

Имена навыков и названия активностей из source попадают в JSON и встроены в тексты server facts, включая skill_gap и target_requirement. При замене skill.name и event.title на sentinel-инструкцию она достигает payload. Source descriptions и имена других сотрудников туда не попадают. Системный prompt явно обозначает JSON как данные, а не инструкции.

Когда подменённый provider выполняет уже существующую title injection из `challenge-untrusted-instructions` и выбирает inferior, но eligible candidate с допустимыми ссылками, сервер принимает `mode=ai`; eval отвергает качество top-1. Это означает, что injection, **если** сработает на модели, может менять ranking внутри серверного набора. Она не позволяет изобрести активность, цифры или произвольную причинную прозу. Нельзя на основании stub объявлять live exploit.

Рекомендуемый следующий live тест: domain-generated source-label injection в skill.name и unlock event.title, с неизменными server ranking_factors и заранее фиксированным ожидаемым победителем. Заголовки «verified facts» сами по себе не означают, что любой импортированный текст внутри них доверенный.

## Что в действительности измеряют evals

Пересчитаны все 23 authored ranking cases: deterministic baseline проходит top-1 **23/23**. Только **10/23** имеют обязательные решающие fact IDs; только **1/23** задаёт порядок нескольких карточек. В кейсе limit=3 одна правильная первая карточка проходит expectedCandidateOrderPass. Это согласуется с явным контрактом 1..limit и не является ошибкой cardinality; это не проверка полного top-3.

Не следует называть evals простой подстановкой baseline output: expected choices написаны явно, существуют counterfactual/permutation/injection/domain cases, отдельные evidence checks, проверки полного grounded card contract. Но они измеряют исполнение authored policy. Prompt получает готовые ranking_factors, буквально задаёт ту же priority policy, а production getCandidates уже отдаёт baseline-sorted список. Поэтому 100% совпадения не доказывает полезность AI относительно baseline; повышение top-1 на текущем наборе невозможно сверх 23/23. Сам отчёт evaluate-ai.ts честно предупреждает об этом.

Сильнейшее основание за подход: гибкое цитирование и перестановка в узком безопасном пространстве, факты/допуск/эффекты/идентичности полностью server-owned; качественные transport failures дают воспроизводимый fallback. Сильнейший контраргумент: текущая policy полностью вычислима без LLM, значит AI добавляет латентность и вариативность без продемонстрированного выигрыша. Изменить вывод могут заранее замороженные независимые экспертные предпочтения, где baseline ошибается, измеримый выигрыш объяснения или выбора и статистика с учётом стоимости/времени/ошибок. Честное текущее название — constrained LLM reranker; evidence для обученной ML-модели или uplift здесь не найдено.

## Возражения другим проверяющим

- Методологу: prefix-only score не считаю багом, поскольку 1..limit явно разрешено. Его тезис о невозможности uplift на benchmark с baseline 23/23 поддержан измерением. Теоретическая способность модели учитывать дополнительную информацию не является наблюдаемым выигрышем; текущий prompt фиксирует порядок policy.
- Reliability-аудитору: late-version race в cache branch нуждается в конкретном interleaving, потому что cacheKey уже включает employee version и payload. Само отсутствие второго чтения ещё не доказывает выдачу stale cache при обычной последовательной работе.
- Собственное ограничение: omission guard не должен превращаться в восстановление baseline ranking под видом AI и не должен добавлять неназванные моделью причины. Нужны rejection/fallback или явно server-owned explanation.
