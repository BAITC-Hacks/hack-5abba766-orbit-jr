import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PoolClient } from 'pg';
import { pool } from '../db';
import { AppError, invariant } from '../errors';
import type { SessionView } from '../types';

const scrypt = promisify(scryptCallback);
export const COOKIE_NAME = 'cq_session';
const TTL_SECONDS = 12 * 60 * 60;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const digest = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${digest.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, digest] = encoded.split(':');
  if (algorithm !== 'scrypt' || !salt || !/^[0-9a-f]{128}$/.test(digest ?? '')) return false;
  const actual = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(digest, 'hex'));
}

export async function seedDemoAccounts(client: PoolClient): Promise<void> {
  const first = await client.query('SELECT employee_id FROM employees ORDER BY employee_id LIMIT 1');
  invariant(first.rows[0], 'NOT_READY', 'Для demo-аккаунта нужен хотя бы один сотрудник.', 503);
  for (const account of [
    { id: 'demo-employee', username: 'employee', role: 'employee', employee: first.rows[0].employee_id, password: process.env.DEMO_EMPLOYEE_PASSWORD || 'employee-demo-2026', name: 'Сотрудник' },
    { id: 'demo-hr', username: 'hr', role: 'hr', employee: null, password: process.env.DEMO_HR_PASSWORD || 'hr-demo-2026', name: 'HR · Career Quest' },
  ]) {
    if ((await client.query('SELECT id FROM accounts WHERE username=$1', [account.username])).rowCount) continue;
    await client.query('INSERT INTO accounts(id,username,password_hash,role,employee_id,display_name) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [account.id, account.username, await hashPassword(account.password), account.role, account.employee, account.name]);
  }
}

function actorFromRow(row: Record<string, unknown>): SessionView {
  return { account_id: String(row.id), role: row.role as SessionView['role'], employee_id: row.employee_id as string | null, display_name: String(row.display_name) };
}

// Small bounded per-process limiter for the local demo; shared deployment requires a shared limiter.
const attempts = new Map<string, { count: number; until: number }>();
export async function login(username: string, password: string): Promise<{ actor: SessionView; token: string }> {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  if (attempts.size >= 1000 && !attempts.has(username)) throw new AppError('INVALID_REQUEST', 'Слишком много попыток входа. Повторите позже.', 429);
  const attempt = attempts.get(username) ?? { count: 0, until: now + 15 * 60_000 };
  if (attempt.count >= 10) throw new AppError('INVALID_REQUEST', 'Слишком много попыток входа. Повторите через 15 минут.', 429);
  attempt.count++; attempts.set(username, attempt);
  const { rows } = await pool.query('SELECT * FROM accounts WHERE username=$1', [username]);
  const row = rows[0];
  const dummy = 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128);
  const valid = await verifyPassword(password, row?.password_hash ?? dummy);
  invariant(row && valid, 'UNAUTHENTICATED', 'Неверный логин или пароль.', 401);
  attempts.delete(username);
  const token = randomBytes(32).toString('base64url');
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  await pool.query('INSERT INTO sessions(token_hash,account_id,expires_at) VALUES($1,$2,$3)', [tokenHash(token), row.id, new Date(now + TTL_SECONDS * 1000)]);
  return { actor: actorFromRow(row), token };
}

function cookieToken(request: Request): string | null {
  const raw = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : null;
}
export async function session(request: Request): Promise<SessionView> {
  const token = cookieToken(request);
  invariant(token, 'UNAUTHENTICATED', 'Войдите в аккаунт.', 401);
  const { rows } = await pool.query('SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now()', [tokenHash(token)]);
  invariant(rows[0], 'UNAUTHENTICATED', 'Сессия истекла. Войдите снова.', 401);
  return actorFromRow(rows[0]);
}
export async function logout(request: Request): Promise<void> {
  const token = cookieToken(request);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(token)]);
}
export function requireHr(actor: SessionView): void {
  invariant(actor.role === 'hr', 'FORBIDDEN', 'Доступно только HR.', 403);
}
export function requireEmployee(actor: SessionView, employeeId: string): void {
  invariant(actor.role === 'hr' || actor.employee_id === employeeId, 'FORBIDDEN', 'Нет доступа к этому сотруднику.', 403);
}
export function sessionCookie(token: string, clear = false): string {
  const secure = (process.env.APP_ORIGIN || '').startsWith('https:') ? '; Secure' : '';
  return `${COOKIE_NAME}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : TTL_SECONDS}${secure}`;
}
