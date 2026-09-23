import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { SessionView, EmployeeSource, ParticipationSource, CompletionRequest } from '../src/types';

const connectionString = process.env.TEST_DATABASE_URL;
const schema = `cq_test_${randomBytes(8).toString('hex')}`;
const hr: SessionView = { account_id: 'demo-hr', role: 'hr', employee_id: null, display_name: 'HR' };
const employee: SessionView = { account_id: 'demo-employee', role: 'employee', employee_id: 'E0001', display_name: 'Employee' };
const otherAccount: SessionView = { ...employee, account_id: 'test-employee-alias' };
const employee2: SessionView = { account_id: 'test-employee-2', role: 'employee', employee_id: 'E0002', display_name: 'Employee 2' };
const people: EmployeeSource[] = ['E0001', 'E0002'].map((employee_id, i) => ({ employee_id, full_name: `Test person ${i}`, department: 'Test', role: 'Engineer', grade: i ? 'Lead' : 'Junior', manager_id: null, hire_date: '2020-01-01', tenure_months: 81, work_format: 'remote', preferred_language: 'ru', career_goal: { target_role: 'Engineer', target_grade: 'Middle' }, skills: { SK_1: 1 }, last_review_date: '2026-09-01' }));
const history = (overrides: Partial<ParticipationSource> = {}): ParticipationSource => ({ record_id: 'NEW_HISTORY', employee_id: 'E0002', event_id: 'EV_A', date: '2026-09-10', due_date: null, status: 'completed', completion_pct: 100, score: null, feedback_rating: null, assigned_by: 'self', ...overrides });
let admin: pg.Pool;
let directory: string;
let data: typeof import('../src/services/data');
let db: typeof import('../src/db');
let bootstrap: typeof import('../src/db/bootstrap');

