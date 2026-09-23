import { recommendationLockPool, readDomainVersionWithClient } from '../db';
import { readSnapshot } from './data';
import { getCandidates } from '../domain';
import { AppError } from '../errors';
import { recommend } from '../ai/recommend';
import { createHash } from 'node:crypto';
import { buildUserMessage, RANKING_JSON_SCHEMA, SYSTEM_PROMPT } from '../ai/prompt';
import { recommendationWork } from './recommendation-work';
import type { AiRankingInput, DomainVersion, RecommendationRequest, RecommendationResult } from '../types';

const sameVersion = (a: Partial<DomainVersion>, b: DomainVersion) => a.dataset_revision === b.dataset_revision && a.employee_revision === b.employee_revision;

export async function recommendations(employeeId: string, request: RecommendationRequest, signal?: AbortSignal): Promise<RecommendationResult> {
  const snapshot = await readSnapshot();
  const { employee, candidates, emptyReason, signals } = getCandidates(snapshot, employeeId);
  if (!sameVersion(employee.version, request.expected_version)) throw new AppError('REVISION_CONFLICT', 'Данные изменились. Обновите профиль.', 409, { current_version: employee.version });
  if (emptyReason || candidates.length === 0) return { version: employee.version, mode: 'no_candidates', empty_reason: emptyReason ?? 'NO_GOAL_RELEVANT_EVENTS', recommendations: [], fallback_reason: null };
  const { role, grade, work_format, tenure_months, preferred_language, goal, progress, skills } = employee;
  const input: AiRankingInput = { version: employee.version, as_of_date: snapshot.as_of_date, limit: request.limit ?? 3,
    profile: { role, grade, work_format, tenure_months, preferred_language, goal, progress, skills }, candidates };
  // A digest keeps credentials and profile contents out of cache keys/logs and
  // invalidates results when configuration, prompt, evidence, limit or version changes.
  const cacheKey = createHash('sha256').update(JSON.stringify([employeeId, input, buildUserMessage(input, signals), SYSTEM_PROMPT, RANKING_JSON_SCHEMA,
    process.env.LLM_MODEL, process.env.LLM_API_URL, process.env.LLM_API_KEY, process.env.LLM_TIMEOUT_MS])).digest('hex');
  return recommendationWork.run(cacheKey, () => rankSnapshot(employeeId, input, signals, signal), { sharePending: signal === undefined });
}

async function rankSnapshot(employeeId: string, input: AiRankingInput,
  signals: Parameters<typeof recommend>[1]['signals'], signal?: AbortSignal): Promise<RecommendationResult> {
  // Session-level advisory lock spans the network call but holds no DB transaction.
  const connection = await recommendationLockPool.connect().catch(() => {
    throw new AppError('STORAGE_BUSY', 'Подбор временно занят. Повторите запрос.', 503);
  });
  const lockName = `recommend:${employeeId}:${input.version.dataset_revision}:${input.version.employee_revision}`;
  let locked = false;
  try {
    const lock = await connection.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [lockName]);
    locked = Boolean(lock.rows[0]?.acquired);
    if (!locked) throw new AppError('RECOMMENDATION_IN_PROGRESS', 'Подбор для этого профиля уже выполняется.', 429);
    const result = await recommend(input, { signals, signal });
    // Reuse the lock connection for an atomic revision check. Loading every
    // employee and history row again adds latency without strengthening freshness.
    const current = await readDomainVersionWithClient(connection, employeeId);
    if (!sameVersion(current, input.version)) throw new AppError('STALE_RECOMMENDATION', 'Профиль изменился во время подбора. Обновите рекомендации.', 409, { current_version: current });
    return result;
  } finally {
    let unlockError: Error | undefined;
    if (locked) {
      try { await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockName]); }
      catch (error) { unlockError = error instanceof Error ? error : new Error('Advisory unlock failed'); }
    }
    connection.release(unlockError);
  }
}
