# Редизайн Career Quest × Halyk — 23 сентября 2026

- Единая палитра: глубокий зелёный, золото, мята, лавандовый, голубой и тёплые акценты. Manrope поставляется локально с приложением.
- Новый вход: иллюстрация роста, выбор demo-роли, доступные поля, показ пароля, состояния загрузки и ошибки.
- Обновлены кабинет сотрудника, карточки рекомендаций и каталога, активность, навыки, модальные окна; HR-сводка, каталог сотрудников, импорт; отдельное демо и страница 404.
- В профиле первыми показаны 8 приоритетных навыков, полный список раскрывается. HR-список без рекомендаций сначала показывает 8 человек.
- Анимации появления, наведения и иллюстраций учитывают prefers-reduced-motion. Числа и прогресс берутся из API; декор не создаёт вымышленных достижений.

## Проверено на живом приложении

- Production-сборка и TypeScript; 161 backend-тест и 23 клиентских теста.
- Вход employee и HR, выход, модальное окно курса и Escape, поиск по каталогу, фильтр активности с пустым результатом.
- HR: сводка на 200 сотрудниках, поиск по имени, открытие профиля, возврат с сохранённым поиском и восстановлением фокуса, экран импорта.
- Размеры окна 375×812, 768×1024, 1000×850 и вход 1440×1000: проверка компоновки и горизонтального переполнения.
- Демо, страница 404 и её ссылка на главную. Изменения целей, импорт и симуляции в живую БД во время визуальной проверки не выполнялись.
- API health: ok, dataset_initialized=true. AI не настроен; интерфейс явно обозначает подборку по правилам.

---
# Проверка HR и карточек активности — 23 сентября 2026

Объединены изменения frontend с backend из main (d4a026a). В проекте есть HTTP-обработчики, PostgreSQL, авторизация, версии данных, receipts и предварительная проверка импорта.

## Что изменено

- HR разделён на «Обзор команды», «Сотрудники», «Импорт данных». Состояние поиска и выбранные файлы сохраняются при переключении разделов.
- В сводке — основные показатели, приоритетные навыки, распределение целей и сотрудники без рекомендации с фильтром причин. Достигнутая цель не обозначается как проблема.
- Разрывы навыков объединяются по непересекающимся группам источников целей; знаменатель показывает сотрудников, которым навык нужен. Подробная разбивка сохранена.
- Статистика исходного обучения отделена от симуляций. Дополнительные таблицы открываются по запросу.
- Сотрудники представлены карточками, с поиском, фильтрами и пагинацией по 24 записи. Профиль открывается отдельным экраном внутри HR; возврат сохраняет список и возвращает фокус.
- В «Моей активности» вместо строк — адаптивная сетка карточек: название, статус, дата, прогресс, действие и раскрываемые детали участия. Сохраняются точные participation_id, фильтры, признаки симуляции и перекрытых попыток.
- Сохранены предыдущие исправления адаптива, ошибок входа, повторов после 408/429, модальных окон и клавиатурного фокуса. Сохранены новые функции backend-интеграции: вход в demo-аккаунты, dry_run импорта, подписи навыков вне цели.

## Проверки

- Node.js 24: 161 тест backend и 23 клиентских теста проходят. В backend-прогон включён локальный аудит исходного датасета; сам датасет не публикуется.
- Проверка типов backend/frontend и production-сборка успешны.
- В браузере на синтетическом API: HR-разделы, открытие профиля и возврат фокуса, карточки активности и фильтр статусов, инструкция импорта.
- Размеры 375×812, 768×1024, 1280×900: документ не имеет горизонтального переполнения.
- Новые регрессии: сохранение файлов при переключении HR-разделов, знаменатели сводки, фильтрация причин отсутствия рекомендации. Проверки импорта различают preview и запись.

На этапе этой проверки PostgreSQL был недоступен. Позже Docker восстановлен, база поднята на локальном порту 15432, исходный датасет загружен; health и smoke с живой БД прошли. Live LLM не вызывался.

## Повторить проверку UI без БД

Установить зависимости из корня проекта (Node.js 24):

~~~powershell
npm ci
npm run build
npm run start -w frontend -- --port 3200
~~~

Во втором терминале из корня:

~~~powershell
node frontend/tests/preview-server.cjs
~~~

Открыть http://localhost:3201/__qa и выбрать employee или hr. Сценарий login принимает любой логин и тестовый пароль qa. Синтетический файл для импорта: frontend/tests/fixtures/ui-import.json.

QA-сервер слушает только 127.0.0.1, не загружается приложением Next.js и не заменяет production API. Сценарии имеют общее состояние в памяти и рассчитаны на последовательный прогон одним проверяющим. Переход к сценарию сбрасывает состояние.

## Apple-style workspace revision

- Replaced ornamental hero and pipeline with a compact career-goal summary.
- Replaced recommendation tiles with learning rows and expandable details; catalog and HR directory use lists.
- Added persistent desktop navigation, neutral surfaces, system typography, blue controls, and responsive single-column layout.
- Verified production build and TypeScript; 23 existing client tests passed after component restructuring.
- Browser checked employee and HR overview, goal-source donut, light/dark switching, recommendation modal, login, and employee layout at 390px (no horizontal overflow). Browser error log empty during checks.
- Browser checks use the local demo dataset. No deployment, commit, or push performed.

## Visual learning and HR profiles

- Recommendation illustrations and server-calculated goal impact; expandable evidence.
- Activity distribution, accessible status buttons, responsive cards and compact metrics.
- Visual import stages, file tiles and expandable instructions.
- Named employee profiles, explicit HR actions and light/dark themes.
- Validation: 161 backend tests, 24 client tests, production build; browser checks for recommendations, mobile history/filtering and HR import. HR profiles were also checked against the local API.
- Full implementation map: PRODUCT-IMPLEMENTATION.md at repository root.

## Integration with the latest team changes

- Preserved career journey, persistent lesson player, completion comparison, catalog gaps and grouped recommendation evidence.
- Adapted learning surfaces to both workspace themes.
- Post-merge verification: 321 backend tests, 40 client tests and production build passed.

