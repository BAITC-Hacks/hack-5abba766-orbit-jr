import { LogOut, LayoutDashboard, Sprout } from "lucide-react";
import type { SessionView } from "../../../../contracts/backend";
import { Brand } from "./visuals";
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
        <a
          className="brand"
          href={home}
          aria-label="Halyk Career Quest — главная"
        >
          <Brand />
        </a>
        <nav aria-label="Главная навигация">
          <a href={home} aria-current="page">
            {session.role === "hr" ? (
              <LayoutDashboard size={17} />
            ) : (
              <Sprout size={18} />
            )}{" "}
            {session.role === "hr" ? "Пространство HR" : "Моё развитие"}
          </a>
        </nav>
        <div className="account-menu">
          <span className="account-avatar" aria-hidden="true">
            {session.display_name.slice(0, 1)}
          </span>
          <span className="account-name" title={session.display_name}>
            {session.display_name}
            <small>{session.role === "hr" ? "HR-партнёр" : "Сотрудник"}</small>
          </span>
          <button
            className="secondary nav-logout"
            disabled={busy}
            onClick={logout}
            aria-label={busy ? "Выход…" : "Выйти"}
          >
            <LogOut size={17} />
            <span>{busy ? "Выход…" : "Выйти"}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
