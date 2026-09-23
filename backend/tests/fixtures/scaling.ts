import type { DatasetSnapshot, EmployeeSource, EventView, ParticipationSource } from '../../src/types';

/** Authored synthetic workload. No official employee, catalog, or history data. */
export function scalingSnapshot(people = 1000, records = 50_000): DatasetSnapshot {
  const employees: EmployeeSource[] = Array.from({ length: people }, (_, index) => ({
    employee_id: `PERSON_${index}`, full_name: `Synthetic person ${index}`, department: 'Engineering',
    role: 'Engineer', grade: 'Junior', manager_id: null, hire_date: '2025-01-01', tenure_months: 21,
    work_format: 'remote', preferred_language: 'ru', career_goal: { target_role: 'Engineer', target_grade: 'Middle' },
    skills: { A: 1, B: 1, C: 1 }, last_review_date: '2026-09-30',
  }));
  const events = Array.from({ length: 40 }, (_, index): EventView => ({
    event_id: index === 36 ? 'EV_036' : `EVENT_${index}`, title: `Synthetic activity ${index}`, description: 'Authored scaling activity',
    type: 'course', format: index === 36 || index % 3 === 1 ? 'online' : index % 3 === 0 ? 'self_paced' : 'offline',
    duration_hours: 4, mandatory: index % 13 === 0, target_roles: ['Engineer'], target_grades: ['Junior'],
    prerequisites: index % 5 === 0 ? { A: 2 } : {},
    develops_skills: [{ skill_id: ['A', 'B', 'C'][index % 3], gain: 1, max_level: 5 }],
    upcoming_sessions: index % 3 === 0 && index !== 36 ? [] : ['2026-10-02', '2026-10-03'],
    // Match the current source loader's repeatability policy.
    repeatable: index === 36,
  }));
  const history: ParticipationSource[] = Array.from({ length: records }, (_, index) => {
    const attempt = Math.floor(index / people);
    // At most one imported completion of an event/occurrence per employee.
    const status = index % 50 === 0 ? 'in_progress' : attempt < 40 && index % 3 === 0
      ? 'completed' : index % 3 === 1 ? 'declined' : 'dropped';
    return {
      record_id: `H${String(index).padStart(8, '0')}`, employee_id: employees[index % people].employee_id,
      event_id: events[attempt % events.length].event_id, date: `2026-09-${String(1 + attempt % 28).padStart(2, '0')}`,
      due_date: null, status, completion_pct: status === 'in_progress' ? 50 : status === 'completed' ? 100 : status === 'dropped' ? 5 : 0,
      score: null, feedback_rating: null, assigned_by: 'self',
    };
  });
  return {
    as_of_date: '2026-10-01', dataset_revision: 1, global_revision: 1, employees,
    employee_revisions: Object.fromEntries(employees.map(employee => [employee.employee_id, 1])), goals: {},
    skills: ['A', 'B', 'C'].map(skill_id => ({ skill_id, name: skill_id, type: 'hard', category: 'Synthetic', description: 'Authored skill' })),
    role_profiles: [
      { role: 'Engineer', grade: 'Junior', required_skills: { A: 1, B: 1, C: 1 }, critical_skills: ['A'] },
      { role: 'Engineer', grade: 'Middle', required_skills: { A: 4, B: 4, C: 4 }, critical_skills: ['A'] },
    ],
    events, history, completions: [],
    proficiency_scale: { '0': 'None', '1': 'Basic', '2': 'Working', '3': 'Confident', '4': 'Advanced', '5': 'Expert' },
  };
}
