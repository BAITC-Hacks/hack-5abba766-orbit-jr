import type { CompletionRequest, CompletionResult, DomainVersion, GoalProgress, Id, UtcTimestamp } from './backend';

export type LessonBlock =
  | { type: 'paragraph' | 'callout'; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'bullets'; items: string[] };
export type LearningLesson = { id: Id; title: string; blocks: LessonBlock[] };
export type LearningQuestion = { id: Id; prompt: string; options: { id: Id; text: string }[] };
export type LearningModuleSummary = {
  id: Id; event_id: Id; title: string; summary: string; estimated_minutes: number; version: number;
  lesson_count: number; question_count: number; passing_score: 100; is_demo: true;
};
/** Public content intentionally excludes answer keys and grading explanations. */
export type LearningModuleView = LearningModuleSummary & {
  lessons: LearningLesson[]; questions: LearningQuestion[]; sources: { title: string; url: string }[];
};
export type LearningAttempt = {
  id: Id; employee_id: Id; module_id: Id; module_version: number; event_id: Id;
  target: CompletionRequest['target']; status: 'learning' | 'ready_for_quiz' | 'passed';
  completed_lesson_ids: Id[]; lesson_count: number; quiz_attempts: number; last_score: number | null;
  started_at: UtcTimestamp; updated_at: UtcTimestamp; passed_at: UtcTimestamp | null;
  employee_version: DomainVersion;
  /** Exact public content of this attempt, retained when authored content is versioned. */
  module: LearningModuleView;
  /** Original completion result; a later profile fetch may have a newer version.
   * When status is passed and this is null, this occurrence was completed elsewhere:
   * the quiz is saved without awarding its effect again. */
  completion: CompletionResult | null;
  previous_progress: GoalProgress | null;
};
export type StartLearningRequest = { module_id: Id; target: CompletionRequest['target']; expected_version: DomainVersion };
export type CompleteLessonRequest = { lesson_id: Id };
export type SubmitQuizRequest = { answers: Record<Id, Id>; expected_version: DomainVersion };
export type LearningFeedback = { question_id: Id; correct: boolean; explanation: string };
export type SubmitQuizResult = {
  attempt: LearningAttempt; feedback: LearningFeedback[]; completion: CompletionResult | null;
  previous_progress: GoalProgress | null;
};
