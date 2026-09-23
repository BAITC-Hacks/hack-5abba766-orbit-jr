import { spawnSync } from 'node:child_process';
if (!process.env.TEST_DATABASE_URL) {
  console.error('TEST_DATABASE_URL is required. Integration tests use temporary schemas and never reset live demo tables.');
  process.exit(1);
}
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'test:integration', '-w', 'backend'], { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
