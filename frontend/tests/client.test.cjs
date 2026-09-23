// Client tests with explicit synthetic HTTP responses. These do not verify backend behavior.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { create, act } = require("react-test-renderer");
global.IS_REACT_ACT_ENVIRONMENT = true;
const modules = new Map();
function load(file, imports = {}) {
  if (modules.has(file)) return modules.get(file);
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)(
    (id) => {
      if (imports[id]) return imports[id];
      if (id.startsWith("@/") || id.startsWith(".")) {
        const base = id.startsWith("@/")
          ? `src/${id.slice(2)}`
          : path.posix.join(path.posix.dirname(file), id);
        const target = [".ts", ".tsx"]
          .map((ext) => base + ext)
          .find((p) => fs.existsSync(path.join(__dirname, "..", p)));
        if (target) return load(target);
      }
      return require(id);
    },
    module,
    module.exports,
  );
  modules.set(file, module.exports);
  return module.exports;
}
const api = load("src/lib/api.ts");
const { useEmployee } = load("src/hooks/use-employee.ts", { "@/lib/api": api });
const reply = (data, meta = {}) =>
  Response.json({
    data,
    meta: { request_id: "test", as_of_date: "2026-10-01", ...meta },
  });
const employee = (revision = 1, id = "test-employee") => ({
  employee_id: id,
  full_name: "Тестовый сотрудник",
  version: { dataset_revision: 1, employee_revision: revision },
  skills: [],
  history: [],
});
const rec = (revision = 1) => ({
  version: employee(revision).version,
  mode: "no_candidates",
  fallback_reason: null,
  empty_reason: "GOAL_REQUIRED",
  recommendations: [],
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
let value;
const onError = () => {};
function Harness({ id = "test-employee" }) {
  value = useEmployee(id, onError);
  return null;
}
async function mount() {
  let root;
  await act(async () => {
    root = create(React.createElement(Harness));
  });
  return root;
}
async function unmount(root) {
  await act(async () => root.unmount());
}

test("transport preserves structured 403, conflict details and request id", async () => {
  global.fetch = async () =>
    Response.json(
      {
        error: {
          code: "IMPORT_CONFLICT",
          message: "Конфликт",
          details: { row: 4 },
        },
        request_id: "r1",
      },
      { status: 409 },
    );
  await assert.rejects(
    api.apiRequest("/api/import"),
    (e) =>
      e.status === 409 &&
      e.code === "IMPORT_CONFLICT" &&
      e.details.row === 4 &&
      e.requestId === "r1",
  );
  global.fetch = async () => new Response("", { status: 403 });
  await assert.rejects(
    api.apiRequest("/api/hr/overview"),
    (e) => e.status === 403 && e.message.includes("Нет доступа"),
  );
});
test("multipart leaves browser boundary intact and combines timeout with caller cancellation", async () => {
  const controller = new AbortController();
  const body = new FormData();
  body.append("dry_run", "false");
  global.fetch = async (_, options) => {
    assert.equal(options.headers.has("Content-Type"), false);
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.notEqual(options.signal, controller.signal);
    controller.abort();
    assert.equal(options.signal.aborted, true);
    return reply({ ok: true });
  };
  await api.apiRequest("/api/import", {
    method: "POST",
    body,
    signal: controller.signal,
  });
});
test("malformed success is not turned into demo data", async () => {
  global.fetch = async () => Response.json({ hello: "world" });
  await assert.rejects(
    api.apiRequest("/api/employees/test"),
    (e) => e.code === "INVALID_RESPONSE",
  );
  assert.equal(
    api.sameVersion(
      { dataset_revision: 1, employee_revision: 2 },
      { dataset_revision: 2, employee_revision: 2 },
    ),
    false,
  );
});
test("profile renders while recommendations are pending; stale version is rejected", async () => {
  const pending = deferred();
  global.fetch = async (url) =>
    url.endsWith("/recommendations") ? pending.promise : reply(employee());
  const root = await mount();
  try {
    assert.equal(value.profile.employee_id, "test-employee");
    assert.equal(value.loading, false);
    assert.equal(value.recLoading, true);
    await act(async () => pending.resolve(reply(rec(0))));
    assert.equal(value.recommendations, undefined);
    assert.equal(value.recError.code, "STALE_RECOMMENDATION");
  } finally {
    await unmount(root);
  }
});
test("completion retries use identical body/key and no optimistic skill update; receipt replay refetches current state", async () => {
  let current = 1;
  const requests = [];
  let calls = 0;
  global.fetch = async (url, options) => {
    if (url.endsWith("/completions")) {
      requests.push({
        body: options.body,
        key: options.headers.get("Idempotency-Key"),
      });
      if (++calls === 1)
        throw new TypeError("Connection reset after possible commit");
      current = 3;
      return reply(
        {
          skill_changes: [],
          version: employee(2).version,
          employee: employee(2),
        },
        { replayed: true },
      );
    }
    return reply(
      url.endsWith("/recommendations") ? rec(current) : employee(current),
    );
  };
  const root = await mount();
  try {
    await act(async () =>
      value.complete({
        kind: "new_participation",
        event_id: "EV_036",
        session_date: "2026-10-07",
      }),
    );
    assert.equal(value.profile.version.employee_revision, 1);
    assert.ok(value.pendingTarget);
    await act(async () => value.retryCompletion());
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(value.profile.version.employee_revision, 3);
    assert.equal(value.recommendations.version.employee_revision, 3);
    assert.match(value.notice, /повторно не начислены/);
  } finally {
    await unmount(root);
  }
});
test("late recommendations are discarded after completion and after switching profile", async () => {
  const old = deferred();
  let first = true;
  let current = 1;
  global.fetch = async (url) => {
    if (url.endsWith("/completions")) {
      current = 2;
      return reply({ skill_changes: [] });
    }
    if (url.endsWith("/recommendations")) {
      if (first) {
        first = false;
        return old.promise;
      }
      return reply(rec(current));
    }
    return reply(employee(current, url.split("/").pop()));
  };
  const root = await mount();
  try {
    await act(async () =>
      value.complete({
        kind: "existing_participation",
        participation_id: "session-1",
      }),
    );
    await act(async () => old.resolve(reply(rec(1))));
    assert.equal(value.recommendations.version.employee_revision, 2);
    await act(async () =>
      root.update(
        React.createElement(Harness, { id: "new-profile", key: "new-profile" }),
      ),
    );
    assert.equal(value.profile.employee_id, "new-profile");
  } finally {
    await unmount(root);
  }
});
test("double completion click sends one request; separate EV_036 sessions have distinct targets", async () => {
  const pending = deferred();
  let calls = 0;
  global.fetch = async (url) => {
    if (url.endsWith("/completions")) {
      calls++;
      return pending.promise;
    }
    return reply(url.endsWith("/recommendations") ? rec() : employee());
  };
  const root = await mount();
  try {
    let operation;
    await act(async () => {
      operation = value.complete({
        kind: "existing_participation",
        participation_id: "EV036-session-a",
      });
      void value.complete({
        kind: "existing_participation",
        participation_id: "EV036-session-a",
      });
    });
    assert.equal(calls, 1);
    await act(async () => {
      pending.resolve(reply({ skill_changes: [] }));
      await operation;
    });
    await act(async () =>
      value.complete({
        kind: "existing_participation",
        participation_id: "EV036-session-b",
      }),
    );
    assert.equal(calls, 2);
  } finally {
    await unmount(root);
  }
});

const feedback = load("src/components/quest/feedback.tsx", {
  "@/lib/api": api,
});
const { ImportPanel } = load("src/components/quest/import-panel.tsx", {
  "@/lib/api": api,
  "./feedback": feedback,
});
test("import submits JSON+CSV with revision; atomic conflict is not reported as success", async () => {
  let imported = 0;
  let root;
  global.fetch = async (url, options) => {
    assert.equal(url, "/api/import");
    assert.equal(options.body.get("employees").name, "employees.json");
    assert.equal(options.body.get("history").name, "history.csv");
    assert.equal(options.body.get("expected_dataset_revision"), "7");
    assert.equal(options.body.get("dry_run"), "false");
    assert.ok(options.headers.get("Idempotency-Key"));
    return Response.json(
      {
        error: {
          code: "IMPORT_CONFLICT",
          message: "ID занят",
          details: { errors: [{ row: 2, field: "employee_id" }] },
        },
        request_id: "import-test",
      },
      { status: 409 },
    );
  };
  await act(async () => {
    root = create(
      React.createElement(ImportPanel, {
        revision: 7,
        onError,
        onRefresh: () => imported++,
      }),
    );
  });
  try {
    const inputs = root.root.findAllByType("input");
    await act(async () => {
      inputs[0].props.onChange({
        target: { files: [new File(["{}"], "employees.json")] },
      });
      inputs[1].props.onChange({
        target: { files: [new File(["record_id\nR1"], "history.csv")] },
      });
    });
    await act(async () => root.root.findByType("button").props.onClick());
    const text = JSON.stringify(root.toJSON());
    assert.match(text, /Пакет отклонён целиком/);
    assert.doesNotMatch(text, /Импорт применён/);
    assert.equal(imported, 0);
    assert.equal(root.root.findAllByType("input")[0].props.disabled, false);
  } finally {
    await unmount(root);
  }
});
test("import preserves key and files after connection loss and reports server counts on replay", async () => {
  let root;
  let imported = 0;
  const requests = [];
  global.fetch = async (_, options) => {
    requests.push({
      key: options.headers.get("Idempotency-Key"),
      body: options.body,
    });
    if (requests.length === 1) throw new TypeError("Connection reset");
    return reply(
      {
        applied: true,
        dry_run: false,
        counts: {
          employees: { new_rows: 1, identical_rows: 0 },
          history: { new_rows: 2, identical_rows: 1 },
        },
        errors: [],
        warnings: [],
      },
      { replayed: true },
    );
  };
  await act(async () => {
    root = create(
      React.createElement(ImportPanel, {
        revision: 7,
        onError,
        onRefresh: () => imported++,
      }),
    );
  });
  try {
    await act(async () =>
      root.root.findAllByType("input")[0].props.onChange({
        target: { files: [new File(["{}"], "employees.json")] },
      }),
    );
    await act(async () => root.root.findByType("button").props.onClick());
    assert.equal(root.root.findAllByType("input")[0].props.disabled, true);
    await act(async () => root.root.findByType("button").props.onClick());
    assert.equal(requests[0].key, requests[1].key);
    assert.equal(requests[0].body, requests[1].body);
    assert.equal(imported, 1);
    assert.match(JSON.stringify(root.toJSON()), /Импорт применён/);
  } finally {
    await unmount(root);
  }
});

const QuestApp = load("src/components/quest-app.tsx").default;
test("employee session visiting HR never requests HR data", async () => {
  const paths = [];
  let root;
  global.fetch = async (url) => {
    paths.push(url);
    return reply({
      account_id: "test",
      role: "employee",
      employee_id: "test-employee",
      display_name: "Тест",
    });
  };
  await act(async () => {
    root = create(React.createElement(QuestApp, { initialView: "hr" }));
  });
  try {
    assert.deepEqual(paths, ["/api/auth/session"]);
    assert.match(JSON.stringify(root.toJSON()), /Нет доступа к HR/);
  } finally {
    await unmount(root);
  }
});
test("401 shows login without requesting profiles or recommendations", async () => {
  const paths = [];
  let root;
  global.fetch = async (url) => {
    paths.push(url);
    return Response.json(
      { error: { code: "UNAUTHENTICATED" } },
      { status: 401 },
    );
  };
  await act(async () => {
    root = create(React.createElement(QuestApp));
  });
  try {
    assert.deepEqual(paths, ["/api/auth/session"]);
    assert.equal(root.root.findAllByType("input").length, 2);
  } finally {
    await unmount(root);
  }
});
const { Employee } = load("src/components/quest/employee.tsx");
test("connected profile displays missing goal and distinguishes AI, fallback and empty results", async () => {
  const profile = {
    ...employee(),
    department: "Тест",
    role: "Engineer",
    grade: "Lead",
    tenure_months: 12,
    last_review_date: "2026-09-01",
    goal: { source: "missing", target: null },
    progress: null,
    has_simulated_progress: false,
  };
  for (const [mode, expected] of [
    ["ai", "AI-подборка"],
    ["rules_fallback", "Резервная подборка по правилам"],
    ["no_candidates", "Выберите направление развития"],
  ]) {
    let root;
    global.fetch = async (url) =>
      reply(
        url === "/api/catalog"
          ? { skills: [], role_profiles: [], events: [] }
          : url.endsWith("/recommendations")
            ? {
                ...rec(),
                mode,
                empty_reason: mode === "no_candidates" ? "GOAL_REQUIRED" : null,
                fallback_reason:
                  mode === "rules_fallback" ? "missing_api_key" : null,
              }
            : profile,
      );
    await act(async () => {
      root = create(
        React.createElement(Employee, { id: "test-employee", onError }),
      );
    });
    try {
      const text = JSON.stringify(root.toJSON());
      assert.match(text, new RegExp(expected));
      assert.match(text, /Цель не выбрана/);
      assert.doesNotMatch(text, /Senior/);
    } finally {
      await unmount(root);
    }
  }
});

test("login failure keeps authentication message instead of claiming an expired session", async () => {
  global.fetch = async () =>
    Response.json(
      {
        error: {
          code: "UNAUTHENTICATED",
          message: "Неверный логин или пароль.",
        },
      },
      { status: 401 },
    );
  await assert.rejects(
    api.apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "employee", password: "wrong" }),
    }),
    (error) =>
      error.status === 401 && error.message === "Неверный логин или пароль.",
  );
});

