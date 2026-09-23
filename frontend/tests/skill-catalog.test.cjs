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
const noop = () => {};
const names = { design: 'System Design', uncatalogued: 'Mentoring', covered: 'SQL', unrelated: 'Teamwork' };
const profile = {
  version, employee_id: 'employee-one', full_name: 'Тестовый Сотрудник', department: 'Engineering',
  role: 'Engineer', grade: 'Junior', work_format: 'remote', preferred_language: 'ru', tenure_months: 6,
  last_review_date: '2026-09-01', goal: { source: 'selected', target: { target_role: 'Engineer', target_grade: 'Middle' } },
  progress: { coverage: .5, gap_points: 3, missing_critical_skill_ids: ['design'] }, history: [],
  skills: [
    { skill_id: 'design', baseline_level: 3, current_level: 3, required_level: 5, gap: 2, critical: true },
    { skill_id: 'uncatalogued', baseline_level: 0, current_level: 0, required_level: 1, gap: 1, critical: false },
    { skill_id: 'covered', baseline_level: 3, current_level: 3, required_level: 3, gap: 0, critical: false },
    { skill_id: 'unrelated', baseline_level: 2, current_level: 2, required_level: null, gap: null, critical: false },
  ],
};
const event = (event_id, title, overrides = {}) => ({
  event_id, title, description: 'Описание программы', type: 'course', format: 'self_paced', duration_hours: 2,
  upcoming_sessions: [], mandatory: false, target_roles: ['Engineer'], target_grades: ['Junior'],
  prerequisites: {}, develops_skills: [{ skill_id: 'design', gain: 1, max_level: 4 }], repeatable: false,
  ...overrides,
});
const events = [
  event('real-course', 'Архитектура сервисов'),
  event('real-workshop', 'Практикум архитектуры', { type: 'workshop', description: 'Распределённая практика', develops_skills: [{ skill_id: 'design', gain: 5, max_level: 5 }] }),
  event('intro', 'Основы проектирования', { develops_skills: [{ skill_id: 'design', gain: 1, max_level: 2 }] }),
  event('title-only', 'System Design: новости команды', { develops_skills: [{ skill_id: 'unrelated', gain: 1, max_level: 5 }] }),
  event('zero-gain', 'Обзор без развития навыка', { develops_skills: [{ skill_id: 'design', gain: 0, max_level: 5 }] }),
];
const catalog = {
  dataset_revision: 1, skills: Object.entries(names).map(([skill_id, name]) => ({ skill_id, name })), events,
  role_profiles: [{ role: 'Engineer', grade: 'Middle' }],
};
const modules = [{ id: 'architecture-module', event_id: 'real-course', title: 'Уроки архитектуры', summary: 'Содержание модуля', estimated_minutes: 15, lesson_count: 2 }];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : (node?.children ?? []).map(text).join('');
const buttons = root => root.root.findAllByType('button');
const button = (root, label) => {
  const matching = buttons(root).filter(item => text(item).trim() === label);
  assert.equal(matching.length, 1, `Expected one button: ${label}; found ${matching.length}`);
  return matching[0];
};
const browse = (root, name) => root.root.findByProps({ 'aria-label': `Найти обучение: ${name}` });
const click = async node => { await act(async () => node.props.onClick()); };
const close = async root => { await act(async () => root.unmount()); };
const articles = root => root.root.findAllByType('article');
const titles = root => articles(root).map(node => node.props['aria-label']);
const select = async (root, label, value) => {
  const match = root.root.findAll(node => node.type?.name === 'CatalogSelect' && (node.props.label ?? 'Тип активности') === label);
  assert.equal(match.length, 1, `Expected CatalogSelect: ${label}`);
  await act(async () => match[0].props.onChange(value));
};
const search = async (root, value) => {
  await act(async () => root.root.findByProps({ 'aria-label': 'Поиск по каталогу' }).props.onChange({ target: { value } }));
};

