"use client";
import { CatalogSelect } from "./catalog-select";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  Users,
  Upload,
  ArrowLeft,
  ArrowUpRight,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
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
  const hasFilters = !!(q.trim() || department.trim() || role);
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
      <div hidden={!!selected} className="hr-workspace">
        <header className="page-top hr-heading">
          <div className="hr-heading-copy">
            <span className="eyebrow">HALYK · PEOPLE & GROWTH</span>
            <h1 ref={heading} tabIndex={-1}>
              Развитие команды
            </h1>
            <p>Видеть потенциал. Находить точки роста. Поддерживать команду.</p>
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
              aria-controls={`hr-${id}`}
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
        <div id="hr-overview" hidden={section !== "overview"} className="hr-view">
          {overview.loading && <Loading>Обновляем сводку команды…</Loading>}
          <Failure error={overview.error} retry={overview.reload} />
          {overview.data && (
            <HrOverview
              data={overview.data}
              open={openProfile}
              showPeople={() => setSection("people")}
              showImport={() => setSection("import")}
              names={Object.fromEntries(
                catalog.data?.skills.map((s) => [s.skill_id, s.name]) ?? [],
              )}
            />
          )}
        </div>
        <section
          id="hr-people"
          hidden={section !== "people"}
          className="hr-view people-workspace"
          aria-labelledby="directory-title"
          aria-busy={directory.loading || filtersPending}
        >
          <div className="section-heading directory-heading">
            <div className="directory-heading-copy">
              <span className="eyebrow">ЛЮДИ И ПОТЕНЦИАЛ</span>
              <h2 id="directory-title">
                Ваша команда
                {directory.data && !filtersPending && !directory.loading && (
                  <span className="directory-total" aria-label="Найдено сотрудников">
                    {directory.data.total}
                  </span>
                )}
              </h2>
              <p>Откройте профиль, чтобы изучить навыки, цель и историю обучения.</p>
            </div>
            <button className="secondary" onClick={() => setSection("import")}>
              <Upload size={16} aria-hidden="true" />
              Добавить сотрудников
            </button>
          </div>
          <div className="toolbar directory-filters">
            <label className="directory-search-field">
              Имя или ID сотрудника
              <span className="directory-input-wrap">
                <Search size={18} aria-hidden="true" />
              <input
                type="search"
                value={q}
                maxLength={200}
                placeholder="Найти сотрудника…"
                onChange={(e) => {
                  setQ(e.target.value);
                  setOffset(0);
                }}
              />
              </span>
            </label>
            <label>
              Отдел
              <input
                value={department}
                maxLength={200}
                aria-describedby="directory-department-help"
                placeholder="Полное название отдела"
                onChange={(e) => {
                  setDepartment(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <CatalogSelect label="Роль" value={role} onChange={(value) => { setRole(value); setOffset(0); }}
              options={[["", "Все роли"], ...Array.from(new Set(catalog.data?.role_profiles.map((p) => p.role))).sort().map((r): [string, string] => [r, r])]} />
            {(q || department || role) && (
              <button className="secondary" onClick={clearFilters}>
                Сбросить
              </button>
            )}
          </div>
          <small id="directory-department-help" className="directory-filter-help">
            Отдел ищется по полному названию. Поиск по имени и ID — по части текста.
          </small>
          {hasFilters && (
            <div className="directory-active-filters" aria-label="Активные фильтры">
              <span>Фильтры:</span>
              {[
                { label: "Поиск", value: q.trim(), clear: () => setQ("") },
                { label: "Отдел", value: department.trim(), clear: () => setDepartment("") },
                { label: "Роль", value: role, clear: () => setRole("") },
              ].filter((filter) => filter.value).map((filter) => (
                <button
                  key={filter.label}
                  className="directory-filter-chip"
                  aria-label={`Убрать фильтр ${filter.label}: ${filter.value}`}
                  onClick={() => { filter.clear(); setOffset(0); }}
                >
                  {filter.label}: {filter.value}
                  <X size={14} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          <Failure error={catalog.error} retry={catalog.reload} />
          {(directory.loading || filtersPending) && (
            <Loading>Ищем сотрудников…</Loading>
          )}
          <Failure error={directory.error} retry={directory.reload} />
          {directory.data && !filtersPending && (
            <>
              <p className="directory-count" role="status">
                Найдено сотрудников: <strong>{directory.data.total}</strong>
                {directory.data.items.length > 0 && (
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
                        {p.role} <span className="employee-grade">{p.grade}</span>
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
                  <h3>{directory.data.total > 0 ? "На этой странице нет сотрудников" : hasFilters ? "Сотрудники не найдены" : "В команде пока нет сотрудников"}</h3>
                  <p>{directory.data.total > 0 ? "Список изменился. Вернитесь к первой странице." : hasFilters ? "Измените имя, отдел или роль и попробуйте снова." : "Добавьте профили через импорт, чтобы видеть команду и планировать обучение."}</p>
                  {directory.data.total > 0 ? (
                    <button className="secondary" onClick={() => setOffset(0)}>
                      На первую страницу
                    </button>
                  ) : hasFilters ? (
                    <button className="secondary" onClick={clearFilters}>
                      Сбросить фильтры
                    </button>
                  ) : (
                    <button className="secondary" onClick={() => setSection("import")}>
                      Перейти к импорту
                    </button>
                  )}
                </div>
              )}
              {directory.data.total > 24 && (
                <nav className="directory-pagination" aria-label="Страницы сотрудников">
                  <button
                    className="secondary"
                    disabled={!offset || directory.loading || filtersPending}
                    onClick={() => setOffset((n) => Math.max(0, n - 24))}
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
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
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </nav>
              )}
            </>
          )}
        </section>
        <div id="hr-import" hidden={section !== "import"} className="hr-view">
          <div className="section-heading directory-heading">
            <div>
              <span className="eyebrow">ДАННЫЕ КОМАНДЫ</span>
              <h2>Актуальные профили — точные решения</h2>
              <p>Загрузите сотрудников и историю обучения, чтобы обновить картину развития.</p>
            </div>
          </div>
          <details className="import-format-help">
            <summary>Как работает импорт</summary>
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
          </details>
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
              Просмотр HR. Цель и обучение выбирает сотрудник.
            </p>
          </div>
          <Employee
            viewer="hr"
            readOnly
            initialTab="profile"
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
