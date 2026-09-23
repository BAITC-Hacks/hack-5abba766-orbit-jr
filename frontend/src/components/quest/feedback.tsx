import { ApiFailure } from "@/lib/api";
export function Failure({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  if (!error) return null;
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
      {error instanceof ApiFailure && error.details && (
        <pre>{JSON.stringify(error.details, null, 2)}</pre>
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
    <p className="feedback" role="status">
      {children}
    </p>
  );
}
