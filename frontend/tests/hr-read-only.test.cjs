const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

function sourceLoader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const module = { exports: {} };
    const resolve = id => {
      if (Object.hasOwn(overrides, id)) return overrides[id];
      if (!id.startsWith('@/') && !id.startsWith('.')) return require(id);
      const base = id.startsWith('@/') ? `src/${id.slice(2)}` : path.join(path.dirname(file), id);
      const resolved = [base, `${base}.ts`, `${base}.tsx`].find(candidate => fs.existsSync(path.join(__dirname, '..', candidate)));
      assert.ok(resolved, `Cannot resolve ${id} in ${file}`);
      return load(resolved);
    };
    new Function('require', 'module', 'exports', code)(resolve, module, module.exports);
    cache.set(file, module.exports);
    return module.exports;
  }
  return load;
}

const version = { dataset_revision: 1, employee_revision: 2 };
const events = [
  { event_id: 'module-event', title: 'Курс анализа', description: 'Описание учебного курса', type: 'course', format: 'self_paced', duration_hours: 2, upcoming_sessions: [], mandatory: false },
  { event_id: 'practice-event', title: 'Практикум общения', description: 'Описание командной практики', type: 'workshop', format: 'self_paced', duration_hours: 1, upcoming_sessions: [], mandatory: false },
];
const cards = events.map((event, index) => ({
  candidate_id: `candidate-${index}`, event_id: event.event_id, title: event.title, rank: index + 1,
  event_type: event.type, format: event.format, duration_hours: event.duration_hours,
  relevance: 'goal', action: 'start', session_date: null, unlocks_event_ids: [], goal_coverage_delta: .1,
  expected_skill_changes: [{ skill_id: 'analysis', before: 1, after: 2, gain: 1 }],
  reason_fact_ids: ['cited'], facts: [{ fact_id: 'cited', category: 'skill_gap', text: 'Проверенное объяснение рекомендации' }],
}));
const history = events.map((event, index) => ({
  participation_id: `participation-${index}`, event_id: event.event_id, event_title: event.title,
  effective_status: 'in_progress', source_status: 'in_progress', completion_pct: 40,
  source_date: '2026-09-01', scheduled_session_date: null, actionable: true,
}));
const profile = {
  version, employee_id: 'employee-one', full_name: 'Тестовый Сотрудник', department: 'Engineering',
  role: 'Engineer', grade: 'Junior', tenure_months: 6, last_review_date: '2026-09-01',
  goal: { source: 'selected', target: { target_role: 'Engineer', target_grade: 'Middle' } },
  progress: { coverage: .5, gap_points: 1, missing_critical_skill_ids: [] },
  skills: [{ skill_id: 'analysis', current_level: 1, required_level: 2, gap: 1, critical: false }], history,
};
const catalog = {
  dataset_revision: 1, skills: [{ skill_id: 'analysis', name: 'Анализ' }], events,
  role_profiles: [{ role: 'Engineer', grade: 'Middle' }, { role: 'Engineer', grade: 'Senior' }],
};
const modules = [{ id: 'analysis-module', event_id: 'module-event', title: 'Уроки анализа', summary: 'Содержание учебного модуля', estimated_minutes: 15, lesson_count: 2 }];
const noop = () => {};
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : (node?.children ?? []).map(text).join('');
const buttons = root => root.root.findAllByType('button');
const button = (root, label) => {
  const matching = buttons(root).filter(item => text(item).trim() === label);
  assert.equal(matching.length, 1, `Expected one button: ${label}; found ${matching.length}`);
  return matching[0];
};
const click = async item => { await act(async () => item.props.onClick()); };
const close = async root => { await act(async () => root.unmount()); };
const readOnlyActions = /Изменить цель|Выбрать цель|Назначить цель|Убрать явную цель|Отметить|Продолжить уроки|Открыть уроки|Открыть (?:демомодуль|модуль)|Сдать тест/;
function assertNoMutatingActions(root) {
  assert.deepEqual(buttons(root).map(text).filter(label => readOnlyActions.test(label)), []);
  assert.equal(root.root.findAllByType('test-learning-player').length, 0);
}

