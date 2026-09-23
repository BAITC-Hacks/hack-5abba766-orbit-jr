import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { readSnapshotWithClient, withTransaction } from '../db';
import { invariant } from '../errors';
import { assertCompletionAllowed, employeeView } from '../domain';
import { audit, checkVersion, completeActivityInTransaction, ensureKey, lockDataset, receipt, saveReceipt, scope } from '../services/data';
import { sourceHash, idSchema } from '../validation';
import { learningCourses } from './content';
import type { CompletionRequest, CompletionResult, DatasetSnapshot, GoalProgress, SessionView } from '../types';
import type { CourseDefinition, LearningAttempt, LearningFeedback, LearningModuleSummary, LearningModuleView, StartLearningRequest, SubmitQuizRequest, SubmitQuizResult } from './types';

const versionSchema = z.object({ dataset_revision: z.number().int().positive(), employee_revision: z.number().int().positive() }).strict();
export const learningTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing_participation'), participation_id: idSchema }).strict(),
  z.object({ kind: z.literal('new_participation'), event_id: idSchema, session_date: z.iso.date().nullable() }).strict(),
]);
export const startLearningSchema = z.object({ module_id: idSchema, target: learningTargetSchema, expected_version: versionSchema }).strict();
export const completeLessonSchema = z.object({ lesson_id: idSchema }).strict();
export const submitQuizSchema = z.object({ answers: z.record(idSchema, idSchema), expected_version: versionSchema }).strict();

type AttemptRow = {
  id: string; employee_id: string; event_id: string; module_id: string; module_version: number; occurrence_key: string;
  target: CompletionRequest['target']; course_snapshot: CourseDefinition; completed_lesson_ids: string[];
  status: LearningAttempt['status']; quiz_attempts: number; last_score: number | null; last_feedback: LearningFeedback[];
  completion_result: CompletionResult | null; previous_progress: GoalProgress | null;
  created_at: Date; updated_at: Date; passed_at: Date | null;
};

function summary(course: CourseDefinition): LearningModuleSummary {
  return { id: course.id, event_id: course.event_id, title: course.title, summary: course.summary, estimated_minutes: course.estimated_minutes,
    version: course.version, lesson_count: course.lessons.length, question_count: course.questions.length, passing_score: course.passing_score, is_demo: true };
}
export function publicModule(course: CourseDefinition): LearningModuleView {
  // Explicit projection: never spread a server question or course with its answer keys.
  return { ...summary(course), lessons: structuredClone(course.lessons),
    questions: course.questions.map(({ id, prompt, options }) => ({ id, prompt, options: structuredClone(options) })),
    sources: structuredClone(course.sources) };
}
function courseById(id: string): CourseDefinition {
  const course = learningCourses.find(item => item.id === id);
  invariant(course, 'NOT_FOUND', 'Учебный модуль не найден', 404);
  return course;
}
export function listLearningModules(): { modules: LearningModuleSummary[] } { return { modules: learningCourses.map(summary) }; }
export function getLearningModule(id: string): LearningModuleView { return publicModule(courseById(id)); }

function attemptView(row: AttemptRow, snapshot: DatasetSnapshot): LearningAttempt {
  return { id: row.id, employee_id: row.employee_id, module_id: row.module_id, module_version: row.module_version, event_id: row.event_id,
    target: row.target, status: row.status, completed_lesson_ids: row.completed_lesson_ids, lesson_count: row.course_snapshot.lessons.length,
    quiz_attempts: row.quiz_attempts, last_score: row.last_score, started_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString(),
    passed_at: row.passed_at ? new Date(row.passed_at).toISOString() : null,
    employee_version: { dataset_revision: snapshot.dataset_revision, employee_revision: snapshot.employee_revisions[row.employee_id] },
    module: publicModule(row.course_snapshot), completion: row.completion_result, previous_progress: row.previous_progress };
}
async function findAttempt(client: PoolClient, employeeId: string, attemptId: string, lock = false): Promise<AttemptRow> {
  const { rows } = await client.query<AttemptRow>(`SELECT * FROM learning_attempts WHERE id=$1 AND employee_id=$2${lock ? ' FOR UPDATE' : ''}`, [attemptId, employeeId]);
  invariant(rows[0], 'NOT_FOUND', 'Учебная попытка сотрудника не найдена', 404);
  return rows[0];
}
/** Resolve identity before eligibility, so replaying start resumes a now-passed attempt. */
function learningOccurrence(snapshot: DatasetSnapshot, employeeId: string, course: CourseDefinition, target: CompletionRequest['target']): string {
  const event = snapshot.events.find(e => e.event_id === course.event_id);
  invariant(event, 'NOT_FOUND', 'Активность учебного модуля отсутствует в датасете', 404);
  let sessionDate: string | null;
  if (target.kind === 'existing_participation') {
    const participation = snapshot.history.find(row => row.record_id === target.participation_id && row.employee_id === employeeId);
    invariant(participation, 'NOT_FOUND', 'Участие сотрудника не найдено', 404);
    invariant(participation.event_id === course.event_id, 'VALIDATION_ERROR', 'Модуль не соответствует выбранной активности');
    sessionDate = event.format === 'self_paced' ? null : participation.date;
  } else {
    invariant(target.event_id === course.event_id, 'VALIDATION_ERROR', 'Модуль не соответствует выбранной активности');
    sessionDate = target.session_date;
  }
  if (event.repeatable) invariant(sessionDate, 'VALIDATION_ERROR', 'Повторяемая активность требует даты сессии');
  return event.repeatable ? sessionDate! : 'once';
}

