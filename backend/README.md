# Backend Career Quest

Здесь находится серверная реализация на TypeScript. Пакет `@career-quest/backend` вызывается из Next.js API; он не требует отдельного HTTP-порта.

```text
src/
  http/          маршруты, Zod-схемы запросов, Origin, ошибки и JSON-ответы
  auth/          scrypt-пароли, cookie-сессии, employee/HR scope
  domain/        навыки, цели, допуск, prerequisites, HR и ранжирование по правилам
  services/      чтение, транзакционные команды, импорт и рекомендации
  db/            PostgreSQL pool, Drizzle schema, SQL-миграции и bootstrap
  validation/    JSON/CSV, связи и отдельный загрузчик исходного набора
  ai/            адаптер провайдера, проверка ID/фактов, fallback
  learning/      авторские уроки, приватные ответы, попытки и серверная проверка
  types.ts       общие контракты и внутренний снимок данных
tests/           unit и изолированные PostgreSQL/HTTP integration проверки
scripts/         CLI bootstrap
```

Путь запроса: **браузер → Next route → http → auth → service → domain / PostgreSQL**. Только подбор рекомендаций обращается к AI. У AI нет операций записи в базу.

Рабочие маршруты:

| Метод | Путь | Операция |
|---|---|---|
| GET | `/api/health` | Готовность базы и seed |
| POST | `/api/auth/login` | Создать сессию |
| GET | `/api/auth/session` | Текущий аккаунт |
| POST | `/api/auth/logout` | Отозвать сессию |
| GET | `/api/catalog` | Навыки, роли и активности |
| GET | `/api/employees` | HR: поиск и список |
| GET | `/api/employees/:id` | Профиль и рассчитанное состояние |
| PUT | `/api/employees/:id/goal` | Выбрать цель |
| POST | `/api/employees/:id/recommendations` | AI или подбор по правилам |
| POST | `/api/employees/:id/completions` | Симуляция выполнения |
| GET | `/api/hr/overview` | Агрегаты |
| POST | `/api/import` | Предварительная проверка / атомарный импорт |
| GET | `/api/learning/modules` | Список двух учебных демомодулей |
| GET | `/api/learning/modules/:moduleId` | Материал и вопросы без ключей ответов |
| POST | `/api/employees/:id/learning/attempts` | Начать или продолжить попытку |
| GET | `/api/employees/:id/learning/attempts/:attemptId` | Сохранённая попытка и её версия материала |
| POST | `/api/employees/:id/learning/attempts/:attemptId/lessons` | Завершить следующий урок |
| POST | `/api/employees/:id/learning/attempts/:attemptId/quiz` | Проверить ответы; при успехе симулировать эффект |

Успех: `{data, meta}`. Ошибка: `{error: {code, message, details?}, request_id}`. Контракты: [backend.ts](../contracts/backend.ts), [learning.ts](../contracts/learning.ts). Все защищённые запросы используют cookie-сессию. Изменяющие запросы требуют допустимый `Origin`; JSON — `Content-Type: application/json`. Импорт использует multipart-поля `employees`, `history`, `dry_run`, `expected_dataset_revision`. Для выполнения, фактического импорта и отправки учебного теста нужен `Idempotency-Key`.

В доменных запросах версия состоит из `dataset_revision` и `employee_revision`. Источник данных неизменяем; цели и симуляции хранятся отдельно. Расчёты используют PostgreSQL snapshot. Изменяющие операции блокируют строку метаданных, проверяют версии и фиксируют эффект вместе с квитанцией повтора в одной транзакции.

## Обучение

`learning/content.ts` содержит два авторских модуля: EV_012 / Advanced Python и EV_005 / System Design Fundamentals. Каждый рассчитан примерно на 7 минут и состоит из трёх уроков и трёх вопросов. В браузер отправляется явная проекция материала без `correct_option_id` и объяснений проверки; объяснения появляются после отправки ответов. Браузер передаёт ID вариантов, а не готовый балл.

Миграция `002_learning.sql` добавляет `learning_attempts`. В попытке сохраняются версия и полный серверный снимок материала, завершённые уроки, число проверок, балл и результат. Обновление авторского модуля не подменяет уроки и ответы уже начатой попытки. Начало и повтор урока естественно идемпотентны; переходить к тесту до завершения всех уроков нельзя.

Для успеха нужны все три правильных ответа. `submitQuiz` и `completeActivityInTransaction` используют один PostgreSQL client и одну транзакцию: статус passed, симуляция эффекта активности, revisions, receipts и аудит фиксируются вместе. Ошибка откатывает весь результат. Неверные ответы не меняют навыки; повтор успешной проверки не начисляет их дважды. Если активность успели завершить отдельно, повторное начисление отклоняется.

Результат короткого обучения реален в пределах приложения; **прирост навыков равен демонстрационному эффекту полной активности из каталога**, а не доказанной пользе семиминутного урока. Подробный пользовательский смысл — в [PRODUCT_GUIDE.md](../docs/PRODUCT_GUIDE.md).

Запускать из корня: `npm ci`, `docker compose up -d db`, `npm run dev`. Подготовка датасета, Docker, аккаунты и AI описаны в [README проекта](../README.md). Самостоятельно запускать `npm run dev` внутри backend не требуется: сервером служит Next.js.
