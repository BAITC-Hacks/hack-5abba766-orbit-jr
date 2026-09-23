import type {
  AiRankingInput,
  Candidate,
  ParticipationStatus,
  RecommendationFact,
  SkillView,
} from '../../contracts/backend'
import type { BaselineSignals } from '../src/server/domain/baseline'

/** Authored regression scenarios, not official data or a measure of judge success. */
export type EvaluationCase = {
  id: string
  description: string
  input: AiRankingInput
  signals: BaselineSignals
  expectedTopCandidateIds: string[]
}

type CandidateSpec = {
  id: string
  title: string
  changes: { skillId: string; after: number }[]
  hours: number
  history?: ParticipationStatus[] // Oldest to newest; no more than three outcomes.
  relevance?: Candidate['relevance']
  unlock?: { eventId: string; skillId: string; after: number }
  continuation?: { participationId: string; sessionDate: string }
}

function skill(id: string, current: number, required: number | null, critical = false): SkillView {
  return {
    skill_id: id,
    baseline_level: current,
    current_level: current,
    required_level: required,
    gap: required === null ? null : Math.max(0, required - current),
    critical,
  }
}

function scenario(
  id: string,
  description: string,
  skills: SkillView[],
  specs: CandidateSpec[],
  expectedTopCandidateIds: string[],
): EvaluationCase {
  const byId = new Map(skills.map((item) => [item.skill_id, item]))
  const requirements = skills.filter((item) => item.required_level !== null)
  const targetSum = requirements.reduce((sum, item) => sum + item.required_level!, 0)
  const covered = requirements.reduce(
    (sum, item) => sum + Math.min(item.current_level, item.required_level!), 0,
  )
  const unlockedWeightedGain = new Map<string, number>()
  const negativeOutcomes = new Map<string, number>()
  const negativeStatuses = new Set<ParticipationStatus>(['dropped', 'no_show', 'declined'])

  const candidates: Candidate[] = specs.map((spec) => {
    const changes = spec.changes.map(({ skillId, after }) => {
      const current = byId.get(skillId)!
      return { skill_id: skillId, before: current.current_level, after, gain: after - current.current_level }
    })
    const goalGain = changes.reduce((sum, change) => {
      const current = byId.get(change.skill_id)!
      if (current.required_level === null) return sum
      return sum + Math.min(change.after, current.required_level) -
        Math.min(change.before, current.required_level)
    }, 0)
    const closedCritical = changes.filter((change) => {
      const current = byId.get(change.skill_id)!
      return current.critical && current.gap! > 0 && change.after >= current.required_level!
    }).length
    const history = spec.history ?? []
    const negatives = history.filter((status) => negativeStatuses.has(status)).length
    negativeOutcomes.set(spec.id, negatives)

    const facts: RecommendationFact[] = [
      {
        fact_id: `${spec.id}/grade`, category: 'grade',
        text: 'The employee is a Middle Research Engineer; the selected goal is Senior Research Engineer.',
      },
      {
        fact_id: `${spec.id}/gap`, category: 'skill_gap',
        text: changes.map((change) => {
          const current = byId.get(change.skill_id)!
          const requirement = current.required_level === null
            ? 'not required by this goal'
            : `goal requires ${current.required_level}; current gap ${current.gap}`
          return `${change.skill_id}: current ${change.before}, expected ${change.after}, gain ${change.gain}; ${requirement}.`
        }).join(' '),
      },
      {
        fact_id: `${spec.id}/target`, category: 'target_requirement',
        text: `Goal requirements: ${requirements.map((item) => `${item.skill_id}=${item.required_level}${item.critical ? ' (critical)' : ''}`).join(', ')}. ` +
          `Requirement sum ${targetSum}; covered points ${covered}. This step adds ${goalGain} covered points and closes ${closedCritical} critical gaps.`,
      },
      {
        fact_id: `${spec.id}/history`, category: 'history',
        text: history.length
          ? `Most recent ${history.length} participation outcomes for this event, oldest first: ${history.join(', ')}. Negative outcomes: ${negatives}.`
          : 'No prior participation in this event; negative outcomes: 0.',
      },
      {
        fact_id: `${spec.id}/effort`, category: 'effort',
        text: `Activity duration is ${spec.hours} hours.`,
      },
    ]

    if (spec.unlock) {
      const futureSkill = byId.get(spec.unlock.skillId)!
      const afterPrep = changes.find((change) => change.skill_id === futureSkill.skill_id)?.after ??
        futureSkill.current_level
      const futureGoalGain = Math.max(0, Math.min(spec.unlock.after, futureSkill.required_level!) -
        Math.min(afterPrep, futureSkill.required_level!))
      const weightedGain = futureGoalGain * (futureSkill.critical ? 2 : 1)
      unlockedWeightedGain.set(spec.id, weightedGain)
      facts.push({
        fact_id: `${spec.id}/unlock`, category: 'target_requirement',
        text: `Completing this prerequisite unlocks ${spec.unlock.eventId}. That separate future activity can raise ${futureSkill.skill_id} from ${afterPrep} to ${spec.unlock.after}, adding ${futureGoalGain} goal points (weighted gain ${weightedGain}). Future gain is not earned by this preparatory step.`,
      })
    }
    if (spec.continuation) {
      facts.find((fact) => fact.category === 'history')!.text +=
        ` Continue existing attempt ${spec.continuation.participationId} with session date ${spec.continuation.sessionDate}; do not create a new enrollment.`
    }

    return {
      candidate_id: spec.id,
      event_id: `authored-event/${spec.id}`,
      title: spec.title,
      event_type: spec.continuation ? 'workshop' : 'course',
      format: spec.continuation ? 'online' : 'self_paced',
      duration_hours: spec.hours,
      action: spec.continuation ? 'continue' : 'start',
      participation_id: spec.continuation?.participationId ?? null,
      session_date: spec.continuation?.sessionDate ?? null,
      relevance: spec.relevance ?? 'direct',
      expected_skill_changes: changes,
      goal_coverage_delta: goalGain / targetSum,
      unlocks_event_ids: spec.unlock ? [spec.unlock.eventId] : [],
      facts,
    }
  })

  return {
    id,
    description,
    input: {
      version: { dataset_revision: 1, employee_revision: 1 },
      as_of_date: '2026-10-01',
      limit: 1,
      profile: {
        role: 'Research Engineer', grade: 'Middle', work_format: 'hybrid',
        tenure_months: 18, preferred_language: 'en',
        goal: { source: 'selected', target: { target_role: 'Research Engineer', target_grade: 'Senior' } },
        progress: {
          coverage: covered / targetSum,
          gap_points: targetSum - covered,
          missing_critical_skill_ids: requirements.filter((item) => item.critical && item.gap! > 0).map((item) => item.skill_id),
        },
        skills,
      },
      candidates,
    },
    signals: { unlockedWeightedGain, negativeOutcomes },
    expectedTopCandidateIds,
  }
}

