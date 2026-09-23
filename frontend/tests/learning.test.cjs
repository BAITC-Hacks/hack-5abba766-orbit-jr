const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
function load(file, overrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => overrides[id] || require(id), module, module.exports);
  return module.exports;
}
const api = load('src/lib/api.ts');
const { useLearning } = load('src/hooks/use-learning.ts', { '@/lib/api': api });
const version = { dataset_revision: 1, employee_revision: 1 };
const target = { kind: 'new_participation', event_id: 'authored-event', session_date: null };
const course = { id: 'authored-module', event_id: target.event_id, version: 1, lesson_count: 1, question_count: 1,
  lessons: [{ id: 'lesson', title: 'Authored lesson', blocks: [] }], questions: [{ id: 'question', prompt: 'Authored choice', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }], sources: [] };
const progress = (extra = {}) => ({ id: 'attempt', employee_id: 'person', module_id: course.id, module_version: 1, module: course, target,
  status: 'ready_for_quiz', completed_lesson_ids: ['lesson'], lesson_count: 1, employee_version: version, quiz_attempts: 0, last_score: null, completion: null, previous_progress: null, ...extra });
const completion = { version: { ...version, employee_revision: 2 }, skill_changes: [{ skill_id: 'skill', before: 1, after: 2, gain: 1 }], employee: { version: { ...version, employee_revision: 2 } } };
const quizResult = (passed = true) => ({ attempt: progress({ status: passed ? 'passed' : 'ready_for_quiz', last_score: passed ? 100 : 0, quiz_attempts: 1, completion: passed ? completion : null, employee_version: passed ? completion.version : version }), feedback: [{ question_id: 'question', correct: passed, explanation: 'Server authored explanation' }], completion: passed ? completion : null, previous_progress: null });
const reply = (data) => Response.json({ data, meta: { request_id: 'authored-test', as_of_date: '2026-10-01' } });
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let state;
const onError = () => {};
function Harness() { state = useLearning('person', course.id, target, version, onError); return null; }
async function mount() { let root; await act(async () => { root = create(React.createElement(Harness)); }); return root; }
async function close(root) { await act(async () => root.unmount()); }
const initial = (url) => url.startsWith('/api/learning/modules/') ? reply(course) : reply(progress());

test('resumes the attempt content version and only advances a lesson after the server confirms it', async () => {
  const saved = progress({ status: 'learning', completed_lesson_ids: [] });
  const pending = defer();
  let saves = 0;
  global.fetch = async (url) => {
    if (url.endsWith('/lessons')) { saves++; return pending.promise; }
    if (url.startsWith('/api/learning/modules/')) return reply({ ...course, version: 2 });
    return reply(saved);
  };
  const root = await mount();
  try {
    assert.equal(state.module.version, 1);
    let request;
    await act(async () => { request = state.completeLesson('lesson'); });
    assert.deepEqual(state.attempt.completed_lesson_ids, []);
    await act(async () => { await state.completeLesson('lesson'); });
    assert.equal(saves, 1);
    await act(async () => { pending.resolve(reply(progress())); await request; });
    assert.deepEqual(state.attempt.completed_lesson_ids, ['lesson']);
    assert.equal(state.attempt.completion, null);
  } finally { await close(root); }
});

test('a failed quiz keeps skills unchanged and a later server-confirmed pass supplies the completion', async () => {
  let submission = 0;
  global.fetch = async (url) => url.endsWith('/quiz') ? reply(quizResult(++submission > 1)) : initial(url);
  const root = await mount();
  try {
    await act(async () => state.answer('question', 'a'));
    await act(async () => state.submitQuiz());
    assert.equal(state.result.completion, null);
    assert.equal(state.attempt.status, 'ready_for_quiz');
    assert.equal(state.result.feedback[0].correct, false);
    await act(async () => state.answer('question', 'b'));
    assert.equal(state.result, undefined);
    await act(async () => state.submitQuiz());
    assert.deepEqual(state.result.completion, completion);
    assert.equal(state.attempt.status, 'passed');
    await act(async () => state.submitQuiz());
    assert.equal(submission, 2);
  } finally { await close(root); }
});

test('an ambiguous quiz response retries the exact body and key and freezes answer changes', async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    if (!url.endsWith('/quiz')) return initial(url);
    calls.push({ body: options.body, key: options.headers.get('Idempotency-Key') });
    if (calls.length === 1) throw new TypeError('Authored connection loss');
    return reply(quizResult());
  };
  const root = await mount();
  try {
    await act(async () => state.answer('question', 'b'));
    await act(async () => state.submitQuiz());
    assert.equal(state.pending, true);
    assert.equal(state.result, undefined);
    await act(async () => state.answer('question', 'a'));
    assert.equal(state.answers.question, 'b');
    await act(async () => state.submitQuiz());
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(state.pending, false);
    assert.equal(state.attempt.status, 'passed');
  } finally { await close(root); }
});

