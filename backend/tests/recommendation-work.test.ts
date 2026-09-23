import { describe, expect, it } from 'vitest';
import { RecommendationWork } from '../src/services/recommendation-work';
import type { RecommendationResult } from '../src/types';

const ai = (): Extract<RecommendationResult, { mode: 'ai' }> => ({ version: { dataset_revision: 1, employee_revision: 0 },
  mode: 'ai', fallback_reason: null, empty_reason: null, recommendations: [] });

describe('bounded recommendation work', () => {
  it('shares identical in-flight work while reserving database capacity for other requests', async () => {
    const work = new RecommendationWork({ concurrency: 1, entries: 2, ttlMs: 100 });
    let finish!: (value: RecommendationResult) => void;
    let calls = 0;
    const operation = () => { calls++; return new Promise<RecommendationResult>(resolve => { finish = resolve; }); };
    const first = work.run('same', operation);
    const duplicate = work.run('same', operation);
    await expect(work.run('different', async () => ai())).rejects.toMatchObject({ code: 'RECOMMENDATION_BUSY', status: 429 });
    finish(ai());
    const [a, b] = await Promise.all([first, duplicate]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    await expect(work.run('different', async () => ai())).resolves.toMatchObject({ mode: 'ai' });
  });

  it('bounds cache lifetime and size, and isolates returned objects', async () => {
    let now = 0;
    let calls = 0;
    const work = new RecommendationWork({ concurrency: 1, entries: 1, ttlMs: 100 }, () => now);
    const operation = async () => { calls++; return ai(); };
    const first = await work.run('a', operation);
    first.version.employee_revision = 999;
    expect((await work.run('a', operation)).version.employee_revision).toBe(0);
    expect(calls).toBe(1);
    now = 100;
    await work.run('a', operation);
    expect(calls).toBe(2);
    await work.run('b', operation);
    await work.run('a', operation);
    expect(calls).toBe(4);
  });

  it('releases admission after failure and never caches a temporary fallback', async () => {
    const work = new RecommendationWork({ concurrency: 1, entries: 1, ttlMs: 100 });
    await expect(work.run('a', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    await work.run('a', async () => ({ ...ai(), mode: 'rules_fallback', fallback_reason: 'provider_timeout' }));
    let recovered = false;
    await work.run('a', async () => { recovered = true; return ai(); });
    expect(recovered).toBe(true);
  });
});
