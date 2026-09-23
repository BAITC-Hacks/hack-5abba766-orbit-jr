import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const frontend = fileURLToPath(new URL('../frontend/', import.meta.url));
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const mode = process.argv[2] === 'start' ? 'start' : 'dev';
if (process.argv.includes('--demo')) {
  const demo = parseEnv(readFileSync(new URL('../.env.demo', import.meta.url), 'utf8'));
  if (!/^cq_demo_[a-f0-9]{32}$/.test(demo.DATABASE_SCHEMA ?? '') ||
      path.resolve(demo.DATASET_DIR ?? '') !== path.join(root, 'test-results', 'demo', demo.DATABASE_SCHEMA) ||
      !/^\d+$/.test(demo.PORT ?? '') || Number(demo.PORT) < 1 || Number(demo.PORT) > 65535 ||
      demo.APP_ORIGIN !== `http://localhost:${Number(demo.PORT)}`) {
    throw new Error('Invalid rehearsal configuration. Run npm run demo:prepare first.');
  }
  // Explicitly override an inherited schema so rehearsals cannot touch live data.
  for (const key of ['DATABASE_SCHEMA', 'DATASET_DIR', 'PORT', 'APP_ORIGIN']) process.env[key] = demo[key];
  process.env.LLM_API_KEY = ''; process.env.LLM_MODEL = '';
}
const bootstrap = spawnSync(process.execPath, ['--import', 'tsx', 'backend/scripts/bootstrap.ts'], { cwd: root, stdio: 'inherit', env: process.env });
if (bootstrap.status !== 0) process.exit(bootstrap.status || 1);
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), mode, '--hostname', mode === 'dev' || process.argv.includes('--local') ? '127.0.0.1' : '0.0.0.0', '--port', process.env.PORT || '3000'], { cwd: frontend, stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 0 : 1); });
