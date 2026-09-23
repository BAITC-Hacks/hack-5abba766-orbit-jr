import type { Candidate, RecommendationInput } from '@/contracts/ai'

export function candidate(overrides: Partial<Candidate> & { event_id: string }): Candidate {
  return {
    title: `Event ${overrides.event_id}`,
    action: 'start',
    duration_hours: 8,
    expected_changes: [],
    rating: 4,
    peer_count: 2,
    is_preparatory: false,
    facts: [
      { id: `${overrides.event_id}-f1`, category: 'target_gap', text: 'closes a gap' },
      { id: `${overrides.event_id}-f2`, category: 'critical_skill', text: 'critical skill' },
      { id: `${overrides.event_id}-f3`, category: 'duration', text: '8 hours' },
      { id: `${overrides.event_id}-f4`, category: 'feedback', text: 'rated 4.0' },
    ],
    ...overrides,
  }
}

export function input(candidates: Candidate[]): RecommendationInput {
  return {
    employee: {
      employee_id: 'E_001',
      role: 'Engineer',
      grade: 'Middle',
      target_role: 'Engineer',
      target_grade: 'Senior',
      goal_source: 'chosen',
      gap_skill_ids: ['SK_1', 'SK_2'],
      critical_skill_ids: ['SK_1'],
    },
    candidates,
    state_version: 7,
  }
}

export const gain = (skill_id: string, from: number, to: number, closes_gap = true, critical = false) => ({
  skill_id,
  from,
  to,
  closes_gap,
  critical,
})
