import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AppError } from '../errors';
import type { DatasetSnapshot } from '../types';
import { checked, parseJson, employeeFileSchema, skillsFileSchema, eventsFileSchema, parseHistoryCsv, validateRelations } from './index';

export async function loadDataset(directory = process.env.DATASET_DIR || fileURLToPath(new URL('../../../data/source/', import.meta.url))): Promise<DatasetSnapshot> {
  const [employeeText, skillText, eventText, historyText] = await Promise.all(['employees.json', 'skills.json', 'events.json', 'activity_history.csv'].map(name => readFile(path.join(directory, name), 'utf8')));
  const people = checked(employeeFileSchema, parseJson(employeeText));
  const catalog = checked(skillsFileSchema, parseJson(skillText));
  const events = checked(eventsFileSchema, parseJson(eventText));
  if ([catalog.meta.as_of_date, events.meta.as_of_date].some(date => date !== people.meta.as_of_date)) throw new AppError('VALIDATION_ERROR', 'Даты среза файлов не совпадают');
  const snapshot: DatasetSnapshot = {
    as_of_date: people.meta.as_of_date, dataset_revision: 1, global_revision: 1,
    employees: people.employees, employee_revisions: Object.fromEntries(people.employees.map(e => [e.employee_id, 1])),
    skills: catalog.skills, role_profiles: catalog.role_profiles,
    events: events.events.map(e => ({ ...e, repeatable: e.event_id === 'EV_036' })),
    history: parseHistoryCsv(historyText), completions: [], goals: {}, proficiency_scale: catalog.proficiency_scale,
  };
  for (const [name, ids] of [['employees', snapshot.employees.map(e => e.employee_id)], ['skills', snapshot.skills.map(s => s.skill_id)], ['roles', snapshot.role_profiles.map(r => `${r.role}\u0000${r.grade}`)], ['events', snapshot.events.map(e => e.event_id)], ['history', snapshot.history.map(h => h.record_id)]] as const) {
    if (new Set(ids).size !== ids.length) throw new AppError('VALIDATION_ERROR', `Повторяющиеся ID в ${name}`);
  }
  const skills = new Set(snapshot.skills.map(s => s.skill_id));
  const roles = new Set(snapshot.role_profiles.map(r => r.role));
  for (const role of snapshot.role_profiles) {
    if (Object.keys(role.required_skills).some(s => !skills.has(s)) || role.critical_skills.some(s => !(s in role.required_skills))) throw new AppError('VALIDATION_ERROR', 'Некорректные навыки в требованиях роли');
  }
  for (const event of snapshot.events) {
    if ([...Object.keys(event.prerequisites), ...event.develops_skills.map(s => s.skill_id)].some(s => !skills.has(s)) || event.target_roles.some(r => !roles.has(r))) throw new AppError('VALIDATION_ERROR', 'Некорректные ссылки в каталоге активностей');
    if (event.format === 'self_paced' && event.upcoming_sessions.length) throw new AppError('VALIDATION_ERROR', 'У самостоятельной активности не должно быть сессий');
    if (new Set(event.develops_skills.map(s => s.skill_id)).size !== event.develops_skills.length) throw new AppError('VALIDATION_ERROR', 'Повторяющиеся эффекты одного навыка');
  }
  const issues = validateRelations(snapshot);
  if (issues.length) throw new AppError('VALIDATION_ERROR', 'Связи датасета не прошли проверку', 400, { issues: issues.slice(0, 100) });
  const eventMap = new Map(snapshot.events.map(e => [e.event_id, e]));
  const completed = new Set<string>();
  for (const row of snapshot.history) {
    const event = eventMap.get(row.event_id)!;
    if (row.status !== 'completed' || event.mandatory) continue;
    const occurrence = JSON.stringify([row.employee_id, row.event_id, event.repeatable ? row.date : 'once']);
    if (completed.has(occurrence)) throw new AppError('VALIDATION_ERROR', 'Повторное завершение неповторяемой активности или одной сессии', 400, { record_id: row.record_id });
    completed.add(occurrence);
  }
  return snapshot;
}
