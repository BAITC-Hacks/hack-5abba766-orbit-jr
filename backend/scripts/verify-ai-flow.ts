import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--live')) throw new Error('Usage: verify-ai-flow.ts [--live]');
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required; verification only uses an isolated temporary schema.');
const live = args.includes('--live');
if (live && (!process.env.LLM_API_KEY?.trim() || !process.env.LLM_MODEL?.trim())) {
  throw new Error('Live verification requires LLM_API_KEY and LLM_MODEL.');
}
const backendDirectory = fileURLToPath(new URL('../', import.meta.url));
const vitest = fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url));
const report = fileURLToPath(new URL('../../test-results/ai-flow.json', import.meta.url));
console.info(`Checking authenticated handlers with real PostgreSQL and authored synthetic data; live LLM: ${live}.`);
const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, [vitest, 'run', '--config', 'vitest.integration.config.ts', 'tests/ai-flow.integration.test.ts'], {
  cwd: backendDirectory, stdio: 'inherit', env: { ...process.env, RUN_LIVE_AI_FLOW: live ? '1' : '0', AI_FLOW_REPORT_PATH: report },
});
if (result.error) throw result.error;
const details = JSON.parse(await readFile(report, 'utf8')) as { recorded_at: string };
if (details.recorded_at < startedAt) throw new Error('Verification did not produce a fresh report.');
await writeFile(report, JSON.stringify({ status: result.status === 0 ? 'passed' : 'failed', started_at: startedAt, ...details }, null, 2) + '\n');
process.exitCode = result.status ?? 1;
