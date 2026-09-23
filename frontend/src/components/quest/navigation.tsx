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
  return (
    <header className="global-nav">
      <div className="nav-inner">
        <a className="brand" href="/employee">
          <Compass size={21} />
          career<span>quest</span>
        </a>
        <nav aria-label="Главная навигация">
          <a href="/employee">Развитие</a>
          {session.role === "hr" && <a href="/hr">HR-обзор</a>}
        </nav>
        <button className="text-button" disabled={busy} onClick={logout}>
          Выйти · {session.display_name}
        </button>
      </div>
    </header>
  );
}
