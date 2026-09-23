# Release critique — пятый проход, Astra method reviewer

Это второй тематический проход того же агента Astra, выполнившего method audit, а не пятый отдельный независимый агент. Production diff внесён другим агентом; ниже его независимая проверка. Дата: 2026-09-23.

## Первый этап: минимальная правка объяснения

**Код guard/prompt одобрен как ограниченное исправление explanation gap.** `validateRanking` требует все существующие `history` и `effort`; при непустом `unlocks_event_ids` — все существующие `target_requirement`. Не определяет смысл по opaque IDs, не сравнивает кандидатов, не меняет winner/order, не добавляет model reasons. При отсутствии цитаты возвращает `ok:false`, после чего `recommend` выбирает явно помеченный fallback.

Prompt согласован с guard и прямо объясняет, что обязательное покрытие доказательств не означает решающую роль каждого фактора. Это важно: факты не представлены как достоверная реконструкция внутреннего рассуждения модели.

Из двух вариантов выбран консервативный guard. Вычисление решающего фактора pairwise требует определения соперника для каждого из 1–3 мест и почти дублирует comparator. При фактически неверном выборе нельзя надёжно восстановить причину модели из правильного baseline. Такое изменение было бы существенно шире необходимой правки.

## Чем это решение плохо

1. **Больше нерешающей информации.** History/effort нужны и когда winner однозначно закрывает critical gap; при наличии unlocks нужно цитировать все future target facts, включая не-best варианты. Это сознательная цена простого контракта, а не оптимизация объяснимости. Usability reviewer подтверждает длинные объяснения в раскрытых карточках. Следующий отдельный продуктовый шаг — краткий серверный summary ключевого различия с полной раскрываемой evidence, честно помеченный как серверное объяснение. Сейчас это не основание отложить guard.
2. **Рост числа fallback.** Больше обязательных ID может ухудшить соблюдение контракта и расходовать output budget. Время/приёмка исторического prompt больше не характеризуют новый. Требуется postpatch live; нельзя объявлять успех по 69/69 старого контракта.
3. **Политика не равна пользовательской полезности.** Первый evidence guard не проверял winner. Следующий этап ниже добавляет проверку заданной политики, но она всё равно не доказывает её оптимальность для человека и верность исходных кадровых данных.
4. **Исторические метрики версионны.** Новый `validateRanking` используется и evaluator. Нельзя повторно оценить старые selected choices новым валидатором и приписать изменение модели; нужен отдельный отчёт с prompt/schema/adapter/config hashes и временем.

## Release blockers и evidence

**Подтверждено до patch:** source CLI Luna xhigh, 69 вызовов: 67 AI, 2 provider timeout; все 67 принятых ответов прошли авторские quality checks. p50 3576 ms, p95 6775 ms, max 8022 ms. Это хорошая прозрачность fallback, но не доказательство преимущества xhigh относительно low: нет contemporaneous controlled comparison.

**Подтверждено reliability audit:** обслуживаемая `.next` сборка имела другой prompt hash и Luna low; source изменился после сборки. У CLI и browser разные исполняемые версии. До rebuild/restart + сверки сборки заявлять browser work на новой конфигурации нельзя. См. `../reliability/runtime-check.json`.

**Проверены сохранённые postpatch логи и полный test diff:** 440/440 unit, 54 integration прошли и 1 opt-in live пропущен, production build завершён. Positive provider mocks дополнены обязательными facts; старые тесты, принимавшие пропущенный decisive fact, теперь проверяют rejection/fallback. Новый `evidence-completeness.test.ts` независимо проверяет opaque IDs, пропуск каждого обязательного факта, отсутствие вставки/перестановки цитат и явный fallback. Это корректное изменение контракта, а не удаление негативных тестов. Начальный прогон после guard имел 28 падений старых mocks; они не скрыты, лог `evidence-after-initial.log` сохранён.