export async function startLearning(actor: SessionView, employeeId: string, rawRequest: StartLearningRequest): Promise<LearningAttempt> {
  scope(actor, employeeId);
  const request = startLearningSchema.parse(rawRequest);
  const course = courseById(request.module_id);
  return withTransaction(async client => {
    await lockDataset(client);
    const snapshot = await readSnapshotWithClient(client);
    employeeView(snapshot, employeeId); // Existence after access check, before any write.
    const occurrence = learningOccurrence(snapshot, employeeId, course, request.target);
    // Resume an existing attempt across authored content revisions. Its private
    // course snapshot keeps lesson IDs and grading stable after a content update.
    const existing = await client.query<AttemptRow>("SELECT * FROM learning_attempts WHERE employee_id=$1 AND event_id=$2 AND occurrence_key=$3 AND module_id=$4 ORDER BY (status='passed') DESC,created_at DESC LIMIT 1 FOR UPDATE", [employeeId, course.event_id, occurrence, course.id]);
    if (existing.rows[0]) return attemptView(existing.rows[0], snapshot);
    checkVersion(snapshot, employeeId, request.expected_version);
    assertCompletionAllowed(snapshot, employeeId, { ...request, simulation: true });
    const id = `LEARN_${randomUUID()}`;
    const { rows } = await client.query<AttemptRow>('INSERT INTO learning_attempts(id,employee_id,event_id,module_id,module_version,occurrence_key,target,course_snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) RETURNING *', [id, employeeId, course.event_id, course.id, course.version, occurrence, JSON.stringify(request.target), JSON.stringify(course), actor.account_id]);
    await audit(client, actor, 'learning.start', employeeId, { attempt_id: id, module_id: course.id, module_version: course.version, event_id: course.event_id });
    return attemptView(rows[0], snapshot);
  });
}
export async function getLearningAttempt(actor: SessionView, employeeId: string, attemptId: string): Promise<LearningAttempt> {
  scope(actor, employeeId);
  return withTransaction(async client => {
    const row = await findAttempt(client, employeeId, attemptId);
    const snapshot = await readSnapshotWithClient(client);
    return attemptView(row, snapshot);
  }, { readOnly: true });
}
export async function completeLesson(actor: SessionView, employeeId: string, attemptId: string, lessonId: string): Promise<LearningAttempt> {
  scope(actor, employeeId);
  completeLessonSchema.parse({ lesson_id: lessonId });
  return withTransaction(async client => {
    await lockDataset(client);
    const row = await findAttempt(client, employeeId, attemptId, true);
    const snapshot = await readSnapshotWithClient(client);
    invariant(row.course_snapshot.lessons.some(lesson => lesson.id === lessonId), 'VALIDATION_ERROR', 'Урок не относится к этому модулю');
    if (row.completed_lesson_ids.includes(lessonId)) return attemptView(row, snapshot);
    invariant(row.status !== 'passed', 'INVALID_PARTICIPATION_STATE', 'Учебный модуль уже завершён', 409);
    const next = row.course_snapshot.lessons[row.completed_lesson_ids.length];
    invariant(next?.id === lessonId, 'INVALID_PARTICIPATION_STATE', 'Сначала завершите предыдущий урок', 409);
    const ids = [...row.completed_lesson_ids, lessonId];
    const status = ids.length === row.course_snapshot.lessons.length ? 'ready_for_quiz' : 'learning';
    const { rows } = await client.query<AttemptRow>('UPDATE learning_attempts SET completed_lesson_ids=$2::jsonb,status=$3,updated_at=clock_timestamp() WHERE id=$1 RETURNING *', [attemptId, JSON.stringify(ids), status]);
    await audit(client, actor, 'learning.lesson', employeeId, { attempt_id: attemptId, lesson_id: lessonId });
    return attemptView(rows[0], snapshot);
  });
}

