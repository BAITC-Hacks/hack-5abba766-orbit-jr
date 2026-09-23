// Component behavior with DOM doubles; native dialog focus trapping needs browser QA.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
global.document = undefined;

function load(file, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(id => imports[id] ?? require(id), module, module.exports);
  return module.exports;
}
const { Modal } = load('src/components/quest/modal.tsx');
const { CatalogSelect } = load('src/components/quest/catalog-select.tsx');

for (const connected of [true, false]) {
  test(`modal restores scroll and ${connected ? 'trigger' : 'fallback'} focus after unmount`, async t => {
    let restored = 0, fallbackFocus = 0, opened = 0, closed = 0;
    const document = {
      activeElement: { isConnected: connected, focus: () => restored++ },
      documentElement: { style: { overflow: 'scroll' } },
      querySelector: () => ({ focus: () => fallbackFocus++ }),
    };
    t.mock.property(global, 'document', document);
    let root;
    await act(async () => { root = create(React.createElement(Modal, { title: 'Диалог', close() {} }), {
      createNodeMock: element => element.type === 'dialog' ? { showModal: () => opened++, close: () => closed++ } : null,
    }); });
    t.after(async () => { await act(async () => root.unmount()); });
    assert.equal(opened, 1);
    assert.equal(document.documentElement.style.overflow, 'hidden');
    await act(async () => root.unmount());
    assert.equal(closed, 1);
    assert.equal(document.documentElement.style.overflow, 'scroll');
    assert.equal(restored, connected ? 1 : 0);
    assert.equal(fallbackFocus, connected ? 0 : 1);
  });
}

test('catalog keyboard navigation selects only on confirmation, exposes active option, and cleans listeners', async t => {
  const listeners = new Set();
  t.mock.property(global, 'document', {
    getElementById: () => ({ scrollIntoView() {} }),
    addEventListener: (_, callback) => listeners.add(callback),
    removeEventListener: (_, callback) => listeners.delete(callback),
  });
  const changes = [];
  let root, focused = 0;
  await act(async () => { root = create(React.createElement(CatalogSelect, {
    value: 'course', onChange: value => changes.push(value),
    options: [['all', 'Все'], ['course', 'Курс'], ['project', 'Проект']],
  }), { createNodeMock: () => ({ focus: () => focused++, contains: () => false }) }); });
  t.after(async () => { await act(async () => root.unmount()); });
  const combo = () => root.root.findByProps({ role: 'combobox' });
  async function key(key) {
    let prevented = false, stopped = false;
    await act(async () => combo().props.onKeyDown({ key,
      preventDefault() { prevented = true; }, stopPropagation() { stopped = true; },
    }));
    return { prevented, stopped };
  }
  const activeText = () => root.root.findByProps({ id: combo().props['aria-activedescendant'] }).children[0];
  await key('ArrowDown');
  assert.equal(combo().props['aria-expanded'], true);
  assert.equal(activeText(), 'Курс');
  await key('ArrowDown');
  assert.equal(activeText(), 'Проект');
  assert.deepEqual(changes, []);
  await key('Home');
  assert.equal(activeText(), 'Все');
  await key('End');
  await key('Enter');
  assert.deepEqual(changes, ['project']);
  assert.equal(focused, 1);
  assert.equal(combo().props['aria-expanded'], false);
  assert.equal(listeners.size, 0);
  await key('п');
  assert.equal(activeText(), 'Проект');
  assert.deepEqual(await key('Escape'), { prevented: true, stopped: true });
  assert.equal(combo().props['aria-expanded'], false);
  assert.deepEqual(changes, ['project']);
  await key('ArrowDown');
  assert.equal(listeners.size, 1);
  await act(async () => root.unmount());
  assert.equal(listeners.size, 0);
});

test('import rejects absent and empty files locally and allows correcting the selection', async t => {
  let requests = 0, errors = 0, refreshes = 0;
  const { ImportPanel } = load('src/components/quest/import-panel.tsx', {
    '@/lib/api': { ApiFailure: class extends Error {}, endpoints: { import: '/api/import' },
      apiRequest: async () => { requests++; throw new Error('No HTTP expected'); }, isDefinitiveRejection: () => false },
    './feedback': { Failure: ({ error }) => error ? React.createElement('p', { role: 'alert' }, error.message) : null },
  });
  let root;
  await act(async () => { root = create(React.createElement(ImportPanel, {
    revision: 1, onRefresh: () => refreshes++, onError: () => errors++,
  })); });
  t.after(async () => { await act(async () => root.unmount()); });
  const submit = () => root.root.findByType('button');
  await act(async () => submit().props.onClick());
  assert.match(root.root.findByProps({ role: 'alert' }).children.join(''), /Выберите хотя бы один файл/);
  const input = root.root.findAllByProps({ type: 'file' })[0];
  await act(async () => input.props.onChange({ target: { files: [new File([], 'empty.json')] } }));
  await act(async () => submit().props.onClick());
  assert.match(root.root.findByProps({ role: 'alert' }).children.join(''), /empty\.json.*пуст/);
  assert.equal(submit().props.disabled, false);
  assert.equal(input.props.disabled, false);
  await act(async () => input.props.onChange({ target: { files: [new File(['{}'], 'data.json')] } }));
  assert.equal(root.root.findAllByProps({ role: 'alert' }).length, 0);
  assert.equal(requests, 0);
  assert.equal(errors, 0);
  assert.equal(refreshes, 0);
});
