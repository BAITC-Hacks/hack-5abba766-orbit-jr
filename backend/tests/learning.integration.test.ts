import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { SessionView, DomainVersion } from '../src/types';
import type { LearningAttempt, StartLearningRequest } from '../../contracts/learning';
import { learningCourses } from '../src/learning/content';

const connectionString = process.env.TEST_DATABASE_URL;
const schema = `cq_test_${randomBytes(8).toString('hex')}`;
const employee: SessionView = { account_id: 'demo-employee', role: 'employee', employee_id: 'E0001', display_name: 'Employee' };
const employee2: SessionView = { account_id: 'test-employee-2', role: 'employee', employee_id: 'E0002', display_name: 'Employee 2' };
const hr: SessionView = { account_id: 'demo-hr', role: 'hr', employee_id: null, display_name: 'HR' };
const initialVersion: DomainVersion = { dataset_revision: 1, employee_revision: 1 };
const course = learningCourses.find(c => c.event_id === 'EV_012')!;
const answers = Object.fromEntries(course.questions.map(q => [q.id, q.correct_option_id]));
const startRequest: StartLearningRequest = { module_id: course.id, expected_version: initialVersion, target: { kind: 'existing_participation', participation_id: 'R_COURSE' } };
let admin: pg.Pool;
let directory: string;
let db: typeof import('../src/db');
let data: typeof import('../src/services/data');
let learning: typeof import('../src/learning/service');
let bootstrap: typeof import('../src/db/bootstrap');
let auth: typeof import('../src/auth');
let http: typeof import('../src/http');