function fixture({ employee = profile, catalogData = catalog } = {}) {
  const calls = [];
  const record = name => (...args) => calls.push([name, ...args]);
  const state = {
    profile: employee, recommendations: { version, mode: 'rules_fallback', fallback_reason: 'missing_api_key', recommendations: [] },
    busy: false, loading: false, recLoading: false, asOfDate: '2026-09-23',
    refresh: record('refresh'), retryRecommendations: record('recommendations'), changeGoal: record('goal'),
    complete: record('complete'), retryCompletion: record('retryCompletion'), acceptLearningCompletion: record('learningCompleted'), dismissCompletion: noop,
  };
  const load = sourceLoader({
    '@/hooks/use-employee': { useEmployee: () => state },
    '@/hooks/use-resource': { useResource: endpoint => ({ data: endpoint === '/api/catalog' ? catalogData : { modules }, reload: noop }) },
    './learning-player': { LearningPlayer: props => React.createElement('test-learning-player', props) },
  });
  const { Employee } = load('src/components/quest/employee.tsx');
  return {
    calls,
    async mount(props = {}) {
      let root;
      await act(async () => { root = create(React.createElement(Employee, { id: employee.employee_id, onError: noop, ...props })); });
      return root;
    },
  };
}

test('only outstanding goal skills offer a learning action, using the skill ID', async () => {
  const chosen = [];
  const { Skills } = sourceLoader()('src/components/quest/skills.tsx');
  let root;
  await act(async () => { root = create(React.createElement(Skills, { employee: profile, names, onBrowseSkill: skillId => chosen.push(skillId) })); });
  try {
    assert.deepEqual(buttons(root).map(node => node.props['aria-label']).filter(Boolean).sort(), ['Найти обучение: Mentoring', 'Найти обучение: System Design']);
    await click(browse(root, 'System Design'));
    assert.deepEqual(chosen, ['design']);
  } finally { await close(root); }
});

for (const initialTab of ['overview', 'profile']) test(`${initialTab} skill action opens the catalog with exact skill matching`, async () => {
  const root = await fixture().mount({ initialTab });
  try {
    await click(browse(root, 'System Design'));
    assert.equal(button(root, 'Каталог').props['aria-current'], 'page');
    assert.deepEqual(titles(root), ['Архитектура сервисов', 'Практикум архитектуры', 'Основы проектирования']);
    assert.doesNotMatch(titles(root).join(','), /новости команды|без развития/);
    const skillSelect = root.root.findByProps({ label: 'Навык' });
    assert.equal(skillSelect.props.value, 'design');
    assert.match(text(root.toJSON()), /System Design/);
  } finally { await close(root); }
});

test('opening a skill clears a previous catalog query and activity type', async () => {
  const root = await fixture().mount();
  try {
    await click(button(root, 'Каталог'));
    await search(root, 'несуществующий запрос');
    await select(root, 'Тип активности', 'meetup');
    assert.deepEqual(titles(root), []);
    await click(button(root, 'Обзор'));
    await click(browse(root, 'System Design'));
    assert.equal(root.root.findByProps({ 'aria-label': 'Поиск по каталогу' }).props.value, '');
    assert.equal(root.root.findAll(node => node.type?.name === 'CatalogSelect' && (node.props.label ?? 'Тип активности') === 'Тип активности')[0].props.value, 'all');
    assert.equal(titles(root).length, 3);
  } finally { await close(root); }
});

test('skill filter combines with description search and activity type, and reset restores all programs', async () => {
  const root = await fixture().mount();
  try {
    await click(browse(root, 'System Design'));
    await search(root, 'распределённая');
    await select(root, 'Тип активности', 'workshop');
    assert.deepEqual(titles(root), ['Практикум архитектуры']);
    await select(root, 'Тип активности', 'course');
    assert.deepEqual(titles(root), []);
    await click(button(root, 'Сбросить фильтры'));
    assert.deepEqual(titles(root), events.map(item => item.title));
    assert.equal(root.root.findByProps({ label: 'Навык' }).props.value, '');
    assert.equal(root.root.findByProps({ 'aria-label': 'Поиск по каталогу' }).props.value, '');
  } finally { await close(root); }
});

test('an uncovered skill has an explicit catalog empty state and no invented course', async () => {
  const root = await fixture().mount();
  try {
    await click(browse(root, 'Mentoring'));
    assert.deepEqual(titles(root), []);
    assert.match(text(root.toJSON()), /Mentoring/);
    assert.match(text(root.toJSON()), /(?:нет|не найдено|не найдены|не нашлось)/i);
    assert.equal(buttons(root).filter(node => /Открыть (?:демомодуль|модуль|уроки)/.test(text(node))).length, 0);
    await click(button(root, 'Сбросить фильтры'));
    assert.equal(titles(root).length, events.length);
  } finally { await close(root); }
});

