import { pool, readSnapshotWithClient } from '../db';
import { readSnapshot } from './data';
import { getCandidates } from '../domain';
import { AppError } from '../errors';
import { AiError, baselineRanking, cardsFromRanking, rankCandidates } from '../ai';
import type { AiRankingInput, DomainVersion, RecommendationRequest, RecommendationResult } from '../types';

const sameVersion = (a: DomainVersion, b: DomainVersion) => a.dataset_revision === b.dataset_revision && a.employee_revision === b.employee_revision;

export async function recommendations(employeeId: string, request: RecommendationRequest): Promise<RecommendationResult> {
  const snapshot = await readSnapshot();
  const { employee, candidates, emptyReason } = getCandidates(snapshot, employeeId);
  if (!sameVersion(employee.version, request.expected_version)) throw new AppError('REVISION_CONFLICT', 'Данные изменились. Обновите профиль.', 409, { current_version: employee.version });
  if (emptyReason || candidates.length === 0) return { version: employee.version, mode: 'no_candidates', empty_reason: emptyReason ?? 'NO_GOAL_RELEVANT_EVENTS', recommendations: [], fallback_reason: null };
  const { role, grade, work_format, tenure_months, preferred_language, goal, progress, skills } = employee;
  const input: AiRankingInput = { version: employee.version, as_of_date: snapshot.as_of_date, limit: request.limit ?? 3,
    profile: { role, grade, work_format, tenure_months, preferred_language, goal, progress, skills }, candidates };
  // Session-level advisory lock spans the network call but holds no DB transaction.
  const connection = await pool.connect();
  const lockName = `recommend:${employeeId}:${employee.version.dataset_revision}:${employee.version.employee_revision}`;
  let locked = false;
  try {
    const lock = await connection.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [lockName]);
    locked = Boolean(lock.rows[0]?.acquired);
    if (!locked) throw new AppError('RECOMMENDATION_IN_PROGRESS', 'Подбор для этого профиля уже выполняется.', 429);
    let ranking; let fallback: AiError['reason'] | null = null;
    try { ranking = await rankCandidates(input); }
    catch (error) { fallback = error instanceof AiError ? error.reason : 'provider_error'; ranking = baselineRanking(input); }
    // Reuse the lock connection: ten concurrent calls must not exhaust the pool
    // while each waits for a second connection to check its result version.
    let latest;
    await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      latest = await readSnapshotWithClient(connection);
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    const current = { dataset_revision: latest.dataset_revision, employee_revision: latest.employee_revisions[employeeId] };
    if (!sameVersion(current, employee.version)) throw new AppError('STALE_RECOMMENDATION', 'Профиль изменился во время подбора. Обновите рекомендации.', 409, { current_version: current });
    const cards = cardsFromRanking(ranking, candidates);
    return fallback
      ? { version: employee.version, mode: 'rules_fallback', fallback_reason: fallback, recommendations: cards, empty_reason: null }
      : { version: employee.version, mode: 'ai', fallback_reason: null, recommendations: cards, empty_reason: null };
  } finally {
    let unlockError: Error | undefined;
    if (locked) {
      try { await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockName]); }
      catch (error) { unlockError = error instanceof Error ? error : new Error('Advisory unlock failed'); }
    }
    connection.release(unlockError);
  }
}