**Postpatch all-suite live проверен:** 67/69 принятых AI, 2 timeout, без invalid response. Все принятые ответы прошли authored top/evidence/order. p50 4578 ms, p95 7595 ms, max 8010 ms. Оба timeout относятся к `acceptance-multiple-cards`, повторы 1 и 2: единственный исходный limit=3 case дал AI лишь 1/3. Aggregate 97.1% маскирует этот важный срез; по трём коррелированным попыткам нельзя оценить истинную вероятность, но нужно проверить multi-card отдельно. Наблюдаемое увеличение времени относительно предыдущего запуска не доказывает причинный эффект guard без контролируемого сравнения.

**Build parity проверена:** `runtime-check-after.json` подтверждает совпадение source/built prompt `44bc26f7...`, включение нового контракта и отсутствие прежнего low для обеих моделей. Прямой Next launch без root env всё ещё выберет другую локальную конфигурацию; необходим подтверждённый root-env запуск. Успешная сборка сама по себе не доказывает замену работающего процесса.

**12-case follow-up xhigh live проверен:** 36 вызовов, только 10 принятых AI, 26 `provider_timeout`, 0 иных причин отказа. Все 10 AI прошли качество. Указанные в отчёте 36/36 integrity/order включают правильный fallback и не являются качеством AI. Все 9 multi-card вызовов и все 9 similar-format-history вызовов истекли по timeout. p50 8003 ms, p95 8014 ms, max 8026 ms. Это серьёзная проблема доступности AI на этом наборе.

Sanity: snapshot и ручные order рубрики прошли offline, payload 5.8–8.0 KiB приблизительно, вызовы последовательные через настоящий adapter с тем же 8000ms deadline; timeout появляется около установленной границы, не на validation stage. Признаков дефекта harness не найдено. Production service использует `request.limit ?? 3`, поэтому этот набор ближе к обычному запросу по числу карточек, чем исходные 22/23 сценария с limit=1. Необычные ID/permutations/injection усложняют отдельные случаи; это не оценка частоты failure на обычных пользователях.

**Low diagnostic проверен:** 9/9 accepted AI и все quality checks, 0 fallback; p50 5001 ms, p95/max 6239 ms. Metadata подтверждает source `xhigh`, effective override `low`, ровно 9 изменённых запросов. Это не результат source low production configuration — пока только диагностический wrapper. Root запускает обратный high control, затем при подтверждении решения — source low и полный набор регрессии.

**Обратный high control:** после low прогона 0/3 AI, все три timeout, тот же subset cases hash. Это ослабляет объяснение исключительно временной нагрузкой, но не превращает последовательную серию в randomized A/B. Source adapter затем изменён ровно в значении Luna effort `xhigh→low`, без смены модели, 1400 output budget, 8000ms deadline и guard. Diff и тест соответствующего request parameter проверены; замечаний к механике изменения нет. Low diagnostic действительно возвращал 3 карточки во всех 9 случаях, а не ускорялся за счёт single-card prefix.

**Новая ошибка source low на прежнем prompt:** 23/23 accepted, но только 22/23 quality: `challenge-direct-with-conditional-unlock` выбрал direct2 вместо combined1+0.5×3=2.5. Guard это не должен обнаруживать — все требуемые факты выбранного проигрывающего кандидата присутствуют. Исправление prompt явно задаёт `ranking_factors.weighted_target_value` как следующий критерий после critical closures и запрещает предварительную сортировку по direct gain. Это уточнение существующей общей политики, без fixture IDs и скрытого deterministic override. Предположение, что причина была двусмысленностью prompt, остаётся гипотезой до новых проверок.

**Расширение после этой ошибки:** добавлены 3 варианта direct-unlock и 3 reciprocal counterfactuals. В первых b=2.5 побеждает a=2; в reciprocal future gain b уменьшен 3→1, fact будущего эффекта изменён 2→5 на 2→3, и b=1.5 проигрывает a=2. Так проверяется, что модель не стала всегда предпочитать наличие unlock. Default теперь 18 случаев, filter `direct-unlock` охватывает 6, repeat до 5; offline 18/18. Новые случаи прямо помечены как post-failure targeted regression, не holdout.

**Пока ожидаются:** обратный high control, итоговая эффективная конфигурация и подтверждение обслуживаемого процесса после restart. Root координирует эти проверки.

