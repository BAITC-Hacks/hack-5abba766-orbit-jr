import pg, { type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readFile } from 'node:fs/promises';
import { AppError } from '../errors';
import type { DatasetSnapshot } from '../types';
import * as schema from './schema';

const databaseSchema = process.env.DATABASE_SCHEMA;
if (databaseSchema && !/^[a-z][a-z0-9_]*$/.test(databaseSchema)) throw new Error('DATABASE_SCHEMA must be a lowercase SQL identifier');
/** Constructing pools is lazy: build/import never opens a database connection. */
const connectionOptions = {
  connectionString: process.env.DATABASE_URL || 'postgresql://career_quest:career_quest_local@127.0.0.1:54329/career_quest',
  max: 10, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000,
  ...(databaseSchema ? { options: `-c search_path=${databaseSchema}` } : {}),
};
export const pool = new pg.Pool(connectionOptions);
// Session locks live through provider latency. Keep their bounded connections
// separate so AI saturation cannot stop authentication, profiles or writes.
export const recommendationLockPool = new pg.Pool({ ...connectionOptions, connectionTimeoutMillis: 1000 });
pool.on('error', () => { console.error('PostgreSQL idle connection failed'); });
recommendationLockPool.on('error', () => { console.error('PostgreSQL recommendation connection failed'); });
let closing: Promise<void> | undefined;
export function closePools(): Promise<void> {
  return closing ??= Promise.all([pool.end(), recommendationLockPool.end()]).then(() => undefined);
}
export const db = drizzle(pool, { schema });
export const SCHEMA_VERSION = '001_initial';

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>, options: { readOnly?: boolean; bootstrap?: boolean } = {}): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(options.readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    await client.query(`SET LOCAL lock_timeout = '${options.bootstrap ? '30000' : '3000'}ms'`);
    await client.query(`SET LOCAL statement_timeout = '${options.bootstrap ? '60000' : '15000'}ms'`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error && typeof error === 'object' && 'code' in error && ['55P03', '57014', '40001', '40P01'].includes(String(error.code))) throw new AppError('STORAGE_BUSY', 'База занята, повторите запрос', 503);
    throw error;
  } finally { client.release(); }
}
export async function migrate(client?: PoolClient): Promise<void> {
  if (!client) return withTransaction(c => migrate(c), { bootstrap: true });
  await client.query('SELECT pg_advisory_xact_lock(734119012)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
  const existing = await client.query('SELECT version FROM schema_migrations WHERE version=$1', [SCHEMA_VERSION]);
  if (existing.rowCount) return;
  const sql = await readFile(new URL('./migrations/001_initial.sql', import.meta.url), 'utf8');
  await client.query(sql);
  await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [SCHEMA_VERSION]);
}
export async function readSnapshotWithClient(client: PoolClient): Promise<DatasetSnapshot> {
  const { rows: metaRows } = await client.query('SELECT * FROM app_meta WHERE id=1 AND seed_complete=true');
  const meta = metaRows[0];
  if (!meta) throw new AppError('NOT_READY', 'Датасет ещё не инициализирован', 503);
  // Queries on a single transaction connection share one MVCC snapshot for reads,
  // or run behind the metadata row lock held by every domain writer.
  const employees = await client.query('SELECT employee_id,source,employee_revision FROM employees ORDER BY employee_id');
  const skills = await client.query('SELECT source FROM skills ORDER BY skill_id');
  const roles = await client.query('SELECT source FROM role_profiles ORDER BY role,grade');
  const events = await client.query('SELECT source FROM events ORDER BY event_id');
  const history = await client.query('SELECT source FROM history_records ORDER BY date,record_id');
  const completions = await client.query('SELECT id,employee_id,event_id,participation_id,session_date,occurrence_key,applied_as_of,recorded_at,sequence FROM demo_completions ORDER BY sequence');
  const goals = await client.query('SELECT employee_id,goal FROM goal_overrides');
  return {
    as_of_date: meta.as_of_date, dataset_revision: meta.dataset_revision, global_revision: meta.global_revision,
    employees: employees.rows.map(r => r.source), employee_revisions: Object.fromEntries(employees.rows.map(r => [r.employee_id, r.employee_revision])),
    skills: skills.rows.map(r => r.source), role_profiles: roles.rows.map(r => r.source), events: events.rows.map(r => r.source), history: history.rows.map(r => r.source),
    completions: completions.rows.map(r => ({ ...r, sequence: Number(r.sequence), recorded_at: new Date(r.recorded_at).toISOString() })),
    goals: Object.fromEntries(goals.rows.map(r => [r.employee_id, r.goal])), proficiency_scale: meta.proficiency_scale,
  };
}
