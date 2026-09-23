import type { Id } from './backend';

/** Structural catalog limitations, not a judgment about an employee's performance. */
export type CatalogCoverageGapReason =
  | 'NO_VOLUNTARY_CATALOG_COVERAGE'
  | 'AUDIENCE_MISMATCH'
  | 'LEVEL_CAP_REACHED';

/** HR-only diagnostics for the supplied, authorized employee views. One row per skill/reason. */
export type HrCatalogCoverageGap = {
  skill_id: Id;
  reason: CatalogCoverageGapReason;
  employee_ids: Id[];
  employee_count: number;
  critical_employee_count: number;
  /** Voluntary catalog events with a positive declared effect on this skill. */
  related_event_ids: Id[];
  /** Subset matching at least one affected employee's current role/grade, or already actionable
   * participation. This is NOT eligibility: prerequisites, calendar, previous completions and
   * possible multi-step paths are not evaluated by this diagnostic. */
  audience_event_ids: Id[];
};
