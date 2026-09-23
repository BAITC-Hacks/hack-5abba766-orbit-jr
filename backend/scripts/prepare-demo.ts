import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { writeAiFlowFixture } from '../tests/fixtures/ai-flow';
import { databaseConnectionConfig } from '../src/db/config';

// Reuse the authored two-step fixture exercised by the PostgreSQL/AI flow suite.
// Each rehearsal gets new data; never reset the shared demo or a previous run.
const root = fileURLToPath(new URL('../../', import.meta.url));
const schema = `cq_demo_${randomUUID().replaceAll('-', '')}`;
const directory = path.join(root, 'test-results', 'demo', schema);
const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => !/^--port=\d+$/.test(arg))) throw new Error('Usage: demo:prepare [--port=3210]');
const port = args.length ? Number(args[0].slice('--port='.length)) : 3210;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Demo port must be between 1 and 65535');
const admin = new pg.Pool({
  ...databaseConnectionConfig(),
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
