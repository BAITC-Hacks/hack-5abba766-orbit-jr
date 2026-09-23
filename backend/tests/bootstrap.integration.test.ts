import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { writeAiFlowFixture } from './fixtures/ai-flow';

const connectionString = process.env.TEST_DATABASE_URL;
const schema = `bootstrap_test_${randomUUID().replaceAll('-', '')}`;

describe.skipIf(!connectionString)('Bootstrap on a fresh PostgreSQL schema', () => {
  let admin: pg.Pool;
  let directory: string;
  let db: typeof import('../src/db');
  let bootstrapDatabase: typeof import('../src/db/bootstrap').bootstrapDatabase;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString, connectionTimeoutMillis: 3000 });
    process.env.DATABASE_URL = connectionString;
    process.env.DATABASE_SCHEMA = schema;
    directory = await mkdtemp(path.join(tmpdir(), 'orbit-bootstrap-'));
    await writeAiFlowFixture(directory);
    db = await import('../src/db');
    ({ bootstrapDatabase } = await import('../src/db/bootstrap'));
  });

  beforeEach(async () => {
    if (!/^bootstrap_test_[a-f0-9]+$/.test(schema)) throw new Error('Refusing to reset a non-test schema');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.query(`CREATE SCHEMA "${schema}"`);
  });

  afterAll(async () => {
    await db?.closePools();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function counts() {
    const { rows: [row] } = await db.pool.query(`SELECT
      (SELECT count(*)::int FROM schema_migrations) AS migrations,
      (SELECT count(*)::int FROM app_meta) AS metadata,
      (SELECT count(*)::int FROM employees) AS employees,
      (SELECT count(*)::int FROM history_records) AS history,
      (SELECT count(*)::int FROM events) AS events,
      (SELECT count(*)::int FROM accounts) AS accounts`);
    return row;
  }

  it('serializes concurrent migration and seed calls without duplicate records', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => bootstrapDatabase(directory)));
    expect(results.filter(result => result.seeded)).toHaveLength(1);
    expect(await counts()).toEqual({ migrations: 2, metadata: 1, employees: 1, history: 1, events: 2, accounts: 2 });
    expect((await db.pool.query('SELECT seed_complete FROM app_meta WHERE id=1')).rows[0]?.seed_complete).toBe(true);
  }, 30_000);

  it('rolls back a failed seed and can retry without losing committed migrations', async () => {
    await db.migrate();
    await db.pool.query(`CREATE FUNCTION fail_bootstrap_account() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic account write failure'; END $$`);
    await db.pool.query('CREATE TRIGGER fail_bootstrap BEFORE INSERT ON accounts FOR EACH ROW EXECUTE FUNCTION fail_bootstrap_account()');
    await expect(bootstrapDatabase(directory)).rejects.toThrow('Synthetic account write failure');
    expect(await counts()).toEqual({ migrations: 2, metadata: 0, employees: 0, history: 0, events: 0, accounts: 0 });
    await db.pool.query('DROP TRIGGER fail_bootstrap ON accounts');
    expect(await bootstrapDatabase(directory)).toEqual({ seeded: true });
    expect(await counts()).toEqual({ migrations: 2, metadata: 1, employees: 1, history: 1, events: 2, accounts: 2 });
  });

  it('preserves state and existing credentials while recreating a missing demo account without source files', async () => {
    await bootstrapDatabase(directory);
    await db.pool.query("UPDATE accounts SET password_hash='existing-custom-credential' WHERE username='employee'");
    await db.pool.query("UPDATE employees SET employee_revision=7 WHERE employee_id='FLOW_PERSON'");
    await db.pool.query('UPDATE app_meta SET dataset_revision=3, global_revision=8 WHERE id=1');
    await db.pool.query("DELETE FROM accounts WHERE username='hr'");
    expect(await bootstrapDatabase(path.join(directory, 'unavailable-source'))).toEqual({ seeded: false });
    expect((await db.pool.query("SELECT password_hash FROM accounts WHERE username='employee'")).rows[0]?.password_hash).toBe('existing-custom-credential');
    expect((await db.pool.query("SELECT employee_revision FROM employees WHERE employee_id='FLOW_PERSON'")).rows[0]?.employee_revision).toBe(7);
    expect((await db.pool.query('SELECT dataset_revision,global_revision FROM app_meta WHERE id=1')).rows[0]).toEqual({ dataset_revision: 3, global_revision: 8 });
    expect(await counts()).toEqual({ migrations: 2, metadata: 1, employees: 1, history: 1, events: 2, accounts: 2 });
  });
});
