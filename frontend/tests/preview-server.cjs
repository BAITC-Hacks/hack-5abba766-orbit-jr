// Explicit, local-only UI QA fixture server. Never loaded by Next or production.
// Start Next on 3200, then run this script and open /__qa on port 3201.
const http = require("node:http");
let scenario = "employee";
let loggedIn = true;
let revision = 1;
let datasetRevision = 1;
let completed = false;
let attempts = 0;
let imported = false;
const receipts = new Map();
const statuses = {
  completed: 1,
  in_progress: 1,
  dropped: 1,
  no_show: 1,
  declined: 1,
  overdue: 1,
};
const session = () => ({
  account_id: "qa",
  role: scenario.startsWith("hr") ? "hr" : "employee",
  employee_id: "QA_1",
  display_name: "Тестовый пользователь интерфейса",
});
const version = () => ({
  dataset_revision: datasetRevision,
  employee_revision: revision,
});
let goal = {
  source: "selected",
  target: {
    target_role: "Архитектор распределённых информационных систем",
    target_grade: "Senior",
  },
};
const profile = (id = "QA_1") => ({
  version: version(),
  employee_id: id,
  full_name:
    id === "QA_1" ? "Александра Константинопольская" : "Новый тестовый профиль",
  department: "Разработка банковских технологий",
  role: "Backend Engineer",
  grade: "Middle",
  work_format: "hybrid",
  tenure_months: 28,
  preferred_language: "ru",
  last_review_date: "2026-09-01",
  goal,
  progress: goal.target
    ? {
        coverage: completed ? 0.8 : 0.6,
        gap_points: completed ? 1 : 2,
        missing_critical_skill_ids: ["SK_1"],
      }
    : null,
  skills: [
    {
      skill_id: "SK_1",
      baseline_level: 2,
      current_level: completed ? 3 : 2,
      required_level: goal.target ? 4 : null,
      gap: goal.target ? (completed ? 1 : 2) : null,
      critical: true,
    },
    {
      skill_id: "SK_2",
      baseline_level: 5,
      current_level: 5,
      required_level: goal.target ? 3 : null,
      gap: goal.target ? 0 : null,
      critical: false,
    },
  ],
  history: Object.keys(statuses).map((s, i) => ({
    participation_id: "QA_P" + i,
    event_id: "QA_EV" + i,
    event_title: "Практикум: архитектура и коммуникация " + (i + 1),
    source_status: s,
    effective_status: i === 1 && completed ? "completed" : s,
    completion_pct: s === "completed" ? 100 : 25,
    scheduled_session_date: "2026-10-07",
    source_date: "2026-09-15",
    completion_origin: i === 1 && completed ? "simulation" : null,
    applied_as_of: null,
    recorded_at: null,
    actionable: i === 1 && !completed,
    superseded_by: null,
  })),
  has_simulated_progress: completed,
});
const facts = [
  { fact_id: "f1", category: "grade", text: "Участие доступно грейду Middle." },
  {
    fact_id: "f2",
    category: "skill_gap",
    text: "Архитектура: текущий уровень 2, требуемый 4.",
  },
  { fact_id: "f3", category: "history", text: "Активность уже начата." },
];
const card = {
  candidate_id: "QA_C1",
  event_id: "QA_EV1",
  title: "Архитектура высоконагруженных распределённых систем",
  event_type: "workshop",
  format: "offline",
  duration_hours: 12,
  action: "continue",
  participation_id: "QA_P1",
  session_date: null,
  relevance: "direct",
  expected_skill_changes: [{ skill_id: "SK_1", before: 2, after: 3, gain: 1 }],
  goal_coverage_delta: 0.2,
  unlocks_event_ids: [],
  facts,
  rank: 1,
  reason_fact_ids: ["f1", "f2", "f3"],
  alternative_candidate_id: null,
  alternative: null,
};
const catalog = () => ({
  dataset_revision: datasetRevision,
  skills: [
    {
      skill_id: "SK_1",
      name: "Архитектура распределённых систем",
      type: "hard",
      category: "engineering",
      description: "",
    },
    {
      skill_id: "SK_2",
      name: "Коммуникация",
      type: "soft",
      category: "people",
      description: "",
    },
  ],
  role_profiles: [
    {
      role: "Архитектор распределённых информационных систем",
      grade: "Senior",
      required_skills: { SK_1: 4, SK_2: 3 },
      critical_skills: ["SK_1"],
    },
    {
      role: "Product Manager",
      grade: "Lead",
      required_skills: { SK_2: 5 },
      critical_skills: [],
    },
  ],
  events: [
    {
      event_id: "QA_EV1",
      title: card.title,
      description: "Подготовленный пример для проверки интерфейса.",
      type: "workshop",
      format: "offline",
      duration_hours: 12,
      mandatory: false,
      target_roles: [],
      target_grades: [],
      prerequisites: {},
      develops_skills: [],
      upcoming_sessions: ["2026-10-07"],
      repeatable: false,
    },
  ],
  grades: ["Middle", "Senior", "Lead"],
  proficiency_scale: {},
});
const overview = () => ({
  global_revision: revision + datasetRevision,
  employee_count: imported ? 2 : 1,
  goals_by_source: {
    selected: 1,
    imported: imported ? 1 : 0,
    suggested: 0,
    missing: 0,
  },
  skill_gaps: [
    {
      skill_id: "SK_1",
      goal_source: "selected",
      employees_with_gap: 1,
      denominator: 1,
      total_gap_points: 2,
    },
  ],
  no_next_step: [],
  participation: {
    actual_by_status: statuses,
    simulated_completions: completed ? 1 : 0,
    effective_by_status: statuses,
    superseded_attempts: 0,
    by_activity: [],
  },
});
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:3201");
  const send = (data, meta = {}) => {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify({
        data,
        meta: { request_id: "qa-only", as_of_date: "2026-10-01", ...meta },
      }),
    );
  };
  const error = (status, code, message, details) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: { code, message, details },
        request_id: "qa-only",
      }),
    );
  };
  if (url.pathname === "/__qa") {
    if (url.searchParams.has("scenario")) {
      scenario = url.searchParams.get("scenario");
      loggedIn = scenario !== "login";
      revision = datasetRevision = 1;
      completed = imported = false;
      attempts = 0;
      receipts.clear();
      goal =
        scenario === "no-goal"
          ? { source: "missing", target: null }
          : {
              source: "selected",
              target: {
                target_role: "Архитектор распределённых информационных систем",
                target_grade: "Senior",
              },
            };
      res.writeHead(302, {
        Location: scenario.startsWith("hr") ? "/hr" : "/employee",
      });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<h1>Локальный QA — только синтетические данные</h1>" +
        [
          "employee",
          "login",
          "slow-ai",
          "ai",
          "no-goal",
          "completion-retry",
          "hr",
          "hr-conflict",
        ]
          .map((s) => `<p><a href="/__qa?scenario=${s}">${s}</a></p>`)
          .join(""),
    );
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {}
    if (url.pathname === "/api/auth/login") {
      if (body.password !== "qa")
        return error(401, "UNAUTHENTICATED", "Неверный логин или пароль.");
      loggedIn = true;
      return send(session());
    }
    if (!loggedIn) return error(401, "UNAUTHENTICATED", "Требуется вход.");
    if (url.pathname === "/api/auth/session") return send(session());
    if (url.pathname === "/api/auth/logout") {
      loggedIn = false;
      return send({ logged_out: true });
    }
    if (url.pathname === "/api/catalog") return send(catalog());
    if (url.pathname === "/api/hr/overview") return send(overview());
    if (url.pathname === "/api/employees") {
      const items = [
        profile(),
        ...(imported ? [profile("QA_NEW")] : []),
      ].filter((p) =>
        p.full_name
          .toLowerCase()
          .includes((url.searchParams.get("q") || "").toLowerCase()),
      );
      return send({ items, total: items.length });
    }
    if (url.pathname.endsWith("/recommendations")) {
      const snapshot = version();
      if (scenario === "slow-ai")
        await new Promise((resolve) => setTimeout(resolve, 5000));
      return send(
        !goal.target || completed
          ? {
              version: snapshot,
              mode: "no_candidates",
              fallback_reason: null,
              recommendations: [],
              empty_reason: !goal.target
                ? "GOAL_REQUIRED"
                : "NO_BENEFICIAL_EVENTS",
            }
          : {
              version: snapshot,
              mode: scenario === "ai" ? "ai" : "rules_fallback",
              fallback_reason: scenario === "ai" ? null : "missing_api_key",
              recommendations: [card],
              empty_reason: null,
            },
      );
    }
    if (url.pathname.endsWith("/completions")) {
      const key = req.headers["idempotency-key"];
      if (receipts.has(key)) return send(receipts.get(key), { replayed: true });
      if (completed)
        return error(409, "ALREADY_COMPLETED", "Участие уже завершено.");
      completed = true;
      revision++;
      const result = {
        version: version(),
        participation_id: "QA_P1",
        completion_origin: "simulation",
        scheduled_session_date: null,
        applied_as_of: "2026-10-01",
        recorded_at: new Date().toISOString(),
        skill_changes: card.expected_skill_changes,
        employee: profile(),
      };
      receipts.set(key, result);
      if (scenario === "completion-retry" && attempts++ === 0)
        return error(408, "HTTP_ERROR", "Потерян ответ после записи.");
      return send(result);
    }
    if (url.pathname.endsWith("/goal")) {
      goal = body.career_goal
        ? { source: "selected", target: body.career_goal }
        : { source: "missing", target: null };
      revision++;
      return send({ version: version(), employee: profile(), changed: true });
    }
    if (url.pathname === "/api/import") {
      if (scenario === "hr-conflict")
        return error(409, "IMPORT_CONFLICT", "Конфликт идентификатора.", {
          errors: [
            {
              file: "employees",
              row: 2,
              field: "employee_id",
              code: "IMPORT_CONFLICT",
              message: "Профиль с этим ID имеет другое содержимое.",
            },
          ],
        });
      imported = true;
      datasetRevision++;
      return send({
        dry_run: false,
        applied: true,
        dataset_revision: datasetRevision,
        global_revision: revision + datasetRevision,
        counts: {
          employees: { new_rows: 1, identical_rows: 0 },
          history: { new_rows: 0, identical_rows: 0 },
        },
        errors: [],
        warnings: [],
      });
    }
    if (url.pathname.startsWith("/api/employees/"))
      return send(profile(decodeURIComponent(url.pathname.split("/").pop())));
    return error(404, "NOT_FOUND", "QA route not found");
  }
  const proxy = http.request(
    {
      hostname: "127.0.0.1",
      port: 3200,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: "localhost:3200" },
    },
    (upstream) => {
      res.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(res);
    },
  );
  proxy.on("error", () => {
    res.writeHead(502);
    res.end("Start Next on port 3200.");
  });
  req.pipe(proxy);
});
server.listen(3201, "127.0.0.1", () =>
  console.log(
    "Synthetic UI QA: http://localhost:3201/__qa (requires Next on 3200)",
  ),
);
