import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if (!process.env.TEST_DATABASE_URL?.trim()) {
  console.error('TEST_DATABASE_URL is required. Integration tests use temporary schemas and never reset live demo tables.');
  process.exit(1);
}
const backend = fileURLToPath(new URL('../backend/', import.meta.url));
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const result = spawnSync(process.execPath, [vitest, 'run', '--config', 'vitest.integration.config.ts'], {
  cwd: backend, stdio: 'inherit', env: process.env,
});
if (result.error) console.error('Integration runner failed:', result.error.message);
process.exit(result.status ?? 1);