for (const status of [408, 429]) test(`quiz HTTP ${status} keeps the original receipt until the outcome is known`, async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    if (!url.endsWith('/quiz')) return initial(url);
    calls.push({ body: options.body, key: options.headers.get('Idempotency-Key') });
    return calls.length === 1
      ? Response.json({ error: { code: 'HTTP_ERROR', message: 'Authored retryable response' } }, { status })
      : reply(quizResult());
  };
  const root = await mount();
  try {
    await act(async () => state.answer('question', 'b'));
    await act(async () => state.submitQuiz());
    assert.equal(state.pending, true);
    await act(async () => state.submitQuiz());
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(state.attempt.status, 'passed');
  } finally { await close(root); }
});

test('a definite version conflict keeps answers and requires refreshed state with a new submission key', async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    if (url === '/api/employees/person') return reply({ version: { ...version, employee_revision: 4 } });
    if (!url.endsWith('/quiz')) return initial(url);
    calls.push({ body: JSON.parse(options.body), key: options.headers.get('Idempotency-Key') });
    return calls.length === 1
      ? Response.json({ error: { code: 'REVISION_CONFLICT', message: 'Authored stale profile' } }, { status: 409 })
      : reply(quizResult());
  };
  const root = await mount();
  try {
    await act(async () => state.answer('question', 'b'));
    await act(async () => state.submitQuiz());
    assert.equal(state.needsRefresh, true);
    assert.equal(state.pending, false);
    assert.equal(state.answers.question, 'b');
    await act(async () => state.refreshVersion());
    assert.equal(state.needsRefresh, false);
    await act(async () => state.submitQuiz());
    assert.notEqual(calls[0].key, calls[1].key);
    assert.equal(calls[1].body.expected_version.employee_revision, 4);
    assert.deepEqual(calls[1].body.answers, { question: 'b' });
  } finally { await close(root); }
});

test('refreshing a stale profile starts the module again when no attempt was created', async () => {
  const starts = [];
  global.fetch = async (url, options) => {
    if (url.startsWith('/api/learning/modules/')) return reply(course);
    if (url === '/api/employees/person') return reply({ version: { ...version, employee_revision: 4 } });
    starts.push(JSON.parse(options.body));
    return starts.length === 1
      ? Response.json({ error: { code: 'REVISION_CONFLICT', message: 'Authored stale profile' } }, { status: 409 })
      : reply(progress({ status: 'learning', completed_lesson_ids: [], employee_version: { ...version, employee_revision: 4 } }));
  };
  const root = await mount();
  try {
    assert.equal(state.attempt, undefined);
    assert.equal(state.needsRefresh, true);
    await act(async () => state.refreshVersion());
    assert.equal(starts.length, 2);
    assert.equal(starts[1].expected_version.employee_revision, 4);
    assert.equal(state.attempt.status, 'learning');
    assert.equal(state.needsRefresh, false);
    assert.equal(state.loading, false);
  } finally { await close(root); }
});

test('a quiz passed after external completion is terminal without a new effect', async () => {
  let submissions = 0;
  const terminal = { ...quizResult(), attempt: progress({ status: 'passed', last_score: 100, quiz_attempts: 1 }), completion: null };
  global.fetch = async (url) => {
    if (url.endsWith('/quiz')) { submissions++; return reply(terminal); }
    return initial(url);
  };
  const root = await mount();
  try {
    await act(async () => state.answer('question', 'b'));
    await act(async () => state.submitQuiz());
    assert.equal(state.attempt.status, 'passed');
    assert.equal(state.result.completion, null);
    assert.equal(state.pending, false);
    await act(async () => state.submitQuiz());
    assert.equal(submissions, 1);
  } finally { await close(root); }
});

test('a resumed passed module explains the existing effect and returns without a fabricated completion', async () => {
  const terminalState = { attempt: progress({ status: 'passed', last_score: 100, quiz_attempts: 1 }), module: course };
  const { LearningPlayer } = load('src/components/quest/learning-player.tsx', {
    '@/hooks/use-learning': { useLearning: () => terminalState },
    './feedback': { Loading: () => null },
  });
  let closed = 0;
  let completed = 0;
  let root;
  await act(async () => { root = create(React.createElement(LearningPlayer, {
    employee: { employee_id: 'person', version }, moduleId: course.id, target, names: {},
    event: { title: 'Authored event', duration_hours: 16 }, onError,
    onClose: () => closed++, onCompleted: () => completed++,
  })); });
  try {
    assert.match(root.root.findByProps({ role: 'status' }).children.join(''), /ранее учтён/);
    assert.equal(root.root.findAllByProps({ className: 'learning-gains' }).length, 0);
    await act(async () => root.root.findByProps({ className: 'primary' }).props.onClick());
    assert.equal(closed, 1);
    assert.equal(completed, 0);
  } finally { await close(root); }
});