test("import preview sends dry_run and never refreshes persisted data", async () => {
  let root;
  let changed = 0;
  global.fetch = async (_, options) => {
    assert.equal(options.body.get("dry_run"), "true");
    assert.equal(options.body.get("expected_dataset_revision"), "9");
    assert.equal(options.body.get("employees").name, "employees.json");
    return reply({
      dry_run: true,
      applied: false,
      dataset_revision: 9,
      global_revision: 10,
      counts: {
        employees: { new_rows: 1, identical_rows: 0 },
        history: { new_rows: 0, identical_rows: 0 },
      },
      errors: [],
      warnings: [],
    });
  };
  await act(async () => {
    root = create(
      React.createElement(ImportPanel, {
        revision: 9,
        onError,
        onRefresh: () => changed++,
      }),
    );
  });
  try {
    await act(async () => {
      root.root
        .findAllByType("input")[0]
        .props.onChange({
          target: { files: [new File(["{}"], "employees.json")] },
        });
      root.root
        .findAllByType("input")
        .find((input) => input.props.type === "checkbox")
        .props.onChange({ target: { checked: true } });
    });
    await act(async () => root.root.findByType("button").props.onClick());
    assert.equal(changed, 0);
    assert.match(JSON.stringify(root.toJSON()), /данные не сохранены/);
    assert.equal(root.root.findAllByType("input")[0].props.disabled, false);
  } finally {
    await unmount(root);
  }
});

test("a skill outside an active goal is not labeled as missing career goal", async () => {
  const { Skills } = load("src/components/quest/skills.tsx");
  let root;
  await act(async () => {
    root = create(
      React.createElement(Skills, {
        employee: {
          ...employee(),
          goal: {
            source: "selected",
            target: { target_role: "Engineer", target_grade: "Senior" },
          },
          skills: [
            {
              skill_id: "optional",
              current_level: 2,
              baseline_level: 2,
              required_level: null,
              gap: null,
              critical: false,
            },
          ],
        },
        names: { optional: "Optional skill" },
      }),
    );
  });
  try {
    const text = JSON.stringify(root.toJSON());
    assert.match(text, /Не входит в требования выбранной цели/);
    assert.doesNotMatch(text, /[Цц]ель не выбрана/);
  } finally {
    await unmount(root);
  }
});
