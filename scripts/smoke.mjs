import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const base = process.env.SMOKE_URL || 'http://127.0.0.1:3000';
let cookie = '';
async function call(route, method = 'GET', body, key) {
  const headers = { Origin: new URL(base).origin, ...(cookie ? { Cookie: cookie } : {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  const response = await fetch(base + route, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const payload = await response.json();
  assert.equal(response.status, 200, `${method} ${route}: ${JSON.stringify(payload)}`);
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return payload;
}
assert.equal((await call('/api/health')).data.status, 'ok');
await call('/api/auth/login', 'POST', { username: 'hr', password: process.env.DEMO_HR_PASSWORD || 'hr-demo-2026' });
const directory = (await call('/api/employees?limit=1')).data;
assert.ok(directory.items.length);
const id = directory.items[0].employee_id;
const profilePath = `/api/employees/${encodeURIComponent(id)}`;
let profile = (await call(profilePath)).data;
const catalog = (await call('/api/catalog')).data;
assert.ok(catalog.events.length); assert.ok(catalog.skills.length);
const recs = (await call(`${profilePath}/recommendations`, 'POST', { expected_version: profile.version })).data;
assert.ok(['ai', 'rules_fallback', 'no_candidates'].includes(recs.mode));
if (process.env.SMOKE_MUTATE === 'true') {
  const candidate = recs.recommendations[0]; assert.ok(candidate, 'No candidate for mutation smoke');
  const body = { expected_version: profile.version, simulation: true, target: candidate.action === 'continue'
    ? { kind: 'existing_participation', participation_id: candidate.participation_id }
    : { kind: 'new_participation', event_id: candidate.event_id, session_date: candidate.session_date } };
  const key = crypto.randomUUID();
  const first = await call(`${profilePath}/completions`, 'POST', body, key);
  const retry = await call(`${profilePath}/completions`, 'POST', body, key);
  assert.equal(retry.meta.replayed, true); assert.deepEqual(first.data, retry.data);
  profile = (await call(profilePath)).data;
  assert.equal(profile.has_simulated_progress, true);
  if (process.env.SMOKE_STATE_FILE) await writeFile(process.env.SMOKE_STATE_FILE, JSON.stringify({ employee_id: id, version: profile.version, skills: profile.skills }));
}
if (process.env.SMOKE_RESTORE === 'true') {
  assert.ok(process.env.SMOKE_STATE_FILE);
  const saved = JSON.parse(await readFile(process.env.SMOKE_STATE_FILE, 'utf8'));
  assert.equal(id, saved.employee_id); assert.deepEqual(profile.version, saved.version); assert.deepEqual(profile.skills, saved.skills);
}
const hr = (await call('/api/hr/overview')).data;
assert.equal(hr.employee_count, directory.total);
await call('/api/auth/logout', 'POST', {});
console.log(JSON.stringify({ status: 'passed', employees: hr.employee_count, events: catalog.events.length, recommendation_mode: recs.mode, simulated_completions: hr.participation.simulated_completions, persisted_state_checked: process.env.SMOKE_RESTORE === 'true' }));
