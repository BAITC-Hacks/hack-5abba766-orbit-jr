import { z } from 'zod'

/**
 * Contract for the AI zone (`server/ai`).
 *
 * The backend computes every number; the model only chooses an order and cites
 * facts by id. Nothing the model writes is rendered as a fact - see validate.ts.
 */

/** Why a candidate is worth doing. The model may only cite these, never invent them. */
export const FactCategory = z.enum([
  'skill_gain', // raises a skill the target role needs
  'target_gap', // directly closes a gap against the target role/grade
  'critical_skill', // touches a skill marked critical for the target
  'prerequisite_unlock', // opens access to an activity that closes a gap
  'duration', // time cost
  'participation', // colleagues from the same role/grade attended
  'feedback', // rating from past attendees
])
export type FactCategory = z.infer<typeof FactCategory>

export const CandidateFact = z.object({
  /** Stable id, unique within one candidate. Cited by the model. */
  id: z.string().min(1),
  category: FactCategory,
  /** Human-readable text built server-side. Safe to render. */
  text: z.string().min(1),
})
export type CandidateFact = z.infer<typeof CandidateFact>

export const SkillDelta = z.object({
  skill_id: z.string().min(1),
  from: z.number().int().min(0).max(5),
  to: z.number().int().min(0).max(5),
  /** True when this skill is part of the gap against the target role/grade. */
  closes_gap: z.boolean(),
  critical: z.boolean(),
})
export type SkillDelta = z.infer<typeof SkillDelta>

export const Candidate = z.object({
  event_id: z.string().min(1),
  title: z.string().min(1),
  /** 'continue' when the employee already started it - never re-enroll. */
  action: z.enum(['start', 'continue']),
  duration_hours: z.number().nonnegative(),
  /** Precomputed by the domain layer with the effective_gain formula. */
  expected_changes: z.array(SkillDelta),
  facts: z.array(CandidateFact).min(1),
  /** Average rating of past attendees, when the dataset has one. */
  rating: z.number().min(0).max(5).nullable(),
  /** How many colleagues of the same role/grade attended. */
  peer_count: z.number().int().nonnegative(),
  /** True when the only value is opening access to another activity. */
  is_preparatory: z.boolean(),
})
export type Candidate = z.infer<typeof Candidate>

export const EmployeeBrief = z.object({
  employee_id: z.string().min(1),
  role: z.string().min(1),
  grade: z.string().min(1),
  target_role: z.string().min(1),
  target_grade: z.string().min(1),
  goal_source: z.enum(['chosen', 'suggested']),
  /** Skill ids still below the target requirement. */
  gap_skill_ids: z.array(z.string()),
  critical_skill_ids: z.array(z.string()),
})
export type EmployeeBrief = z.infer<typeof EmployeeBrief>

export const RecommendationInput = z.object({
  employee: EmployeeBrief,
  candidates: z.array(Candidate),
  /** Echoed back so the UI can discard a stale result. */
  state_version: z.number().int().nonnegative(),
})
export type RecommendationInput = z.infer<typeof RecommendationInput>

/**
 * Exactly what the model is allowed to return. Anything else is a validation
 * failure and drops the request to the deterministic ranker.
 */
export const ModelRanking = z.object({
  ranked: z
    .array(
      z.object({
        event_id: z.string().min(1),
        fact_ids: z.array(z.string().min(1)).min(1),
        /** Another candidate this one was preferred over. Optional. */
        compared_to_event_id: z.string().min(1).nullable(),
        /** Free text. NEVER rendered as a fact; capped and stripped. */
        note: z.string().max(200).nullable(),
      }),
    )
    .min(1)
    .max(3),
})
export type ModelRanking = z.infer<typeof ModelRanking>

export const RecommendationCard = z.object({
  event_id: z.string(),
  title: z.string(),
  action: z.enum(['start', 'continue']),
  duration_hours: z.number(),
  /** Server-owned facts, resolved from the ids the model cited. */
  factors: z.array(CandidateFact),
  expected_changes: z.array(SkillDelta),
  compared_to_event_id: z.string().nullable(),
  note: z.string().nullable(),
})
export type RecommendationCard = z.infer<typeof RecommendationCard>

export const RecommendationResult = z.object({
  mode: z.enum(['ai', 'rules_fallback']),
  state_version: z.number().int().nonnegative(),
  cards: z.array(RecommendationCard),
  /** Set when cards is empty, or when the AI path was abandoned. */
  reason: z.string().nullable(),
  /** Observability: how long the model call took, and why it was rejected. */
  diagnostics: z.object({
    llm_ms: z.number().nullable(),
    rejection: z.string().nullable(),
  }),
})
export type RecommendationResult = z.infer<typeof RecommendationResult>
