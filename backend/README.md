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

Успех: `{data, meta}`. Ошибка: `{error: {code, message, details?}, request_id}`. Контракты: [backend.ts](../contracts/backend.ts). Все защищённые запросы используют cookie-сессию. Изменяющие запросы требуют допустимый `Origin`; JSON — `Content-Type: application/json`. Импорт использует multipart-поля `employees`, `history`, `dry_run`, `expected_dataset_revision`. Для выполнения и фактического импорта нужен `Idempotency-Key`.

В доменных запросах версия состоит из `dataset_revision` и `employee_revision`. Источник данных неизменяем; цели и симуляции хранятся отдельно. Расчёты используют PostgreSQL snapshot. Изменяющие операции блокируют строку метаданных, проверяют версии и фиксируют эффект вместе с квитанцией повтора в одной транзакции.

Запускать из корня: `npm ci`, `docker compose up -d db`, `npm run dev`. Подготовка датасета, Docker, аккаунты и AI описаны в [README проекта](../README.md). Самостоятельно запускать `npm run dev` внутри backend не требуется: сервером служит Next.js.
