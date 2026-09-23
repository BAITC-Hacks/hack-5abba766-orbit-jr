import type { CatalogCoverageGapReason, HrCatalogCoverageGap } from '../../../contracts/development-insights';
import type { DatasetSnapshot, EmployeeView, EventView } from '../types';

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

type Aggregate = {
  skill_id: string;
  reason: CatalogCoverageGapReason;
  employees: Set<string>;
  criticalEmployees: Set<string>;
  relatedEvents: Set<string>;
  audienceEvents: Set<string>;
};

/** Find structural catalog gaps using the already computed, authorized employee projections.
 * An omitted gap means only that a voluntary event could improve the skill at its current
 * level for this audience. It does not establish admission, a bookable session, or a complete
 * path to the target. Those remain the responsibility of the recommendation domain.
 * Existing actionable participation retains its original admission, as in getCandidates.
 */
export function buildCatalogCoverageGaps(
  snapshot: Pick<DatasetSnapshot, 'events'>,
  employees: readonly EmployeeView[],
): HrCatalogCoverageGap[] {
  const eventsBySkill = new Map<string, EventView[]>();
  for (const event of snapshot.events) {
    if (event.mandatory) continue;
    const developedSkills = new Set(event.develops_skills
      .filter(effect => effect.gain > 0 && effect.max_level > 0)
      .map(effect => effect.skill_id));
    for (const skillId of developedSkills) {
      const events = eventsBySkill.get(skillId) ?? [];
      events.push(event);
      eventsBySkill.set(skillId, events);
    }
  }

  const aggregates = new Map<string, Aggregate>();
  for (const employee of employees) {
    if (!employee.goal.target) continue;
    const continuingEvents = new Set(employee.history
      .filter(participation => participation.actionable)
      .map(participation => participation.event_id));
    for (const skill of employee.skills) {
      if (skill.required_level === null || skill.required_level <= skill.current_level || (skill.gap ?? 0) <= 0) continue;
      const related = eventsBySkill.get(skill.skill_id) ?? [];
      const audience = related.filter(event => continuingEvents.has(event.event_id) ||
        (event.target_roles.includes(employee.role) && event.target_grades.includes(employee.grade)));
      if (audience.some(event => event.develops_skills.some(effect =>
        effect.skill_id === skill.skill_id && effect.gain > 0 &&
        Math.min(effect.max_level, 5) > skill.current_level))) continue;

      const reason: CatalogCoverageGapReason = related.length === 0
        ? 'NO_VOLUNTARY_CATALOG_COVERAGE'
        : audience.length === 0 ? 'AUDIENCE_MISMATCH' : 'LEVEL_CAP_REACHED';
      const key = JSON.stringify([skill.skill_id, reason]);
      const aggregate = aggregates.get(key) ?? {
        skill_id: skill.skill_id, reason, employees: new Set<string>(), criticalEmployees: new Set<string>(),
        relatedEvents: new Set<string>(), audienceEvents: new Set<string>(),
      };
      aggregate.employees.add(employee.employee_id);
      if (skill.critical) aggregate.criticalEmployees.add(employee.employee_id);
      for (const event of related) aggregate.relatedEvents.add(event.event_id);
      for (const event of audience) aggregate.audienceEvents.add(event.event_id);
      aggregates.set(key, aggregate);
    }
  }

  return [...aggregates.values()].map(row => ({
    skill_id: row.skill_id, reason: row.reason,
    employee_ids: [...row.employees].sort(compareText), employee_count: row.employees.size,
    critical_employee_count: row.criticalEmployees.size,
    related_event_ids: [...row.relatedEvents].sort(compareText),
    audience_event_ids: [...row.audienceEvents].sort(compareText),
  })).sort((a, b) => b.critical_employee_count - a.critical_employee_count ||
    b.employee_count - a.employee_count || compareText(a.skill_id, b.skill_id) || compareText(a.reason, b.reason));
}
