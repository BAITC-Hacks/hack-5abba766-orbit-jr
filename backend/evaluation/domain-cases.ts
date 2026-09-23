import { getCandidates } from '../src/domain'
import {
  checked, employeeFileSchema, eventsFileSchema, participationSchema,
  skillsFileSchema, validateRelations,
} from '../src/validation'
import type {
  AiRankingInput, DatasetSnapshot, EmployeeSource, EmptyReason, EventView,
  ParticipationSource, RoleProfile, SkillLevels,
} from '../src/types'
import type { EvaluationCase } from './cases'

/** Authored source data, never copies of employee records or manually authored candidates. */
export type DomainEvaluationCase = EvaluationCase & {
  snapshot: DatasetSnapshot
  employeeId: string
}
export type DomainEmptyCase = Omit<DomainEvaluationCase, 'expectedTopCandidateIds'> & {
  expectedEmptyReason: EmptyReason
}

const meta = { dataset: 'Authored domain pipeline evaluation', version: '1', as_of_date: '2026-10-01' }
const role = 'Research Engineer'
const personId = 'authored/person-47'

function person(skills: SkillLevels, overrides: Partial<EmployeeSource> = {}): EmployeeSource {
  return {
    employee_id: personId, full_name: 'Authored evaluation person', department: 'Research',
    role, grade: 'Middle', manager_id: null, hire_date: '2024-01-01', tenure_months: 33,
    work_format: 'hybrid', preferred_language: 'ru', last_review_date: '2026-08-01',
    career_goal: { target_role: role, target_grade: 'Senior' }, skills, ...overrides,
  }
}

function event(id: string, changes: SkillLevels, overrides: Partial<Omit<EventView, 'repeatable'>> = {}): Omit<EventView, 'repeatable'> {
  return {
    event_id: id, title: id, description: 'Authored evaluation activity', type: 'course',
    format: 'self_paced', duration_hours: 4, mandatory: false,
    target_roles: [role], target_grades: ['Middle'], prerequisites: {},
    develops_skills: Object.entries(changes).map(([skill_id, gain]) => ({ skill_id, gain, max_level: 5 })),
    upcoming_sessions: [], ...overrides,
  }
}

function history(eventId: string, index: number, status: ParticipationSource['status']): ParticipationSource {
  return {
    record_id: `authored/history-${index}`, employee_id: personId, event_id: eventId,
    date: `2026-09-${String(10 + index).padStart(2, '0')}`, due_date: null, status,
    completion_pct: status === 'completed' ? 100 : status === 'dropped' || status === 'in_progress' ? 50 : 0,
    score: null, feedback_rating: null, assigned_by: 'self',
  }
}

function sourceSnapshot(options: {
  employee: EmployeeSource
  required: SkillLevels
  critical?: string[]
  events: Omit<EventView, 'repeatable'>[]
  history?: ParticipationSource[]
}): DatasetSnapshot {
  const { employee, required } = options
  const sourcePeople = checked(employeeFileSchema, { meta, employees: [employee] })
  const skillIds = new Set([
    ...Object.keys(employee.skills), ...Object.keys(required),
    ...options.events.flatMap(activity => [
      ...Object.keys(activity.prerequisites), ...activity.develops_skills.map(effect => effect.skill_id),
    ]),
  ])
  const current: RoleProfile = { role: employee.role, grade: employee.grade, required_skills: {}, critical_skills: [] }
  const target: RoleProfile | null = employee.career_goal ? {
    role: employee.career_goal.target_role, grade: employee.career_goal.target_grade,
    required_skills: required, critical_skills: options.critical ?? [],
  } : null
  const sourceSkills = checked(skillsFileSchema, {
    meta,
    proficiency_scale: { '0': 'None', '1': 'Basic', '2': 'Working', '3': 'Good', '4': 'Advanced', '5': 'Expert' },
    skills: [...skillIds].map(skill_id => ({ skill_id, name: skill_id, type: 'hard', category: 'Evaluation', description: 'Authored evaluation skill' })),
    role_profiles: target && (target.role !== current.role || target.grade !== current.grade) ? [current, target] : [target ?? current],
  })
  const sourceEvents = checked(eventsFileSchema, { meta, events: options.events })
  const snapshot: DatasetSnapshot = {
    as_of_date: meta.as_of_date, dataset_revision: 3, global_revision: 7,
    employees: sourcePeople.employees, employee_revisions: { [employee.employee_id]: 4 },
    skills: sourceSkills.skills, role_profiles: sourceSkills.role_profiles,
    events: sourceEvents.events.map(activity => ({ ...activity, repeatable: false })),
    history: checked(participationSchema.array(), options.history ?? []),
    completions: [], goals: {}, proficiency_scale: sourceSkills.proficiency_scale,
  }
  const issues = validateRelations(snapshot)
  if (issues.length) throw new Error(`Invalid authored domain fixture: ${JSON.stringify(issues)}`)
  return snapshot
}

