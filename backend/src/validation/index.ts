import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { AppError } from '../errors';
import type { DatasetSnapshot, EmployeeSource, ParticipationSource, ImportIssue } from '../types';

export const idSchema = z.string().trim().min(1).max(200).refine(s => !['__proto__', 'prototype', 'constructor'].includes(s), 'Invalid identifier');
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
export const gradeSchema = z.enum(['Junior', 'Middle', 'Senior', 'Lead']);
const shortText = z.string().trim().min(1).max(500);
const levels = z.record(idSchema, z.number().finite().min(0).max(5));
export const careerGoalSchema = z.object({ target_role: shortText, target_grade: gradeSchema }).strict();
export const employeeSchema = z.object({
  employee_id: idSchema, full_name: shortText, department: shortText, role: shortText,
  grade: gradeSchema, manager_id: idSchema.nullable(), hire_date: dateSchema,
  tenure_months: z.number().int().min(0).max(1500), work_format: z.enum(['office', 'hybrid', 'remote']),
  preferred_language: z.enum(['kk', 'ru', 'en']), career_goal: careerGoalSchema.nullable(),
  skills: levels, last_review_date: dateSchema,
}).strict();
export const participationSchema = z.object({
  record_id: idSchema, employee_id: idSchema, event_id: idSchema, date: dateSchema,
  due_date: dateSchema.nullable(), status: z.enum(['completed', 'in_progress', 'dropped', 'no_show', 'declined', 'overdue']),
  completion_pct: z.number().int().min(0).max(100), score: z.number().int().min(0).max(100).nullable(),
  feedback_rating: z.number().int().min(1).max(5).nullable(), assigned_by: z.enum(['self', 'manager', 'hr']),
}).strict().superRefine((row, ctx) => {
  const ok = row.status === 'completed' ? row.completion_pct === 100
    : ['no_show', 'declined'].includes(row.status) ? row.completion_pct === 0
      : row.status === 'dropped' ? row.completion_pct >= 5 && row.completion_pct <= 95
        : row.completion_pct <= 95;
  if (!ok) ctx.addIssue({ code: 'custom', path: ['completion_pct'], message: 'Progress is inconsistent with participation status' });
});
const metaSchema = z.object({ dataset: shortText, version: shortText, as_of_date: dateSchema }).strict();
export const employeeFileSchema = z.object({ meta: metaSchema, employees: z.array(employeeSchema).min(1).max(1000) }).strict();
const skillSchema = z.object({ skill_id: idSchema, name: shortText, type: z.enum(['hard', 'soft']), category: shortText, description: z.string().max(10000) }).strict();
const roleSchema = z.object({ role: shortText, grade: gradeSchema, required_skills: levels, critical_skills: z.array(idSchema) }).strict();
const scaleSchema = z.object({ '0': shortText, '1': shortText, '2': shortText, '3': shortText, '4': shortText, '5': shortText }).strict();
export const skillsFileSchema = z.object({ meta: metaSchema, proficiency_scale: scaleSchema, skills: z.array(skillSchema).min(1), role_profiles: z.array(roleSchema).min(1) }).strict();
const eventSchema = z.object({
  event_id: idSchema, title: shortText, description: z.string().max(10000),
  type: z.enum(['compliance', 'onboarding', 'course', 'workshop', 'mentoring', 'certification', 'meetup']),
  format: z.enum(['online', 'offline', 'self_paced']), duration_hours: z.number().finite().positive().max(10000),
  mandatory: z.boolean(), target_roles: z.array(shortText), target_grades: z.array(gradeSchema),
  prerequisites: levels, develops_skills: z.array(z.object({ skill_id: idSchema, gain: z.number().finite().min(0).max(5), max_level: z.number().finite().min(0).max(5) }).strict()),
  upcoming_sessions: z.array(dateSchema),
}).strict();
export const eventsFileSchema = z.object({ meta: metaSchema, events: z.array(eventSchema).min(1) }).strict();

