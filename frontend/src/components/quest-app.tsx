"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronRight,
  Compass,
  Sparkles,
  Clock,
  MapPin,
  Plus,
  X,
  Search,
  SlidersHorizontal,
  Upload,
  CheckCircle2,
  Layers,
  Target,
  BookOpen,
  Users,
  TrendingUp,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { courses, initialSkills, people, type Course } from "@/lib/demo";
type View = "overview" | "catalog" | "history" | "hr";
export default function QuestApp({
  initialView = "overview",
}: {
  initialView?: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const [done, setDone] = useState<string[]>([]);
  const [started, setStarted] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<Course | null>(null);
  const [dialog, setDialog] = useState<"goal" | "import" | "profile" | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Все");
  const [department, setDepartment] = useState("Все отделы");
  const [toast, setToast] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [goal, setGoal] = useState("Senior");
  const [draftGoal, setDraftGoal] = useState("Senior");
  const modalRef = useRef<HTMLDialogElement>(null);
  const skills = initialSkills.map((s) => ({
    ...s,
    level: Math.min(
      5,
      s.level +
        courses
          .filter((c) => done.includes(c.id) && c.skill === s.id)
          .reduce((n, c) => n + c.gain, 0),
    ),
    required: goal === "Lead" ? Math.min(5, s.required + 1) : s.required,
  }));
  const total = skills.reduce((n, s) => n + s.required, 0);
  const progress = Math.round(
    (100 * skills.reduce((n, s) => n + Math.min(s.level, s.required), 0)) /
      total,
  );
  const critical = skills.filter((s) => s.critical);
  const openCourses = courses.filter((c) => !done.includes(c.id));
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("cq-ui-v1") || "null");
      if (saved) {
        setDone(
          courses.filter((c) => saved.done?.includes(c.id)).map((c) => c.id),
        );
        setStarted(
          courses.filter((c) => saved.started?.includes(c.id)).map((c) => c.id),
        );
        setGoal(saved.goal === "Lead" ? "Lead" : "Senior");
      }
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready)
      localStorage.setItem("cq-ui-v1", JSON.stringify({ done, started, goal }));
  }, [done, started, goal, ready]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (selected || dialog) modalRef.current?.showModal();
    else modalRef.current?.close();
  }, [selected, dialog]);
  function close() {
    setSelected(null);
    setDialog(null);
  }
  function navigate(v: View) {
    setView(v);
    setQuery("");
    setFilter("Все");
  }
  function complete(c: Course) {
    if (!done.includes(c.id)) {
      setDone((d) => [...d, c.id]);
      setToast("Демо-завершение сохранено. Навыки и прогресс обновлены.");
    }
    close();
  }
  const filtered = courses.filter(
    (c) =>
      (filter === "Все" || c.type === filter) &&
      `${c.title} ${c.subtitle}`.toLowerCase().includes(query.toLowerCase()),
  );
  function courseCard(c: Course) {
    const completed = done.includes(c.id);
    return (
      <article className="course-card" key={c.id}>
        <button
          className={`course-art ${c.accent}`}
          onClick={() => setSelected(c)}
          aria-label={`Подробнее: ${c.title}`}
        >
          <span className="art-label">{c.type}</span>
          <div className={`sculpture ${c.accent}`} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
          <span className="art-arrow">
            <ArrowUpRight size={19} />
          </span>
        </button>
        <div className="course-body">
          <div className="course-meta">
            <span>{c.format}</span>
            <span>·</span>
            <span>{c.hours} часов</span>
            {completed && (
              <span className="completed-mini">
                <Check size={12} />
                Готово
              </span>
            )}
          </div>
          <h3>{c.title}</h3>
          <p>{c.subtitle}</p>
          <div className="course-bottom">
            <span className="gain">
              {completed ? "Навык обновлён" : "+1 к навыку"}
            </span>
            <button className="text-button" onClick={() => setSelected(c)}>
              {completed
                ? "Результат"
                : started.includes(c.id)
                  ? "Продолжить"
                  : "Подробнее"}
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </article>
    );
  }
  return (
    <>
      <header className="global-nav">
        <div className="nav-inner">
          <a className="brand" href="/employee">
            <span className="brand-icon">
              <Compass size={21} />
            </span>
            career<span>quest</span>
            <span className="brand-dot" />
          </a>
          <nav aria-label="Главная навигация">
            <button
              className={view === "overview" || view === "history" ? "active" : ""}
              onClick={() => navigate("overview")}
            >
              Моё развитие
            </button>
            <button
              className={view === "catalog" ? "active" : ""}
              onClick={() => navigate("catalog")}
            >
              Каталог
            </button>
            <button
              className={view === "hr" ? "active" : ""}
              onClick={() => navigate("hr")}
            >
              HR-обзор
            </button>
          </nav>
          <button
            className="avatar"
            aria-label="Открыть профиль"
            onClick={() => setDialog("profile")}
          >
            АИ
          </button>
        </div>
      </header>
      <div className="demo-strip">
        <span className="status-dot" />
        Интерактивный прототип<span className="strip-divider">/</span>
        Демонстрационные данные · AI не подключён
      </div>
      <main>
        <div className="page-top">
          <div>
            <div className="eyebrow">
              {view === "hr"
                ? "ЛЮДИ И ВОЗМОЖНОСТИ"
                : "ВАША КАРЬЕРА. ВАШ МАРШРУТ."}
            </div>
            <h1>
              {view === "hr"
                ? "Рост начинается с людей."
                : view === "catalog"
                  ? "Найдите свой следующий шаг."
                  : view === "history"
                    ? "Каждый шаг имеет значение."
                    : "Большое начинается с вас."}
            </h1>
            <p>
              {view === "hr"
                ? "Замечайте потребности. Создавайте возможности для развития."
                : view === "catalog"
                  ? "Возможности, которые превращают интерес в новый навык."
                  : view === "history"
                    ? "Всё, чему вы научились, и то, что ещё впереди."
                    : "Акмарал, ваше следующее достижение ближе, чем кажется."}
            </p>
          </div>
          <span className="date-chip">1 октября 2026</span>
        </div>
        {view !== "hr" && (
          <div className="subnav" aria-label="Разделы развития">
            {(
              [
                ["overview", "Обзор"],
                ["catalog", "Возможности"],
                ["history", "Моя активность"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                className={view === v ? "selected" : ""}
                onClick={() => navigate(v)}
              >
                {label}
                {v === "history" && started.length > 0 && (
                  <span>{started.length}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {view === "overview" && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <span className="pill">
                  <span className="status-dot" />
                  Ваша траектория
                </span>
                <h2>
                  Следующая глава.
                  <br />
                  <span>{goal} Engineer.</span>
                </h2>
                <p>
                  Ваш опыт уже стал прочной основой.
                  <br />
                  Теперь — больше масштаба, влияния и возможностей.
                </p>
                <button
                  className="primary"
                  onClick={() =>
                    document
                      .getElementById("next-steps")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  К следующим шагам
                  <ArrowRight size={17} />
                </button>
                <button
                  className="hero-link"
                  onClick={() => {
                    setDraftGoal(goal);
                    setDialog("goal");
                  }}
                >
                  Изменить цель
                  <ChevronRight size={15} />
                </button>
              </div>
              <div
                className="orbit-scene"
                aria-label={`Соответствие цели ${progress}%`}
              >
                <div className="orbital orbit-one" />
                <div className="orbital orbit-two" />
                <div className="orbital orbit-three" />
                <div className="planet-glow" />
                <div className="progress-orb">
                  <span>ВАШ ПРОГРЕСС</span>
                  <strong>
                    {progress}
                    <small>%</small>
                  </strong>
                  <p>на пути к {goal}</p>
                  <div className="orb-track">
                    <i style={{ width: `${progress}%` }} />
                  </div>
                </div>
                <div className="float-label float-top">
                  <Sparkles size={16} />
                  <span>Потенциал становится опытом</span>
                </div>
                <div className="float-label float-bottom">
                  <span className="small-check">
                    <Check size={12} />
                  </span>
                  Каждый шаг — ближе к цели
                </div>
                <span className="orbit-dot dot-one" />
                <span className="orbit-dot dot-two" />
              </div>
              <div className="hero-foot">
                <span>
                  Backend Engineer <ChevronRight size={13} />
                  Middle <ChevronRight size={13} />
                  <b>{goal}</b>
                </span>
                <span>Цель выбрана вами</span>
              </div>
            </section>
            <section className="metrics">
              <div>
                <span className="metric-icon">
                  <Target size={20} />
                </span>
                <div>
                  <strong>
                    {skills.filter((s) => s.level >= s.required).length}
                    <small> / {skills.length}</small>
                  </strong>
                  <p>навыков соответствуют цели</p>
                </div>
              </div>
              <div>
                <span className="metric-icon lavender">
                  <Layers size={20} />
                </span>
                <div>
                  <strong>
                    {critical.filter((s) => s.level < s.required).length}
                  </strong>
                  <p>приоритетных навыка для роста</p>
                </div>
              </div>
              <div>
                <span className="metric-icon mint">
                  <CheckCircle2 size={20} />
                </span>
                <div>
                  <strong>{2 + done.length}</strong>
                  <p>завершённых активностей в демо</p>
                </div>
              </div>
            </section>
            <section id="next-steps">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">В НУЖНОМ НАПРАВЛЕНИИ</span>
                  <h2>Маленькие шаги. Большие перемены.</h2>
                </div>
                <button
                  className="text-button"
                  onClick={() => navigate("catalog")}
                >
                  Все возможности
                  <ArrowUpRight size={16} />
                </button>
              </div>
              <div className="insight">
                <span className="insight-icon">
                  <Sparkles size={21} />
                </span>
                <div>
                  <strong>Сначала — то, что приблизит к цели.</strong>
                  <p>
                    {openCourses.length
                      ? "В демо-подборке учтены разрывы в навыках, требования роли и история обучения."
                      : "Вы завершили все активности демо-подборки. Новые шаги появятся после подключения backend."}
                  </p>
                </div>
                <span className="outline-tag">Демо-подборка</span>
              </div>
              <div className="course-grid">
                {openCourses.length ? (
                  openCourses.map(courseCard)
                ) : (
                  <div className="empty">
                    <CheckCircle2 />
                    <h3>Отличный результат.</h3>
                    <p>Все предложенные шаги завершены.</p>
                    <button
                      className="text-button"
                      onClick={() => navigate("history")}
                    >
                      Посмотреть историю
                      <ArrowRight size={15} />
                    </button>
                  </div>
                )}
              </div>
            </section>
            <section className="skills-panel">
              <div className="skills-intro">
                <span className="eyebrow">ВИДЕТЬ СВОЙ РОСТ</span>
                <h2>
                  Ваш опыт.
                  <br />В новой перспективе.
                </h2>
                <p>
                  Сравните текущие навыки с требованиями цели. Каждый
                  завершённый шаг меняет картину.
                </p>
                <div className="legend">
                  <span>
                    <i />
                    Текущий уровень
                  </span>
                  <span>
                    <i />
                    До цели
                  </span>
                </div>
                <small>
                  Расчётное соответствие навыков.
                  <br />
                  Не является гарантией повышения.
                </small>
              </div>
              <div className="skill-list">
                {skills.map((s) => (
                  <div className="skill-row" key={s.id}>
                    <div>
                      <span>
                        {s.name}
                        {s.critical && (
                          <span className="critical">Приоритет</span>
                        )}
                      </span>
                      <b>
                        {s.level}
                        <em> / {s.required}</em>
                        {s.level >= s.required && <Check size={14} />}
                      </b>
                    </div>
                    <div className="skill-segments">
                      {Array.from({ length: 5 }, (_, i) => (
                        <span
                          key={i}
                          className={
                            i < s.level
                              ? "filled"
                              : i < s.required
                                ? "needed"
                                : ""
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
        {view === "catalog" && (
          <>
            <div className="toolbar">
              <label className="search">
                <Search size={18} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Найти возможность"
                />
              </label>
              <div className="filter-pills">
                {["Все", "Воркшоп", "Курс", "Программа"].map((t) => (
                  <button
                    className={filter === t ? "chosen" : ""}
                    onClick={() => setFilter(t)}
                    key={t}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="catalog-count">
              {filtered.length} возможности в демо-каталоге
            </div>
            <div className="course-grid">{filtered.map(courseCard)}</div>
            {!filtered.length && (
              <div className="empty">
                <Search />
                <h3>Ничего не найдено</h3>
                <p>Попробуйте другое название или снимите фильтр.</p>
                <button
                  className="text-button"
                  onClick={() => {
                    setQuery("");
                    setFilter("Все");
                  }}
                >
                  Сбросить поиск
                </button>
              </div>
            )}
          </>
        )}
        {view === "history" && (
          <section className="history-panel">
            <div className="section-heading">
              <h2>Ваш путь в деталях</h2>
              <span className="outline-tag">Демо-история</span>
            </div>
            {courses
              .filter((c) => started.includes(c.id) || done.includes(c.id))
              .map((c) => (
                <div className="history-row" key={c.id}>
                  <span
                    className={`history-icon ${done.includes(c.id) ? "finished" : ""}`}
                  >
                    {done.includes(c.id) ? (
                      <Check size={20} />
                    ) : (
                      <BookOpen size={20} />
                    )}
                  </span>
                  <div>
                    <h3>{c.title}</h3>
                    <p>
                      {done.includes(c.id)
                        ? "Симуляция завершения · навык обновлён"
                        : "В процессе · ваш следующий шаг"}
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setSelected(c)}
                  >
                    {done.includes(c.id) ? "Результат" : "Продолжить"}
                    <ChevronRight size={15} />
                  </button>
                </div>
              ))}
            {[
              "Практика проектирования API",
              "Командный воркшоп: обратная связь",
            ].map((title, i) => (
              <div className="history-row" key={title}>
                <span className="history-icon finished">
                  <Check size={20} />
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>
                    {i ? "12 августа" : "18 сентября"} 2026 · завершено в
                    демо-истории
                  </p>
                </div>
                <span className="muted">Завершено</span>
              </div>
            ))}
          </section>
        )}
        {view === "hr" && (
          <>
            <div className="hr-toolbar">
              <div className="pill">
                <ShieldCheck size={16} />
                Предпросмотр HR · без авторизации
              </div>
              <button
                className="primary"
                onClick={() => {
                  setImportStatus("");
                  setDialog("import");
                }}
              >
                <Upload size={16} />
                Импорт данных
              </button>
            </div>
            <section className="hr-metrics">
              {[
                [Users, "5", "сотрудников в выборке"],
                [TrendingUp, "70%", "среднее соответствие цели"],
                [Target, "2", "сотрудника требуют внимания"],
              ].map(([Icon, num, label], i) => {
                const I = Icon as typeof Users;
                return (
                  <div key={i}>
                    <I size={22} />
                    <strong>{num as string}</strong>
                    <p>{label as string}</p>
                  </div>
                );
              })}
            </section>
            <div className="hr-grid">
              <section className="panel">
                <span className="eyebrow">ТОЧКИ РОСТА</span>
                <h2>Где нужна поддержка</h2>
                <p className="muted">
                  Сотрудники с разрывом до целевого уровня
                </p>
                {[
                  ["System Design", 3],
                  ["Менторство", 2],
                  ["Cloud Architecture", 2],
                  ["Коммуникация", 1],
                ].map(([label, n]) => (
                  <div className="hr-bar" key={label}>
                    <div>
                      <span>{label}</span>
                      <b>{n} из 5</b>
                    </div>
                    <div>
                      <i style={{ width: `${Number(n) * 20}%` }} />
                    </div>
                  </div>
                ))}
              </section>
              <section className="hr-note">
                <span className="note-icon">
                  <Compass size={30} />
                </span>
                <h2>
                  У каждого свой
                  <br />
                  темп развития.
                </h2>
                <p>
                  Отсутствие подходящего шага — повод помочь с маршрутом.
                  Обсудите цель или предложите подготовительную активность.
                </p>
                <div>
                  <span className="status-dot" />
                  Без публичных рейтингов
                </div>
              </section>
            </div>
            <section className="people-panel">
              <div className="section-heading">
                <h2>Потребности команды</h2>
                <label className="select-wrap">
                  <SlidersHorizontal size={15} />
                  <select
                    aria-label="Фильтр отдела"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                  >
                    {["Все отделы", "Разработка", "Аналитика", "Продукт"].map(
                      (d) => (
                        <option key={d}>{d}</option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Сотрудник</th>
                      <th>Отдел</th>
                      <th>Соответствие цели</th>
                      <th>Следующий шаг</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people
                      .filter(
                        (p) =>
                          department === "Все отделы" ||
                          p.department === department,
                      )
                      .map((p) => (
                        <tr key={p.name}>
                          <td>
                            <strong>{p.name}</strong>
                            <small>{p.role}</small>
                          </td>
                          <td>{p.department}</td>
                          <td>
                            <div className="table-progress">
                              <i style={{ width: `${p.progress}%` }} />
                            </div>
                            <span>{p.progress}%</span>
                          </td>
                          <td>
                            <span
                              className={`status-tag ${p.status === "Есть следующий шаг" ? "ok" : "attention"}`}
                            >
                              {p.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p className="table-note">
                Отдельная демонстрационная выборка. Показатели не являются
                анализом исходного датасета.
              </p>
            </section>
          </>
        )}
        <footer>
          <a className="brand" href="/employee">
            <Compass size={18} />
            career<span>quest</span>
          </a>
          <span>Развитие, в котором есть смысл.</span>
          <button
            onClick={() => {
              setDone([]);
              setStarted([]);
              setGoal("Senior");
              setToast("Демонстрация сброшена");
            }}
          >
            <RotateCcw size={13} />
            Сбросить демо
          </button>
        </footer>
      </main>
      <dialog
        ref={modalRef}
        onCancel={close}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <button className="close" aria-label="Закрыть окно" onClick={close}>
          <X size={21} />
        </button>
        {selected && (
          <div className="modal-content">
            <span className="eyebrow">ВАШ СЛЕДУЮЩИЙ ШАГ</span>
            <h2>{selected.title}</h2>
            <div className="modal-meta">
              <span>
                <Clock size={16} />
                {selected.hours} часов
              </span>
              <span>
                <MapPin size={16} />
                {selected.format}
              </span>
              <span>{selected.date}</span>
            </div>
            <p className="modal-lead">
              {done.includes(selected.id)
                ? "Результат этого занятия уже включён в текущие навыки. Повторное завершение не начисляет прирост."
                : `Активность развивает ${skills.find((s) => s.id === selected.skill)?.name} и сокращает разрыв до выбранной цели ${goal}. ${selected.format === "В своём темпе" ? "Самостоятельный формат позволяет распределить нагрузку." : "Формат и длительность помогут спланировать следующий шаг."}`}
            </p>
            <h3>Почему это подходит вам</h3>
            <ul className="fact-list">
              {[
                `Текущий уровень: ${skills.find((s) => s.id === selected.skill)?.level}; требование цели ${goal}: ${skills.find((s) => s.id === selected.skill)?.required}`,
                `Формат: ${selected.format.toLowerCase()}; нагрузка: ${selected.hours} часов`,
                done.includes(selected.id) ? "Завершение уже записано в демонстрационной истории" : started.includes(selected.id) ? "Занятие уже добавлено в ваш план — можно продолжить" : "В демонстрационной истории это занятие ещё не завершено",
              ].map((f) => (
                <li key={f}>
                  <CheckCircle2 size={17} />
                  {f}
                </li>
              ))}
            </ul>
            <div className="outcome">
              <span>
                {initialSkills.find((s) => s.id === selected.skill)?.name}
              </span>
              <strong>
                {skills.find((s) => s.id === selected.skill)?.level}
                <ArrowRight size={19} />
                {done.includes(selected.id)
                  ? "Уже учтено"
                  : Math.min(
                      selected.max,
                      (skills.find((s) => s.id === selected.skill)?.level ||
                        0) + selected.gain,
                    )}
              </strong>
            </div>
            <p className="fine-print">
              Сценарий интерфейса на подготовленных данных. Завершение будущего
              занятия — симуляция, не подтверждение посещения.
            </p>
            {done.includes(selected.id) ? (
              <div className="success">
                <CheckCircle2 size={20} />
                Активность завершена в демо
              </div>
            ) : (
              <div className="modal-actions">
                <button
                  className="primary"
                  onClick={() => {
                    setStarted((s) =>
                      s.includes(selected.id) ? s : [...s, selected.id],
                    );
                    setToast("Активность добавлена в «Мою активность»");
                    close();
                  }}
                >
                  {started.includes(selected.id)
                    ? "Вернуться к обучению"
                    : "Добавить в мой план"}
                  <Plus size={16} />
                </button>
                <button
                  className="secondary"
                  onClick={() => complete(selected)}
                >
                  Симулировать завершение
                </button>
              </div>
            )}
          </div>
        )}
        {dialog === "goal" && (
          <div className="modal-content">
            <span className="eyebrow">ВАШЕ НАПРАВЛЕНИЕ</span>
            <h2>Куда хотите двигаться?</h2>
            <p className="modal-lead">
              Выберите следующий ориентир в Backend Engineering.
            </p>
            <label className="field-label">
              Целевой грейд
              <select
                value={draftGoal}
                onChange={(e) => setDraftGoal(e.target.value)}
              >
                <option>Senior</option>
                <option>Lead</option>
              </select>
            </label>
            <p className="fine-print">
              В прототипе доступны две демонстрационные траектории. Полный
              список ролей будет поступать с backend.
            </p>
            <button
              className="primary"
              onClick={() => {
                setGoal(draftGoal);
                close();
                setToast("Цель обновлена. Требования и прогресс пересчитаны.");
              }}
            >
              Сохранить цель
              <ArrowRight size={16} />
            </button>
          </div>
        )}
        {dialog === "profile" && (
          <div className="modal-content">
            <div className="large-avatar">АИ</div>
            <h2>Акмарал Исмаилова</h2>
            <p className="modal-lead">Backend Engineer · Middle</p>
            <div className="profile-details">
              <span>
                Отдел<b>Разработка</b>
              </span>
              <span>
                Стаж<b>4 года 4 месяца</b>
              </span>
              <span>
                Формат работы<b>Гибридный</b>
              </span>
            </div>
            <p className="fine-print">
              Подготовленный демонстрационный профиль. Переключение на HR
              показывает макет интерфейса и не предоставляет реальные права
              доступа.
            </p>
          </div>
        )}
        {dialog === "import" && (
          <div className="modal-content">
            <span className="eyebrow">ДАННЫЕ ДЛЯ РАЗВИТИЯ</span>
            <h2>Импорт профилей</h2>
            <p className="modal-lead">
              Предварительная проверка файла сотрудников. Данные не отправляются
              на сервер.
            </p>
            <label className="upload-zone">
              <Upload size={32} />
              <strong>Выберите JSON-файл</strong>
              <span>employees.json · до 2 МБ</span>
              <input
                type="file"
                accept=".json,application/json"
                aria-label="Файл сотрудников"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 2 * 1024 * 1024) {
                    setImportStatus("Файл слишком большой. Максимум 2 МБ.");
                    return;
                  }
                  try {
                    const data = JSON.parse(await f.text());
                    const list = Array.isArray(data) ? data : data.employees;
                    if (
                      !Array.isArray(list) ||
                      !list.length ||
                      list.some(
                        (x: Record<string, unknown>) =>
                          !x ||
                          typeof x.employee_id !== "string" ||
                          typeof x.role !== "string" ||
                          typeof x.grade !== "string",
                      )
                    )
                      throw Error();
                    setImportStatus(
                      `Прочитано профилей: ${list.length}. Базовая структура верна. Полная проверка и сохранение станут доступны после подключения API.`,
                    );
                  } catch {
                    setImportStatus(
                      "Не удалось проверить файл. Ожидается JSON с employees и полями employee_id, role, grade.",
                    );
                  }
                }}
              />
            </label>
            {importStatus && (
              <p className="import-result" role="status">
                {importStatus}
              </p>
            )}
            <p className="fine-print">
              CSV-история и атомарный импорт будут подключены к POST
              /api/import. Этот экран пока не изменяет выборку.
            </p>
          </div>
        )}
      </dialog>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
          <button aria-label="Закрыть уведомление" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