test('catalog outcomes respect the course cap and never promise a decrease or levels above five', async () => {
  const root = await fixture().mount();
  try {
    await click(browse(root, 'System Design'));
    const basic = articles(root).find(node => node.props['aria-label'] === 'Архитектура сервисов');
    const workshop = articles(root).find(node => node.props['aria-label'] === 'Практикум архитектуры');
    const introductory = articles(root).find(node => node.props['aria-label'] === 'Основы проектирования');
    assert.match(text(basic), /3\s*→\s*4/);
    assert.match(text(workshop), /3\s*→\s*5/);
    assert.doesNotMatch(text(workshop), /3\s*→\s*8/);
    assert.doesNotMatch(text(introductory), /3\s*→\s*2/);
    assert.match(text(introductory), /(?:не повыс|не увелич|не даст|без рост|не выраст|достиг|предел)/i);
  } finally { await close(root); }
});

test('a matching course still opens its real learning module for the employee', async () => {
  const scenario = fixture();
  const root = await scenario.mount();
  try {
    await click(browse(root, 'System Design'));
    await click(buttons(root).find(node => text(node).includes('Открыть демомодуль')));
    const player = root.root.findByType('test-learning-player');
    assert.equal(player.props.moduleId, 'architecture-module');
    assert.equal(player.props.event.event_id, 'real-course');
    assert.deepEqual(player.props.target, { kind: 'new_participation', event_id: 'real-course', session_date: null });
    assert.deepEqual(scenario.calls, []);
  } finally { await close(root); }
});

test('HR can inspect programs for a missing skill without starting or completing learning', async () => {
  const scenario = fixture();
  const root = await scenario.mount({ viewer: 'hr', readOnly: true, initialTab: 'profile' });
  try {
    await click(browse(root, 'System Design'));
    assert.equal(titles(root).length, 3);
    assert.deepEqual(buttons(root).map(text).filter(label => /Открыть (?:демомодуль|модуль|уроки)|Отметить|Продолжить уроки|Изменить цель/.test(label)), []);
    assert.equal(root.root.findAllByType('test-learning-player').length, 0);
    assert.deepEqual(scenario.calls, []);
  } finally { await close(root); }
});

test('a manually selected skill that already meets the goal never promises to close a gap', async () => {
  const { SkillCourseDetails } = sourceLoader()('src/components/quest/skill-course-details.tsx');
  const coveredSkill = { ...profile.skills[0], required_level: 3, gap: 0 };
  let root;
  await act(async () => { root = create(React.createElement(SkillCourseDetails, {
    event: events[0], skill: coveredSkill, employee: profile, names,
  })); });
  try {
    assert.match(text(root.toJSON()), /3\s*→\s*4/);
    assert.doesNotMatch(text(root.toJSON()), /закроет разрыв|после этой программы останется/);
  } finally { await close(root); }
});

test('scheduled availability uses the supplied snapshot date and lets an active participation continue', async () => {
  const { SkillCourseDetails } = sourceLoader()('src/components/quest/skill-course-details.tsx');
  const scheduled = event('scheduled', 'Архитектурная встреча', { format: 'online', upcoming_sessions: ['2030-01-01'] });
  const props = { event: scheduled, skill: profile.skills[0], employee: profile, names };
  let root;
  await act(async () => { root = create(React.createElement(SkillCourseDetails, { ...props, asOfDate: '2031-01-01' })); });
  try {
    assert.match(text(root.toJSON()), /Будущих дат пока нет/);
    await act(async () => root.update(React.createElement(SkillCourseDetails, { ...props, asOfDate: '2030-01-01' })));
    assert.doesNotMatch(text(root.toJSON()), /Будущих дат пока нет/);
    await act(async () => root.update(React.createElement(SkillCourseDetails, {
      ...props, asOfDate: '2031-01-01', employee: { ...profile, history: [
        { participation_id: 'active-scheduled', event_id: scheduled.event_id, effective_status: 'in_progress', actionable: true },
      ] },
    })));
    assert.match(text(root.toJSON()), /Обучение уже начато/);
    assert.doesNotMatch(text(root.toJSON()), /Будущих дат пока нет|начать эту программу сейчас нельзя/);
  } finally { await close(root); }
});
