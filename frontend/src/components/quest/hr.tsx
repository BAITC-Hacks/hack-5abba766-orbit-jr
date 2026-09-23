"use client";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  Users,
  Upload,
  ArrowLeft,
  ArrowUpRight,
  Search,
} from "lucide-react";
import type {
  CatalogView,
  EmployeeDirectory,
  HrOverview as Overview,
} from "../../../../contracts/backend";
import { endpoints } from "@/lib/api";
import { useResource } from "@/hooks/use-resource";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { Employee } from "./employee";
import { HrOverview } from "./hr-overview";
import { ImportPanel } from "./import-panel";
import { Failure, Loading } from "./feedback";
type Section = "overview" | "people" | "import";
const sections = [
  {
    id: "overview" as const,
    label: "Обзор команды",
    description: "Цели и потребности в обучении",
    icon: LayoutDashboard,
  },
  {
    id: "people" as const,
    label: "Сотрудники",
    description: "Найти и открыть профиль",
    icon: Users,
  },
  {
    id: "import" as const,
    label: "Импорт данных",
    description: "Добавить профили и историю",
    icon: Upload,
  },
];
export function Hr({ onError }: { onError: (error: unknown) => void }) {
  const [section, setSection] = useState<Section>("overview");
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("");
  const [role, setRole] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [revision, setRevision] = useState(0);
  const profilePanel = useRef<HTMLElement>(null);
  const profileTrigger = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const settledQ = useDebouncedValue(q);
  const settledDepartment = useDebouncedValue(department);
  const filtersPending = q !== settledQ || department !== settledDepartment;
  const overview = useResource<Overview>(endpoints.hr, onError);
  const catalog = useResource<CatalogView>(endpoints.catalog, onError);
  const directory = useResource<EmployeeDirectory>(
    endpoints.employees +
      "?" +
      new URLSearchParams({
        ...(settledQ.trim() ? { q: settledQ.trim() } : {}),
        ...(settledDepartment.trim()
          ? { department: settledDepartment.trim() }
          : {}),
        ...(role ? { role } : {}),
        offset: String(offset),
        limit: "24",
      }),
    onError,
  );
  function openProfile(id: string) {
    profileTrigger.current = document.activeElement as HTMLElement | null;
    setSelected(id);
  }
  useEffect(() => {
    if (selected && profilePanel.current) {
      profilePanel.current.focus({ preventScroll: true });
      profilePanel.current.scrollIntoView({ block: "start" });
    } else if (profileTrigger.current) {
      if (profileTrigger.current.isConnected) profileTrigger.current.focus();
      else heading.current?.focus();
      profileTrigger.current = null;
    }
  }, [selected]);
  function refresh() {
    overview.reload();
    directory.reload();
    catalog.reload();
    setRevision((n) => n + 1);
  }
  function clearFilters() {
    setQ("");
    setDepartment("");
    setRole("");
    setOffset(0);
  }
  return (
    <>
      <div hidden={!!selected}>
        <header className="page-top hr-heading">
          <div>
            <span className="eyebrow">КАБИНЕТ HR</span>
            <h1 ref={heading} tabIndex={-1}>
              Развитие команды
            </h1>
            <p>
              Находите потребности в обучении и помогайте сотрудникам сделать
              следующий шаг.
            </p>
          </div>
          <span className="workspace-label">
            <Users size={16} aria-hidden="true" />
            Рабочее пространство HR
          </span>
        </header>
        <nav className="hr-sections" aria-label="Разделы HR">
          {sections.map(({ id, label, description, icon: Icon }) => (
            <button
              key={id}
              className={section === id ? "active" : ""}
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
            >
              <Icon size={22} aria-hidden="true" />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </button>
          ))}
        </nav>
        <div hidden={section !== "overview"} className="hr-view">
          {overview.loading && <Loading>Обновляем сводку команды…</Loading>}
          <Failure error={overview.error} retry={overview.reload} />
          {overview.data && (
            <HrOverview
              data={overview.data}
              open={openProfile}
              showPeople={() => setSection("people")}
              names={Object.fromEntries(
                catalog.data?.skills.map((s) => [s.skill_id, s.name]) ?? [],
              )}
            />
          )}
        </div>
        <section
          hidden={section !== "people"}
          className="hr-view people-workspace"
          aria-labelledby="directory-title"
        >
          <div className="section-heading">
            <div>
              <h2 id="directory-title">Сотрудники</h2>
              <p className="section-description">
                Откройте профиль, чтобы посмотреть навыки, выбрать цель и план
                развития.
              </p>
            </div>
          </div>
          <div className="toolbar directory-filters">
            <label>
              Поиск по имени
              <input
                value={q}
                placeholder="Например, Анна"
                onChange={(e) => {
                  setQ(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label>
              Отдел
              <input
                value={department}
                placeholder="Полное название отдела"
                onChange={(e) => {
                  setDepartment(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label>
              Роль
              <select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">Все роли</option>
                {Array.from(
                  new Set(catalog.data?.role_profiles.map((p) => p.role)),
                )
                  .sort()
                  .map((r) => (
                    <option key={r}>{r}</option>
                  ))}
              </select>
            </label>
            {(q || department || role) && (
              <button className="secondary" onClick={clearFilters}>
                Сбросить
              </button>
            )}
          </div>
          <Failure error={catalog.error} retry={catalog.reload} />
          {(directory.loading || filtersPending) && (
            <Loading>Ищем сотрудников…</Loading>
          )}
          <Failure error={directory.error} retry={directory.reload} />
          {directory.data && !filtersPending && (
            <>
              <p className="directory-count" role="status">
                Найдено сотрудников: <strong>{directory.data.total}</strong>
                {directory.data.total > 0 && (
                  <>
                    {" "}
                    · показаны {offset + 1}–
                    {offset + directory.data.items.length}
                  </>
                )}
              </p>
              <div className="employee-grid">
                {directory.data.items.map((p) => (
                  <button
                    className="employee-card"
                    key={p.employee_id}
                    onClick={() => openProfile(p.employee_id)}
                    aria-label={"Открыть профиль: " + p.full_name}
                  >
                    <span className="employee-avatar" aria-hidden="true">
                      {p.full_name
                        .split(" ")
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((n) => n[0])
                        .join("")}
                    </span>
                    <span className="employee-card-body">
                      <strong>{p.full_name}</strong>
                      <span>
                        {p.role} · {p.grade}
                      </span>
                      <small>{p.department}</small>
                      <span className="employee-link">
                        Открыть профиль{" "}
                        <ArrowUpRight size={15} aria-hidden="true" />
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {!directory.data.items.length && (
                <div className="empty-state">
                  <Search size={32} aria-hidden="true" />
                  <h3>Сотрудники не найдены</h3>
                  <p>Измените имя, отдел или роль и попробуйте снова.</p>
                  {(q || department || role) && (
                    <button className="secondary" onClick={clearFilters}>
                      Сбросить фильтры
                    </button>
                  )}
                </div>
              )}
              {directory.data.total > 24 && (
                <div className="directory-pagination">
                  <button
                    className="secondary"
                    disabled={!offset || directory.loading || filtersPending}
                    onClick={() => setOffset((n) => Math.max(0, n - 24))}
                  >
                    Назад
                  </button>
                  <span>
                    Страница {Math.floor(offset / 24) + 1} из{" "}
                    {Math.ceil(directory.data.total / 24)}
                  </span>
                  <button
                    className="secondary"
                    disabled={
                      directory.loading ||
                      filtersPending ||
                      offset + 24 >= directory.data.total
                    }
                    onClick={() => setOffset((n) => n + 24)}
                  >
                    Далее
                  </button>
                </div>
              )}
            </>
          )}
        </section>
        <div hidden={section !== "import"} className="hr-view">
          <div className="import-guide">
            <span className="eyebrow">ОБНОВЛЕНИЕ КОМАНДЫ</span>
            <h2>Добавьте данные в три шага</h2>
            <ol>
              <li>
                <strong>Выберите файлы</strong>
                <span>Профили сотрудников и/или историю обучения.</span>
              </li>
              <li>
                <strong>Проверьте содержимое</strong>
                <span>
                  Включите проверку без сохранения и изучите результат.
                </span>
              </li>
              <li>
                <strong>Примените импорт</strong>
                <span>Отключите режим проверки и нажмите «Импортировать».</span>
              </li>
            </ol>
            <p>
              Новые записи добавятся, одинаковые будут пропущены. Конфликтующие
              изменения остановят весь импорт.
            </p>
          </div>
          <Failure error={catalog.error} retry={catalog.reload} />
          {catalog.data && (
            <ImportPanel
              revision={catalog.data.dataset_revision}
              onError={onError}
              onRefresh={refresh}
            />
          )}
          {catalog.loading && <Loading>Загрузка данных для импорта…</Loading>}
        </div>
      </div>
      {selected && (
        <section
          className="selected-employee hr-profile"
          ref={profilePanel}
          tabIndex={-1}
          aria-label="Выбранный профиль сотрудника"
        >
          <div className="profile-context">
            <button
              className="secondary"
              onClick={() => setSelected(undefined)}
            >
              <ArrowLeft size={17} aria-hidden="true" />
              Вернуться {section === "people" ? "к сотрудникам" : "к обзору"}
            </button>
            <p>
              Вы просматриваете профиль как HR. Изменение цели и симуляция
              сохраняются для этого сотрудника.
            </p>
          </div>
          <Employee
            key={selected + "-" + revision}
            id={selected}
            onError={onError}
            onChanged={() => {
              overview.reload();
              directory.reload();
            }}
          />
        </section>
      )}
    </>
  );
}
