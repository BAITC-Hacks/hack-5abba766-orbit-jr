// Browser lifecycle events are synthetic; HTTP and UI boundaries remain explicit.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { create, act } = require("react-test-renderer");
global.IS_REACT_ACT_ENVIRONMENT = true;

function load(file, imports = {}) {
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
    (id) => imports[id] ?? require(id),
    module,
    module.exports,
  );
  return module.exports;
}

const api = load("src/lib/api.ts");
const feedback = {
  Failure: ({ error }) =>
    error ? React.createElement("p", { "data-testid": "error" }, String(error)) : null,
  Loading: ({ children }) => React.createElement("p", null, children),
};
const QuestApp = load("src/components/quest-app.tsx", {
  "@/lib/api": api,
  "./quest/login": {
    Login: () => React.createElement("div", { "data-testid": "login" }),
  },
  "./quest/navigation": {
    Navigation: ({ session, logout }) =>
      React.createElement(
        "nav",
        { "data-account": session.account_id },
        React.createElement("button", { onClick: logout }, "Выйти"),
      ),
  },
  "./quest/employee": {
    Employee: ({ id }) =>
      React.createElement("div", { "data-testid": "employee", "data-id": id }),
  },
  "./quest/hr": {
    Hr: () => React.createElement("div", { "data-testid": "hr" }),
  },
  "./quest/feedback": feedback,
}).default;

const employee = {
  account_id: "employee-account",
  role: "employee",
  employee_id: "employee-profile",
  display_name: "Сотрудник",
};
const hr = {
  account_id: "hr-account",
  role: "hr",
  employee_id: null,
  display_name: "HR",
};
const reply = (data) => Response.json({ data, meta: { request_id: "session-test" } });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const count = (root, name) => root.root.findAllByProps({ "data-testid": name }).length;
const browserEvent = (target, type, persisted = false) => {
  const event = new Event(type);
  Object.defineProperty(event, "persisted", { value: persisted });
  target.dispatchEvent(event);
};

async function setup(t, fetch) {
  const previousWindow = global.window;
  const previousFetch = global.fetch;
  const browser = new EventTarget();
  global.window = browser;
  global.fetch = fetch;
  let root;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    global.fetch = previousFetch;
  });
  await act(async () => { root = create(React.createElement(QuestApp)); });
  return { root, browser };
}

test("a BFCache restore hides the old employee until the current HR session is checked", async (t) => {
  const pending = deferred();
  const requests = [];
  const { root, browser } = await setup(t, async (url) => {
    requests.push(url);
    return requests.length === 1 ? reply(employee) : pending.promise;
  });
  assert.equal(count(root, "employee"), 1);
  await act(async () => browserEvent(browser, "pageshow", true));
  assert.equal(count(root, "employee"), 0);
  assert.equal(count(root, "hr"), 0);
  assert.deepEqual(requests, [api.endpoints.session, api.endpoints.session]);
  await act(async () => pending.resolve(reply(hr)));
  assert.equal(count(root, "hr"), 1);
  assert.equal(count(root, "employee"), 0);
  assert.equal(root.root.findByType("nav").props["data-account"], hr.account_id);
});

test("an ordinary pageshow does not start a redundant session check", async (t) => {
  let requests = 0;
  const { root, browser } = await setup(t, async () => {
    requests++;
    return reply(employee);
  });
  await act(async () => browserEvent(browser, "pageshow", false));
  assert.equal(requests, 1);
  assert.equal(count(root, "employee"), 1);
});

test("pagehide removes authenticated content before the document can be restored", async (t) => {
  let requests = 0;
  const { root, browser } = await setup(t, async () => {
    requests++;
    return reply(requests === 1 ? employee : hr);
  });
  assert.equal(count(root, "employee"), 1);
  await act(async () => browserEvent(browser, "pagehide", true));
  assert.equal(count(root, "employee"), 0);
  assert.equal(root.root.findAllByType("nav").length, 0);
  assert.equal(requests, 1);
  await act(async () => browserEvent(browser, "pageshow", true));
  assert.equal(count(root, "hr"), 1);
  assert.equal(count(root, "employee"), 0);
});

test("pagehide cancels an in-flight session check and discards its late response", async (t) => {
  const pending = deferred();
  const signals = [];
  const { root, browser } = await setup(t, async (_url, options) => {
    signals.push(options.signal);
    return signals.length === 1 ? pending.promise : reply(hr);
  });
  await act(async () => browserEvent(browser, "pagehide", true));
  assert.equal(signals[0].aborted, true);
  await act(async () => pending.resolve(reply(employee)));
  assert.equal(count(root, "employee"), 0);
  await act(async () => browserEvent(browser, "pageshow", true));
  assert.equal(count(root, "hr"), 1);
});

test("back/forward popstate checks the server identity before showing a role", async (t) => {
  const pending = deferred();
  let requests = 0;
  const { root, browser } = await setup(t, async () => {
    requests++;
    return requests === 1 ? reply(employee) : pending.promise;
  });
  await act(async () => browserEvent(browser, "popstate"));
  assert.equal(requests, 2);
  assert.equal(count(root, "employee"), 0);
  await act(async () => pending.resolve(reply(hr)));
  assert.equal(count(root, "hr"), 1);
});

test("an older restoration response cannot overwrite a newer account", async (t) => {
  const pending = deferred();
  const signals = [];
  const { root, browser } = await setup(t, async (_url, options) => {
    signals.push(options.signal);
    if (signals.length === 1) return reply(employee);
    if (signals.length === 2) return pending.promise;
    return reply(hr);
  });
  await act(async () => browserEvent(browser, "pageshow", true));
  await act(async () => browserEvent(browser, "pageshow", true));
  assert.equal(signals.length, 3);
  assert.equal(signals[1].aborted, true);
  assert.equal(count(root, "hr"), 1);
  // The mock deliberately resolves after abort, like an already received response.
  await act(async () => pending.resolve(reply(employee)));
  assert.equal(count(root, "hr"), 1);
  assert.equal(count(root, "employee"), 0);
});

test("restoring an expired session removes the previous employee and shows login", async (t) => {
  let requests = 0;
  const { root, browser } = await setup(t, async () => {
    requests++;
    return requests === 1
      ? reply(employee)
      : Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  });
  await act(async () => browserEvent(browser, "pageshow", true));
  assert.equal(count(root, "login"), 1);
  assert.equal(count(root, "employee"), 0);
});

test("an unmounted login cannot publish a late account response", async (t) => {
  const pending = deferred();
  let signal;
  let loggedIn = 0;
  const { Login } = load("src/components/quest/login.tsx", {
    "@/lib/api": {
      endpoints: api.endpoints,
      apiRequest: async (_url, options) => {
        signal = options.signal;
        return pending.promise;
      },
    },
    "./feedback": feedback,
  });
  let root;
  t.after(async () => { if (root) await act(async () => root.unmount()); });
  await act(async () => {
    root = create(React.createElement(Login, { onLogin: () => loggedIn++ }));
  });
  let submit;
  await act(async () => {
    submit = root.root.findByType("form").props.onSubmit({
      preventDefault() {},
      currentTarget: undefined,
    });
  });
  await act(async () => root.unmount());
  root = undefined;
  assert.equal(signal.aborted, true);
  await act(async () => {
    pending.resolve({ data: employee });
    await submit;
  });
  assert.equal(loggedIn, 0);
});
