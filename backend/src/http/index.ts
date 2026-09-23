import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { AppError, invariant } from '../errors';
import { login, logout, session, sessionCookie, requireEmployee, requireHr } from '../auth';
import { readSnapshot, getHealth, updateGoal, completeActivity, importData } from '../services/data';
import { recommendations } from '../services/recommendations';
import { listLearningModules, getLearningModule, startLearning, getLearningAttempt, completeLesson, submitQuiz, startLearningSchema, completeLessonSchema, submitQuizSchema } from '../learning/service';
import { employeeView, catalogView, hrOverview } from '../domain';
import { parseEmployeeFile, parseHistoryCsv } from '../validation';
import type { ImportCommand, RequestMeta } from '../types';

const versionSchema = z.object({ dataset_revision: z.number().int().nonnegative(), employee_revision: z.number().int().nonnegative() }).strict();
const idSchema = z.string().min(1).max(200);
const grades = z.enum(['Junior', 'Middle', 'Senior', 'Lead']);
const goalSchema = z.object({ expected_version: versionSchema, career_goal: z.object({ target_role: z.string().min(1).max(200), target_grade: grades }).strict().nullable() }).strict();
const recSchema = z.object({ expected_version: versionSchema, limit: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() }).strict();
const completionSchema = z.object({ expected_version: versionSchema, simulation: z.literal(true), target: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing_participation'), participation_id: idSchema }).strict(),
  z.object({ kind: z.literal('new_participation'), event_id: idSchema, session_date: z.iso.date().nullable() }).strict(),
]) }).strict();

export function assertOrigin(request: Request): void {
  const expected = new URL(process.env.APP_ORIGIN || 'http://localhost:3000');
  const allowed = new Set([expected.origin]);
  if (['localhost', '127.0.0.1'].includes(expected.hostname)) {
    const alias = new URL(expected); alias.hostname = expected.hostname === 'localhost' ? '127.0.0.1' : 'localhost'; allowed.add(alias.origin);
  }
  invariant(allowed.has(request.headers.get('origin') || ''), 'FORBIDDEN', 'Недопустимый источник запроса.', 403);
}

async function limitedBody(request: Request, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  const length = Number(request.headers.get('content-length') || 0);
  invariant(Number.isFinite(length) && length <= maximum, 'PAYLOAD_TOO_LARGE', 'Размер запроса превышает лимит.', 413);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.length;
      if (total > maximum) { await reader.cancel(); throw new AppError('PAYLOAD_TOO_LARGE', 'Размер запроса превышает лимит.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}
async function jsonBody(request: Request): Promise<unknown> {
  invariant(request.headers.get('content-type')?.split(';')[0].trim() === 'application/json', 'INVALID_REQUEST', 'Ожидается Content-Type: application/json.');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await limitedBody(request, 64 * 1024))); }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError('VALIDATION_ERROR', 'Некорректный JSON.'); }
}
function idempotencyKey(request: Request): string {
  return z.string().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/).parse(request.headers.get('idempotency-key'));
}
async function importCommand(request: Request, asOf: string): Promise<ImportCommand> {
  const type = request.headers.get('content-type') || '';
  invariant(type.startsWith('multipart/form-data;'), 'INVALID_REQUEST', 'Импорт ожидает multipart/form-data.');
  const bytes = await limitedBody(request, 20 * 1024 * 1024 + 64 * 1024);
  let form: FormData;
  try { form = await new Response(bytes, { headers: { 'content-type': type } }).formData(); }
  catch { throw new AppError('VALIDATION_ERROR', 'Некорректная форма импорта.'); }
  for (const key of form.keys()) invariant(['employees', 'history', 'dry_run', 'expected_dataset_revision'].includes(key) && form.getAll(key).length === 1, 'VALIDATION_ERROR', `Неизвестное или повторное поле: ${key}`);
  const dry = z.enum(['true', 'false']).parse(form.get('dry_run'));
  const expected = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().safe()).parse(form.get('expected_dataset_revision'));
  const employees = form.get('employees'); const history = form.get('history');
  invariant(employees || history, 'VALIDATION_ERROR', 'Выберите JSON сотрудников или CSV истории.');
  invariant(!employees || employees instanceof File, 'VALIDATION_ERROR', 'Поле employees должно быть файлом.');
  invariant(!history || history instanceof File, 'VALIDATION_ERROR', 'Поле history должно быть файлом.');
  const employeeFile = employees as File | null; const historyFile = history as File | null;
  invariant((employeeFile?.size || 0) + (historyFile?.size || 0) <= 20 * 1024 * 1024, 'PAYLOAD_TOO_LARGE', 'Файлы должны занимать не более 20 МиБ.', 413);
  const command: ImportCommand = { expected_dataset_revision: expected, dry_run: dry === 'true' };
  const decode = async (file: File) => {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw new AppError('VALIDATION_ERROR', 'Файл должен иметь кодировку UTF-8.'); }
  };
  if (employeeFile) command.employees = parseEmployeeFile(await decode(employeeFile), asOf);
  if (historyFile) command.history = parseHistoryCsv(await decode(historyFile));
  return command;
}

