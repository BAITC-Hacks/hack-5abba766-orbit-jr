"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Upload } from "lucide-react";
import type { ImportResult } from "../../../contracts/backend";
import { ApiClientError, apiRequest, endpoints, errorMessage } from "@/lib/api";

export default function ImportPanel({
  datasetRevision,
  onCommitted,
  onBusyChange,
}: {
  datasetRevision: number;
  onCommitted: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [employees, setEmployees] = useState<File | null>(null);
  const [history, setHistory] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [details, setDetails] = useState<Record<string, unknown> | undefined>();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const commitRef = useRef<{ key: string; revision: number } | null>(null);
  const [committed, setCommitted] = useState(false);
  function changeFile(kind: "employees" | "history", file: File | null) {
    if (kind === "employees") setEmployees(file);
    else setHistory(file);
    setResult(null);
    setError("");
    setDetails(undefined);
    setCommitted(false);
    commitRef.current = null;
  }
  async function submit(dryRun: boolean) {
    if (busyRef.current) return;
    if (!employees && !history) {
      setError("Выберите файл сотрудников JSON и/или историю CSV.");
      return;
    }
    if ((employees?.size ?? 0) + (history?.size ?? 0) > 20 * 1024 * 1024) {
      setError("Общий размер файлов должен быть не больше 20 МиБ.");
      return;
    }
    if (!dryRun && (!result || result.errors.length > 0 || !result.dry_run))
      return;
    if (!dryRun && !commitRef.current)
      commitRef.current = {
        key: crypto.randomUUID(),
        revision: result!.dataset_revision,
      };
    const body = new FormData();
    if (employees) body.set("employees", employees);
    if (history) body.set("history", history);
    body.set("dry_run", String(dryRun));
    body.set(
      "expected_dataset_revision",
      String(dryRun ? datasetRevision : commitRef.current!.revision),
    );
    busyRef.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setDetails(undefined);
    try {
      const response = await apiRequest<ImportResult>(endpoints.import, {
        method: "POST",
        body,
        headers: dryRun
          ? undefined
          : { "Idempotency-Key": commitRef.current!.key },
      });
      setResult(response);
      if (!dryRun) {
        setCommitted(true);
        commitRef.current = null;
        onCommitted();
      }
    } catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof ApiClientError) {
        setDetails(cause.details);
        if (cause.status >= 400 && cause.status < 500) {
          commitRef.current = null;
          setResult(null);
        }
      }
    } finally {
      setBusy(false);
      busyRef.current = false;
      onBusyChange(false);
    }
  }
  return (
    <>
      <span className="eyebrow">ДАННЫЕ КОМАНДЫ</span>
      <h2>Импорт сотрудников и истории</h2>
      <p className="modal-lead">
        Добавьте новые профили и участия. Сначала проверьте файлы: одинаковые
        записи будут пропущены, конфликтующие изменения не перезапишут
        существующие данные.
      </p>
      <div className="import-files">
        <label className="upload-zone">
          <Upload size={24} />
          <strong>Сотрудники · JSON</strong>
          <span>{employees?.name ?? "Объект с полями meta и employees"}</span>
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            aria-label="Файл сотрудников JSON"
            onChange={(event) =>
              changeFile("employees", event.target.files?.[0] ?? null)
            }
          />
        </label>
        <label className="upload-zone">
          <Upload size={24} />
          <strong>История · CSV</strong>
          <span>{history?.name ?? "Таблица участий из датасета"}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            aria-label="Файл истории CSV"
            onChange={(event) =>
              changeFile("history", event.target.files?.[0] ?? null)
            }
          />
        </label>
      </div>
      <p className="fine-print">
        Максимум 20 МиБ суммарно. Идентификаторы навыков, ролей и активностей
        должны присутствовать в текущем каталоге. Проверка не изменяет данные.
      </p>
      {error && (
        <div role="alert" className="error-panel">
          {error}
          {details && (
            <details>
              <summary>Подробности ошибки</summary>
              <pre className="error-details">
                {JSON.stringify(details, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
      {result && (
        <div className="import-result">
          <strong>
            {result.dry_run
              ? "Результат проверки"
              : result.applied
                ? "Импорт сохранён"
                : "Новых записей нет"}
          </strong>
          <p>
            Сотрудники: {result.counts.employees.new_rows} новых,{" "}
            {result.counts.employees.identical_rows} уже есть.
          </p>
          <p>
            История: {result.counts.history.new_rows} новых,{" "}
            {result.counts.history.identical_rows} уже есть.
          </p>
          {result.errors.map((issue, index) => (
            <p className="issue-error" key={`error-${index}`}>
              {issue.file}
              {issue.row !== undefined ? `, строка ${issue.row}` : ""}
              {issue.field ? `, ${issue.field}` : ""}: {issue.message}
            </p>
          ))}
          {result.warnings.map((issue, index) => (
            <p key={`warning-${index}`}>
              Примечание: {issue.file}
              {issue.row !== undefined ? `, строка ${issue.row}` : ""}:{" "}
              {issue.message}
            </p>
          ))}
        </div>
      )}
      {committed ? (
        <div className="success spaced">
          <CheckCircle2 size={18} />
          Данные и HR-обзор обновлены.
        </div>
      ) : (
        <div className="modal-actions spaced">
          <button
            className="secondary"
            disabled={busy || (!employees && !history)}
            onClick={() => void submit(true)}
          >
            {busy ? "Обрабатываем…" : "Проверить файлы"}
          </button>
          <button
            className="primary"
            disabled={busy || !result?.dry_run || result.errors.length > 0}
            onClick={() => void submit(false)}
          >
            Сохранить импорт
          </button>
        </div>
      )}
    </>
  );
}
