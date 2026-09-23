import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EmployeeSource } from '../../src/types';

export const aiFlowMeta = { dataset: 'Authored AI integration fixture; no competition data', version: '1', as_of_date: '2026-10-01' };
export const aiFlowPerson: EmployeeSource = {
  employee_id: 'FLOW_PERSON', full_name: 'Synthetic Private Name', department: 'Synthetic Department',
  role: 'Data Engineer', grade: 'Junior', manager_id: null, hire_date: '2025-01-01', tenure_months: 21,
  work_format: 'remote', preferred_language: 'ru', career_goal: { target_role: 'Data Engineer', target_grade: 'Middle' },
  skills: { SQL: 1 }, last_review_date: '2026-09-01',
};

/** Only authored synthetic records. Safe to use in a separate app smoke-test schema. */
export async function writeAiFlowFixture(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const baseEvent = {
    description: 'Authored synthetic activity', type: 'course', format: 'self_paced', duration_hours: 2,
    mandatory: false, target_roles: ['Data Engineer'], target_grades: ['Junior'], upcoming_sessions: [],
  };
  const files = {
    'employees.json': { meta: aiFlowMeta, employees: [aiFlowPerson] },
    'skills.json': {
      meta: aiFlowMeta, proficiency_scale: Object.fromEntries([0, 1, 2, 3, 4, 5].map(level => [String(level), `Level ${level}`])),
      skills: [{ skill_id: 'SQL', name: 'SQL', type: 'hard', category: 'Data', description: 'Authored synthetic skill' }],
      role_profiles: ['Junior', 'Middle'].map(grade => ({ role: 'Data Engineer', grade, required_skills: { SQL: grade === 'Junior' ? 1 : 3 }, critical_skills: ['SQL'] })),
    },
    'events.json': { meta: aiFlowMeta, events: [
      { ...baseEvent, event_id: 'FLOW_BASIC', title: 'SQL foundations', prerequisites: {}, develops_skills: [{ skill_id: 'SQL', gain: 1, max_level: 2 }] },
      { ...baseEvent, event_id: 'FLOW_ADVANCED', title: 'Advanced SQL practice', prerequisites: { SQL: 2 }, develops_skills: [{ skill_id: 'SQL', gain: 1, max_level: 3 }] },
    ] },
  };
  for (const [file, value] of Object.entries(files)) await writeFile(path.join(directory, file), JSON.stringify(value));
  await writeFile(path.join(directory, 'activity_history.csv'), 'record_id,employee_id,event_id,date,due_date,status,completion_pct,score,feedback_rating,assigned_by\nFLOW_STARTED,FLOW_PERSON,FLOW_BASIC,2026-09-15,,in_progress,50,,,self\n');
}
