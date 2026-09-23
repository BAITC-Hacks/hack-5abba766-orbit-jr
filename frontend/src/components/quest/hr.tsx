"use client";
import { useState } from "react";
import type {
  CatalogView,
  EmployeeDirectory,
  HrOverview as Overview,
} from "../../../../contracts/backend";
import { endpoints } from "@/lib/api";
import { useResource } from "@/hooks/use-resource";
import { Employee } from "./employee";
import { HrOverview } from "./hr-overview";
import { ImportPanel } from "./import-panel";
import { Failure, Loading } from "./feedback";
export function Hr({ onError }: { onError: (error: unknown) => void }) {
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("");
  const [role, setRole] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [revision, setRevision] = useState(0);
  const overview = useResource<Overview>(endpoints.hr, onError);
  const catalog = useResource<CatalogView>(endpoints.catalog, onError);
  const directory = useResource<EmployeeDirectory>(
    `${endpoints.employees}?${new URLSearchParams({ q, department, role, offset: String(offset), limit: "50" })}`,
    onError,
  );
  // The overview contract has no filtered HR query: directory filters apply only to the table.
  return (
    <>
      <div className="page-top">
        <div>
          <span className="eyebrow">ЛЮДИ И ВОЗМОЖНОСТИ</span>
          <h1>Рост начинается с людей.</h1>
          <p>Сводка разрешённой выборки. Без публичных рейтингов.</p>
        </div>
      </div>
      {overview.loading && <Loading>Загрузка HR-сводки…</Loading>}
      <Failure error={overview.error} retry={overview.reload} />
      {overview.data && <HrOverview data={overview.data} open={setSelected} />}
      <section className="people-panel">
        <h2>Сотрудники</h2>
        <p>
          Фильтры применяются только к списку сотрудников; сводка выше
          показывает всю разрешённую выборку.
        </p>
        <div className="toolbar">
          <label>
            Поиск
            <input
              value={q}
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
              onChange={(e) => {
                setDepartment(e.target.value);
                setOffset(0);
              }}
              placeholder="Название отдела"
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
              ).map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>
        {directory.loading && <Loading />}
        <Failure error={directory.error} retry={directory.reload} />
        {directory.data && (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Сотрудник</th>
                    <th>Отдел</th>
                    <th>Роль</th>
                    <th>Грейд</th>
                  </tr>
                </thead>
                <tbody>
                  {directory.data.items.map((p) => (
                    <tr key={p.employee_id}>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setSelected(p.employee_id)}
                        >
                          {p.full_name}
                        </button>
                      </td>
                      <td>{p.department}</td>
                      <td>{p.role}</td>
                      <td>{p.grade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!directory.data.items.length && <p>Сотрудники не найдены.</p>}
            <p>Всего по фильтрам: {directory.data.total}</p>
            <div className="modal-actions">
              <button
                className="secondary"
                disabled={!offset}
                onClick={() => setOffset((n) => Math.max(0, n - 50))}
              >
                Назад
              </button>
              <button
                className="secondary"
                disabled={offset + 50 >= directory.data.total}
                onClick={() => setOffset((n) => n + 50)}
              >
                Далее
              </button>
            </div>
          </>
        )}
      </section>
      {selected && (
        <section className="selected-employee">
          <button className="secondary" onClick={() => setSelected(undefined)}>
            Закрыть профиль
          </button>
          <Employee
            key={`${selected}-${revision}`}
            id={selected}
            onError={onError}
            onChanged={() => {
              overview.reload();
              directory.reload();
            }}
          />
        </section>
      )}
      <Failure error={catalog.error} retry={catalog.reload} />
      {catalog.data && (
        <ImportPanel
          revision={catalog.data.dataset_revision}
          onError={onError}
          onRefresh={() => {
            overview.reload();
            directory.reload();
            catalog.reload();
            setRevision((n) => n + 1);
          }}
        />
      )}
      {catalog.loading && (
        <Loading>Загрузка версии данных для импорта…</Loading>
      )}
    </>
  );
}
