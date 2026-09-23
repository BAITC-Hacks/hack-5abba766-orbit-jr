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
import { FileJson, FileSpreadsheet, Upload, CheckCircle2, Database } from "lucide-react";
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
  const [dryRun, setDryRun] = useState(false);
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
      body.append("dry_run", String(dryRun));
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
      <ol className="import-steps" aria-label="Этапы импорта">
        <li className={employees || history ? "done" : "current"}><Upload size={20} /><span>Файлы</span></li>
        <li className={result?.dry_run && !result.errors.length ? "done" : ""}><CheckCircle2 size={20} /><span>Проверка</span></li>
        <li className={result?.applied ? "done" : ""}><Database size={20} /><span>Готово</span></li>
      </ol>
      <div className="import-file-grid">
      <label className="field-label import-file-tile">
        <FileJson size={30} aria-hidden="true" />
        <strong>Профили · JSON</strong>
        <span>{employees ? employees.name : "До 1 000 сотрудников"}</span>
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
      <label className="field-label import-file-tile">
        <FileSpreadsheet size={30} aria-hidden="true" />
        <strong>История · CSV</strong>
        <span>{history ? history.name : "До 50 000 записей"}</span>
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
      </div>
      <details className="import-format-help"><summary>Формат файлов · до 20 МиБ</summary><p>Профили: JSON {"{meta, employees}"}. История: CSV. Выберите хотя бы один файл. Весь пакет сохраняется целиком; одинаковые записи пропускаются.</p></details>
      <label className="import-preview-toggle">
        <input
          type="checkbox"
          checked={dryRun}
          disabled={busy || pending}
          onChange={(event) => {
            setDryRun(event.target.checked);
            setError(undefined);
            setResult(undefined);
          }}
        />
        Только проверить файлы, без сохранения
      </label>
      <button className="primary" disabled={busy} onClick={() => void submit()}>
        {busy
          ? "Обработка…"
          : pending
            ? "Повторить тот же импорт"
            : dryRun
              ? "Проверить файлы"
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
