import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, readSnapshotWithClient, withTransaction, SCHEMA_VERSION } from '../db';
import { AppError } from '../errors';
import { requireEmployeeWrite, requireHr } from '../auth';
import { isAiConfigured } from '../ai/adapter';
import { employeeView, assertCompletionAllowed, skillChanges } from '../domain';
import { canonicalJson, sourceHash, validateRelations, employeeSchema, participationSchema, careerGoalSchema } from '../validation';
import type { DatasetSnapshot, SessionView, HealthView, GoalRequest, GoalResult, CompletionRequest, CompletionResult, ImportCommand, ImportResult, ImportIssue, EmployeeSource, ParticipationSource } from '../types';

export async function readSnapshot(): Promise<DatasetSnapshot> { return withTransaction(readSnapshotWithClient, { readOnly: true }); }
export async function readDatasetDate(): Promise<string> {
  const { rows } = await pool.query('SELECT as_of_date FROM app_meta WHERE id=1 AND seed_complete=true');
  if (!rows[0]) throw new AppError('NOT_READY', 'Датасет ещё не инициализирован', 503);
  return rows[0].as_of_date;
}
export async function getHealth(): Promise<HealthView> {
  const base: HealthView = { status: 'not_ready', dataset_initialized: false, schema_version: null, ai_configured: isAiConfigured() };
  try {
    const { rows } = await pool.query('SELECT seed_complete FROM app_meta WHERE id=1');
    const migrations = await pool.query('SELECT version FROM schema_migrations WHERE version=$1', [SCHEMA_VERSION]);
    return { ...base, status: rows[0]?.seed_complete && migrations.rowCount ? 'ok' : 'not_ready', dataset_initialized: Boolean(rows[0]?.seed_complete), schema_version: migrations.rows[0]?.version || null };
  } catch { return base; }
}
export async function lockDataset(client: PoolClient): Promise<void> {
  const lock = await client.query('SELECT id FROM app_meta WHERE id=1 AND seed_complete=true FOR UPDATE');
  if (!lock.rowCount) throw new AppError('NOT_READY', 'Датасет ещё не инициализирован', 503);
}
export function checkVersion(snapshot: DatasetSnapshot, id: string, version: GoalRequest['expected_version']): void {
  if (!Object.hasOwn(snapshot.employee_revisions, id)) throw new AppError('NOT_FOUND', 'Сотрудник не найден', 404);
  const current = { dataset_revision: snapshot.dataset_revision, employee_revision: snapshot.employee_revisions[id] };
  if (current.dataset_revision !== version.dataset_revision || current.employee_revision !== version.employee_revision) throw new AppError('REVISION_CONFLICT', 'Данные изменились, обновите профиль', 409, { current_version: current });
}
export function ensureKey(key?: string): asserts key is string {
  if (!key || key.length > 200 || !/^[\x21-\x7E]+$/.test(key)) throw new AppError('INVALID_REQUEST', 'Нужен Idempotency-Key длиной до 200 ASCII-символов', 400);
}
export async function receipt<T>(client: PoolClient, actor: SessionView, operation: string, key: string, hash: string): Promise<T | undefined> {
  const { rows } = await client.query('SELECT request_hash,result FROM action_receipts WHERE actor_id=$1 AND operation=$2 AND idempotency_key=$3', [actor.account_id, operation, key]);
  if (!rows.length) return undefined;
  if (rows[0].request_hash !== hash) throw new AppError('IDEMPOTENCY_CONFLICT', 'Этот ключ уже использован для другого запроса', 409);
  return rows[0].result as T;
}
export async function saveReceipt(client: PoolClient, actor: SessionView, operation: string, key: string, hash: string, result: unknown): Promise<void> {
  await client.query('INSERT INTO action_receipts(actor_id,operation,idempotency_key,request_hash,result) VALUES($1,$2,$3,$4,$5::jsonb)', [actor.account_id, operation, key, hash, JSON.stringify(result)]);
}
export async function audit(client: PoolClient, actor: SessionView, operation: string, target: string | null, details: unknown): Promise<void> {
  await client.query('INSERT INTO audit_records(actor_id,operation,target_employee_id,details) VALUES($1,$2,$3,$4::jsonb)', [actor.account_id, operation, target, JSON.stringify(details)]);
}
export async function updateGoal(actor: SessionView, id: string, request: GoalRequest): Promise<GoalResult> {
  requireEmployeeWrite(actor, id);
  const goal = careerGoalSchema.nullable().safeParse(request.career_goal);
  if (!goal.success) throw new AppError('VALIDATION_ERROR', 'Некорректная карьерная цель');
  return withTransaction(async client => {
    await lockDataset(client);
    const snapshot = await readSnapshotWithClient(client);
    checkVersion(snapshot, id, request.expected_version);
    if (goal.data && !snapshot.role_profiles.some(r => r.role === goal.data!.target_role && r.grade === goal.data!.target_grade)) throw new AppError('VALIDATION_ERROR', 'Целевая роль и грейд отсутствуют в каталоге');
    const changed = !Object.hasOwn(snapshot.goals, id) || canonicalJson(snapshot.goals[id]) !== canonicalJson(goal.data);
    if (changed) {
      await client.query('INSERT INTO goal_overrides(employee_id,goal,actor_id) VALUES($1,$2::jsonb,$3) ON CONFLICT(employee_id) DO UPDATE SET goal=excluded.goal,actor_id=excluded.actor_id,recorded_at=clock_timestamp()', [id, goal.data === null ? null : JSON.stringify(goal.data), actor.account_id]);
      await client.query('UPDATE employees SET employee_revision=employee_revision+1 WHERE employee_id=$1', [id]);
      await client.query('UPDATE app_meta SET global_revision=global_revision+1 WHERE id=1');
      snapshot.employee_revisions[id]++;
      snapshot.global_revision++;
      snapshot.goals[id] = goal.data;
      await audit(client, actor, 'goal.update', id, { career_goal: goal.data, employee_revision: snapshot.employee_revisions[id] });
    }
    const employee = employeeView(snapshot, id);
    return { version: employee.version, employee, changed };
  });
}
export async function completeActivity(actor: SessionView, id: string, request: CompletionRequest, key: string): Promise<{ result: CompletionResult; replayed: boolean }> {
  requireEmployeeWrite(actor, id); ensureKey(key);
  return withTransaction(async client => {
    await lockDataset(client);
    return completeActivityInTransaction(client, actor, id, request, key);
  });
}

