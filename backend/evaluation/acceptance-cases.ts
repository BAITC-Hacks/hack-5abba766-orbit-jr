import type { Candidate, SkillView } from '../src/types'
import type { EvaluationCase } from './cases'

type Step = {
  id: string
  title: string
  hours: number
  effects: { skillId: string; after: number }[]
}

function skill(id: string, current: number, required: number, critical = false): SkillView {
  return { skill_id: id, baseline_level: current, current_level: current, required_level: required, gap: Math.max(0, required - current), critical }
}

function acceptanceCase(
  id: string,
  description: string,
  skills: SkillView[],
  steps: Step[],
  limit: 1 | 3,
  expectedTopId: string,
  expectedCandidateOrder?: string[],
): EvaluationCase {
  const bySkill = new Map(skills.map((item) => [item.skill_id, item]))
  const total = skills.reduce((sum, item) => sum + item.required_level!, 0)
  const covered = skills.reduce((sum, item) => sum + Math.min(item.current_level, item.required_level!), 0)
  const candidates: Candidate[] = steps.map((step) => {
    const changes = step.effects.map(({ skillId, after }) => {
      const before = bySkill.get(skillId)!.current_level
      return { skill_id: skillId, before, after, gain: after - before }
    })
    const goalGain = changes.reduce((sum, change) => {
      const target = bySkill.get(change.skill_id)!.required_level!
      return sum + Math.min(change.after, target) - Math.min(change.before, target)
    }, 0)
    return {
      candidate_id: step.id, event_id: `acceptance/event/${step.id}`, title: step.title,
      event_type: 'course', format: 'self_paced', duration_hours: step.hours,
      action: 'start', participation_id: null, session_date: null,
      relevance: 'direct', expected_skill_changes: changes, goal_coverage_delta: goalGain / total,
      unlocks_event_ids: [],
      facts: [
        { fact_id: `${step.id}/grade`, category: 'grade', text: 'Current role and grade: Middle Infrastructure Specialist. Selected goal: Senior Infrastructure Specialist.' },
        {
          fact_id: `${step.id}/gap`, category: 'skill_gap',
          text: changes.map((change) => {
            const item = bySkill.get(change.skill_id)!
            return `${change.skill_id}: current ${change.before}; expected ${change.after}; gain ${change.gain}; ` +
              `goal requires ${item.required_level}; current gap ${item.gap}; critical=${item.critical}.`
          }).join(' '),
        },
        {
          fact_id: `${step.id}/target`, category: 'target_requirement',
          text: `Goal requirements: ${skills.map((item) => `${item.skill_id}=${item.required_level}${item.critical ? ' (critical)' : ''}`).join(', ')}. ` +
            `Requirement sum ${total}; covered points ${covered}; this activity adds ${goalGain} covered points.`,
        },
        { fact_id: `${step.id}/history`, category: 'history', text: 'No prior participation in this event; negative outcomes: 0.' },
        { fact_id: `${step.id}/effort`, category: 'effort', text: `Activity duration is ${step.hours} hours.` },
      ],
    }
  })
  return {
    id, description,
    input: {
      version: { dataset_revision: 1, employee_revision: 1 }, as_of_date: '2026-10-19', limit,
      profile: {
        role: 'Infrastructure Specialist', grade: 'Middle', work_format: 'hybrid', tenure_months: 26, preferred_language: 'en',
        goal: { source: 'selected', target: { target_role: 'Infrastructure Specialist', target_grade: 'Senior' } },
        progress: {
          coverage: covered / total, gap_points: total - covered,
          missing_critical_skill_ids: skills.filter((item) => item.critical && item.gap! > 0).map((item) => item.skill_id),
        },
        skills,
      },
      candidates,
    },
    signals: { negativeOutcomes: new Map(steps.map((step) => [step.id, 0])), unlockedWeightedGain: new Map(steps.map((step) => [step.id, 0])) },
    expectedTopCandidateIds: [expectedTopId],
    expectedCandidateOrder,
    requiredTopFactIds: [`${expectedTopId}/gap`],
  }
}

/** New synthetic acceptance checks authored after the prompt change, without prompt or response access.
 * They supplement the frozen before/after challenges; they do not claim a paired measurement.
 * The multi-card case gained an explicit full-order rubric during post-run review;
 * it permits one to three cards, each matching the corresponding expected prefix.
 */
export const acceptanceCases: EvaluationCase[] = [
  acceptanceCase(
    'acceptance-critical-weight-without-closure',
    'A critical gain of 1.5 outweighs an ordinary gain of 2.5 at weight 2; neither activity fully closes a critical gap.',
    [skill('acceptance/fault-isolation', 2, 5, true), skill('acceptance/cost-analysis', 1, 5)],
    [
      { id: 'option:f6/a', title: 'Capacity cost exercises', hours: 2, effects: [{ skillId: 'acceptance/cost-analysis', after: 3.5 }] },
      { id: 'option:f6/b', title: 'Fault isolation exercises', hours: 9, effects: [{ skillId: 'acceptance/fault-isolation', after: 3.5 }] },
    ],
    1, 'option:f6/b',
  ),
  acceptanceCase(
    'acceptance-multiple-cards',
    'Post-review order rubric: the critical closure ranks first, then remaining alternatives by weighted target gain; one to three cards must preserve the expected prefix.',
    [skill('acceptance/recovery', 2, 4, true), skill('acceptance/runbooks', 1, 4)],
    [
      { id: 'option:9c/a', title: 'Runbook drafting', hours: 2, effects: [{ skillId: 'acceptance/runbooks', after: 2 }] },
      { id: 'option:9c/b', title: 'Recovery rehearsal', hours: 10, effects: [{ skillId: 'acceptance/recovery', after: 4 }] },
      { id: 'option:9c/c', title: 'Recovery foundations', hours: 3, effects: [{ skillId: 'acceptance/recovery', after: 3 }] },
      { id: 'option:9c/d', title: 'Runbook design workshop', hours: 6, effects: [{ skillId: 'acceptance/runbooks', after: 3.5 }] },
    ],
    3, 'option:9c/b',
    ['option:9c/b', 'option:9c/d', 'option:9c/c', 'option:9c/a'],
  ),
]
