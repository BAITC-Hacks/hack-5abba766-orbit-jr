/** Shared design contract; declarations only. Runtime validation belongs in Zod schemas. */
import type { HrCatalogCoverageGap } from './development-insights';
export type Id = string; // Nonempty; never restrict judge IDs to the original dataset range.
export type DateOnly = string; // Valid YYYY-MM-DD, not an arbitrary string at runtime.
export type UtcTimestamp = string; // ISO 8601 UTC timestamp.
export type Grade = 'Junior' | 'Middle' | 'Senior' | 'Lead';
export type Language = 'kk' | 'ru' | 'en';
export type SkillLevels = Record<Id, number>; // Finite levels in [0, 5]; absent skill = 0.
export type DomainVersion = { dataset_revision: number; employee_revision: number };
export type RequestMeta = {
  request_id: string;
  as_of_date: DateOnly | null; // null only before dataset initialization, e.g. health 503.
  replayed?: boolean; // Receipt replay; business payload retains its original version.
};
export type ApiResponse<T> = { data: T; meta: RequestMeta };
export type ErrorCode =
  | 'INVALID_REQUEST' | 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN'
  | 'NOT_FOUND' | 'NOT_READY' | 'PAYLOAD_TOO_LARGE' | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT' | 'IMPORT_CONFLICT' | 'ALREADY_COMPLETED'
  | 'SESSION_ALREADY_COMPLETED' | 'USE_EXISTING_PARTICIPATION'
  | 'INVALID_PARTICIPATION_STATE' | 'INELIGIBLE_EVENT' | 'STALE_RECOMMENDATION'
  | 'RECOMMENDATION_IN_PROGRESS' | 'RECOMMENDATION_BUSY' | 'STORAGE_BUSY' | 'INTERNAL_ERROR';
export type ApiError = {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
  request_id: string;
};
/** Required for completion and committing imports. Replay check precedes version check.
 * Receipt request hash includes operation, URL target employee and normalized body. */
export type MutationHeaders = { 'Idempotency-Key': string };
export type LoginRequest = { username: string; password: string };
export type SessionView = {
  account_id: Id; role: 'employee' | 'hr'; employee_id: Id | null; display_name: string;
};
export type HealthView = {
  status: 'ok' | 'not_ready'; dataset_initialized: boolean;
  schema_version: string | null;
  ai_configured: boolean; // Configuration presence, not a provider connectivity check.
};
export type CareerGoal = { target_role: string; target_grade: Grade };
export type GoalSource = 'imported' | 'selected' | 'suggested' | 'missing';
export type ResolvedGoal =
  | { source: 'missing'; target: null }
  | { source: Exclude<GoalSource, 'missing'>; target: CareerGoal };
export type GoalRequest = { expected_version: DomainVersion; career_goal: CareerGoal | null };
export type ParticipationStatus =
  | 'completed' | 'in_progress' | 'dropped' | 'no_show' | 'declined' | 'overdue';

/** Normalized imported values remain immutable; goal/progress edits are separate overlays. */
export type EmployeeSource = {
  employee_id: Id;
  full_name: string;
  department: string;
  role: string;
  grade: Grade;
  manager_id: Id | null;
  hire_date: DateOnly;
  tenure_months: number;
  work_format: 'office' | 'hybrid' | 'remote';
  preferred_language: Language;
  career_goal: CareerGoal | null;
  skills: SkillLevels;
  last_review_date: DateOnly;
};
/** CSV empty numeric/date cells normalize to null before hashing or validation. */
export type ParticipationSource = {
  record_id: Id;
  employee_id: Id;
  event_id: Id;
  date: DateOnly;
  due_date: DateOnly | null;
  status: ParticipationStatus;
  completion_pct: number;
  score: number | null;
  feedback_rating: number | null;
  assigned_by: 'self' | 'manager' | 'hr';
};
export type SkillDefinition = {
  skill_id: Id; name: string; type: 'hard' | 'soft'; category: string; description: string;
};
export type RoleProfile = {
  role: string; grade: Grade; required_skills: SkillLevels; critical_skills: Id[];
};
export type EventView = {
  event_id: Id;
  title: string;
  description: string;
  type: 'compliance' | 'onboarding' | 'course' | 'workshop' | 'mentoring' | 'certification' | 'meetup';
  format: 'online' | 'offline' | 'self_paced';
  duration_hours: number;
  mandatory: boolean;
  target_roles: string[];
  target_grades: Grade[];
  prerequisites: SkillLevels;
  develops_skills: { skill_id: Id; gain: number; max_level: number }[];
  upcoming_sessions: DateOnly[];
  repeatable: boolean; // Derived from the documented EV_036 policy, not invented by the LLM.
};
export type CatalogView = {
  dataset_revision: number; skills: SkillDefinition[]; role_profiles: RoleProfile[];
  events: EventView[]; grades: Grade[];
  proficiency_scale: Record<'0' | '1' | '2' | '3' | '4' | '5', string>;
};
export type SkillView = {
  skill_id: Id; baseline_level: number; current_level: number;
  required_level: number | null; gap: number | null; critical: boolean;
};
export type SkillChange = { skill_id: Id; before: number; after: number; gain: number };
export type GoalProgress = {
  /** Sum min(current, required) / sum required; [0, 1]. Goal absence => progress=null. */
  coverage: number;
  gap_points: number;
  missing_critical_skill_ids: Id[];
};
export type ParticipationView = {
  participation_id: Id;
  event_id: Id;
  event_title: string;
  source_status: ParticipationStatus | null; // null for a new local simulation.
  effective_status: ParticipationStatus;
  completion_pct: number;
  scheduled_session_date: DateOnly | null;
  source_date: DateOnly | null;
  completion_origin: 'imported' | 'simulation' | null;
  applied_as_of: DateOnly | null;
  recorded_at: UtcTimestamp | null;
  actionable: boolean;
  /** Completing another attempt covered this nonrepeatable event; no additional credit. */
  superseded_by: Id | null;
};
export type EmployeeView = {
  version: DomainVersion;
  employee_id: Id;
  full_name: string;
  department: string;
  role: string;
  grade: Grade;
  work_format: EmployeeSource['work_format'];
  tenure_months: number;
  preferred_language: Language;
  last_review_date: DateOnly;
  goal: ResolvedGoal;
  progress: GoalProgress | null;
  skills: SkillView[];
  history: ParticipationView[];
  has_simulated_progress: boolean;
};
export type EmployeeDirectory = {
  items: Pick<EmployeeView, 'employee_id' | 'full_name' | 'department' | 'role' | 'grade'>[];
  total: number;
};
/** Query parameters, not a JSON GET body. Default limit=50, maximum=200. */
export type EmployeeDirectoryQuery = {
  q?: string; department?: string; role?: string; grade?: Grade;
  offset?: number; limit?: number;
};

