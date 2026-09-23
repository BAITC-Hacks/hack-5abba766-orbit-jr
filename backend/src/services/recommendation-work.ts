import { AppError } from '../errors';
import type { RecommendationResult } from '../types';

/** Process-local admission and bounded memoization; PostgreSQL still guards across processes. */
export class RecommendationWork {
  private readonly pending = new Map<string, Promise<RecommendationResult>>();
  private readonly cache = new Map<string, { expires: number; result: RecommendationResult }>();

  constructor(private readonly options = { concurrency: 3, entries: 128, ttlMs: 60_000 },
    private readonly now: () => number = Date.now) {}

  async run(key: string, operation: () => Promise<RecommendationResult>): Promise<RecommendationResult> {
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) return structuredClone(cached.result);
    if (cached) this.cache.delete(key);
    const existing = this.pending.get(key);
    if (existing) return structuredClone(await existing);
    // Do not queue more requests holding scarce database connections. Three AI
    // calls leave seven connections in the application's ten-connection pool.
    if (this.pending.size >= this.options.concurrency) {
      throw new AppError('RECOMMENDATION_BUSY', 'Сейчас выполняется несколько подборов. Повторите запрос через несколько секунд.', 429);
    }
    const work = Promise.resolve().then(operation);
    this.pending.set(key, work);
    try {
      const result = await work;
      // A temporary provider failure must not hide recovery behind a cached fallback.
      if (result.mode === 'ai') {
        for (const [id, entry] of this.cache) if (entry.expires <= this.now()) this.cache.delete(id);
        this.cache.set(key, { expires: this.now() + this.options.ttlMs, result: structuredClone(result) });
        while (this.cache.size > this.options.entries) this.cache.delete(this.cache.keys().next().value!);
      }
      return structuredClone(result);
    } finally {
      this.pending.delete(key);
    }
  }
}

export const recommendationWork = new RecommendationWork();
