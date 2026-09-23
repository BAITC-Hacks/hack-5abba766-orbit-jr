import { LogOut, LayoutDashboard, Sprout } from "lucide-react";
import type { SessionView } from "../../../../contracts/backend";
import { Brand } from "./visuals";
export function Navigation({
  session,
  logout,
  busy,
  profileActive = false,
}: {
  session: SessionView;
  logout: () => void;
  busy: boolean;
  profileActive?: boolean;
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
          <a href={home} aria-current={!profileActive ? "page" : undefined}>
            {session.role === "hr" ? (
              <LayoutDashboard size={17} aria-hidden="true" />
            ) : (
              <Sprout size={18} aria-hidden="true" />
            )}{" "}
            {session.role === "hr" ? "Пространство HR" : "Моё развитие"}
          </a>
        </nav>
        <div className="account-menu">
          {session.role === "employee" ? <a className="account-avatar" href="/employee/profile" aria-label="Мой профиль" aria-current={profileActive ? "page" : undefined}>
            {session.display_name.slice(0, 1)}
          </a> : <span className="account-avatar" aria-hidden="true">
            {session.display_name.slice(0, 1)}
          </span>}
          <span className="account-name" title={session.display_name}>
            {session.display_name}
            <small>{session.role === "hr" ? "HR-партнёр" : "Сотрудник"}</small>
          </span>
          <button
            type="button"
            className="secondary nav-logout"
            disabled={busy}
            onClick={logout}
            aria-label={busy ? "Выход…" : "Выйти"}
          >
            <LogOut size={17} aria-hidden="true" />
            <span>{busy ? "Выход…" : "Выйти"}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
