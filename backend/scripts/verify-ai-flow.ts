import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const live = args.includes('--live');
const backendDirectory = fileURLToPath(new URL('../', import.meta.url));
const vitest = fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url));
const report = fileURLToPath(new URL('../../test-results/ai-flow.json', import.meta.url));
const startedAt = new Date().toISOString();
await mkdir(path.dirname(report), { recursive: true });
// Only this run can create its details file. A previous canonical report can never
// satisfy verification, even after a clock change or an interrupted test run.
const runDirectory = await mkdtemp(path.join(path.dirname(report), '.ai-flow-'));
const detailsPath = path.join(runDirectory, 'details.json');
async function publishReport(value: object): Promise<void> {
  const staged = path.join(runDirectory, 'summary.json');
  await writeFile(staged, JSON.stringify(value, null, 2) + '\n');
  await rename(staged, report);
}
try {
  await publishReport({ status: 'running', started_at: startedAt, live_requested: live });
  if (args.some(arg => arg !== '--live')) throw new Error('Usage: verify-ai-flow.ts [--live]');
  if (!process.env.TEST_DATABASE_URL?.trim()) throw new Error('TEST_DATABASE_URL is required; verification only uses an isolated temporary schema.');
  if (live && (!process.env.LLM_API_KEY?.trim() || !process.env.LLM_MODEL?.trim())) {
    throw new Error('Live verification requires LLM_API_KEY and LLM_MODEL.');
  }
  console.info(`Checking authenticated handlers with real PostgreSQL and authored synthetic data; live LLM: ${live}.`);
  const result = spawnSync(process.execPath, [vitest, 'run', '--config', 'vitest.integration.config.ts', 'tests/ai-flow.integration.test.ts'], {
    cwd: backendDirectory, stdio: 'inherit', env: { ...process.env, RUN_LIVE_AI_FLOW: live ? '1' : '0', AI_FLOW_REPORT_PATH: detailsPath },
  });
  if (result.error) throw result.error;
  const details: unknown = JSON.parse(await readFile(detailsPath, 'utf8').catch(() => {
    throw new Error('Verification did not produce a report for this run. Check the test runner output above.');
  }));
  if (!details || typeof details !== 'object' || Array.isArray(details)
    || !('recorded_at' in details) || typeof details.recorded_at !== 'string'
    || !Number.isFinite(Date.parse(details.recorded_at))
    || Date.parse(details.recorded_at) < Date.parse(startedAt) || Date.parse(details.recorded_at) > Date.now()
    || !('live_requested' in details) || details.live_requested !== live
    || !('checks' in details) || !Array.isArray(details.checks)
    || (result.status === 0 && details.checks.length === 0)) {
    throw new Error('Verification did not produce a valid fresh report for the requested mode.');
  }
  await publishReport({
    ...details, status: result.status === 0 ? 'passed' : 'failed', started_at: startedAt, live_requested: live,
    ...(result.status === 0 ? {} : { error: `Verification runner exited with ${result.signal ?? result.status ?? 'unknown status'}.` }),
  });
  process.exitCode = result.status ?? 1;
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown verification failure';
  await publishReport({ status: 'failed', started_at: startedAt, live_requested: live, error: message });
  console.error('AI flow verification failed:', message);
  process.exitCode = 1;
} finally {
  await rm(runDirectory, { recursive: true, force: true });
}
