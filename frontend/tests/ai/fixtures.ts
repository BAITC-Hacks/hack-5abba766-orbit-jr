import type {
  AiRankingInput,
  Candidate,
  RecommendationFact,
  SkillChange,
  SkillView,
} from '../../../contracts/backend'

export const fact = (id: string, category: RecommendationFact['category']): RecommendationFact => ({
  fact_id: id,
  category,
  text: `${category} fact ${id}`,
})

/** Four facts covering the three required categories plus one extra. */
export const standardFacts = (prefix: string): RecommendationFact[] => [
  fact(`${prefix}-gap`, 'skill_gap'),
  fact(`${prefix}-req`, 'target_requirement'),
  fact(`${prefix}-grade`, 'grade'),
  fact(`${prefix}-effort`, 'effort'),
]

export const change = (skill_id: string, before: number, after: number): SkillChange => ({
  skill_id,
  before,
  after,
  gain: after - before,
})

export function candidate(overrides: Partial<Candidate> & { candidate_id: string }): Candidate {
  const id = overrides.candidate_id
  return {
    event_id: `EV_${id}`,
    title: `Activity ${id}`,
    event_type: 'course',
    format: 'online',
    duration_hours: 8,
    action: 'start',
    participation_id: null,
    session_date: null,
    relevance: 'direct',
    expected_skill_changes: [],
    goal_coverage_delta: 0.1,
    unlocks_event_ids: [],
    facts: standardFacts(id),
    ...overrides,
  }
}

export const skill = (
  skill_id: string,
  opts: Partial<SkillView> = {},
): SkillView => ({
  skill_id,
  baseline_level: 2,
  current_level: 2,
  required_level: 3,
  gap: 1,
  critical: false,
  ...opts,
})

export function input(
  candidates: Candidate[],
  opts: { limit?: 1 | 2 | 3; skills?: SkillView[] } = {},
): AiRankingInput {
  return {
    version: { dataset_revision: 1, employee_revision: 4 },
    as_of_date: '2026-10-01',
    limit: opts.limit ?? 3,
    profile: {
      role: 'Analyst',
      grade: 'Middle',
      work_format: 'hybrid',
      tenure_months: 30,
      preferred_language: 'ru',
      goal: { source: 'selected', target: { target_role: 'Analyst', target_grade: 'Senior' } },
      progress: { coverage: 0.6, gap_points: 4, missing_critical_skill_ids: ['SK_CRIT'] },
      skills: opts.skills ?? [
        skill('SK_CRIT', { critical: true }),
        skill('SK_PLAIN'),
        skill('SK_OFF', { required_level: null, gap: null }),
      ],
    },
    candidates,
  }
}