/** Caller must hold app_meta FOR UPDATE on this same transaction connection.
 * Learning uses this helper so quiz state, effects, receipts and audit commit together. */
export async function completeActivityInTransaction(client: PoolClient, actor: SessionView, id: string, request: CompletionRequest, key: string): Promise<{ result: CompletionResult; replayed: boolean }> {
  requireEmployeeWrite(actor, id); ensureKey(key);
  if (request.simulation !== true) throw new AppError('INVALID_REQUEST', 'Поддерживается только явно указанная симуляция');
  const operation = 'completion';
  const hash = sourceHash({ operation, target_employee_id: id, body: request });
  const previous = await receipt<CompletionResult>(client, actor, operation, key, hash);
  if (previous) return { result: previous, replayed: true };
  const snapshot = await readSnapshotWithClient(client);
  checkVersion(snapshot, id, request.expected_version);
  const target = assertCompletionAllowed(snapshot, id, request);
  const before = employeeView(snapshot, id);
  const completionId = `SIM_${randomUUID()}`;
  const { rows } = await client.query('INSERT INTO demo_completions(id,employee_id,event_id,participation_id,session_date,occurrence_key,applied_as_of,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING recorded_at,sequence', [completionId, id, target.event_id, target.participation_id, target.session_date, target.occurrence_key, snapshot.as_of_date, actor.account_id]);
  const recordedAt = new Date(rows[0].recorded_at).toISOString();
  snapshot.completions.push({ id: completionId, employee_id: id, ...target, applied_as_of: snapshot.as_of_date, recorded_at: recordedAt, sequence: Number(rows[0].sequence) });
  snapshot.employee_revisions[id]++;
  snapshot.global_revision++;
  await client.query('UPDATE employees SET employee_revision=employee_revision+1 WHERE employee_id=$1', [id]);
  await client.query('UPDATE app_meta SET global_revision=global_revision+1 WHERE id=1');
  const employee = employeeView(snapshot, id);
  const result: CompletionResult = { version: employee.version, participation_id: target.participation_id || completionId, completion_origin: 'simulation', scheduled_session_date: target.session_date, applied_as_of: snapshot.as_of_date, recorded_at: recordedAt, skill_changes: skillChanges(before, employee), employee };
  await saveReceipt(client, actor, operation, key, hash, result);
  await audit(client, actor, 'completion.simulate', id, { completion_id: completionId, event_id: target.event_id, participation_id: target.participation_id, skill_changes: result.skill_changes });
  return { result, replayed: false };
}