export function parseJson(text: string): unknown {
  try { return JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new AppError('VALIDATION_ERROR', 'Некорректный JSON', 400); }
}
export function checked<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError('VALIDATION_ERROR', 'Файл не соответствует схеме', 400, {
    issues: result.error.issues.slice(0, 100).map(i => ({ field: i.path.join('.'), message: i.message })),
  });
  return result.data;
}
export function parseEmployeeFile(text: string, expectedAsOf: string): EmployeeSource[] {
  const file = checked(employeeFileSchema, parseJson(text));
  if (file.meta.as_of_date !== expectedAsOf) throw new AppError('VALIDATION_ERROR', 'Дата среза файла отличается от активного датасета', 400, { expected_as_of_date: expectedAsOf });
  return file.employees;
}
const historyColumns = ['record_id', 'employee_id', 'event_id', 'date', 'due_date', 'status', 'completion_pct', 'score', 'feedback_rating', 'assigned_by'];
export function parseHistoryCsv(text: string): ParticipationSource[] {
  let rows: Record<string, string>[];
  try {
    rows = parse(text, { bom: true, skip_empty_lines: true, trim: true, max_record_size: 100000,
      columns: (header: string[]) => {
        if (header.length !== historyColumns.length || new Set(header).size !== header.length || historyColumns.some(c => !header.includes(c))) throw new Error('Invalid CSV header');
        return header;
      },
    });
  } catch { throw new AppError('VALIDATION_ERROR', 'Некорректный CSV: проверьте заголовки, кавычки и число столбцов', 400); }
  if (!rows.length || rows.length > 50000) throw new AppError('VALIDATION_ERROR', 'CSV должен содержать от 1 до 50000 строк', 400);
  return rows.map((r, index) => {
    const num = (s: string) => s === '' ? null : /^\d+$/.test(s) ? Number(s) : NaN;
    try { return checked(participationSchema, { ...r, due_date: r.due_date || null, completion_pct: num(r.completion_pct), score: num(r.score), feedback_rating: num(r.feedback_rating) }); }
    catch (error) { if (error instanceof AppError) error.details = { ...error.details, row: index + 2 }; throw error; }
  });
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function sourceHash(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }

/** Validate relations against the union of existing and incoming immutable rows. */
export function validateRelations(snapshot: DatasetSnapshot, employees = snapshot.employees, history = snapshot.history): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const skills = new Set(snapshot.skills.map(s => s.skill_id));
  const roles = new Set(snapshot.role_profiles.map(r => `${r.role}\u0000${r.grade}`));
  const people = new Map(snapshot.employees.map(e => [e.employee_id, e]));
  const events = new Map(snapshot.events.map(e => [e.event_id, e]));
  const add = (file: 'employees' | 'history', record_id: string, field: string, message: string) => issues.push({ file, record_id, field, code: 'INVALID_REFERENCE', message });
  for (const e of employees) {
    if (!roles.has(`${e.role}\u0000${e.grade}`)) add('employees', e.employee_id, 'role', 'Неизвестная роль и грейд');
    if (e.career_goal && !roles.has(`${e.career_goal.target_role}\u0000${e.career_goal.target_grade}`)) add('employees', e.employee_id, 'career_goal', 'Неизвестная целевая роль и грейд');
    if (e.manager_id && (!people.has(e.manager_id) || e.manager_id === e.employee_id)) add('employees', e.employee_id, 'manager_id', 'Руководитель не найден или совпадает с сотрудником');
    for (const skill of Object.keys(e.skills)) if (!skills.has(skill)) add('employees', e.employee_id, `skills.${skill}`, 'Навык не найден');
    if (e.hire_date > snapshot.as_of_date || e.last_review_date > snapshot.as_of_date) add('employees', e.employee_id, 'last_review_date', 'Дата не может быть позже даты среза');
  }
  for (const h of history) {
    if (!people.has(h.employee_id)) add('history', h.record_id, 'employee_id', 'Сотрудник не найден');
    const event = events.get(h.event_id);
    if (!event) add('history', h.record_id, 'event_id', 'Активность не найдена');
    if (h.date > snapshot.as_of_date) add('history', h.record_id, 'date', 'История не может быть позже даты среза');
    if (event && h.status === 'no_show' && event.format === 'self_paced') add('history', h.record_id, 'status', 'no_show допустим только для сессий по расписанию');
    if (event && h.status === 'overdue' && (!event.mandatory || !h.due_date || h.due_date >= snapshot.as_of_date)) add('history', h.record_id, 'due_date', 'Просрочка требует обязательной активности с прошедшим сроком');
    if (event && h.due_date && !event.mandatory) add('history', h.record_id, 'due_date', 'Срок предусмотрен только для обязательных активностей');
  }
  return issues;
}
