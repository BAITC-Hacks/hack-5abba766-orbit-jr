import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { writeAiFlowFixture } from '../tests/fixtures/ai-flow';

// Reuse the authored two-step fixture exercised by the PostgreSQL/AI flow suite.
// Each rehearsal gets new data; never reset the shared demo or a previous run.
const root = fileURLToPath(new URL('../../', import.meta.url));
const schema = `cq_demo_${randomUUID().replaceAll('-', '')}`;
const directory = path.join(root, 'test-results', 'demo', schema);
const port = 3210;
const admin = new pg.Pool({
  connectionString: process.env.DATABASE_URL || (process.env.PGHOST ? undefined : 'postgresql://career_quest:career_quest_local@127.0.0.1:54329/career_quest'),
  connectionTimeoutMillis: 3000,
});
try {
  await writeAiFlowFixture(directory);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  process.env.DATABASE_SCHEMA = schema;
  process.env.DATASET_DIR = directory;
  process.env.DEMO_EMPLOYEE_PASSWORD = 'employee-demo-2026';
  process.env.DEMO_HR_PASSWORD = 'hr-demo-2026';
  const { bootstrapDatabase } = await import('../src/db/bootstrap');
  const { closePools } = await import('../src/db');
  try { await bootstrapDatabase(directory); }
  finally { await closePools(); }
  await writeFile(path.join(root, '.env.demo'), [
    '# Authored rehearsal data. No competition records or secrets.',
    `DATABASE_SCHEMA=${schema}`,
    `DATASET_DIR="${directory.replaceAll('\\', '/')}"`,
    `PORT=${port}`,
    `APP_ORIGIN=http://localhost:${port}`,
    '',
  ].join('\n'), 'utf8');
  console.log(JSON.stringify({ prepared: true, schema, dataset: 'authored synthetic two-step flow',
    next: 'npm run demo:start', url: `http://localhost:${port}`, previousDataPreserved: true }));
} catch (error) {
  console.error('Demo preparation failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
} finally { await admin.end(); }
