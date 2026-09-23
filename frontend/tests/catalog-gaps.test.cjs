const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', javascript)(id => imports[id] ?? (id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`, imports) : id.startsWith('.') ? load(path.join(path.dirname(file), `${id}.tsx`), imports) : require(id)), loaded, loaded.exports);
  return loaded.exports;
}
const { CatalogGaps } = load('src/components/quest/catalog-gaps.tsx');
const { HrOverview } = load('src/components/quest/hr-overview.tsx', {
  '@/lib/labels': load('src/lib/labels.ts'),
  './catalog-gaps': { CatalogGaps },
});
const render = gaps => renderToStaticMarkup(React.createElement(CatalogGaps, {
  gaps, names: { TEST_DESIGN: 'Test Design' }, open: () => {},
}));
const gap = {
  skill_id: 'TEST_DESIGN', reason: 'NO_VOLUNTARY_CATALOG_COVERAGE',
  employee_ids: ['judge-profile'], employee_count: 1, critical_employee_count: 1,
  related_event_ids: [], audience_event_ids: [],
};

test('an uncovered goal skill shows catalog action, critical count and an employee profile button', () => {
  const html = render([gap]);
  assert.match(html, /Test Design/);
  assert.match(html, /В каталоге нет добровольной активности по навыку/);
  assert.match(html, /Критический навык цели: <strong>1<\/strong>/);
  assert.match(html, /Профиль judge-profile<\/button>/);
  assert.match(html, /новый курс, практику или менторство/);
});

test('audience mismatch and level cap receive distinct explanations and actions', () => {
  const audience = render([{ ...gap, reason: 'AUDIENCE_MISMATCH', related_event_ids: ['other-grade'] }]);
  const cap = render([{ ...gap, reason: 'LEVEL_CAP_REACHED', related_event_ids: ['intro'], audience_event_ids: ['intro'] }]);
  assert.match(audience, /другую роль или грейд/);
  assert.match(audience, /подготовительную программу/);
  assert.match(cap, /достиг предела/);
  assert.match(cap, /активность более высокого уровня/);
});

test('an empty diagnostic does not promise an executable route', () => {
  const html = render([]);
  assert.match(html, /пробелов по покрытию каталога не найдено/);
  assert.match(html, /не гарантирует готовый маршрут/);
  assert.match(html, /Предварительные требования, расписание, история прохождения/);
});

test('a large catalog diagnostic keeps later needs available in a disclosure', () => {
  const html = render(Array.from({ length: 9 }, (_, index) => ({ ...gap, skill_id: `skill-${index}` })));
  assert.match(html, /<summary>Остальные потребности \(1\)<\/summary>/);
  assert.ok(html.indexOf('Остальные потребности') < html.indexOf('<h3>skill-8</h3>'));
});

test('the HR overview includes actionable catalog diagnostics and neutral goal attribution', () => {
  const counts = { completed: 0, in_progress: 0, dropped: 0, no_show: 0, declined: 0, overdue: 0 };
  const html = renderToStaticMarkup(React.createElement(HrOverview, {
    data: {
      global_revision: 1, employee_count: 1,
      goals_by_source: { imported: 0, selected: 1, suggested: 0, missing: 0 },
      skill_gaps: [], catalog_gaps: [gap], no_next_step: [],
      participation: { actual_by_status: counts, effective_by_status: counts,
        simulated_completions: 0, superseded_attempts: 0, by_activity: [] },
    },
    names: { TEST_DESIGN: 'Test Design' }, open: () => {}, showPeople: () => {},
  }));
  assert.match(html, /Где расширить возможности развития/);
  assert.match(html, /Test Design/);
  assert.match(html, /Профиль judge-profile<\/button>/);
  assert.match(html, /Выбранная цель/);
  assert.doesNotMatch(html, /Цель выбрана сотрудником/);
});
