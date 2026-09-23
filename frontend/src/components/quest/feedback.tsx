import { ApiFailure } from "@/lib/api";
export function Failure({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  if (!error) return null;
  const details = error instanceof ApiFailure ? error.details : undefined;
  const issues = Array.isArray(details?.errors)
    ? details.errors.filter(
        (issue): issue is Record<string, unknown> =>
          !!issue &&
          typeof issue === "object" &&
          typeof issue.message === "string",
      )
    : [];
  return (
    <div className="feedback error" role="alert">
      <p>
        {error instanceof Error
          ? error.message
          : "Не удалось выполнить действие."}
      </p>
      {error instanceof ApiFailure && error.requestId && (
        <small>Запрос: {error.requestId}</small>
      )}
      {issues.length > 0 && (
        <ul>
          {issues.map((issue, index) => (
            <li key={index}>
              {issue.file === "employees"
                ? "Профили"
                : issue.file === "history"
                  ? "История"
                  : "Файл"}
              {typeof issue.row === "number" ? ` · строка ${issue.row}` : ""}
              {typeof issue.field === "string" ? ` · ${issue.field}` : ""}:{" "}
              {String(issue.message)}
            </li>
          ))}
        </ul>
      )}
      {details && !issues.length && (
        <details>
          <summary>Подробности ошибки</summary>
          <pre>{JSON.stringify(details, null, 2)}</pre>
        </details>
      )}
      {retry && (
        <button className="secondary" onClick={retry}>
          Повторить
        </button>
      )}
    </div>
  );
}
export function Loading({
  children = "Загрузка…",
}: {
  children?: React.ReactNode;
}) {
  return (
    <p className="feedback loading-feedback" role="status">
      <span className="button-spinner" aria-hidden="true" />
      {children}
    </p>
  );
}
