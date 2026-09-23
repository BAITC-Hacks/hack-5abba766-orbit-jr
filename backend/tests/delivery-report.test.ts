import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

let directory: string;
let sequence = 0;

beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(), 'orbit-delivery-report-')); });
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function verification(childCode: string, previousReport?: object, databaseUrl = 'synthetic-test-connection') {
  const root = path.join(directory, String(sequence++));
  const script = path.join(root, 'backend/scripts/verify-ai-flow.ts');
  const report = path.join(root, 'test-results/ai-flow.json');
  await mkdir(path.dirname(script), { recursive: true });
  await mkdir(path.join(root, 'node_modules/vitest'), { recursive: true });
  await mkdir(path.dirname(report), { recursive: true });
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await copyFile(new URL('../scripts/verify-ai-flow.ts', import.meta.url), script);
  await writeFile(path.join(root, 'node_modules/vitest/vitest.mjs'), childCode);
  if (previousReport) await writeFile(report, JSON.stringify(previousReport));
  // The child is a local test-runner stub, never an application server or provider.
  const result = spawnSync(process.execPath, [script], {
    cwd: root, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, TEST_DATABASE_URL: databaseUrl, LLM_API_KEY: '', LLM_MODEL: '' },
  });
  return { result, report: JSON.parse(await readFile(report, 'utf8')) as Record<string, unknown> };
}

const writeReport = (expression: string, exitCode = 0) => `
  import { mkdir, writeFile } from 'node:fs/promises';
  import path from 'node:path';
  const report = process.env.AI_FLOW_REPORT_PATH;
  await mkdir(path.dirname(report), { recursive: true });
  await writeFile(report, JSON.stringify(${expression}));
  process.exitCode = ${exitCode};
`;
const fresh = "{ recorded_at: new Date().toISOString(), live_requested: false, checks: [{ check: 'synthetic runner check' }] }";

describe('AI verification report provenance', () => {
  it('does not reuse a previous report when the runner fails before reporting', async () => {
    const { result, report } = await verification('process.exitCode = 0;', {
      status: 'passed', recorded_at: '2999-01-01T00:00:00.000Z', live_requested: false, checks: [],
    });
    expect(result.status).not.toBe(0);
    expect(report.status).toBe('failed');
    expect(report.error).toEqual(expect.any(String));
  });

  it.each(['undefined', "'not-a-date'", "'2999-01-01T00:00:00.000Z'"])(
    'rejects a report with invalid run time %s', async recordedAt => {
      const { result, report } = await verification(writeReport(`{ recorded_at: ${recordedAt}, live_requested: false, checks: [] }`));
      expect(result.status).not.toBe(0);
      expect(report.status).toBe('failed');
    },
  );

  it('keeps the runner exit status authoritative over report contents', async () => {
    const { result, report } = await verification(writeReport(`{ ...${fresh}, status: 'passed', started_at: 'forged' }`, 1));
    expect(result.status).toBe(1);
    expect(report.status).toBe('failed');
    expect(report.started_at).not.toBe('forged');
  });

  it('replaces previous success with a failure report when setup is incomplete', async () => {
    const { result, report } = await verification('throw new Error("Runner must not be invoked");', { status: 'passed' }, '');
    expect(result.status).toBe(1);
    expect(report.status).toBe('failed');
    expect(report.error).toContain('TEST_DATABASE_URL is required');
  });

  it.each([
    "{ recorded_at: new Date().toISOString(), live_requested: true, checks: [{}] }",
    "{ recorded_at: new Date().toISOString(), live_requested: false, checks: [] }",
  ])('rejects a successful runner report without matching completed checks', async details => {
    const { result, report } = await verification(writeReport(details));
    expect(result.status).toBe(1);
    expect(report.status).toBe('failed');
  });

  it('publishes a fresh successful report at the documented path', async () => {
    const { result, report } = await verification(writeReport(fresh));
    expect(result.status, result.stderr).toBe(0);
    expect(report.status).toBe('passed');
    expect(report.checks).toHaveLength(1);
    expect(Date.parse(String(report.recorded_at))).toBeGreaterThanOrEqual(Date.parse(String(report.started_at)));
  });
});

describe('Portable integration runner', () => {
  it('finds its workspace from the script path when invoked from another directory', async () => {
    const root = path.join(directory, String(sequence++));
    const script = path.join(root, 'scripts/integration.mjs');
    const report = path.join(root, 'runner.json');
    const backend = path.join(root, 'backend');
    await mkdir(path.dirname(script), { recursive: true });
    await mkdir(backend);
    await mkdir(path.join(root, 'node_modules/vitest'), { recursive: true });
    await copyFile(new URL('../../scripts/integration.mjs', import.meta.url), script);
    await writeFile(path.join(root, 'node_modules/vitest/vitest.mjs'), `
      import { writeFile } from 'node:fs/promises';
      await writeFile(process.env.DELIVERY_RUNNER_REPORT_PATH, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));
    `);
    const result = spawnSync(process.execPath, [script], {
      cwd: directory, encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, TEST_DATABASE_URL: 'synthetic-test-connection', DELIVERY_RUNNER_REPORT_PATH: report },
    });
    expect(result.status, result.stderr).toBe(0);
    const observed = JSON.parse(await readFile(report, 'utf8')) as { cwd: string; args: string[] };
    expect(await realpath(observed.cwd)).toBe(await realpath(backend));
    expect(observed.args).toEqual(['run', '--config', 'vitest.integration.config.ts']);
  });
});