function fixture(extraState = {}) {
  const calls = [];
  const record = name => (...args) => calls.push([name, ...args]);
  const state = {
    profile, recommendations: { version, mode: 'rules_fallback', recommendations: cards },
    busy: false, loading: false, recLoading: false, asOfDate: '2026-09-23',
    refresh: record('refresh'), retryRecommendations: record('recommendations'),
    changeGoal: record('goal'), complete: record('complete'), retryCompletion: record('retryCompletion'),
    acceptLearningCompletion: record('learningCompleted'), dismissCompletion: noop, ...extraState,
  };
  const load = sourceLoader({
    '@/hooks/use-employee': { useEmployee: () => state },
    '@/hooks/use-resource': { useResource: endpoint => ({ data: endpoint === '/api/catalog' ? catalog : { modules }, reload: noop }) },
    './modal': { Modal: ({ title, close, children }) => React.createElement('section', { role: 'dialog', 'aria-label': title }, React.createElement('button', { onClick: close }, 'Закрыть окно'), children) },
    './learning-player': { LearningPlayer: props => React.createElement('test-learning-player', props) },
  });
  const { Employee } = load('src/components/quest/employee.tsx');
  return {
    calls,
    async mount(props = {}) {
      let root;
      await act(async () => { root = create(React.createElement(Employee, { id: profile.employee_id, onError: noop, ...props })); });
      return root;
    },
  };
}