export type FactCategory =
  | 'grade' | 'skill_gap' | 'history' | 'target_requirement' | 'eligibility' | 'effort';
/** Text is generated from verified backend values, never accepted from model output. */
export type RecommendationFact = { fact_id: Id; category: FactCategory; text: string };
export type Candidate = {
  candidate_id: Id; // Unique within the versioned candidate snapshot.
  event_id: Id;
  title: string;
  event_type: EventView['type'];
  format: EventView['format'];
  duration_hours: number;
  action: 'start' | 'continue';
  participation_id: Id | null; // Required for continue; null for start.
  session_date: DateOnly | null; // null for self-paced; continue may retain a past date.
  relevance: 'direct' | 'prerequisite' | 'general';
  /** Each card is an alternative next step from the same version; do not add card gains. */
  expected_skill_changes: SkillChange[];
  goal_coverage_delta: number; // Difference of [0, 1] coverage values, not percentage points.
  unlocks_event_ids: Id[];
  facts: RecommendationFact[];
};
export type RecommendationRequest = { expected_version: DomainVersion; limit?: 1 | 2 | 3 };
export type EmptyReason =
  | 'GOAL_REQUIRED' | 'GOAL_REACHED' | 'NO_ELIGIBLE_EVENTS'
  | 'NO_BENEFICIAL_EVENTS' | 'NO_GOAL_RELEVANT_EVENTS';
export type FallbackReason =
  | 'missing_api_key' | 'provider_timeout' | 'provider_error' | 'invalid_response';
export type RecommendationCard = Candidate & {
  rank: number;
  reason_fact_ids: Id[];
  alternative_candidate_id: Id | null;
  /** Validated server-rendered comparison with an unselected candidate, if supplied. */
  alternative: { candidate_id: Id; event_id: Id; title: string; facts: RecommendationFact[] } | null;
};
/** Nonempty arrays below are constrained to 1..limit by runtime validation. */
export type RecommendationResult = { version: DomainVersion } & (
  | { mode: 'ai'; fallback_reason: null; recommendations: RecommendationCard[]; empty_reason: null }
  | { mode: 'rules_fallback'; fallback_reason: FallbackReason;
      recommendations: RecommendationCard[]; empty_reason: null }
  /** Evaluate after one-step prerequisite search; no provider was called. */
  | { mode: 'no_candidates'; fallback_reason: null; recommendations: []; empty_reason: EmptyReason }
);
/** No names, manager details, free-form source descriptions, or other employees' records. */
export type AiRankingInput = {
  version: DomainVersion;
  as_of_date: DateOnly;
  limit: 1 | 2 | 3;
  profile: Pick<EmployeeView, 'role' | 'grade' | 'work_format' | 'tenure_months'
    | 'preferred_language' | 'goal' | 'progress' | 'skills'>;
  candidates: Candidate[];
};
/** 1..min(limit,candidate count) unique choices. Never call the model for an empty set.
 * Fact IDs must belong to that candidate and cover >=3 of grade/skill_gap/history/
 * target_requirement. Alternative must be a different eligible candidate in this snapshot.
 * Validate semantically; no invented levels, gains or unverifiable model prose is accepted. */