export async function handleRequest(request: Request): Promise<Response> {
  const started = performance.now(); const requestId = randomUUID();
  let asOf: string | null = null;
  const headers: Record<string, string> = { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId, 'X-Content-Type-Options': 'nosniff' };
  const success = (data: unknown, status = 200, replayed?: boolean) => {
    const meta: RequestMeta = { request_id: requestId, as_of_date: asOf, ...(replayed !== undefined ? { replayed } : {}) };
    return Response.json({ data, meta }, { status, headers });
  };
  try {
    const url = new URL(request.url); const method = request.method;
    const path = url.pathname.replace(/\/$/, '');
    if (method === 'GET' && path === '/api/health') {
      const health = await getHealth();
      if (health.status === 'ok') asOf = (await readSnapshot()).as_of_date;
      return success(health, health.status === 'ok' ? 200 : 503);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) assertOrigin(request);
    if (path === '/api/auth/login' && method === 'POST') {
      const input = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(256) }).strict().parse(await jsonBody(request));
      const { actor, token } = await login(input.username, input.password);
      headers['Set-Cookie'] = sessionCookie(token);
      asOf = (await readSnapshot()).as_of_date;
      return success(actor);
    }
    const actor = await session(request);
    const snapshot = await readSnapshot(); asOf = snapshot.as_of_date;
    if (path === '/api/auth/session' && method === 'GET') return success(actor);
    if (path === '/api/auth/logout' && method === 'POST') {
      await logout(request); headers['Set-Cookie'] = sessionCookie('', true);
      return success({ logged_out: true });
    }
    if (path === '/api/catalog' && method === 'GET') return success(catalogView(snapshot));

    if (path === '/api/learning/modules' && method === 'GET') return success(listLearningModules());
    const moduleMatch = /^\/api\/learning\/modules\/([^/]+)$/.exec(path);
    if (moduleMatch && method === 'GET') {
      let moduleId: string;
      try { moduleId = idSchema.parse(decodeURIComponent(moduleMatch[1])); } catch { throw new AppError('VALIDATION_ERROR', 'Некорректный идентификатор модуля'); }
      return success(getLearningModule(moduleId));
    }
    const learningMatch = /^\/api\/employees\/([^/]+)\/learning\/attempts(?:\/([^/]+)(?:\/(lessons|quiz))?)?$/.exec(path);
    if (learningMatch) {
      let employeeId: string;
      let attemptId: string | undefined;
      try {
        employeeId = idSchema.parse(decodeURIComponent(learningMatch[1]));
        attemptId = learningMatch[2] ? idSchema.parse(decodeURIComponent(learningMatch[2])) : undefined;
      } catch { throw new AppError('VALIDATION_ERROR', 'Некорректный идентификатор учебной попытки'); }
      requireEmployee(actor, employeeId);
      if (!attemptId && method === 'POST') return success(await startLearning(actor, employeeId, startLearningSchema.parse(await jsonBody(request))));
      if (attemptId && !learningMatch[3] && method === 'GET') return success(await getLearningAttempt(actor, employeeId, attemptId));
      if (attemptId && learningMatch[3] === 'lessons' && method === 'POST') {
        const body = completeLessonSchema.parse(await jsonBody(request));
        return success(await completeLesson(actor, employeeId, attemptId, body.lesson_id));
      }
      if (attemptId && learningMatch[3] === 'quiz' && method === 'POST') {
        const result = await submitQuiz(actor, employeeId, attemptId, submitQuizSchema.parse(await jsonBody(request)), idempotencyKey(request));
        return success(result.result, 200, result.replayed);
      }
    }

    if (path === '/api/employees' && method === 'GET') {
      requireHr(actor);
      const query = z.object({ q: z.string().max(200).optional(), department: z.string().max(200).optional(), role: z.string().max(200).optional(), grade: grades.optional(), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(50) }).strict().parse(Object.fromEntries(url.searchParams));
      const rows = snapshot.employees.filter(e => (!query.q || `${e.full_name} ${e.employee_id}`.toLowerCase().includes(query.q.toLowerCase())) && (!query.department || e.department === query.department) && (!query.role || e.role === query.role) && (!query.grade || e.grade === query.grade)).sort((a, b) => a.employee_id.localeCompare(b.employee_id));
      return success({ total: rows.length, items: rows.slice(query.offset, query.offset + query.limit).map(({ employee_id, full_name, department, role, grade }) => ({ employee_id, full_name, department, role, grade })) });
    }
    if (path === '/api/hr/overview' && method === 'GET') { requireHr(actor); return success(hrOverview(snapshot)); }
    if (path === '/api/import' && method === 'POST') {
      requireHr(actor); const command = await importCommand(request, asOf);
      const result = await importData(actor, command, command.dry_run ? undefined : idempotencyKey(request));
      return success(result.result, 200, result.replayed);
    }
    const match = /^\/api\/employees\/([^/]+)(?:\/(goal|recommendations|completions))?$/.exec(path);
    if (match) {
      let id: string;
      try { id = idSchema.parse(decodeURIComponent(match[1])); } catch { throw new AppError('VALIDATION_ERROR', 'Некорректный идентификатор сотрудника.'); }
      requireEmployee(actor, id);
      if (!match[2] && method === 'GET') return success(employeeView(snapshot, id));
      if (match[2] === 'goal' && method === 'PUT') return success(await updateGoal(actor, id, goalSchema.parse(await jsonBody(request))));
      if (match[2] === 'recommendations' && method === 'POST') return success(await recommendations(id, recSchema.parse(await jsonBody(request)), request.signal));
      if (match[2] === 'completions' && method === 'POST') {
        const result = await completeActivity(actor, id, completionSchema.parse(await jsonBody(request)), idempotencyKey(request));
        return success(result.result, 200, result.replayed);
      }
    }
    throw new AppError('NOT_FOUND', 'Маршрут не найден.', 404);
  } catch (error) {
    const appError = error instanceof AppError ? error : error instanceof ZodError
      ? new AppError('VALIDATION_ERROR', 'Проверьте данные запроса.', 400, { issues: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) })
      : new AppError('INTERNAL_ERROR', 'Не удалось выполнить операцию. Повторите позже.', 500);
    if (appError.status >= 500) console.error(JSON.stringify({ request_id: requestId, code: appError.code, error_type: error instanceof Error ? error.name : 'unknown' }));
    return Response.json({ error: { code: appError.code, message: appError.message, ...(appError.details ? { details: appError.details } : {}) }, request_id: requestId }, { status: appError.status, headers });
  } finally {
    console.info(JSON.stringify({ request_id: requestId, method: request.method, path: new URL(request.url).pathname, duration_ms: Math.round(performance.now() - started) }));
  }
}