export const evaluationCases: EvaluationCase[] = [
  scenario(
    'critical-over-lowest',
    'Closing a critical gap outweighs the lowest off-goal skill and one prior skip.',
    [skill('authored/reliability', 3, 4, true), skill('authored/writing', 1, 3), skill('authored/sketching', 0, null)],
    [
      { id: 'lowest-skill-distraction', title: 'Visual notes and a short writing exercise', hours: 2, changes: [{ skillId: 'authored/sketching', after: 3 }, { skillId: 'authored/writing', after: 1.5 }] },
      { id: 'close-critical-gap', title: 'Reliability practice', hours: 8, history: ['no_show'], changes: [{ skillId: 'authored/reliability', after: 4 }] },
    ],
    ['close-critical-gap'],
  ),
  scenario(
    'history-breaks-tie',
    'Equal goal gains prefer fewer recent negative outcomes before lower effort.',
    [skill('authored/writing', 1, 3)],
    [
      { id: 'repeated-skips', title: 'Short writing lab', hours: 2, history: ['declined', 'no_show'], changes: [{ skillId: 'authored/writing', after: 2 }] },
      { id: 'new-format', title: 'Writing practice in a new format', hours: 5, changes: [{ skillId: 'authored/writing', after: 2 }] },
    ],
    ['new-format'],
  ),
  scenario(
    'ignore-off-goal-gain',
    'A large unrelated gain must not outweigh a larger gain toward the selected goal.',
    [skill('authored/querying', 2, 4), skill('authored/illustration', 0, null)],
    [
      { id: 'large-unrelated-gain', title: 'Illustration with a brief data exercise', hours: 2, changes: [{ skillId: 'authored/querying', after: 2.25 }, { skillId: 'authored/illustration', after: 4 }] },
      { id: 'focused-goal-gain', title: 'Query optimization practice', hours: 4, changes: [{ skillId: 'authored/querying', after: 3 }] },
    ],
    ['focused-goal-gain'],
  ),
  scenario(
    'cap-gain-at-requirement',
    'Skill growth above the target requirement adds no extra goal coverage.',
    [skill('authored/querying', 2, 3), skill('authored/writing', 1, 3)],
    [
      { id: 'overshoot-target', title: 'Advanced query theory', hours: 3, changes: [{ skillId: 'authored/querying', after: 5 }] },
      { id: 'fill-larger-gap', title: 'Structured technical writing', hours: 6, changes: [{ skillId: 'authored/writing', after: 3 }] },
    ],
    ['fill-larger-gap'],
  ),
  scenario(
    'prerequisite-with-evidence',
    'A prerequisite may win through a discounted documented future gain while immediate coverage stays zero.',
    [skill('authored/system-design', 2, 5), skill('authored/lab-tooling', 0, null)],
    [
      { id: 'small-direct-step', title: 'Introductory design exercise', hours: 2, changes: [{ skillId: 'authored/system-design', after: 3 }] },
      { id: 'prepare-design-lab', title: 'Lab tooling prerequisite', hours: 4, relevance: 'prerequisite', changes: [{ skillId: 'authored/lab-tooling', after: 1 }], unlock: { eventId: 'authored-future/advanced-design-lab', skillId: 'authored/system-design', after: 5 } },
    ],
    ['prepare-design-lab'],
  ),
  scenario(
    'continue-preserves-identity',
    'An equally useful shorter existing attempt keeps its participation ID and past session date.',
    [skill('authored/mentoring', 1, 3)],
    [
      { id: 'new-long-course', title: 'Long mentoring course', hours: 8, changes: [{ skillId: 'authored/mentoring', after: 2 }] },
      { id: 'continue-existing-attempt', title: 'Mentoring workshop already in progress', hours: 3, history: ['in_progress'], continuation: { participationId: 'authored-attempt/8f6b', sessionDate: '2026-09-15' }, changes: [{ skillId: 'authored/mentoring', after: 2 }] },
    ],
    ['continue-existing-attempt'],
  ),
  scenario(
    'arbitrary-new-identifiers',
    'Ranking and evidence validation accept new opaque IDs without original-dataset prefixes.',
    [skill('skill:new/данные-47', 1, 3)],
    [
      { id: 'candidate:imported/β-901', title: 'Brief reasoning exercise', hours: 1, changes: [{ skillId: 'skill:new/данные-47', after: 1.5 }] },
      { id: 'opaque:7cf0/新', title: 'Applied reasoning practice', hours: 4, changes: [{ skillId: 'skill:new/данные-47', after: 2.5 }] },
    ],
    ['opaque:7cf0/新'],
  ),
]