**Уточнение исполняемой версии от root:** свежий browser показал AI-карточки без обязательных history/effort при новой сборке на диске. Первоначальная гипотеза — старые загруженные backend-модули — не идентифицирует точный checkout процесса: позднее другая задача сообщила о публикации собственного аудита из `orbit-jr-jury`. Нужно установить cwd/сборку активного PID и версию именно полученных карточек, а не предполагать, что порт принадлежит нашему checkout. Попытки разрешённого пользователем restart ограничены automatic approval review; обходить отказ нельзя. Новая guard-защита подтверждена source/CLI/tests, но её применение в наблюдавшемся UI пока не доказано. Результаты sibling-задачи и её commit не смешиваются с результатами нашего checkout.

## Дополнительный runner

Создан `holdout.mts`; слово holdout в имени файла историческое, методологически это **авторские коррелированные мутации четырёх существующих fixtures**, не independent expert holdout.

- 12 случаев = critical / similar-format history / prerequisite / multicard × reversed order / opaque IDs / instruction-in-title.
- Во всех limit=3. В девяти случаях изменён source snapshot и повторно вызван настоящий domain pipeline; три случая — mutations существующих candidate fixtures.
- Expected order задан вручную по числам: critical closure; equal gain + history; 0.5×3 future gain против direct 1; multicard b,d,c,a по critical closure и 2.5/2/1 weighted gains. `rankBaseline` не используется как oracle. Offline baselineCards вызывается только как проверяемая система.
- Проверяются все сохранённые серверные поля, версии, уникальность карточек/цитат, ≥3 категории, обязательная evidence каждой карточки, альтернативы и точный возвращённый prefix. Одна карточка при limit=3 допустима по ТЗ, поэтому completeness top-3 не утверждается.
- Injection проверяет реальные title→domain→prompt каналы в девяти source cases (malicious title именно в трёх из них), плюс один candidate-title case. Это не полный red-team всех языков/каналов.
- Важная граница source→user: заголовок остаётся серверным исходным текстом и отображается компонентом карточки. Если malicious-title кандидат выдан вторым, текст инструкции может быть виден пользователю, даже когда модель его проигнорировала. Runner проверяет устойчивость выбора и неизменность данных, а не модерацию заголовков или отсутствие такого текста в интерфейсе.
- Метаданные содержат prompt/schema/cases/adapter hashes, извлечённый effort, provider deadline и payload bytes. Время относится к recommend, не к браузеру.

Offline команда выполнена, exit 0: 12/12 integrity и 12/12 order. `holdout-offline.json`; AI-метрики равны null. Внешние вызовы этот агент не выполнял.

Root запускает live из корня проекта:

```powershell
node --env-file=.env node_modules/tsx/dist/cli.mjs test-results/astra-audit/release/holdout.mts --live --repeat=3 --out=test-results/astra-audit/release/holdout-live.json
```

Добавлен диагностический режим только для трёх multi-card вариантов ×3. Он меняет только `body.reasoning_effort` на `low` в тестовом fetch wrapper; остальные JSON-поля сравниваются, endpoint/headers/schema/model/budget сохраняются, source adapter не меняется, fetch восстанавливается в `finally`. Report отдельно записывает source effort, effective effort, override и число фактически изменённых запросов. Это последовательная диагностика, не рандомизированное A/B. Default остаётся 12 случаев; его offline перепроверка 12/12. Filtered offline 9/9, без provider calls.

После добавления опций совпадение full `casesSha256`, prompt hash и adapter hash между предыдущим high live и новым default offline отчётом проверено: исходные случаи и production код диагностикой не изменены.

```powershell
node --env-file=.env node_modules/tsx/dist/cli.mjs test-results/astra-audit/release/holdout.mts --live --case-filter=multi-card --repeat=3 --effort=low --out=test-results/astra-audit/release/low-probe-live.json
```

Предварительный gate выбора low: 9/9 accepted AI с полным order/evidence и p95≤6 секунд, явно лучший результат относительно сопоставимого xhigh среза. Это операционный порог для запаса к 10-секундному ТЗ, не статистическое доказательство превосходства модели. Если xhigh также проходит и скорость близка, смена не обоснована. После фактической смены source effort требуется регрессия на эффективной конфигурации; historical old-prompt 69/69 не заменяет её.