test('HR opens the actual employee profile with read-only permissions', async () => {
  let employeeProps;
  const load = sourceLoader({
    '@/hooks/use-resource': { useResource: endpoint => ({
      data: endpoint === '/api/catalog' ? catalog : endpoint.startsWith('/api/employees?') ? { items: [profile], total: 1 } : undefined,
      reload: noop,
    }) },
    '@/hooks/use-debounced-value': { useDebouncedValue: value => value },
    './employee': { Employee: props => { employeeProps = props; return null; } },
    './hr-overview': { HrOverview: () => null },
    './import-panel': { ImportPanel: () => null },
  });
  const { Hr } = load('src/components/quest/hr.tsx');
  const previousDocument = global.document;
  global.document = { activeElement: null };
  let root;
  try {
    await act(async () => { root = create(React.createElement(Hr, { onError: noop })); });
    await click(buttons(root).find(item => item.props['aria-label'] === `Открыть профиль: ${profile.full_name}`));
    assert.equal(employeeProps.id, profile.employee_id);
    assert.equal(employeeProps.viewer, 'hr');
    assert.equal(employeeProps.readOnly, true);
  } finally {
    if (root) await close(root);
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
});

test('HR sees the goal and recommendation evidence, including module cards, without employee actions', async () => {
  const scenario = fixture();
  const root = await scenario.mount({ viewer: 'hr', readOnly: true });
  try {
    assert.match(text(root.toJSON()), /Middle Engineer/);
    assert.match(text(root.toJSON()), /Проверенное объяснение рекомендации/);
    assertNoMutatingActions(root);
    await click(button(root, 'Обновить профиль'));
    assert.deepEqual(scenario.calls, [['refresh']]);
    for (const title of events.map(event => event.title)) {
      // The career journey and the recommendation card both open inspectable details.
      await click(button(root, title));
      const dialog = root.root.findByProps({ role: 'dialog' });
      assert.equal(dialog.props['aria-label'], title);
      assert.match(text(dialog), /Проверенное объяснение рекомендации/);
      assertNoMutatingActions(root);
      await click(button(root, 'Закрыть окно'));
    }
    for (let index = 0; index < cards.length; index++) {
      await click(buttons(root).filter(item => text(item).trim() === 'Подробнее о шаге')[index]);
      assert.equal(root.root.findByProps({ role: 'dialog' }).props['aria-label'], cards[index].title);
      assertNoMutatingActions(root);
      await click(button(root, 'Закрыть окно'));
    }
    assert.deepEqual(scenario.calls, [['refresh']]);
  } finally { await close(root); }
});

test('HR history keeps participation details and filters but cannot resume or complete activities', async () => {
  const scenario = fixture();
  const root = await scenario.mount({ viewer: 'hr', readOnly: true });
  try {
    await click(button(root, 'Активность сотрудника'));
    assert.equal(root.root.findAllByType('article').length, 2);
    assert.match(text(root.toJSON()), /Курс анализа/);
    assert.match(text(root.toJSON()), /Загруженная история/);
    assertNoMutatingActions(root);
    const completedFilter = buttons(root).find(item => item.props['aria-pressed'] !== undefined && text(item).startsWith('Завершено'));
    assert.ok(completedFilter);
    await click(completedFilter);
    assert.equal(root.root.findAllByType('article').length, 0);
    await click(button(root, 'Показать все активности'));
    assert.equal(root.root.findAllByType('article').length, 2);
    assert.deepEqual(scenario.calls, []);
  } finally { await close(root); }
});

test('HR can search catalog descriptions and inspect learning summaries without starting modules', async () => {
  const scenario = fixture();
  const root = await scenario.mount({ viewer: 'hr', readOnly: true });
  try {
    await click(button(root, 'Каталог'));
    assert.match(text(root.toJSON()), /Описание учебного курса/);
    assert.match(text(root.toJSON()), /Описание командной практики/);
    assertNoMutatingActions(root);
    const search = root.root.findByProps({ 'aria-label': 'Поиск по каталогу' });
    await act(async () => search.props.onChange({ target: { value: 'командной' } }));
    assert.equal(root.root.findAllByType('article').length, 1);
    assert.match(text(root.toJSON()), /Практикум общения/);
    assert.doesNotMatch(text(root.toJSON()), /Описание учебного курса/);
    await click(button(root, 'Учебные модули'));
    assert.match(text(root.toJSON()), /Уроки анализа/);
    assert.match(text(root.toJSON()), /Содержание учебного модуля/);
    assertNoMutatingActions(root);
    assert.deepEqual(scenario.calls, []);
  } finally { await close(root); }
});

test('read-only profiles cannot retry a pending completion left in client state', async () => {
  const scenario = fixture({ pendingTarget: { kind: 'existing_participation', participation_id: 'participation-0' }, mutationError: new Error('Результат неизвестен') });
  const root = await scenario.mount({ viewer: 'hr', readOnly: true });
  try {
    assertNoMutatingActions(root);
    assert.equal(buttons(root).filter(item => text(item).trim() === 'Повторить').length, 0);
    assert.deepEqual(scenario.calls, []);
  } finally { await close(root); }
});

for (const readOnly of [undefined, false]) test(`HR viewer cannot opt into employee actions with readOnly=${readOnly}`, async () => {
  const scenario = fixture();
  const root = await scenario.mount({ viewer: 'hr', readOnly });
  try {
    assertNoMutatingActions(root);
    await click(button(root, 'Курс анализа'));
    assert.equal(root.root.findByProps({ role: 'dialog' }).props['aria-label'], 'Курс анализа');
    assertNoMutatingActions(root);
    assert.deepEqual(scenario.calls, []);
  } finally { await close(root); }
});

test('an employee can still choose and clear their own goal', async () => {
  const scenario = fixture();
  const root = await scenario.mount();
  try {
    await click(button(root, 'Изменить цель'));
    await act(async () => root.root.findByType('select').props.onChange({ target: { value: '1' } }));
    await act(async () => root.root.findByType('form').props.onSubmit({ preventDefault: noop }));
    assert.deepEqual(scenario.calls, [['goal', { target_role: 'Engineer', target_grade: 'Senior' }]]);
    await click(button(root, 'Изменить цель'));
    await click(button(root, 'Убрать явную цель'));
    assert.deepEqual(scenario.calls[1], ['goal', null]);
  } finally { await close(root); }
});

test('an employee retains completion and lesson actions in recommendations and history', async () => {
  const scenario = fixture();
  const root = await scenario.mount();
  try {
    await click(button(root, 'Практикум общения'));
    await click(button(root, 'Отметить активность выполненной'));
    assert.deepEqual(scenario.calls, [['complete', { kind: 'new_participation', event_id: 'practice-event', session_date: null }]]);
    await click(button(root, 'Моя активность'));
    await click(button(root, 'Отметить выполненной'));
    assert.deepEqual(scenario.calls[1], ['complete', { kind: 'existing_participation', participation_id: 'participation-1' }]);
    await click(button(root, 'Продолжить уроки'));
    const player = root.root.findByType('test-learning-player');
    assert.equal(player.props.moduleId, 'analysis-module');
    assert.deepEqual(player.props.target, { kind: 'existing_participation', participation_id: 'participation-0' });
  } finally { await close(root); }
});

test('an employee can open the recommended module for their own profile', async () => {
  const scenario = fixture();
  const root = await scenario.mount();
  try {
    await click(button(root, 'Открыть уроки'));
    const player = root.root.findByType('test-learning-player');
    assert.equal(player.props.employee.employee_id, profile.employee_id);
    assert.deepEqual(player.props.target, { kind: 'new_participation', event_id: 'module-event', session_date: null });
  } finally { await close(root); }
});