function domainInput(snapshot: DatasetSnapshot, employeeId: string, limit: 1 | 2 | 3 = 1) {
  const { employee, candidates, emptyReason, signals } = getCandidates(snapshot, employeeId)
  const { role, grade, work_format, tenure_months, preferred_language, goal, progress, skills } = employee
  const input: AiRankingInput = {
    version: employee.version, as_of_date: snapshot.as_of_date, limit,
    profile: { role, grade, work_format, tenure_months, preferred_language, goal, progress, skills }, candidates,
  }
  return { input, signals, emptyReason }
}

/** Same source→domain→AI boundary as production, with authored expected event choices. */
export function buildDomainEvaluation(snapshot: DatasetSnapshot, employeeId: string, options: {
  id: string; description: string; expectedTopEventIds: string[]; limit?: 1 | 2 | 3
}): DomainEvaluationCase {
  const { input, signals, emptyReason } = domainInput(snapshot, employeeId, options.limit)
  if (emptyReason) throw new Error(`${options.id}: expected candidates, got ${emptyReason}`)
  const expectedTopCandidateIds = options.expectedTopEventIds.map(eventId => {
    const candidate = input.candidates.find(item => item.event_id === eventId)
    if (!candidate) throw new Error(`${options.id}: expected event ${eventId} is ineligible`)
    return candidate.candidate_id
  })
  return { id: options.id, description: options.description, input, signals, expectedTopCandidateIds, snapshot, employeeId }
}

const critical = sourceSnapshot({
  employee: person({ RELIABILITY: 3, WRITING: 1, DRAWING: 0 }),
  required: { RELIABILITY: 4, WRITING: 3 }, critical: ['RELIABILITY'],
  events: [
    event('close-critical', { RELIABILITY: 1 }, { duration_hours: 8 }),
    event('large-off-goal-gain', { DRAWING: 4, WRITING: 0.5 }, { duration_hours: 1 }),
    event('entirely-off-goal', { DRAWING: 5 }),
  ],
})
const opaquePersonId = 'judge:new/қызметкер-β'
const imported = sourceSnapshot({
  employee: person({ 'skill:жаңа/新': 1 }, { employee_id: opaquePersonId }),
  required: { 'skill:жаңа/新': 3 },
  events: [event('judge:event/新-901', { 'skill:жаңа/新': 1.5 }), event('judge:event/β-47', { 'skill:жаңа/新': 0.5 })],
})
const skippedIds = ['past-format-A', 'past-format-B', 'past-format-C']
const formatHistory = sourceSnapshot({
  employee: person({ WRITING: 1 }), required: { WRITING: 3 },
  events: [
    ...skippedIds.map(id => event(id, { WRITING: 1 }, { format: 'online' })),
    event('new-scheduled-format', { WRITING: 1 }, { format: 'online', duration_hours: 2, upcoming_sessions: ['2026-10-12'] }),
    event('new-self-paced-format', { WRITING: 1 }, { duration_hours: 6 }),
  ],
  history: skippedIds.map((id, index) => history(id, index, (['declined', 'no_show', 'dropped'] as const)[index])),
})
const prerequisite = sourceSnapshot({
  employee: person({ DESIGN: 2, TOOLING: 0 }), required: { DESIGN: 5 },
  events: [
    event('prepare-tooling', { TOOLING: 1 }),
    event('future-design-lab', { DESIGN: 3 }, { prerequisites: { TOOLING: 1 } }),
    event('small-direct-step', { DESIGN: 1 }, { duration_hours: 2 }),
  ],
})
const switchRole = sourceSnapshot({
  employee: person({ STATISTICS: 1 }, { career_goal: { target_role: 'Data Analyst', target_grade: 'Senior' } }),
  required: { STATISTICS: 3 },
  events: [
    event('current-role-bridge', { STATISTICS: 1 }),
    event('target-role-only', { STATISTICS: 2 }, { target_roles: ['Data Analyst'], target_grades: ['Senior'] }),
  ],
})
const continuation = sourceSnapshot({
  employee: person({ MENTORING: 1 }), required: { MENTORING: 3 },
  events: [
    event('old-enrollment', { MENTORING: 1 }, { type: 'workshop', format: 'online', target_grades: ['Junior'], duration_hours: 3 }),
    event('new-course', { MENTORING: 1 }, { duration_hours: 8 }),
  ],
  history: [history('old-enrollment', 4, 'in_progress')],
})