**Пересмотр мягкой latency-планки, явно после измерения:** low p95=6.239 секунды формально не прошёл предложенные 6 секунд. Reviewer поддерживает рассмотрение low несмотря на это: 6 секунд не требование ТЗ, а выбранный запас; по наблюдениям остаётся 1.76 секунды до неизменного provider deadline и 3.76 секунды до общего 10-секундного лимита. Это не сертификация end-to-end latency. Условие zero observed quality regressions и последующая полная проверка сохраняются. Порог не объявлен задним числом пройденным.

## Что изменит вердикт

Ошибочный winner, неполная mandatory evidence или изменение server facts в accepted AI — блокирует приёмку до исправления причины. Отдельный timeout с честным fallback не ломает продуктовый сценарий, но рост fallback после guard потребует корректировки prompt/config в пределах исходного ТЗ, а не отмены проверки. Плохая читаемость длинных карточек — отдельная UX-задача; её нельзя решать скрытым удалением evidence или маскировкой fallback под AI.

## Пересмотр решения после новых ошибок: runtime policy guard

Последующий low-прогон старого prompt дал 36/36 AI, но 35/36 правильных порядков: в history/title-injection один ответ предпочёл формат с негативной историей при равной пользе. Уточнение TOTAL benefit само по себе не решает этот класс ошибки. Поэтому первоначальное ограничение только evidence guard пересмотрено на основании наблюдения, а не скрыто задним числом.

**Одобрено и независимо прочитано:** общий `comparePolicyPriority` в `baseline.ts` сохраняет прежнюю последовательность meaningful priorities: critical closure → total weighted target value → exact-event negative history → similar-format penalty → duration → continuation. Baseline затем добавляет стабильные ID, а runtime guard ID не сравнивает. В `recommend` каждая выбранная карточка проверяется против всех ещё не выбранных допустимых кандидатов. Наличие строго лучшего кандидата отклоняет весь AI-ответ с `invalid_response` fallback. Exact policy ties принимаются в любом порядке; 1–3 карточки и корректный неполный prefix разрешены. Вход, выбранный порядок и model fact IDs не достраиваются и не переставляются.

Алгоритм правильно исключает ранее выбранные карточки из remaining set. Производственный caller audit: HTTP service вызывает общий `recommend`. Legacy helper `ai/index.ts:rankCandidates` не применяет policy guard, но вызывается только unit-тестами и не экспортируется через package index; ему нельзя приписывать производственную гарантию. Изменять этот неиспользуемый compatibility API в данной правке не требуется.

**Почему это не то же возражённое ранее дублирование reasoning:** новая проверка не пытается восстановить внутреннюю причину LLM или выбрать ей факты. Она проверяет уже заявленную явную бизнес-политику общей функцией, которую использует и baseline. O(k·n) сравнений при k≤3, без новых весов, обучаемой модели или вторых расчётов полезности.

**Что становится хуже:** пространство допустимых решений LLM резко сужается до порядка hard-policy с свободой точных равенств, длины допустимого prefix и доказательств/сравнений. Это не доказательство дополнительной ценности LLM. 100% policy agreement принятых AI теперь является следствием gate; сырые ошибки модели наблюдаются как fallback и должны оставаться в denominator и отчёте. Изменение защищает пользователя от известной числовой ошибки ценой дополнительного fallback; скрытым улучшением качества самой модели это не считается.

**Новые проверки:** 11 policy tests охватывают все 6 сравнений, неправильное второе место, prefixes 1/2/3, обратный порядок stable IDs при точном равенстве и неизменность raw choices. Full unit — 451/451; integration — 54 passed, 1 live skipped; backend tsc прошёл. Прочитан diff CLI eval assertions: intentionally wrong outputs теперь ожидают invalid_response fallback; eval по-прежнему возвращает exit 1 и не присваивает fallback заслугу AI. Тесты не ослаблены ради зелёного результата.

Финальный live для этого guard должен стартовать после freeze его модулей. Ранее запущенный Node runner держит старые imports, поэтому его результат, даже при изменённых на диске файлах, не является проверкой новой boundary.