describe.skipIf(!connectionString)('persistent learning and atomic grading', () => {
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString });
    await admin.query(`CREATE SCHEMA ${schema}`);
    process.env.DATABASE_URL = connectionString;
    process.env.DATABASE_SCHEMA = schema;
    process.env.APP_ORIGIN = 'http://localhost:3000';
    directory = await mkdtemp(path.join(tmpdir(), 'cq-learning-'));
    const meta = { dataset: 'Synthetic learning test', version: '1', as_of_date: '2026-10-01' };
    const people = ['E0001', 'E0002'].map(employee_id => ({ employee_id, full_name: 'Test employee', department: 'Engineering', role: 'Engineer', grade: 'Junior', manager_id: null, hire_date: '2020-01-01', tenure_months: 81, work_format: 'remote', preferred_language: 'ru', career_goal: { target_role: 'Engineer', target_grade: 'Middle' }, skills: { SK_PYTHON: 2, SK_SYSTEM_DESIGN: 2 }, last_review_date: '2026-09-01' }));
    await writeFile(path.join(directory, 'employees.json'), JSON.stringify({ meta, employees: people }));
    await writeFile(path.join(directory, 'skills.json'), JSON.stringify({ meta, proficiency_scale: { '0': 'None', '1': 'Basic', '2': 'Working', '3': 'Good', '4': 'Advanced', '5': 'Expert' }, skills: ['SK_PYTHON', 'SK_SYSTEM_DESIGN'].map(skill_id => ({ skill_id, name: skill_id, type: 'hard', category: 'Engineering', description: 'Synthetic test skill' })), role_profiles: ['Junior', 'Middle'].map((grade, i) => ({ role: 'Engineer', grade, required_skills: { SK_PYTHON: i + 2, SK_SYSTEM_DESIGN: i + 2 }, critical_skills: ['SK_PYTHON'] })) }));
    await writeFile(path.join(directory, 'events.json'), JSON.stringify({ meta, events: ['EV_012', 'EV_005'].map(event_id => ({ event_id, title: 'Synthetic course', description: 'Synthetic test event', type: 'course', format: event_id === 'EV_012' ? 'self_paced' : 'online', duration_hours: 16, mandatory: false, target_roles: ['Engineer'], target_grades: ['Junior', 'Middle'], prerequisites: {}, develops_skills: [{ skill_id: event_id === 'EV_012' ? 'SK_PYTHON' : 'SK_SYSTEM_DESIGN', gain: 1, max_level: 5 }], upcoming_sessions: event_id === 'EV_012' ? [] : ['2026-10-05'] })) }));
    await writeFile(path.join(directory, 'activity_history.csv'), 'record_id,employee_id,event_id,date,due_date,status,completion_pct,score,feedback_rating,assigned_by\nR_COURSE,E0001,EV_012,2026-09-15,,in_progress,50,,,self\n');
    db = await import('../src/db');
    data = await import('../src/services/data');
    learning = await import('../src/learning/service');
    bootstrap = await import('../src/db/bootstrap');
    auth = await import('../src/auth');
    http = await import('../src/http');
  });
  beforeEach(async () => {
    if (!/^cq_test_[a-f0-9]+$/.test(schema)) throw new Error('Refusing to reset non-test schema');
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.query(`CREATE SCHEMA ${schema}`);
    await bootstrap.bootstrapDatabase(directory);
    await db.pool.query("INSERT INTO accounts(id,username,password_hash,role,employee_id,display_name) SELECT $1,$1,password_hash,'employee',$2,$3 FROM accounts WHERE id='demo-employee'", [employee2.account_id, employee2.employee_id, employee2.display_name]);
  });
  afterAll(async () => {
    if (db) await db.closePools();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  async function ready(): Promise<LearningAttempt> {
    let attempt = await learning.startLearning(employee, 'E0001', startRequest);
    for (const lesson of course.lessons) attempt = await learning.completeLesson(employee, 'E0001', attempt.id, lesson.id);
    return attempt;
  }

  it('publishes authored lessons and options without exposing answer keys or grading explanations', async () => {
    const list = learning.listLearningModules();
    expect(list.modules).toHaveLength(2);
    expect(list.modules.every(m => m.is_demo && m.lesson_count === 3 && m.question_count === 3 && m.passing_score === 100)).toBe(true);
    const module = learning.getLearningModule(course.id);
    expect(module.lessons).toHaveLength(3);
    expect(module.questions[0]).not.toHaveProperty('correct_option_id');
    expect(module.questions[0]).not.toHaveProperty('explanation');
    const attempt = await learning.startLearning(employee, 'E0001', startRequest);
    expect(JSON.stringify(attempt)).not.toContain('correct_option_id');
    expect(JSON.stringify(attempt)).not.toContain('"explanation"');
    expect(attempt.module).toEqual(module);
  });

  it('resumes the same naturally unique attempt even with a stale start version', async () => {
    const first = await learning.startLearning(employee, 'E0001', startRequest);
    await data.updateGoal(employee, 'E0001', { expected_version: initialVersion, career_goal: null });
    const again = await learning.startLearning(employee, 'E0001', startRequest);
    expect(again.id).toBe(first.id);
    expect(again.employee_version.employee_revision).toBe(2);
    expect((await db.pool.query('SELECT count(*)::integer AS n FROM learning_attempts')).rows[0].n).toBe(1);
  });

  it('resumes the stored course version when current authored content was upgraded', async () => {
    const attempt = await learning.startLearning(employee, 'E0001', startRequest);
    const version = course.version;
    try {
      course.version = version + 1;
      expect(learning.getLearningModule(course.id).version).toBe(version + 1);
      const resumed = await learning.startLearning(employee, 'E0001', startRequest);
      expect(resumed.id).toBe(attempt.id);
      expect(resumed.module.version).toBe(version);
      expect(resumed.module_version).toBe(version);
    } finally { course.version = version; }
  });

  it('enforces lesson ordering, resumes after restart and awards no skills for reading', async () => {
    const attempt = await learning.startLearning(employee, 'E0001', startRequest);
    await expect(learning.completeLesson(employee, 'E0001', attempt.id, course.lessons[1].id)).rejects.toMatchObject({ code: 'INVALID_PARTICIPATION_STATE' });
    const first = await learning.completeLesson(employee, 'E0001', attempt.id, course.lessons[0].id);
    expect(await learning.completeLesson(employee, 'E0001', attempt.id, course.lessons[0].id)).toEqual(first);
    expect(await bootstrap.bootstrapDatabase('/source/not/needed/after/seed')).toEqual({ seeded: false });
    const resumed = await learning.getLearningAttempt(employee, 'E0001', attempt.id);
    expect(resumed.completed_lesson_ids).toEqual([course.lessons[0].id]);
    const snapshot = await data.readSnapshot();
    expect(snapshot.completions).toHaveLength(0);
    expect(snapshot.employee_revisions.E0001).toBe(1);
    expect(snapshot.global_revision).toBe(1);
  });

  it('requires all lessons and accepts only exact known question and option IDs', async () => {
    const attempt = await learning.startLearning(employee, 'E0001', startRequest);
    await expect(learning.submitQuiz(employee, 'E0001', attempt.id, { expected_version: initialVersion, answers }, 'too-early')).rejects.toMatchObject({ code: 'INVALID_PARTICIPATION_STATE' });
    await ready();
    await expect(learning.submitQuiz(employee, 'E0001', attempt.id, { expected_version: initialVersion, answers: {} }, 'missing-answers')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(learning.submitQuiz(employee, 'E0001', attempt.id, { expected_version: initialVersion, answers: { ...answers, unknown: 'a' } }, 'extra-answer')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(learning.submitQuiz(employee, 'E0001', attempt.id, { expected_version: initialVersion, answers: { ...answers, [course.questions[0].id]: 'UNKNOWN' } }, 'unknown-option')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await learning.getLearningAttempt(employee, 'E0001', attempt.id)).quiz_attempts).toBe(0);
  });

  it('grades on the server, persists a failed quiz and does not award partial skill gains', async () => {
    const attempt = await ready();
    const question = course.questions[0];
    const wrong = question.options.find(option => option.id !== question.correct_option_id)!.id;
    const result = await learning.submitQuiz(employee, 'E0001', attempt.id, { expected_version: initialVersion, answers: { ...answers, [question.id]: wrong } }, 'wrong-answer');
    expect(result.result.attempt).toMatchObject({ status: 'ready_for_quiz', quiz_attempts: 1, last_score: 67 });
    expect(result.result.completion).toBeNull();
    expect(result.result.feedback[0]).toEqual({ question_id: question.id, correct: false, explanation: question.explanation });
    const snapshot = await data.readSnapshot();
    expect(snapshot.completions).toHaveLength(0);
    expect(snapshot.employee_revisions.E0001).toBe(1);
    expect((await learning.getLearningAttempt(employee, 'E0001', attempt.id)).last_score).toBe(67);
  });

  it('atomically passes the quiz, awards the canonical effect and replays before stale-version checks', async () => {
    const attempt = await ready();
    const request = { expected_version: initialVersion, answers };
    const first = await learning.submitQuiz(employee, 'E0001', attempt.id, request, 'passed-quiz');
    expect(first.result.attempt).toMatchObject({ status: 'passed', quiz_attempts: 1, last_score: 100, employee_version: { employee_revision: 2 } });
    expect(first.result.completion?.skill_changes).toEqual([{ skill_id: 'SK_PYTHON', before: 2, after: 3, gain: 1 }]);
    expect(first.result.previous_progress?.coverage).toBeCloseTo(2 / 3);
    expect(first.result.completion?.employee.progress?.coverage).toBeCloseTo(5 / 6);
    expect(await learning.submitQuiz(employee, 'E0001', attempt.id, request, 'passed-quiz')).toEqual({ result: first.result, replayed: true });
    const withNewKey = await learning.submitQuiz(employee, 'E0001', attempt.id, request, 'new-key-after-pass');
    expect(withNewKey.replayed).toBe(true);
    expect(withNewKey.result.attempt.quiz_attempts).toBe(1);
    expect((await data.readSnapshot()).completions).toHaveLength(1);
    const receipts = await db.pool.query("SELECT operation FROM action_receipts WHERE operation IN ('completion','learning.quiz')");
    expect(receipts.rows.filter(r => r.operation === 'completion')).toHaveLength(1);
    expect((await learning.startLearning(employee, 'E0001', startRequest)).status).toBe('passed');
  });

  it('rejects key reuse with different answers and stale unpassed quiz versions', async () => {
    const attempt = await ready();
    const wrong = { ...answers, [course.questions[0].id]: course.questions[0].options.find(o => o.id !== course.questions[0].correct_option_id)!.id };
    await learning.submitQuiz(employee, 'E0001', attempt.id, { expected_version: initialVersion, answers: wrong }, 'one-key');
    await expect(learning.submitQuiz(employee, 'E0001', attempt.id, { expected_version: initialVersion, answers }, 'one-key')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await data.updateGoal(employee, 'E0001', { expected_version: initialVersion, career_goal: null });
    await expect(learning.submitQuiz(employee, 'E0001', attempt.id, { expected_version: initialVersion, answers }, 'stale-quiz')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('serializes concurrent correct submissions into one completion and one graded attempt', async () => {
    const attempt = await ready();
    const request = { expected_version: initialVersion, answers };
    const results = await Promise.all([learning.submitQuiz(employee, 'E0001', attempt.id, request, 'concurrent-1'), learning.submitQuiz(employee, 'E0001', attempt.id, request, 'concurrent-2')]);
    expect(results.filter(r => !r.replayed)).toHaveLength(1);
    expect(results.every(r => r.result.attempt.status === 'passed')).toBe(true);
    const snapshot = await data.readSnapshot();
    expect(snapshot.completions).toHaveLength(1);
    expect(snapshot.employee_revisions.E0001).toBe(2);
    expect((await learning.getLearningAttempt(employee, 'E0001', attempt.id)).quiz_attempts).toBe(1);
  });

  it('rolls back completion, revisions and both receipts if persisting the passing attempt fails', async () => {
    const attempt = await ready();
    await db.pool.query("CREATE FUNCTION reject_learning_pass() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='passed' THEN RAISE EXCEPTION 'synthetic attempt write failure'; END IF; RETURN NEW; END $$");
    await db.pool.query('CREATE TRIGGER reject_learning_pass BEFORE UPDATE ON learning_attempts FOR EACH ROW EXECUTE FUNCTION reject_learning_pass()');
    await expect(learning.submitQuiz(employee, 'E0001', attempt.id, { expected_version: initialVersion, answers }, 'forced-rollback')).rejects.toThrow('synthetic attempt write failure');
    const snapshot = await data.readSnapshot();
    expect(snapshot.completions).toHaveLength(0);
    expect(snapshot.employee_revisions.E0001).toBe(1);
    expect(snapshot.global_revision).toBe(1);
    expect((await db.pool.query('SELECT * FROM action_receipts')).rowCount).toBe(0);
    expect((await learning.getLearningAttempt(employee, 'E0001', attempt.id)).quiz_attempts).toBe(0);
  });

  it('does not double-award when the event was simulated outside learning first', async () => {
    const attempt = await ready();
    const simulated = await data.completeActivity(employee, 'E0001', { simulation: true, expected_version: initialVersion, target: startRequest.target }, 'external-simulation');
    await expect(learning.submitQuiz(employee, 'E0001', attempt.id, { expected_version: simulated.result.version, answers }, 'after-external-simulation')).rejects.toMatchObject({ code: 'ALREADY_COMPLETED' });
    expect((await data.readSnapshot()).completions).toHaveLength(1);
    expect((await learning.getLearningAttempt(employee, 'E0001', attempt.id)).status).toBe('ready_for_quiz');
  });

  it('reconciles a new learning target with participation imported while the lessons were open', async () => {
    const request: StartLearningRequest = { module_id: course.id, expected_version: initialVersion,
      target: { kind: 'new_participation', event_id: course.event_id, session_date: null } };
    let attempt = await learning.startLearning(employee2, 'E0002', request);
    for (const lesson of course.lessons) attempt = await learning.completeLesson(employee2, 'E0002', attempt.id, lesson.id);
    await data.importData(hr, { dry_run: false, expected_dataset_revision: 1, history: [{
      record_id: 'R_IMPORTED', employee_id: 'E0002', event_id: course.event_id, date: '2026-09-20',
      due_date: null, status: 'in_progress', completion_pct: 50, score: null, feedback_rating: null, assigned_by: 'self',
    }] }, 'learning-import');
    const quiz = { expected_version: initialVersion, answers };
    await expect(learning.submitQuiz(employee2, 'E0002', attempt.id, quiz, 'before-import-refresh')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    const resumed = await learning.startLearning(employee2, 'E0002', { ...request,
      target: { kind: 'existing_participation', participation_id: 'R_IMPORTED' } });
    expect(resumed.id).toBe(attempt.id);
    const passed = await learning.submitQuiz(employee2, 'E0002', attempt.id, { ...quiz, expected_version: resumed.employee_version }, 'after-import-refresh');
    expect(passed.result.attempt).toMatchObject({ status: 'passed', quiz_attempts: 1,
      target: { kind: 'existing_participation', participation_id: 'R_IMPORTED' } });
    expect(passed.result.completion?.participation_id).toBe('R_IMPORTED');
    const snapshot = await data.readSnapshot();
    expect(snapshot.completions).toHaveLength(1);
    expect(snapshot.completions[0].participation_id).toBe('R_IMPORTED');
    expect(snapshot.employee_revisions.E0002).toBe(3);
    expect(passed.result.completion?.skill_changes).toEqual([{ skill_id: 'SK_PYTHON', before: 2, after: 3, gain: 1 }]);
  });

  it('enforces employee scopes, target/course matching and scheduled event dates', async () => {
    const attempt = await ready();
    await expect(learning.getLearningAttempt(employee, 'E0002', attempt.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(learning.getLearningAttempt(hr, 'E0002', attempt.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(learning.startLearning(employee2, 'E0002', { ...startRequest, target: { kind: 'new_participation', event_id: 'EV_005', session_date: '2026-10-05' } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const systemCourse = learningCourses.find(c => c.event_id === 'EV_005')!;
    await expect(learning.startLearning(employee2, 'E0002', { module_id: systemCourse.id, expected_version: initialVersion, target: { kind: 'new_participation', event_id: 'EV_005', session_date: '2026-10-06' } })).rejects.toMatchObject({ code: 'INELIGIBLE_EVENT' });
    expect((await learning.startLearning(employee2, 'E0002', { module_id: systemCourse.id, expected_version: initialVersion, target: { kind: 'new_participation', event_id: 'EV_005', session_date: '2026-10-05' } })).event_id).toBe('EV_005');
  });

  it('rejects HR and other employees at every mutation service entrypoint without changing durable state', async () => {
    const attempt = await ready();
    const before = await data.readSnapshot();
    const tables = ['goal_overrides', 'learning_attempts', 'demo_completions', 'action_receipts', 'audit_records'];
    const persisted = async () => Promise.all(tables.map(async table => (await db.pool.query(`SELECT * FROM ${table}`)).rows));
    const beforeTables = await persisted();
    for (const actor of [hr, { ...hr, employee_id: 'E0001' }, employee2]) {
      const forbidden = { code: 'FORBIDDEN', status: 403 };
      await expect(data.updateGoal(actor, 'E0001', { expected_version: initialVersion, career_goal: null })).rejects.toMatchObject(forbidden);
      const completion = { simulation: true as const, expected_version: initialVersion, target: startRequest.target };
      await expect(data.completeActivity(actor, 'E0001', completion, 'denied-completion')).rejects.toMatchObject(forbidden);
      await expect(db.withTransaction(async client => {
        await data.lockDataset(client);
        return data.completeActivityInTransaction(client, actor, 'E0001', completion, 'denied-transaction');
      })).rejects.toMatchObject(forbidden);
      await expect(learning.startLearning(actor, 'E0001', startRequest)).rejects.toMatchObject(forbidden);
      await expect(learning.completeLesson(actor, 'E0001', attempt.id, course.lessons[0].id)).rejects.toMatchObject(forbidden);
      await expect(learning.submitQuiz(actor, 'E0001', attempt.id, { expected_version: initialVersion, answers }, 'denied-quiz')).rejects.toMatchObject(forbidden);
    }
    expect(await data.readSnapshot()).toEqual(before);
    expect(await persisted()).toEqual(beforeTables);
    expect((await learning.getLearningAttempt(hr, 'E0001', attempt.id)).status).toBe('ready_for_quiz');
    expect((await learning.submitQuiz(employee, 'E0001', attempt.id, { expected_version: initialVersion, answers }, 'own-quiz')).result.attempt.status).toBe('passed');
  });

  it('rejects HR and foreign-employee HTTP mutations before parsing bodies while preserving HR reads', async () => {
    const attempt = await ready();
    const hrLogin = await auth.login('hr', 'hr-demo-2026');
    const employeeLogin = await auth.login('employee', 'employee-demo-2026');
    const before = await data.readSnapshot();
    const beforeAttempt = (await db.pool.query('SELECT * FROM learning_attempts')).rows;
    const beforeAudits = (await db.pool.query('SELECT * FROM audit_records')).rows;
    const beforeReceipts = (await db.pool.query('SELECT * FROM action_receipts')).rows;
    for (const [token, employeeId] of [[hrLogin.token, 'E0001'], [employeeLogin.token, 'E0002']]) {
      const base = `/api/employees/${employeeId}`;
      const routes: [string, string, unknown][] = [
        ['PUT', `${base}/goal`, { expected_version: initialVersion, career_goal: null }],
        ['POST', `${base}/completions`, { expected_version: initialVersion, simulation: true, target: startRequest.target }],
        ['POST', `${base}/learning/attempts`, startRequest],
        ['POST', `${base}/learning/attempts/${attempt.id}/lessons`, { lesson_id: course.lessons[0].id }],
        ['POST', `${base}/learning/attempts/${attempt.id}/quiz`, { expected_version: initialVersion, answers }],
      ];
      for (const [method, route, body] of routes) {
        for (const payload of [JSON.stringify(body), '{']) {
          const request = new Request(`http://localhost:3000${route}`, { method,
            headers: { cookie: `cq_session=${token}`, origin: 'http://localhost:3000', 'content-type': 'application/json', 'idempotency-key': 'denied-http-mutation' }, body: payload });
          const response = await http.handleRequest(request);
          expect(response.status, `${method} ${route}`).toBe(403);
          expect((await response.json()).error.code).toBe('FORBIDDEN');
          expect(request.bodyUsed).toBe(false);
        }
      }
    }
    expect(await data.readSnapshot()).toEqual(before);
    expect((await db.pool.query('SELECT * FROM learning_attempts')).rows).toEqual(beforeAttempt);
    expect((await db.pool.query('SELECT * FROM audit_records')).rows).toEqual(beforeAudits);
    expect((await db.pool.query('SELECT * FROM action_receipts')).rows).toEqual(beforeReceipts);
    for (const route of ['/api/employees/E0001', `/api/employees/E0001/learning/attempts/${attempt.id}`, '/api/hr/overview']) {
      expect((await http.handleRequest(new Request(`http://localhost:3000${route}`, { headers: { cookie: `cq_session=${hrLogin.token}` } }))).status).toBe(200);
    }
    const goal = await http.handleRequest(new Request('http://localhost:3000/api/employees/E0001/goal', { method: 'PUT',
      headers: { cookie: `cq_session=${employeeLogin.token}`, origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ expected_version: initialVersion, career_goal: null }) }));
    expect(goal.status).toBe(200);
    expect((await goal.json()).data.changed).toBe(true);
  });

  it('upgrades a populated schema without losing seed, sessions, goals or simulated progress', async () => {
    const loggedIn = await auth.login('employee', 'employee-demo-2026');
    await data.updateGoal(employee, 'E0001', { expected_version: initialVersion, career_goal: null });
    await data.completeActivity(employee, 'E0001', { simulation: true, expected_version: { ...initialVersion, employee_revision: 2 }, target: startRequest.target }, 'before-migration');
    const before = await data.readSnapshot();
    await db.pool.query('DROP TABLE learning_attempts');
    await db.pool.query("DELETE FROM schema_migrations WHERE version='002_learning'");
    await db.migrate();
    expect(await data.readSnapshot()).toEqual(before);
    expect(await auth.session(new Request('http://localhost:3000', { headers: { cookie: `cq_session=${loggedIn.token}` } }))).toMatchObject({ account_id: employee.account_id });
    expect(await data.getHealth()).toMatchObject({ status: 'ok', schema_version: '002_learning' });
  });

  it('HTTP exposes protected modules and grades an entire lesson journey with no client score', async () => {
    const guest = await http.handleRequest(new Request('http://localhost:3000/api/learning/modules'));
    expect(guest.status).toBe(401);
    const login = await auth.login('employee', 'employee-demo-2026');
    const request = async (route: string, body?: unknown, key?: string) => http.handleRequest(new Request(`http://localhost:3000${route}`, { method: body ? 'POST' : 'GET', headers: { cookie: `cq_session=${login.token}`, origin: 'http://localhost:3000', ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    expect((await request('/api/learning/modules')).status).toBe(200);
    const start = await request('/api/employees/E0001/learning/attempts', startRequest);
    expect(start.status).toBe(200);
    const { data: attempt } = await start.json() as { data: LearningAttempt };
    const route = `/api/employees/E0001/learning/attempts/${attempt.id}`;
    expect((await request(route)).status).toBe(200);
    for (const lesson of course.lessons) expect((await request(`${route}/lessons`, { lesson_id: lesson.id })).status).toBe(200);
    const illegal = await request(`${route}/quiz`, { expected_version: initialVersion, answers, score: 100 }, 'illegal-score');
    expect(illegal.status).toBe(400);
    const quiz = await request(`${route}/quiz`, { expected_version: initialVersion, answers }, 'http-pass-key');
    expect(quiz.status).toBe(200);
    expect((await quiz.json()).data.attempt.status).toBe('passed');
  });
});