export const domainEvaluationCases: DomainEvaluationCase[] = [
  buildDomainEvaluation(critical, personId, { id: 'domain-critical-gap', description: 'Domain eligibility excludes entirely irrelevant events; closing a critical gap beats large off-goal growth.', expectedTopEventIds: ['close-critical'] }),
  buildDomainEvaluation(imported, opaquePersonId, { id: 'domain-imported-identifiers', description: 'Validated source profiles, skills and activities accept new opaque Unicode IDs throughout the actual candidate pipeline.', expectedTopEventIds: ['judge:event/新-901'] }),
  buildDomainEvaluation(formatHistory, personId, { id: 'domain-similar-format-history', description: 'Three negative outcomes on distinct similar online activities favor an equally useful alternative format.', expectedTopEventIds: ['new-self-paced-format'] }),
  buildDomainEvaluation(prerequisite, personId, { id: 'domain-prerequisite-benefit', description: 'A preparation step has zero immediate coverage but unlocks a separate numeric future gain; it does not earn that gain now.', expectedTopEventIds: ['prepare-tooling'] }),
  buildDomainEvaluation(switchRole, personId, { id: 'domain-role-switch-eligibility', description: 'A career switch does not bypass the current-role and current-grade audience of new activities.', expectedTopEventIds: ['current-role-bridge'] }),
  buildDomainEvaluation(continuation, personId, { id: 'domain-continue-identity', description: 'A past enrollment remains eligible after grade change and keeps its original participation and session identity.', expectedTopEventIds: ['old-enrollment'] }),
]

function emptyCase(id: string, description: string, snapshot: DatasetSnapshot, expectedEmptyReason: EmptyReason): DomainEmptyCase {
  const employeeId = snapshot.employees[0].employee_id
  const { input, signals, emptyReason } = domainInput(snapshot, employeeId)
  if (emptyReason !== expectedEmptyReason) throw new Error(`${id}: expected ${expectedEmptyReason}, got ${emptyReason}`)
  return { id, description, snapshot, employeeId, input, signals, expectedEmptyReason }
}

/** Empty states bypass model ranking and have their own assertions, not artificial top-choice scores. */
export const domainEmptyCases: DomainEmptyCase[] = [
  emptyCase('domain-missing-goal', 'A Lead without a selected goal has no invented next grade or AI recommendations.', sourceSnapshot({
    employee: person({ DESIGN: 1 }, { grade: 'Lead', career_goal: null }), required: {},
    events: [event('lead-development', { DESIGN: 1 }, { target_grades: ['Lead'] })],
  }), 'GOAL_REQUIRED'),
  emptyCase('domain-no-goal-coverage', 'Available learning without direct or preparatory target benefit is not presented as a career step.', sourceSnapshot({
    employee: person({ DESIGN: 1, DRAWING: 0 }), required: { DESIGN: 3 },
    events: [event('unrelated-learning', { DRAWING: 1 })],
  }), 'NO_GOAL_RELEVANT_EVENTS'),
]
