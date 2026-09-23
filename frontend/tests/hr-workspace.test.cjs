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
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : (node?.children ?? []).map(text).join('');
const click = async node => { await act(async () => node.props.onClick()); };
const button = (root, label) => {
  const matches = root.root.findAllByType('button').filter(node => text(node).trim() === label);
  assert.equal(matches.length, 1, `Expected one button: ${label}`);
  return matches[0];
};
const counts = { completed: 0, in_progress: 0, dropped: 0, no_show: 0, declined: 0, overdue: 0 };
const overview = (extra = {}) => ({
  global_revision: 1, employee_count: 0,
  goals_by_source: { imported: 0, selected: 0, suggested: 0, missing: 0 },
  skill_gaps: [], catalog_gaps: [], no_next_step: [],
  participation: { actual_by_status: counts, effective_by_status: counts, simulated_completions: 0, superseded_attempts: 0, by_activity: [] },
  ...extra,
});
const selectOverride = { CatalogSelect: props => React.createElement('test-select', props) };
const { HrOverview } = sourceLoader({ './catalog-select': selectOverride })('src/components/quest/hr-overview.tsx');
async function mount(Component, props) {
  let root;
  await act(async () => { root = create(React.createElement(Component, props)); });
  return root;
}
async function close(root) { await act(async () => root.unmount()); }

test('an empty HR cohort has no invented goal coverage or promise of a next step', async () => {
  const root = await mount(HrOverview, { data: overview(), open() {} });
  try {
    const coverage = root.root.findByProps({ className: 'hr-goal-coverage' });
    assert.equal(text(coverage.findByType('strong')), '—');
    assert.equal(coverage.findByType('progress').props.max, 1);
    assert.equal(coverage.findByType('progress').props.value, 0);
    assert.match(text(root.toJSON()), /В команде пока нет сотрудников/);
    assert.doesNotMatch(text(root.toJSON()), /Для всех сотрудников доступен следующий шаг|NaN|Infinity/);
  } finally { await close(root); }
});

test('skills already meeting every goal are excluded from development demand', async () => {
  const root = await mount(HrOverview, { data: overview({ employee_count: 1,
    skill_gaps: [{ skill_id: 'sql', goal_source: 'imported', employees_with_gap: 0, denominator: 1, total_gap_points: 0 }],
  }), open() {} });
  try {
    assert.equal(root.root.findAllByProps({ className: 'gap-item' }).length, 0);
    assert.match(text(root.toJSON()), /Разрывов в навыках пока нет/);
  } finally { await close(root); }
});

test('goal coverage includes all goal sources and dashboard actions call their real destinations', async () => {
  const calls = [];
  const root = await mount(HrOverview, {
    data: overview({ employee_count: 4, goals_by_source: { imported: 1, selected: 1, suggested: 1, missing: 1 } }),
    open() {}, showPeople: () => calls.push('people'), showImport: () => calls.push('import'),
  });
  try {
    assert.equal(text(root.root.findByProps({ className: 'hr-goal-coverage' }).findByType('strong')), '75%');
    await click(button(root, 'Открыть сотрудников'));
    await click(button(root, 'Открыть список'));
    await click(root.root.findAllByType('button').find(node => text(node).startsWith('Обновить данные')));
    assert.deepEqual(calls, ['people', 'people', 'import']);
    for (const link of root.root.findAllByType('a')) {
      assert.equal(root.root.findAll(node => node.props.id === link.props.href.slice(1)).length, 1);
    }
  } finally { await close(root); }
});

test('no-recommendation reasons stay distinct and filtering resets expanded rows', async () => {
  const people = Array.from({ length: 10 }, (_, index) => ({ employee_id: `e${index}`, full_name: `Сотрудник ${index}`, goal_source: index ? 'selected' : 'missing', reason: index ? 'GOAL_REACHED' : 'GOAL_REQUIRED' }));
  const calls = [];
  const root = await mount(HrOverview, { data: overview({ employee_count: 10, no_next_step: people }), open: id => calls.push(id) });
  const rows = () => root.root.findAllByProps({ className: 'attention-row' });
  try {
    assert.equal(rows().length, 8);
    assert.match(text(rows()[0]), /Цель пока не выбрана/);
    assert.match(text(rows()[1]), /Навыки соответствуют выбранной цели/);
    await click(button(root, 'Показать всех · 10'));
    assert.equal(rows().length, 10);
    await act(async () => root.root.findByType('test-select').props.onChange('GOAL_REACHED'));
    assert.equal(rows().length, 8);
    assert.ok(rows().every(node => !text(node).includes('Сотрудник 0')));
    await act(async () => root.root.findByType('test-select').props.onChange('GOAL_REQUIRED'));
    assert.equal(rows().length, 1);
    await click(rows()[0]);
    assert.deepEqual(calls, ['e0']);
    assert.match(text(root.root.findByProps({ className: 'count-badge' })), /1 из 10/);
  } finally { await close(root); }
});

test('directory filter chips reset pagination and remove only their own filter', async () => {
  const requests = [];
  const { Hr } = sourceLoader({
    '@/lib/api': { endpoints: { hr: '/hr', catalog: '/catalog', employees: '/employees' } },
    '@/hooks/use-debounced-value': { useDebouncedValue: value => value },
    '@/hooks/use-resource': { useResource: endpoint => {
      requests.push(endpoint);
      return { reload() {}, loading: false, data: endpoint === '/hr' ? overview() : endpoint === '/catalog' ? { skills: [], role_profiles: [{ role: 'Engineer' }] } : { total: 50, items: [] } };
    } },
    './catalog-select': selectOverride,
    './employee': { Employee: props => React.createElement('test-employee', props) },
    './import-panel': { ImportPanel: () => null },
  })('src/components/quest/hr.tsx');
  const root = await mount(Hr, { onError() {} });
  const query = () => new URL(requests.filter(url => url.startsWith('/employees')).at(-1), 'http://test').searchParams;
  try {
    await click(button(root, 'Открыть сотрудников'));
    assert.equal(root.root.findByProps({ id: 'hr-people' }).props.hidden, false);
    await click(button(root, 'Далее'));
    assert.equal(query().get('offset'), '24');
    await act(async () => root.root.findByProps({ type: 'search' }).props.onChange({ target: { value: '  Анна  ' } }));
    await act(async () => root.root.findByProps({ placeholder: 'Полное название отдела' }).props.onChange({ target: { value: 'Платформа' } }));
    await act(async () => root.root.findAllByType('test-select').find(node => node.props.label === 'Роль').props.onChange('Engineer'));
    assert.equal(query().get('offset'), '0');
    assert.equal(query().get('q'), 'Анна');
    await click(root.root.findByProps({ 'aria-label': 'Убрать фильтр Поиск: Анна' }));
    assert.equal(query().has('q'), false);
    assert.equal(query().get('department'), 'Платформа');
    assert.equal(query().get('role'), 'Engineer');
    await click(button(root, 'Сбросить'));
    assert.deepEqual([...query()], [['offset', '0'], ['limit', '24']]);
    await click(button(root, 'Добавить сотрудников'));
    assert.equal(root.root.findByProps({ id: 'hr-import' }).props.hidden, false);
  } finally { await close(root); }
});