export type AiRankingOutput = {
  choices: { candidate_id: Id; reason_fact_ids: Id[]; alternative_candidate_id?: Id }[];
};

export type CompletionRequest = {
  expected_version: DomainVersion;
  simulation: true;
  target:
    | { kind: 'existing_participation'; participation_id: Id }
    | { kind: 'new_participation'; event_id: Id; session_date: DateOnly | null };
};
export type CompletionResult = {
  version: DomainVersion;
  participation_id: Id;
  completion_origin: 'simulation';
  scheduled_session_date: DateOnly | null;
  applied_as_of: DateOnly; // Fixed scenario day; causally after the employee baseline.
  recorded_at: UtcTimestamp; // Real wall clock; not a claim of real attendance.
  skill_changes: SkillChange[];
  employee: EmployeeView;
};
export type GoalResult = { version: DomainVersion; employee: EmployeeView; changed: boolean };

export type HrSkillGap = {
  skill_id: Id;
  goal_source: GoalSource;
  employees_with_gap: number;
  denominator: number; // Employees of this goal source whose target requires this skill.
  total_gap_points: number;
};
export type HrOverview = {
  global_revision: number; // Increments on every changing domain transaction, incl. imports.
  employee_count: number;
  goals_by_source: Record<GoalSource, number>;
  skill_gaps: HrSkillGap[];
  /** HR-only structural catalog limitations; not a measure of employee performance. */
  catalog_gaps: HrCatalogCoverageGap[];
  no_next_step: {
    employee_id: Id; full_name: string; goal_source: GoalSource; reason: EmptyReason;
  }[];
  participation: {
    /** Source observations and hypothetical completions stay separate; never add blindly. */
    actual_by_status: Record<ParticipationStatus, number>;
    simulated_completions: number;
    /** Excludes superseded attempts, which remain visible in source history. */
    effective_by_status: Record<ParticipationStatus, number>;
    superseded_attempts: number;
    by_activity: {
      event_id: Id; title: string;
      actual_by_status: Record<ParticipationStatus, number>;
      simulated_completions: number;
      effective_by_status: Record<ParticipationStatus, number>;
      superseded_attempts: number;
    }[];
  };
};

/** Internal command parsed from multipart, <=20 MiB total, at least one nonempty file.
 * New IDs insert, identical immutable source records skip, changed duplicate IDs conflict.
 * Validate references and completion collisions against existing+batch+simulation rows.
 * Employee file metadata must match the active as_of_date. Commit the batch atomically. */
export type ImportCommand = {
  expected_dataset_revision: number;
  dry_run: boolean;
  employees?: EmployeeSource[];
  history?: ParticipationSource[];
};
/** Actual employees JSON wire file; history is a CSV with ParticipationSource columns. */
export type EmployeeImportFile = {
  meta: { dataset: string; version: string; as_of_date: DateOnly };
  employees: EmployeeSource[];
};
export type ImportIssue = {
  file: 'employees' | 'history'; row?: number; record_id?: Id;
  field?: string; code: string; message: string;
};
export type ImportCounts = {
  employees: { new_rows: number; identical_rows: number };
  history: { new_rows: number; identical_rows: number };
};
export type ImportResult = {
  dry_run: boolean;
  applied: boolean; // false for preview or an identical no-op batch.
  dataset_revision: number;
  global_revision: number;
  counts: ImportCounts;
  errors: ImportIssue[]; // Preview may report errors; a commit with errors returns ApiError.
  warnings: ImportIssue[];
};

/** Responses below are successful payloads; every route may also return ApiError. */
export type Endpoint<Request, Response> = { request: Request; response: ApiResponse<Response> };
export type BackendApi = {
  'GET /api/health': Endpoint<null, HealthView>;
  'POST /api/auth/login': Endpoint<LoginRequest, SessionView>;
  'GET /api/auth/session': Endpoint<null, SessionView>;
  'POST /api/auth/logout': Endpoint<null, { logged_out: true }>;
  'GET /api/catalog': Endpoint<null, CatalogView>;
  'GET /api/employees': Endpoint<EmployeeDirectoryQuery, EmployeeDirectory>;
  'GET /api/employees/:id': Endpoint<null, EmployeeView>;
  'PUT /api/employees/:id/goal': Endpoint<GoalRequest, GoalResult>;
  'POST /api/employees/:id/recommendations': Endpoint<RecommendationRequest, RecommendationResult>;
  'POST /api/employees/:id/completions': Endpoint<CompletionRequest, CompletionResult>;
  'GET /api/hr/overview': Endpoint<null, HrOverview>;
  'POST /api/import': Endpoint<ImportCommand, ImportResult>; // Wire request is multipart.
};
