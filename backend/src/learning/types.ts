import type { LearningLesson, LearningQuestion } from '../../../contracts/learning';
export type * from '../../../contracts/learning';
/** Server-only authored content. Answer keys never enter public module DTOs. */
export type CourseDefinition = {
  id: string; event_id: string; title: string; summary: string; estimated_minutes: number; version: number;
  lessons: LearningLesson[];
  questions: (LearningQuestion & { correct_option_id: string; explanation: string })[];
  passing_score: 100;
  sources: { title: string; url: string }[];
};