function validateImportRows(command: ImportCommand): { employees: EmployeeSource[]; history: ParticipationSource[] } {
  const employees = employeeSchema.array().max(1000).safeParse(command.employees || []);
  const history = participationSchema.array().max(50000).safeParse(command.history || []);
  if (!employees.success || !history.success) throw new AppError('VALIDATION_ERROR', 'Некорректные строки импорта');
  if (!employees.data.length && !history.data.length) throw new AppError('VALIDATION_ERROR', 'Нужен хотя бы один непустой файл');
  return { employees: employees.data, history: history.data };
}
export async function importData(actor: SessionView, command: ImportCommand, key?: string): Promise<{ result: ImportResult; replayed: boolean }> {
  requireHr(actor);
  if (!command.dry_run) ensureKey(key);
  const normalized = validateImportRows(command);
  const operation = 'import';
  const hash = sourceHash({ operation, target: '/api/import', body: { ...command, ...normalized } });
  return withTransaction(async client => {
    await lockDataset(client);
    if (!command.dry_run && key) {
      const previous = await receipt<ImportResult>(client, actor, operation, key, hash);
      if (previous) return { result: previous, replayed: true };
    }
    const snapshot = await readSnapshotWithClient(client);
    if (command.expected_dataset_revision !== snapshot.dataset_revision) throw new AppError('REVISION_CONFLICT', 'Датасет изменился, повторите предварительную проверку', 409, { current_dataset_revision: snapshot.dataset_revision });
    const result: ImportResult = { dry_run: command.dry_run, applied: false, dataset_revision: snapshot.dataset_revision, global_revision: snapshot.global_revision,
      counts: { employees: { new_rows: 0, identical_rows: 0 }, history: { new_rows: 0, identical_rows: 0 } }, errors: [], warnings: [] };
    const employeeMap = new Map(snapshot.employees.map(e => [e.employee_id, e]));
    const historyMap = new Map(snapshot.history.map(h => [h.record_id, h]));
    const newEmployees: EmployeeSource[] = [];
    const newHistory: ParticipationSource[] = [];
    const issue = (file: 'employees' | 'history', id: string, code: string, message: string) => result.errors.push({ file, record_id: id, code, message });
    for (const [file, rows, existing, additions, identifier] of [
      ['employees', normalized.employees, employeeMap, newEmployees, 'employee_id'],
      ['history', normalized.history, historyMap, newHistory, 'record_id'],
    ] as const) {
      const seen = new Set<string>();
      for (const row of rows) {
        const id = String((row as unknown as Record<string, unknown>)[identifier]);
        if (seen.has(id)) { issue(file, id, 'DUPLICATE_ID', 'ID повторяется внутри файла'); continue; }
        seen.add(id);
        const previous = existing.get(id);
        if (previous) {
          if (sourceHash(previous) === sourceHash(row)) result.counts[file].identical_rows++;
          else issue(file, id, 'IMMUTABLE_SOURCE', 'Запись с этим ID уже существует и отличается. Исходные данные неизменяемы.');
        } else {
          // Both branches carry the matching source type; the tuple keeps the runtime pairing.
          (additions as (EmployeeSource | ParticipationSource)[]).push(row);
          result.counts[file].new_rows++;
        }
      }
    }
    const union = { ...snapshot, employees: [...snapshot.employees, ...newEmployees], history: [...snapshot.history, ...newHistory] };
    result.errors.push(...validateRelations(union, newEmployees, newHistory));
    const eventMap = new Map(snapshot.events.map(e => [e.event_id, e]));
    const simulationIds = new Set(snapshot.completions.map(row => row.id));
    const completed = new Set<string>();
    const occurrence = (employee: string, eventId: string, date: string) => JSON.stringify([employee, eventId, eventMap.get(eventId)?.repeatable ? date : 'once']);
    for (const row of snapshot.history) if (row.status === 'completed' && !eventMap.get(row.event_id)?.mandatory) completed.add(occurrence(row.employee_id, row.event_id, row.date));
    for (const row of snapshot.completions) completed.add(occurrence(row.employee_id, row.event_id, row.session_date || 'once'));
    for (const row of newHistory) {
      // Imported and simulated rows share participation IDs in employee history.
      if (simulationIds.has(row.record_id)) issue('history', row.record_id, 'PARTICIPATION_ID_COLLISION', 'ID участия уже используется локальной симуляцией');
      const event = eventMap.get(row.event_id);
      if (row.status !== 'completed' || !event || event.mandatory) continue;
      const occurrenceKey = occurrence(row.employee_id, row.event_id, row.date);
      if (completed.has(occurrenceKey)) issue('history', row.record_id, 'COMPLETION_COLLISION', 'Завершение этой активности/сессии уже присутствует в истории или симуляции');
      completed.add(occurrenceKey);
    }
    if (result.errors.length && !command.dry_run) throw new AppError('IMPORT_CONFLICT', 'Импорт отклонён целиком: исправьте конфликтующие строки', 409, { issues: result.errors.slice(0, 100), total_errors: result.errors.length });
    if (command.dry_run) return { result, replayed: false };
    if (newEmployees.length || newHistory.length) {
      await insertEmployees(client, newEmployees);
      await insertHistory(client, newHistory);
      const affectedIds = [...new Set(newHistory.map(h => h.employee_id))].filter(id => employeeMap.has(id));
      if (affectedIds.length) await client.query('UPDATE employees SET employee_revision=employee_revision+1 WHERE employee_id=ANY($1::text[])', [affectedIds]);
      await client.query('UPDATE app_meta SET dataset_revision=dataset_revision+1,global_revision=global_revision+1 WHERE id=1');
      result.dataset_revision++;
      result.global_revision++;
      result.applied = true;
    }
    const batchId = `IMP_${randomUUID()}`;
    await client.query('INSERT INTO import_batches(id,actor_id,fingerprint,result) VALUES($1,$2,$3,$4::jsonb)', [batchId, actor.account_id, hash, JSON.stringify(result)]);
    await saveReceipt(client, actor, operation, key!, hash, result);
    await audit(client, actor, 'dataset.import', null, { batch_id: batchId, counts: result.counts, dataset_revision: result.dataset_revision, applied: result.applied });
    return { result, replayed: false };
  });
}
export async function insertEmployees(client: PoolClient, employees: EmployeeSource[]): Promise<void> {
  if (!employees.length) return;
  const rows = employees.map(source => ({ source, source_hash: sourceHash(source) }));
  await client.query("INSERT INTO employees(employee_id,source,source_hash) SELECT x->'source'->>'employee_id',x->'source',x->>'source_hash' FROM jsonb_array_elements($1::jsonb) x", [JSON.stringify(rows)]);
}
export async function insertHistory(client: PoolClient, history: ParticipationSource[]): Promise<void> {
  if (!history.length) return;
  const rows = history.map(source => ({ source, source_hash: sourceHash(source) }));
  await client.query("INSERT INTO history_records(record_id,employee_id,event_id,date,status,source,source_hash) SELECT x->'source'->>'record_id',x->'source'->>'employee_id',x->'source'->>'event_id',x->'source'->>'date',x->'source'->>'status',x->'source',x->>'source_hash' FROM jsonb_array_elements($1::jsonb) x", [JSON.stringify(rows)]);
}
