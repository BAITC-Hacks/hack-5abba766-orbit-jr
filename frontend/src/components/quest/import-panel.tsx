"use client";
import { useEffect, useRef, useState } from "react";
import type { ImportResult } from "../../../../contracts/backend";
import {
  apiRequest,
  ApiFailure,
  endpoints,
  isDefinitiveRejection,
} from "@/lib/api";
import { Failure } from "./feedback";
export function ImportPanel({
  revision,
  onRefresh,
  onError,
}: {
  revision: number;
  onRefresh: () => void;
  onError: (error: unknown) => void;
}) {
  const [employees, setEmployees] = useState<File>();
  const [history, setHistory] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<ImportResult>();
  const [replayed, setReplayed] = useState(false);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const request = useRef<{ key: string; body: FormData } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function submit() {
    if (lock.current) return;
    if (!request.current) {
      if (!employees && !history) {
        setError(new Error("Выберите хотя бы один файл."));
        return;
      }
      if ((employees?.size ?? 0) + (history?.size ?? 0) > 20 * 1024 * 1024) {
        setError(new Error("Суммарный размер файлов превышает 20 МиБ."));
        return;
      }
      const body = new FormData();
      if (employees) body.append("employees", employees);
      if (history) body.append("history", history);
      body.append("expected_dataset_revision", String(revision));
      body.append("dry_run", "false");
      request.current = { key: crypto.randomUUID(), body };
    }
    lock.current = true;
    setBusy(true);
    setPending(true);
    setError(undefined);
    setResult(undefined);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const response = await apiRequest<ImportResult>(endpoints.import, {
        method: "POST",
        body: request.current.body,
        headers: { "Idempotency-Key": request.current.key },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setResult(response.data);
      setReplayed(!!response.meta.replayed);
      request.current = null;
      setPending(false);
      if (!response.data.dry_run && !response.data.errors.length) onRefresh();
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(error);
        onError(error);
        if (isDefinitiveRejection(error)) {
          request.current = null;
          setPending(false);
          if (error.code === "REVISION_CONFLICT") onRefresh();
        }
      }
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="panel import-panel">
      <span className="eyebrow">ДАННЫЕ ДЛЯ РАЗВИТИЯ</span>
      <h2>Импорт профилей и истории</h2>
      <p>
        JSON в формате {"{meta, employees}"} и CSV истории. Хотя бы один файл;
        суммарно до 20 МиБ, до 1 000 профилей и 50 000 строк истории. Сервер
        сохраняет весь пакет атомарно.
      </p>
      <label className="field-label">
        Профили · JSON
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy || pending}
          onChange={(e) => {
            setEmployees(e.target.files?.[0]);
            setResult(undefined);
            setError(undefined);
          }}
        />
      </label>
      <label className="field-label">
        История · CSV
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy || pending}
          onChange={(e) => {
            setHistory(e.target.files?.[0]);
            setResult(undefined);
            setError(undefined);
          }}
        />
      </label>
      <ul>
        {[employees, history]
          .filter((f): f is File => !!f)
          .map((f) => (
            <li key={f.name}>
              {f.name} · {(f.size / 1024).toFixed(1)} КиБ
            </li>
          ))}
      </ul>
      <button className="primary" disabled={busy} onClick={() => void submit()}>
        {busy
          ? "Обработка…"
          : pending
            ? "Повторить тот же импорт"
            : "Импортировать"}
      </button>
      <Failure error={error} />
      {error instanceof ApiFailure && error.code === "IMPORT_CONFLICT" && (
        <p role="alert">
          Конфликт идентификаторов. Пакет отклонён целиком; существующие записи
          не заменены.
        </p>
      )}
      {pending && !busy && (
        <p>
          Ответ не получен. Файлы и ключ сохранены для безопасной повторной
          попытки.
        </p>
      )}
      {result && (
        <div role="status">
          <h3>
            {result.errors.length
              ? "Пакет содержит ошибки"
              : result.dry_run
                ? "Предварительная проверка — данные не сохранены"
                : result.applied
                  ? "Импорт применён"
                  : "Новых записей нет"}
          </h3>
          {replayed && <p>Повторный запрос: показан сохранённый результат.</p>}
          {!result.errors.length && (
            <p>
              {result.dry_run ? "К добавлению" : "Добавлено"} профилей:{" "}
              {result.counts.employees.new_rows}; записей истории:{" "}
              {result.counts.history.new_rows}. Идентичные записи:{" "}
              {result.counts.employees.identical_rows +
                result.counts.history.identical_rows}
              .
            </p>
          )}
          {[...result.errors, ...result.warnings].map((issue, i) => (
            <p key={i}>
              {issue.file} · строка {issue.row ?? "—"} ·{" "}
              {issue.field ?? issue.record_id ?? ""}: {issue.message}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