// Never touches demo tables: an explicit test connection and fresh random schema are required.
describe.skipIf(!connectionString)('PostgreSQL transactions and source import', () => {
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString });
    await admin.query(`CREATE SCHEMA ${schema}`);
    process.env.DATABASE_URL = connectionString;
    process.env.DATABASE_SCHEMA = schema;
    directory = await mkdtemp(path.join(tmpdir(), 'career-quest-fixture-'));
    const meta = { dataset: 'Synthetic integration fixture', version: '1', as_of_date: '2026-10-01' };
    await writeFile(path.join(directory, 'employees.json'), JSON.stringify({ meta, employees: people }));
    await writeFile(path.join(directory, 'skills.json'), JSON.stringify({ meta, proficiency_scale: { '0': 'None', '1': 'Basic', '2': 'Working', '3': 'Good', '4': 'Advanced', '5': 'Expert' }, skills: [{ skill_id: 'SK_1', name: 'Skill one', type: 'hard', category: 'Engineering', description: 'Synthetic test skill' }], role_profiles: ['Junior', 'Middle', 'Senior', 'Lead'].map((grade, i) => ({ role: 'Engineer', grade, required_skills: { SK_1: i + 2 }, critical_skills: ['SK_1'] })) }));
    await writeFile(path.join(directory, 'events.json'), JSON.stringify({ meta, events: [{ event_id: 'EV_A', title: 'Test course', description: 'Synthetic course', type: 'course', format: 'self_paced', duration_hours: 2, mandatory: false, target_roles: ['Engineer'], target_grades: ['Junior', 'Middle', 'Senior', 'Lead'], prerequisites: {}, develops_skills: [{ skill_id: 'SK_1', gain: 1, max_level: 5 }], upcoming_sessions: [] }] }));
    await writeFile(path.join(directory, 'activity_history.csv'), 'record_id,employee_id,event_id,date,due_date,status,completion_pct,score,feedback_rating,assigned_by\nR_1,E0001,EV_A,2026-09-15,,in_progress,50,,,self\n');
    db = await import('../src/db');
    data = await import('../src/services/data');
    bootstrap = await import('../src/db/bootstrap');
  }, 30000);
  beforeEach(async () => {
    if (!/^cq_test_[a-f0-9]+$/.test(schema)) throw new Error('Refusing to reset non-test schema');
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.query(`CREATE SCHEMA ${schema}`);
    await bootstrap.bootstrapDatabase(directory);
    for (const actor of [employee2, otherAccount]) {
      await db.pool.query("INSERT INTO accounts(id,username,password_hash,role,employee_id,display_name) SELECT $1,$1,password_hash,'employee',$2,$3 FROM accounts WHERE id='demo-employee'", [actor.account_id, actor.employee_id, actor.display_name]);
    }
  });
  afterAll(async () => {
    if (db) await db.closePools();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  const completion = (revision = 1): CompletionRequest => ({ expected_version: { dataset_revision: 1, employee_revision: revision }, simulation: true, target: { kind: 'existing_participation', participation_id: 'R_1' } });

  async function durableCounts() {
    const { rows } = await db.pool.query(`SELECT
      (SELECT count(*)::int FROM action_receipts) AS receipts,
      (SELECT count(*)::int FROM audit_records) AS audits,
      (SELECT count(*)::int FROM import_batches) AS batches`);
    return rows[0];
  }

  async function contend(writes: (() => Promise<unknown>)[]) {
    const blocker = await db.pool.connect();
    let settled: Promise<PromiseSettledResult<unknown>[]> | undefined;
    let transactionOpen = false;
    try {
      await blocker.query('BEGIN');
      transactionOpen = true;
      await blocker.query('SELECT id FROM app_meta WHERE id=1 FOR UPDATE');
      const { rows: [{ oid }] } = await blocker.query("SELECT 'app_meta'::regclass::oid AS oid");
      settled = Promise.allSettled(writes.map(write => write()));
      // Verify both writers are waiting on this schema's metadata lock before releasing it.
      await vi.waitFor(async () => {
        const { rows: [{ waiting }] } = await admin.query(`SELECT count(DISTINCT a.pid)::int AS waiting
          FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid
          WHERE l.relation=$1 AND a.wait_event_type='Lock' AND a.pid<>pg_backend_pid()`, [oid]);
        expect(waiting).toBe(writes.length);
      }, { timeout: 2000, interval: 10 });
      await blocker.query('COMMIT');
      transactionOpen = false;
      return await settled;
    } finally {
      if (transactionOpen) await blocker.query('ROLLBACK');
      blocker.release();
      if (settled) await settled;
    }
  }

  it('initializes all data and preserves changes without source files on restart', async () => {
    expect(await data.getHealth()).toMatchObject({ status: 'ok', schema_version: '003_learning_external_completion', dataset_initialized: true });
    const initial = await data.readSnapshot();
    expect(initial.employees).toHaveLength(2);
    expect(initial.history).toHaveLength(1);
    const selected = await data.updateGoal(employee, 'E0001', { expected_version: { dataset_revision: 1, employee_revision: 1 }, career_goal: { target_role: 'Engineer', target_grade: 'Senior' } });
    expect(selected.version.employee_revision).toBe(2);
    expect(await bootstrap.bootstrapDatabase('/path/that/does/not/exist')).toEqual({ seeded: false });
    expect((await data.readSnapshot()).goals.E0001?.target_grade).toBe('Senior');
  });

  it('replays receipt before version checks and protects URL target and body', async () => {
    const request = completion();
    const first = await data.completeActivity(employee, 'E0001', request, 'completion-key');
    expect(first.replayed).toBe(false);
    expect(first.result.skill_changes).toEqual([{ skill_id: 'SK_1', before: 1, after: 2, gain: 1 }]);
    await data.updateGoal(employee, 'E0001', { expected_version: first.result.version, career_goal: null });
    const replay = await data.completeActivity(employee, 'E0001', request, 'completion-key');
    expect(replay).toEqual({ result: first.result, replayed: true });
    await expect(data.completeActivity(employee, 'E0001', completion(3), 'completion-key')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const snapshot = await data.readSnapshot();
    expect(snapshot.completions).toHaveLength(1);
    expect(snapshot.employee_revisions.E0001).toBe(3);
    await expect(data.completeActivity(employee, 'E0001', completion(3), 'other-key')).rejects.toMatchObject({ code: 'ALREADY_COMPLETED' });
  });

  it('serializes concurrent writes so one action wins once', async () => {
    const results = await Promise.allSettled([data.completeActivity(employee, 'E0001', completion(), 'parallel-1'), data.completeActivity(employee, 'E0001', completion(), 'parallel-2')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason.code).toBe('REVISION_CONFLICT');
    const snapshot = await data.readSnapshot();
    expect(snapshot.completions).toHaveLength(1);
    expect(snapshot.global_revision).toBe(2);
  });

  it('replays one concurrent completion receipt and keeps actors independent', async () => {
    const same = await contend([
      () => data.completeActivity(employee, 'E0001', completion(), 'same-receipt'),
      () => data.completeActivity(employee, 'E0001', completion(), 'same-receipt'),
    ]);
    expect(same.every(result => result.status === 'fulfilled')).toBe(true);
    const responses = same.map(result => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof data.completeActivity>>>).value);
    expect(responses.map(result => result.replayed).sort()).toEqual([false, true]);
    expect(responses[0].result).toEqual(responses[1].result);
    expect(await durableCounts()).toEqual({ receipts: 1, audits: 1, batches: 0 });
    await expect(data.completeActivity(otherAccount, 'E0001', completion(2), 'same-receipt')).rejects.toMatchObject({ code: 'ALREADY_COMPLETED' });
    expect((await data.readSnapshot()).employee_revisions.E0001).toBe(2);
  });

  it('replays concurrent normalized imports without duplicate batches or revisions', async () => {
    const incoming = { ...people[0], employee_id: 'NORMALIZED_IMPORT', full_name: 'Normalized name' };
    const base = { expected_dataset_revision: 1, dry_run: false };
    const results = await contend([
      () => data.importData(hr, { ...base, employees: [{ ...incoming, full_name: '  Normalized name  ' }] }, 'same-import'),
      () => data.importData(hr, { ...base, employees: [incoming] }, 'same-import'),
    ]);
    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
    const responses = results.map(result => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof data.importData>>>).value);
    expect(responses.map(result => result.replayed).sort()).toEqual([false, true]);
    expect(responses[0].result).toEqual(responses[1].result);
    expect(await durableCounts()).toEqual({ receipts: 1, audits: 1, batches: 1 });
    const snapshot = await data.readSnapshot();
    expect(snapshot).toMatchObject({ dataset_revision: 2, global_revision: 2 });
    expect(snapshot.employees).toHaveLength(3);
    await expect(data.importData(hr, { ...base, employees: [{ ...incoming, full_name: 'Different' }] }, 'same-import'))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('scopes receipt keys by actor and operation while binding completion targets', async () => {
    const request = completion();
    await data.completeActivity(employee, 'E0001', request, 'shared-key');
    await data.importData(hr, { expected_dataset_revision: 1, dry_run: false,
      history: [history({ status: 'declined', completion_pct: 0 })] }, 'shared-key');
    const other = await data.completeActivity(employee2, 'E0002', {
      expected_version: { dataset_revision: 2, employee_revision: 2 }, simulation: true,
      target: { kind: 'new_participation', event_id: 'EV_A', session_date: null },
    }, 'shared-key');
    expect(other.replayed).toBe(false);
    await expect(data.completeActivity(employee2, 'E0002', request, 'shared-key')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await durableCounts()).toEqual({ receipts: 3, audits: 3, batches: 1 });
  });

  it('rejects another employee and HR imports from employee account', async () => {
    await expect(data.updateGoal(employee, 'E0002', { expected_version: { dataset_revision: 1, employee_revision: 1 }, career_goal: null })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(data.importData(employee, { expected_dataset_revision: 1, dry_run: true, employees: [people[0]] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('reports preview errors and rolls back every row of invalid commit', async () => {
    const newPerson = { ...people[0], employee_id: 'IMPORTED_PERSON' };
    const command = { expected_dataset_revision: 1, dry_run: true, employees: [newPerson], history: [history({ employee_id: newPerson.employee_id, event_id: 'MISSING' })] };
    expect((await data.importData(hr, command)).result.errors).toHaveLength(1);
    await expect(data.importData(hr, { ...command, dry_run: false }, 'invalid-import')).rejects.toMatchObject({ code: 'IMPORT_CONFLICT' });
    const snapshot = await data.readSnapshot();
    expect(snapshot.employees).toHaveLength(2);
    expect(snapshot.dataset_revision).toBe(1);
  });

  it('adds linked batch, replays stale receipt and skips unchanged source records', async () => {
    const imported = { ...people[0], employee_id: 'NEW_EMPLOYEE', manager_id: 'NEW_MANAGER' };
    const manager = { ...people[1], employee_id: 'NEW_MANAGER' };
    const command = { expected_dataset_revision: 1, dry_run: false, employees: [imported, manager], history: [history({ employee_id: imported.employee_id })] };
    const first = await data.importData(hr, command, 'valid-import');
    expect(first.result).toMatchObject({ applied: true, dataset_revision: 2, global_revision: 2, counts: { employees: { new_rows: 2, identical_rows: 0 }, history: { new_rows: 1, identical_rows: 0 } } });
    expect(await data.importData(hr, command, 'valid-import')).toEqual({ result: first.result, replayed: true });
    const again = await data.importData(hr, { ...command, expected_dataset_revision: 2 }, 'identical-import');
    expect(again.result).toMatchObject({ applied: false, dataset_revision: 2, counts: { employees: { new_rows: 0, identical_rows: 2 }, history: { new_rows: 0, identical_rows: 1 } } });
    const changed = { ...imported, full_name: 'Changed' };
    await expect(data.importData(hr, { expected_dataset_revision: 2, dry_run: false, employees: [changed] }, 'conflict-import')).rejects.toMatchObject({ code: 'IMPORT_CONFLICT' });
  });

  it('keeps selected goals and increments each affected existing employee only once', async () => {
    await data.updateGoal(employee, 'E0001', { expected_version: { dataset_revision: 1, employee_revision: 1 },
      career_goal: { target_role: 'Engineer', target_grade: 'Senior' } });
    const added = { ...people[0], employee_id: 'NEW_WITH_HISTORY' };
    const imported = await data.importData(hr, { expected_dataset_revision: 1, dry_run: false,
      employees: [people[0], added], history: [
        history({ record_id: 'OLD_FIRST', employee_id: 'E0001', status: 'declined', completion_pct: 0 }),
        history({ record_id: 'OLD_SECOND', employee_id: 'E0001', status: 'in_progress', completion_pct: 40 }),
        history({ record_id: 'NEW_FIRST', employee_id: added.employee_id }),
      ] }, 'revision-import');
    expect(imported.result).toMatchObject({ dataset_revision: 2, global_revision: 3, applied: true });
    const snapshot = await data.readSnapshot();
    expect(snapshot.employee_revisions).toEqual({ E0001: 3, E0002: 1, NEW_WITH_HISTORY: 1 });
    expect(snapshot.goals.E0001).toEqual({ target_role: 'Engineer', target_grade: 'Senior' });
    expect(snapshot.employees.find(row => row.employee_id === 'E0001')).toEqual(people[0]);
    await expect(data.updateGoal(employee, 'E0001', { expected_version: { dataset_revision: 1, employee_revision: 2 }, career_goal: null }))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('leaves previews and repeated selected goals free of durable changes', async () => {
    const first = await data.updateGoal(employee, 'E0001', { expected_version: { dataset_revision: 1, employee_revision: 1 }, career_goal: null });
    const before = await data.readSnapshot();
    const counts = await durableCounts();
    expect((await data.updateGoal(employee, 'E0001', { expected_version: first.version, career_goal: null })).changed).toBe(false);
    const preview = await data.importData(hr, { expected_dataset_revision: 1, dry_run: true, history: [history()] });
    expect(preview.result).toMatchObject({ applied: false, errors: [], counts: { history: { new_rows: 1 } } });
    expect(await data.readSnapshot()).toEqual(before);
    expect(await durableCounts()).toEqual(counts);
  });

  it.each(['import', 'completion', 'goal'] as const)('rolls back %s data, revisions and receipts if the final audit write fails', async operation => {
    const before = await data.readSnapshot();
    const counts = await durableCounts();
    await db.pool.query('ALTER TABLE audit_records ADD CONSTRAINT reject_audit CHECK (false)');
    const act = () => operation === 'import'
      ? data.importData(hr, { expected_dataset_revision: 1, dry_run: false,
        employees: [{ ...people[0], employee_id: 'ROLLED_BACK' }], history: [history()] }, 'audit-failure')
      : operation === 'completion'
        ? data.completeActivity(employee, 'E0001', completion(), 'audit-failure')
        : data.updateGoal(employee, 'E0001', { expected_version: { dataset_revision: 1, employee_revision: 1 }, career_goal: null });
    await expect(act()).rejects.toMatchObject({ code: '23514' });
    expect(await data.readSnapshot()).toEqual(before);
    expect(await durableCounts()).toEqual(counts);
    await db.pool.query('ALTER TABLE audit_records DROP CONSTRAINT reject_audit');
    await expect(act()).resolves.toBeDefined();
  });

  it('serializes source imports against completions without duplicate credit', async () => {
    const results = await contend([
      () => data.importData(hr, { expected_dataset_revision: 1, dry_run: false,
        history: [history({ employee_id: 'E0001' })] }, 'racing-import'),
      () => data.completeActivity(employee, 'E0001', completion(), 'racing-completion'),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(['REVISION_CONFLICT', 'IMPORT_CONFLICT']).toContain(rejected.reason.code);
    const snapshot = await data.readSnapshot();
    expect(snapshot.global_revision).toBe(2);
    expect(snapshot.employee_revisions.E0001).toBe(2);
    expect(snapshot.completions.length + snapshot.history.filter(row => row.status === 'completed').length).toBe(1);
    expect(await durableCounts()).toMatchObject({ receipts: 1, audits: 1 });
  });

  it('preserves a concurrent goal selection or rejects its stale version after an import', async () => {
    const target = { target_role: 'Engineer', target_grade: 'Senior' as const };
    const results = await contend([
      () => data.updateGoal(employee, 'E0001', { expected_version: { dataset_revision: 1, employee_revision: 1 }, career_goal: target }),
      () => data.importData(hr, { expected_dataset_revision: 1, dry_run: false,
        employees: [people[0]], history: [history({ employee_id: 'E0001', status: 'declined', completion_pct: 0 })] }, 'goal-race'),
    ]);
    expect(results[1].status).toBe('fulfilled');
    const snapshot = await data.readSnapshot();
    expect(snapshot.dataset_revision).toBe(2);
    if (results[0].status === 'fulfilled') {
      expect(snapshot.goals.E0001).toEqual(target);
      expect(snapshot.employee_revisions.E0001).toBe(3);
      expect(snapshot.global_revision).toBe(3);
    } else {
      expect(results[0].reason).toMatchObject({ code: 'REVISION_CONFLICT' });
      expect(Object.hasOwn(snapshot.goals, 'E0001')).toBe(false);
      expect(snapshot.employee_revisions.E0001).toBe(2);
      expect(snapshot.global_revision).toBe(2);
    }
  });

  it('prevents imported completed history from doubling a simulated skill gain', async () => {
    await data.completeActivity(employee, 'E0001', completion(), 'simulation');
    const command = { expected_dataset_revision: 1, dry_run: false, history: [history({ employee_id: 'E0001' })] };
    await expect(data.importData(hr, command, 'duplicate-completion')).rejects.toMatchObject({ code: 'IMPORT_CONFLICT' });
    const unchanged = await data.importData(hr, { expected_dataset_revision: 1, dry_run: false, history: [{ ...history(), record_id: 'R_1', employee_id: 'E0001', date: '2026-09-15', status: 'in_progress', completion_pct: 50 }] }, 'reimport-original');
    expect(unchanged.result).toMatchObject({ applied: false, counts: { history: { identical_rows: 1 } } });
    expect((await data.readSnapshot()).completions).toHaveLength(1);
  });

  it('rejects source participation IDs already assigned to local simulations', async () => {
    const simulated = await data.completeActivity(employee2, 'E0002', {
      expected_version: { dataset_revision: 1, employee_revision: 1 }, simulation: true,
      target: { kind: 'new_participation', event_id: 'EV_A', session_date: null },
    }, 'local-participation');
    const row = history({ record_id: simulated.result.participation_id, status: 'in_progress', completion_pct: 50 });
    const command = { expected_dataset_revision: 1, dry_run: true, history: [row] };
    const preview = await data.importData(hr, command);
    expect(preview.result.errors).toContainEqual(expect.objectContaining({
      file: 'history', record_id: row.record_id, code: 'PARTICIPATION_ID_COLLISION',
    }));
    await expect(data.importData(hr, { ...command, dry_run: false }, 'colliding-participation')).rejects.toMatchObject({ code: 'IMPORT_CONFLICT' });
    expect((await data.readSnapshot()).history).toHaveLength(1);
  });

  it('normalizes BOM/quoted CSV and rejects unknown columns and impossible dates', async () => {
    const { parseHistoryCsv, parseEmployeeFile, sourceHash } = await import('../src/validation');
    const parsed = parseHistoryCsv('\uFEFFrecord_id,employee_id,event_id,date,due_date,status,completion_pct,score,feedback_rating,assigned_by\n"R,quote",E0002,EV_A,2026-09-10,,completed,100,,,self\n');
    expect(parsed[0]).toEqual(history({ record_id: 'R,quote' }));
    expect(sourceHash(parsed[0])).toBe(sourceHash({ ...parsed[0] }));
    expect(() => parseHistoryCsv('record_id,bad\nR,1\n')).toThrow();
    expect(() => parseEmployeeFile(JSON.stringify({ meta: { dataset: 'T', version: '1', as_of_date: '2026-10-01' }, employees: [{ ...people[0], last_review_date: '2026-02-31' }] }), '2026-10-01')).toThrow();
  });
});