export function gradeQuiz(course: CourseDefinition, answers: Record<string, string>): { score: number; passed: boolean; feedback: LearningFeedback[] } {
  const ids = Object.keys(answers);
  invariant(ids.length === course.questions.length && course.questions.every(q => Object.hasOwn(answers, q.id)), 'VALIDATION_ERROR', 'Нужно ответить на каждый вопрос без лишних полей');
  const feedback = course.questions.map(question => {
    invariant(question.options.some(option => option.id === answers[question.id]), 'VALIDATION_ERROR', 'Выбран неизвестный вариант ответа');
    return { question_id: question.id, correct: answers[question.id] === question.correct_option_id, explanation: question.explanation };
  });
  const correct = feedback.filter(item => item.correct).length;
  // Passing is based on the exact count, never a rounded percentage supplied by a client.
  return { score: Math.round(correct / course.questions.length * 100), passed: correct === course.questions.length, feedback };
}
export async function submitQuiz(actor: SessionView, employeeId: string, attemptId: string, rawRequest: SubmitQuizRequest, key: string): Promise<{ result: SubmitQuizResult; replayed: boolean }> {
  scope(actor, employeeId); ensureKey(key);
  const request = submitQuizSchema.parse(rawRequest);
  const operation = 'learning.quiz';
  const hash = sourceHash({ operation, employee_id: employeeId, attempt_id: attemptId, body: request });
  return withTransaction(async client => {
    await lockDataset(client);
    const previous = await receipt<SubmitQuizResult>(client, actor, operation, key, hash);
    if (previous) return { result: previous, replayed: true };
    let row = await findAttempt(client, employeeId, attemptId, true);
    let snapshot = await readSnapshotWithClient(client);
    // A passed attempt is naturally idempotent even if the client lost its receipt key.
    if (row.status === 'passed') {
      const result: SubmitQuizResult = { attempt: attemptView(row, snapshot), feedback: row.last_feedback, completion: row.completion_result, previous_progress: row.previous_progress };
      await saveReceipt(client, actor, operation, key, hash, result);
      return { result, replayed: true };
    }
    checkVersion(snapshot, employeeId, request.expected_version);
    invariant(row.completed_lesson_ids.length === row.course_snapshot.lessons.length && row.status === 'ready_for_quiz', 'INVALID_PARTICIPATION_STATE', 'Сначала завершите все уроки', 409);
    const grading = gradeQuiz(row.course_snapshot, request.answers);
    const previousProgress = employeeView(snapshot, employeeId).progress;
    let completion: CompletionResult | null = null;
    let target = row.target;
    if (grading.passed) {
      // An import may create the canonical participation after these lessons began.
      // Reconcile only this occurrence; the canonical writer still checks eligibility,
      // existing completions and versions under the same metadata lock.
      if (target.kind === 'new_participation') {
        const event = snapshot.events.find(event => event.event_id === row.event_id)!;
        const participation = snapshot.history.find(item => item.employee_id === employeeId && item.event_id === row.event_id
          && item.status === 'in_progress' && (!event.repeatable || item.date === row.occurrence_key));
        if (participation) target = { kind: 'existing_participation', participation_id: participation.record_id };
      }
      const applied = await completeActivityInTransaction(client, actor, employeeId, { expected_version: request.expected_version, simulation: true, target }, `learning:${attemptId}`);
      completion = applied.result;
    }
    const { rows } = await client.query<AttemptRow>('UPDATE learning_attempts SET quiz_attempts=quiz_attempts+1,last_score=$2,last_answers=$3::jsonb,last_feedback=$4::jsonb,status=$5,completion_result=$6::jsonb,previous_progress=$7::jsonb,passed_at=CASE WHEN $8 THEN clock_timestamp() ELSE NULL END,target=$9::jsonb,updated_at=clock_timestamp() WHERE id=$1 RETURNING *', [attemptId, grading.score, JSON.stringify(request.answers), JSON.stringify(grading.feedback), grading.passed ? 'passed' : 'ready_for_quiz', completion ? JSON.stringify(completion) : null, previousProgress ? JSON.stringify(previousProgress) : null, grading.passed, JSON.stringify(target)]);
    row = rows[0];
    if (completion) snapshot = await readSnapshotWithClient(client);
    const result: SubmitQuizResult = { attempt: attemptView(row, snapshot), feedback: grading.feedback, completion, previous_progress: previousProgress };
    await saveReceipt(client, actor, operation, key, hash, result);
    await audit(client, actor, grading.passed ? 'learning.pass' : 'learning.quiz', employeeId, { attempt_id: attemptId, module_id: row.module_id, score: grading.score, passed: grading.passed });
    return { result, replayed: false };
  });
}
