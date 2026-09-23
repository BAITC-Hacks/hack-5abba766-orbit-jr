import type { CareerGoal, EmployeeSource, EventView, ParticipationSource, RoleProfile, SkillDefinition, CatalogView } from '../../contracts/backend';
export type * from '../../contracts/backend';

export type RuntimeCompletion = {
  id: string; employee_id: string; event_id: string; participation_id: string | null;
  session_date: string | null; occurrence_key: string; applied_as_of: string;
  recorded_at: string; sequence: number;
};
export type DatasetSnapshot = {
  as_of_date: string; dataset_revision: number; global_revision: number;
  employees: EmployeeSource[]; employee_revisions: Record<string, number>;
  skills: SkillDefinition[]; role_profiles: RoleProfile[]; events: EventView[];
  history: ParticipationSource[]; completions: RuntimeCompletion[];
  goals: Record<string, CareerGoal | null>;
  proficiency_scale: CatalogView['proficiency_scale'];
};
