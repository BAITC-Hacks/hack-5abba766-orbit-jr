import { Compass } from "lucide-react";
import type { SessionView } from "../../../../contracts/backend";
export function Navigation({
  session,
  logout,
  busy,
}: {
  session: SessionView;
  logout: () => void;
  busy: boolean;
}) {
  const home = session.role === "hr" ? "/hr" : "/employee";
  return (
    <header className="global-nav connected-nav">
      <div className="nav-inner">
        <a className="brand" href={home}>
          <Compass size={21} />
          career<span>quest</span>
        </a>
        <nav aria-label="Главная навигация">
          <a href={home} aria-current="page">
            {session.role === "hr" ? "HR-обзор" : "Моё развитие"}
          </a>
        </nav>
        <div className="account-menu">
          <span className="account-name" title={session.display_name}>
            {session.display_name}
          </span>
          <button className="secondary" disabled={busy} onClick={logout}>
            {busy ? "Выход…" : "Выйти"}
          </button>
        </div>
      </div>
    </header>
  );
}
