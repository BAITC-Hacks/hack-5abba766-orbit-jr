import { rankBaseline, type BaselineSignals } from './baseline';
import { buildBaselineSignals, latestTerminalHistoryByEvent } from './baseline-signals';
import { historyEvidenceText, summarizeHistoryEvidence } from './history-evidence';
import { buildCatalogCoverageGaps } from './catalog-coverage';
import { AppError, invariant } from '../errors';
import type {
  Candidate, CatalogView, CompletionRequest, DatasetSnapshot, EmployeeSource,
  EmployeeView, EmptyReason, EventView, GoalProgress, Grade, HrOverview,
  ParticipationSource, ParticipationStatus, ParticipationView, ResolvedGoal,
  RoleProfile, RuntimeCompletion, SkillChange, SkillLevels,
} from '../types';

export const GRADES: Grade[] = ['Junior', 'Middle', 'Senior', 'Lead'];
const STATUSES: ParticipationStatus[] = ['completed', 'in_progress', 'dropped', 'no_show', 'declined', 'overdue'];
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const byDateAndId = (a: ParticipationSource, b: ParticipationSource) => compareText(a.date, b.date) || compareText(a.record_id, b.record_id);

function sourceEmployee(snapshot: DatasetSnapshot, employeeId: string): EmployeeSource {
  const employee = snapshot.employees.find(item => item.employee_id === employeeId);
  invariant(employee, 'NOT_FOUND', 'Сотрудник не найден.', 404);
  return employee!;
}

function resolveGoal(snapshot: DatasetSnapshot, employee: EmployeeSource): ResolvedGoal {
  const overridden = Object.prototype.hasOwnProperty.call(snapshot.goals, employee.employee_id);
  const explicit = overridden ? snapshot.goals[employee.employee_id] : employee.career_goal;
  if (explicit) return { source: overridden ? 'selected' : 'imported', target: { ...explicit } };
  const grade = GRADES[GRADES.indexOf(employee.grade) + 1];
  if (grade && snapshot.role_profiles.some(profile => profile.role === employee.role && profile.grade === grade)) {
    return { source: 'suggested', target: { target_role: employee.role, target_grade: grade } };
  }
  return { source: 'missing', target: null };
}

function targetProfile(snapshot: DatasetSnapshot, goal: ResolvedGoal): RoleProfile | null {
  if (!goal.target) return null;
  return snapshot.role_profiles.find(profile => profile.role === goal.target!.target_role && profile.grade === goal.target!.target_grade) ?? null;
}

// Sparse skill maps may use valid IDs such as "toString"; inherited members are not levels.
const skillLevel = (levels: SkillLevels, skillId: string): number => Object.hasOwn(levels, skillId) ? levels[skillId] : 0;

/** Source skills are an assessed baseline, not a zero-point for replaying all history. */
function applyEvent(levels: SkillLevels, event: EventView): SkillLevels {
  const result = { ...levels };
  for (const effect of event.develops_skills) {
    const before = skillLevel(result, effect.skill_id);
    result[effect.skill_id] = before + Math.max(0, Math.min(effect.gain, effect.max_level - before, 5 - before));
  }
  return result;
}

function projectSkills(snapshot: DatasetSnapshot, employee: EmployeeSource, history: ParticipationSource[], completions: RuntimeCompletion[]): SkillLevels {
  const events = new Map(snapshot.events.map(event => [event.event_id, event]));
  let levels = { ...employee.skills };
  const afterReview = history.filter(row => row.status === 'completed' && row.date > employee.last_review_date && row.date <= snapshot.as_of_date).sort(byDateAndId);
  for (const row of afterReview) {
    const event = events.get(row.event_id);
    if (event) levels = applyEvent(levels, event);
  }
  // An in_progress source row with a completion overlay must only enter this stage.
  for (const completion of [...completions].sort((a, b) => a.sequence - b.sequence || compareText(a.id, b.id))) {
    const event = events.get(completion.event_id);
    if (event) levels = applyEvent(levels, event);
  }
  return levels;
}

function progressFor(levels: SkillLevels, profile: RoleProfile | null): GoalProgress | null {
  if (!profile) return null;
  let required = 0;
  let covered = 0;
  const missingCritical: string[] = [];
  for (const [skillId, minimum] of Object.entries(profile.required_skills)) {
    if (minimum <= 0) continue;
    required += minimum;
    const current = skillLevel(levels, skillId);
    covered += Math.min(current, minimum);
    if (current < minimum && profile.critical_skills.includes(skillId)) missingCritical.push(skillId);
  }
  return { coverage: required ? covered / required : 1, gap_points: required - covered, missing_critical_skill_ids: missingCritical.sort(compareText) };
}

const occurrenceKey = (event: EventView, sessionDate: string | null) => event.repeatable ? sessionDate! : 'once';
const sameOccurrence = (event: EventView, date: string, sessionDate: string | null) => !event.repeatable || date === sessionDate;

/** A source completion is just as final as a local overlay, even when already in baseline. */
function completedOccurrence(event: EventView, sessionDate: string | null, history: ParticipationSource[], completions: RuntimeCompletion[]): string | null {
  const completed = history.filter(row => row.event_id === event.event_id && row.status === 'completed' && sameOccurrence(event, row.date, sessionDate)).sort(byDateAndId).at(-1);
  if (completed) return completed.record_id;
  const overlay = completions.find(row => row.event_id === event.event_id && row.occurrence_key === occurrenceKey(event, sessionDate));
  return overlay ? overlay.participation_id ?? overlay.id : null;
}

function levelChanges(before: SkillLevels, after: SkillLevels): SkillChange[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(compareText).flatMap(skillId => {
    const from = skillLevel(before, skillId);
    const to = skillLevel(after, skillId);
    return from === to ? [] : [{ skill_id: skillId, before: from, after: to, gain: to - from }];
  });
}

function employeeHistory(snapshot: DatasetSnapshot, history: ParticipationSource[], completions: RuntimeCompletion[], levels: SkillLevels): ParticipationView[] {
  const events = new Map(snapshot.events.map(event => [event.event_id, event]));
  const overlays = new Map(completions.filter(row => row.participation_id !== null).map(row => [row.participation_id!, row]));
  const views: ParticipationView[] = history.map(row => {
    const event = events.get(row.event_id)!;
    const overlay = overlays.get(row.record_id);
    const session = event.format === 'self_paced' ? null : row.date;
    const completedBy = completedOccurrence(event, session, history, completions);
    // Mandatory assignments can recur; an earlier completion does not discharge a new assignment.
    const supersededBy = !event.mandatory && row.status === 'in_progress' && !overlay && completedBy && completedBy !== row.record_id ? completedBy : null;
    const actionable = row.status === 'in_progress' && !overlay && !supersededBy && !event.mandatory && levelChanges(levels, applyEvent(levels, event)).length > 0;
    return {
      participation_id: row.record_id, event_id: row.event_id, event_title: event.title,
      source_status: row.status, effective_status: overlay ? 'completed' : row.status,
      completion_pct: overlay ? 100 : row.completion_pct,
      scheduled_session_date: session, source_date: row.date,
      completion_origin: overlay ? 'simulation' : row.status === 'completed' ? 'imported' : null,
      applied_as_of: overlay?.applied_as_of ?? (row.status === 'completed' ? row.date : null),
      recorded_at: overlay?.recorded_at ?? null, actionable, superseded_by: supersededBy,
    };
  });
  for (const row of completions.filter(completion => completion.participation_id === null)) {
    views.push({
      participation_id: row.id, event_id: row.event_id, event_title: events.get(row.event_id)!.title,
      source_status: null, effective_status: 'completed', completion_pct: 100,
      scheduled_session_date: row.session_date, source_date: null, completion_origin: 'simulation',
      applied_as_of: row.applied_as_of, recorded_at: row.recorded_at, actionable: false, superseded_by: null,
    });
  }
  return views.sort((a, b) => compareText(b.recorded_at ?? b.source_date ?? '', a.recorded_at ?? a.source_date ?? '') || compareText(b.participation_id, a.participation_id));
}

export function employeeView(snapshot: DatasetSnapshot, employeeId: string): EmployeeView {
  const employee = sourceEmployee(snapshot, employeeId);
  const history = snapshot.history.filter(row => row.employee_id === employeeId);
  const completions = snapshot.completions.filter(row => row.employee_id === employeeId);
  const levels = projectSkills(snapshot, employee, history, completions);
  const goal = resolveGoal(snapshot, employee);
  const profile = targetProfile(snapshot, goal);
  const skillIds = new Set([...snapshot.skills.map(skill => skill.skill_id), ...Object.keys(levels), ...Object.keys(profile?.required_skills ?? {})]);
  return {
    version: { dataset_revision: snapshot.dataset_revision, employee_revision: snapshot.employee_revisions[employeeId] ?? 0 },
    employee_id: employeeId, full_name: employee.full_name, department: employee.department,
    role: employee.role, grade: employee.grade, work_format: employee.work_format,
    tenure_months: employee.tenure_months, preferred_language: employee.preferred_language,
    last_review_date: employee.last_review_date, goal, progress: progressFor(levels, profile),
    skills: [...skillIds].sort(compareText).map(skillId => {
      const required = profile && Object.hasOwn(profile.required_skills, skillId) ? profile.required_skills[skillId] : null;
      const current = skillLevel(levels, skillId);
      return { skill_id: skillId, baseline_level: skillLevel(employee.skills, skillId), current_level: current,
        required_level: required, gap: required === null ? null : Math.max(0, required - current),
        critical: profile?.critical_skills.includes(skillId) ?? false };
    }),
    history: employeeHistory(snapshot, history, completions, levels), has_simulated_progress: completions.length > 0,
  };
}

const levelsFrom = (employee: EmployeeView): SkillLevels => Object.fromEntries(employee.skills.map(skill => [skill.skill_id, skill.current_level]));
const meetsPrerequisites = (event: EventView, levels: SkillLevels) => Object.entries(event.prerequisites).every(([skill, minimum]) => skillLevel(levels, skill) >= minimum);
const matchesAudience = (event: EventView, employee: EmployeeView) => event.target_roles.includes(employee.role) && event.target_grades.includes(employee.grade);

type AvailableAction = { event: EventView; action: 'start' | 'continue'; participation: ParticipationSource | null; session: string | null };

function activeAttempts(event: EventView, history: ParticipationSource[], completions: RuntimeCompletion[]): ParticipationSource[] {
  return history.filter(row => row.event_id === event.event_id && row.status === 'in_progress' && !completedOccurrence(event, event.format === 'self_paced' ? null : row.date, history, completions)).sort(byDateAndId);
}

function availableActions(snapshot: DatasetSnapshot, employee: EmployeeView, levels: SkillLevels): AvailableAction[] {
  const history = snapshot.history.filter(row => row.employee_id === employee.employee_id);
  const completions = snapshot.completions.filter(row => row.employee_id === employee.employee_id);
  const result: AvailableAction[] = [];
  for (const event of snapshot.events) {
    if (event.mandatory) continue;
    const active = activeAttempts(event, history, completions).at(-1);
    if (active) {
      // Enrollment was valid when it occurred. Do not reapply current grade or schedule.
      result.push({ event, action: 'continue', participation: active, session: event.format === 'self_paced' ? null : active.date });
      continue;
    }
    if (!matchesAudience(event, employee) || !meetsPrerequisites(event, levels)) continue;
    if (event.format === 'self_paced') {
      if (!completedOccurrence(event, null, history, completions)) result.push({ event, action: 'start', participation: null, session: null });
    } else {
      const session = [...event.upcoming_sessions].sort(compareText).find(date => date >= snapshot.as_of_date && !completedOccurrence(event, date, history, completions));
      if (session) result.push({ event, action: 'start', participation: null, session });
    }
  }
  return result;
}

function weightedGain(before: SkillLevels, after: SkillLevels, profile: RoleProfile): number {
  return Object.entries(profile.required_skills).reduce((sum, [skill, minimum]) => {
    const closedGap = Math.max(0, Math.min(skillLevel(after, skill), minimum) - Math.min(skillLevel(before, skill), minimum));
    return sum + closedGap * (profile.critical_skills.includes(skill) ? 2 : 1);
  }, 0);
}

type UnlockedActivity = { event: EventView; weighted_gain: number; expected_skill_changes: SkillChange[] };

function findUnlocked(snapshot: DatasetSnapshot, employee: EmployeeView, action: AvailableAction, before: SkillLevels, after: SkillLevels, profile: RoleProfile): UnlockedActivity[] {
  const history = snapshot.history.filter(row => row.employee_id === employee.employee_id);
  const completions = snapshot.completions.filter(row => row.employee_id === employee.employee_id);
  return snapshot.events.flatMap(event => {
    if (event.event_id === action.event.event_id || event.mandatory || !matchesAudience(event, employee)) return [];
    if (meetsPrerequisites(event, before) || !meetsPrerequisites(event, after)) return [];
    // An already enrolled event is not locked by today's prerequisites.
    if (activeAttempts(event, history, completions).length) return [];
    if (event.format === 'self_paced') {
      if (completedOccurrence(event, null, history, completions)) return [];
    } else {
      const hasLaterSession = event.upcoming_sessions.some(date => date >= snapshot.as_of_date
        && !(action.action === 'start' && action.session !== null && date <= action.session)
        && !completedOccurrence(event, date, history, completions));
      if (!hasLaterSession) return [];
    }
    const future = applyEvent(after, event);
    const gain = weightedGain(after, future, profile);
    return gain > 0 ? [{ event, weighted_gain: gain, expected_skill_changes: levelChanges(after, future) }] : [];
  }).sort((a, b) => compareText(a.event.event_id, b.event.event_id));
}

function candidateId(action: AvailableAction): string {
  return `${encodeURIComponent(action.event.event_id)}:${action.action}:${encodeURIComponent(action.participation?.record_id ?? action.session ?? 'self-paced')}`;
}

const numberText = (value: number) => String(Math.round(value * 100) / 100);

function candidateFacts(snapshot: DatasetSnapshot, employee: EmployeeView, action: AvailableAction, candidate: Omit<Candidate, 'facts'>, unlocked: UnlockedActivity[], recentOutcomes: readonly ParticipationSource[]): Candidate['facts'] {
  const names = new Map(snapshot.skills.map(skill => [skill.skill_id, skill.name]));
  const label = (id: string) => names.get(id) ?? id;
  const changes = candidate.expected_skill_changes.map(change => `${label(change.skill_id)}: ${numberText(change.before)} → ${numberText(change.after)}`).join('; ');
  const gapChanges = candidate.expected_skill_changes.filter(change => (employee.skills.find(skill => skill.skill_id === change.skill_id)?.gap ?? 0) > 0);
  const statusLabels: Record<ParticipationStatus, string> = { completed: 'завершено', in_progress: 'в процессе', dropped: 'прекращено', no_show: 'пропуск', declined: 'отказ', overdue: 'просрочено' };
  const negatives = recentOutcomes.filter(row => row.status !== 'completed').length;
  const historyText = (recentOutcomes.length
    ? `Итоговые исходы этой активности на ${snapshot.as_of_date} (последние ${recentOutcomes.length}, от новых к старым): ${recentOutcomes.map(row => `${row.date} — ${statusLabels[row.status]}`).join('; ')}. Отказов, пропусков и прекращений: ${negatives}.`
    : `В исходной истории нет итоговых исходов этой активности на ${snapshot.as_of_date}; отказов, пропусков и прекращений: 0. Отсутствие истории не говорит о мотивации.`)
    + (action.participation ? ` Текущее участие от ${action.participation.date}: в процессе (${numberText(action.participation.completion_pct)}%); оно не входит в счётчик итоговых исходов.` : '');
  const similarHistory = historyEvidenceText(summarizeHistoryEvidence({ employeeId: employee.employee_id,
    asOfDate: snapshot.as_of_date, event: action.event, events: snapshot.events, history: snapshot.history }), { includeExact: false });
  const requirements = gapChanges.map(change => {
    const skill = employee.skills.find(item => item.skill_id === change.skill_id)!;
    return `${label(change.skill_id)}: требуется ${numberText(skill.required_level!)}, сейчас ${numberText(skill.current_level)}${skill.critical ? ', критический навык' : ''}`;
  }).join('; ');
  const goalLabels = { selected: 'выбранная цель', imported: 'цель из профиля', suggested: 'предложенная цель', missing: 'цель не выбрана' };
  const targetText = `Цель: ${employee.goal.target!.target_role}, ${employee.goal.target!.target_grade} (${goalLabels[employee.goal.source]}). `
    + (requirements || (unlocked.length ? `Подготовительный шаг открывает требования для: ${unlocked.map(item => item.event.title).join('; ')}.` : 'Непосредственный прирост покрытия целевых требований отсутствует.'))
    + ` Изменение покрытия после этого шага: ${numberText(candidate.goal_coverage_delta * 100)} п.п.`;
  const eligibilityText = action.action === 'continue'
    ? `Продолжение активности, начатой ${action.participation!.date}; завершено ${action.participation!.completion_pct}%. Допуск сохраняется с момента начала.`
    : `Текущая роль и грейд входят в аудиторию; предварительные требования выполнены. ${action.session ? `Выбрана доступная сессия ${action.session}.` : 'Самостоятельное обучение доступно без даты сессии.'}`;
  return [
    { fact_id: `${candidate.candidate_id}:grade`, category: 'grade', text: `Текущая роль: ${employee.role}, грейд ${employee.grade}. ${action.action === 'continue' ? 'Активность уже начата; новый грейд не отменяет участие.' : `Активность доступна текущему грейду ${employee.grade}.`}` },
    { fact_id: `${candidate.candidate_id}:skill_gap`, category: 'skill_gap', text: `Расчётный эффект: ${changes}. ${unlocked.length ? `После завершения возможно открытие: ${unlocked.map(item => item.event.title).join('; ')}; расписание следующих шагов нужно проверить заново.` : ''}`.trim() },
    { fact_id: `${candidate.candidate_id}:history`, category: 'history', text: `${historyText} ${similarHistory}` },
    { fact_id: `${candidate.candidate_id}:target_requirement`, category: 'target_requirement', text: targetText },
    ...unlocked.map(item => ({
      fact_id: `${candidate.candidate_id}:unlock:${encodeURIComponent(item.event.event_id)}`,
      category: 'target_requirement' as const,
      text: `После завершения подготовки возможно отдельное прохождение «${item.event.title}». `
        + `Его расчётный эффект от состояния после подготовки: ${item.expected_skill_changes.map(change => `${label(change.skill_id)}: ${numberText(change.before)} → ${numberText(change.after)}`).join('; ')}. `
        + `Взвешенное сокращение оставшихся целевых разрывов: ${numberText(item.weighted_gain)} (вес критического навыка 2, остальных 1; рост выше требования и вне цели не учитывается). `
        + 'Будущая польза условна и не начисляется за подготовительный шаг; расписание и допуск нужно проверить заново. Польза альтернативных следующих активностей не складывается.',
    })),
    { fact_id: `${candidate.candidate_id}:eligibility`, category: 'eligibility', text: eligibilityText },
    { fact_id: `${candidate.candidate_id}:effort`, category: 'effort', text: `Полная длительность: ${numberText(action.event.duration_hours)} ч.; формат ${{ online: 'онлайн', offline: 'очно', self_paced: 'в своём темпе' }[action.event.format]}. Это трудозатраты, а не календарный срок.` },
  ];
}

/** Deterministic baseline. Each card is an alternative from the same state, not step N. */
export function getCandidates(snapshot: DatasetSnapshot, employeeId: string): { employee: EmployeeView; candidates: Candidate[]; emptyReason: EmptyReason | null; signals: BaselineSignals } {
  const employee = employeeView(snapshot, employeeId);
  const empty = (reason: EmptyReason) => ({ employee, candidates: [], emptyReason: reason, signals: { unlockedWeightedGain: new Map<string, number>(), negativeOutcomes: new Map<string, number>(), similarFormatPenalty: new Map<string, number>() } });
  if (!employee.goal.target || !employee.progress) return empty('GOAL_REQUIRED');
  if (employee.progress.gap_points <= 0) return empty('GOAL_REACHED');
  const profile = targetProfile(snapshot, employee.goal)!;
  const levels = levelsFrom(employee);
  const actions = availableActions(snapshot, employee, levels);
  if (!actions.length) return empty('NO_ELIGIBLE_EVENTS');
  const recentOutcomes = latestTerminalHistoryByEvent(new Set(actions.map(action => action.event.event_id)), {
    employeeId, asOfDate: snapshot.as_of_date, history: snapshot.history,
  });
  let hasBenefit = false;
  const candidates: Candidate[] = [];
  const unlockedWeightedGain = new Map<string, number>();
  for (const action of actions) {
    const after = applyEvent(levels, action.event);
    const changes = levelChanges(levels, after);
    if (!changes.length) continue;
    hasBenefit = true;
    const direct = weightedGain(levels, after, profile);
    const unlocked = findUnlocked(snapshot, employee, action, levels, after, profile);
    if (direct <= 0 && !unlocked.length) continue;
    const base: Omit<Candidate, 'facts'> = {
      candidate_id: candidateId(action), event_id: action.event.event_id, title: action.event.title,
      event_type: action.event.type, format: action.event.format, duration_hours: action.event.duration_hours,
      action: action.action, participation_id: action.participation?.record_id ?? null, session_date: action.session,
      relevance: direct > 0 ? 'direct' : 'prerequisite', expected_skill_changes: changes,
      goal_coverage_delta: progressFor(after, profile)!.coverage - employee.progress.coverage,
      unlocks_event_ids: unlocked.map(item => item.event.event_id),
    };
    candidates.push({ ...base, facts: candidateFacts(snapshot, employee, action, base, unlocked, recentOutcomes.get(action.event.event_id) ?? []) });
    unlockedWeightedGain.set(base.candidate_id, Math.max(0, ...unlocked.map(item => item.weighted_gain)));
  }
  if (!candidates.length) return empty(hasBenefit ? 'NO_GOAL_RELEVANT_EVENTS' : 'NO_BENEFICIAL_EVENTS');
  const signals = buildBaselineSignals(candidates, { employeeId, asOfDate: snapshot.as_of_date, history: snapshot.history, events: snapshot.events, unlockedWeightedGain });
  return { employee, candidates: rankBaseline({ profile: { skills: employee.skills }, candidates }, signals), emptyReason: null, signals };
}

export function assertCompletionAllowed(snapshot: DatasetSnapshot, employeeId: string, request: CompletionRequest): { event_id: string; participation_id: string | null; session_date: string | null; occurrence_key: string } {
  const employee = employeeView(snapshot, employeeId);
  invariant(request.simulation === true, 'INVALID_REQUEST', 'Допускается только явно обозначенная симуляция.');
  if (request.expected_version.dataset_revision !== employee.version.dataset_revision || request.expected_version.employee_revision !== employee.version.employee_revision) {
    throw new AppError('REVISION_CONFLICT', 'Профиль изменился. Обновите данные.', 409, { current_version: employee.version });
  }
  const history = snapshot.history.filter(row => row.employee_id === employeeId);
  const completions = snapshot.completions.filter(row => row.employee_id === employeeId);
  const levels = levelsFrom(employee);
  let event: EventView | undefined;
  let participationId: string | null = null;
  let sessionDate: string | null;
  if (request.target.kind === 'existing_participation') {
    const targetId = request.target.participation_id;
    const row = history.find(item => item.record_id === targetId);
    if (!row && completions.some(item => item.id === targetId || item.participation_id === targetId)) {
      throw new AppError('ALREADY_COMPLETED', 'Участие уже завершено.', 409);
    }
    invariant(row, 'NOT_FOUND', 'Участие этого сотрудника не найдено.', 404);
    event = snapshot.events.find(item => item.event_id === row!.event_id);
    invariant(event, 'NOT_FOUND', 'Активность не найдена.', 404);
    sessionDate = event!.format === 'self_paced' ? null : row!.date;
    if (completedOccurrence(event!, sessionDate, history, completions)) {
      throw new AppError(event!.repeatable ? 'SESSION_ALREADY_COMPLETED' : 'ALREADY_COMPLETED', 'Активность или выбранная сессия уже завершена.', 409);
    }
    invariant(row!.status === 'in_progress', 'INVALID_PARTICIPATION_STATE', 'Продолжить можно только начатое участие.', 409);
    participationId = row!.record_id;
  } else {
    event = snapshot.events.find(item => item.event_id === (request.target as { event_id: string }).event_id);
    invariant(event, 'NOT_FOUND', 'Активность не найдена.', 404);
    sessionDate = request.target.session_date;
    if (event!.format === 'self_paced') {
      invariant(sessionDate === null, 'INELIGIBLE_EVENT', 'Для самостоятельного обучения дата сессии должна быть null.', 422);
    } else {
      invariant(sessionDate !== null && sessionDate >= snapshot.as_of_date && event!.upcoming_sessions.includes(sessionDate), 'INELIGIBLE_EVENT', 'Выберите существующую будущую сессию.', 422);
    }
    if (completedOccurrence(event!, sessionDate, history, completions)) {
      throw new AppError(event!.repeatable ? 'SESSION_ALREADY_COMPLETED' : 'ALREADY_COMPLETED', 'Активность или выбранная сессия уже завершена.', 409);
    }
    const active = activeAttempts(event!, history, completions).find(row => sameOccurrence(event!, row.date, sessionDate));
    invariant(!active, 'USE_EXISTING_PARTICIPATION', 'Активность уже начата. Продолжите существующее участие.', 409);
    invariant(matchesAudience(event!, employee), 'INELIGIBLE_EVENT', 'Активность не соответствует текущей роли или грейду.', 422);
    invariant(meetsPrerequisites(event!, levels), 'INELIGIBLE_EVENT', 'Не выполнены предварительные требования активности.', 422);
  }
  invariant(!event!.mandatory, 'INELIGIBLE_EVENT', 'Обязательные назначения не входят в добровольную симуляцию развития.', 422);
  invariant(levelChanges(levels, applyEvent(levels, event!)).length > 0, 'INELIGIBLE_EVENT', 'На текущих уровнях активность уже не даёт прироста навыков.', 422);
  return { event_id: event!.event_id, participation_id: participationId, session_date: sessionDate!, occurrence_key: occurrenceKey(event!, sessionDate!) };
}

export function skillChanges(before: EmployeeView, after: EmployeeView): SkillChange[] {
  return levelChanges(levelsFrom(before), levelsFrom(after));
}

export function catalogView(snapshot: DatasetSnapshot): CatalogView {
  return structuredClone({ dataset_revision: snapshot.dataset_revision, skills: snapshot.skills, role_profiles: snapshot.role_profiles,
    events: snapshot.events, grades: GRADES, proficiency_scale: snapshot.proficiency_scale });
}

function statusCounts(): Record<ParticipationStatus, number> {
  return Object.fromEntries(STATUSES.map(status => [status, 0])) as Record<ParticipationStatus, number>;
}

export function hrOverview(snapshot: DatasetSnapshot): HrOverview {
  const result: HrOverview = {
    global_revision: snapshot.global_revision, employee_count: snapshot.employees.length,
    goals_by_source: { imported: 0, selected: 0, suggested: 0, missing: 0 }, skill_gaps: [], catalog_gaps: [], no_next_step: [],
    participation: { actual_by_status: statusCounts(), simulated_completions: snapshot.completions.length,
      effective_by_status: statusCounts(), superseded_attempts: 0, by_activity: [] },
  };
  const activities = new Map(snapshot.events.map(event => [event.event_id, {
    event_id: event.event_id, title: event.title, actual_by_status: statusCounts(), simulated_completions: 0,
    effective_by_status: statusCounts(), superseded_attempts: 0,
  }]));
  for (const row of snapshot.history) {
    result.participation.actual_by_status[row.status]++;
    activities.get(row.event_id)!.actual_by_status[row.status]++;
  }
  for (const row of snapshot.completions) activities.get(row.event_id)!.simulated_completions++;
  const gaps = new Map<string, HrOverview['skill_gaps'][number]>();
  const employeeViews: EmployeeView[] = [];
  const historyByEmployee = new Map<string, ParticipationSource[]>();
  const completionsByEmployee = new Map<string, RuntimeCompletion[]>();
  for (const row of snapshot.history) {
    const rows = historyByEmployee.get(row.employee_id) ?? [];
    rows.push(row); historyByEmployee.set(row.employee_id, rows);
  }
  for (const row of snapshot.completions) {
    const rows = completionsByEmployee.get(row.employee_id) ?? [];
    rows.push(row); completionsByEmployee.set(row.employee_id, rows);
  }
  for (const source of snapshot.employees) {
    // Every employee projection uses only their rows; avoid rescanning the entire
    // company history for each candidate while retaining the same domain rules.
    const employeeSnapshot = { ...snapshot, employees: [source],
      history: historyByEmployee.get(source.employee_id) ?? [],
      completions: completionsByEmployee.get(source.employee_id) ?? [] };
    const { employee, emptyReason } = getCandidates(employeeSnapshot, source.employee_id);
    employeeViews.push(employee);
    result.goals_by_source[employee.goal.source]++;
    if (emptyReason) result.no_next_step.push({ employee_id: employee.employee_id, full_name: employee.full_name, goal_source: employee.goal.source, reason: emptyReason });
    for (const skill of employee.skills) {
      if (skill.required_level === null || skill.required_level <= 0) continue;
      const key = `${employee.goal.source}:${skill.skill_id}`;
      const gap = gaps.get(key) ?? { skill_id: skill.skill_id, goal_source: employee.goal.source, employees_with_gap: 0, denominator: 0, total_gap_points: 0 };
      gap.denominator++;
      if ((skill.gap ?? 0) > 0) { gap.employees_with_gap++; gap.total_gap_points += skill.gap!; }
      gaps.set(key, gap);
    }
    for (const participation of employee.history) {
      const activity = activities.get(participation.event_id)!;
      if (participation.superseded_by) {
        result.participation.superseded_attempts++; activity.superseded_attempts++;
      } else {
        result.participation.effective_by_status[participation.effective_status]++;
        activity.effective_by_status[participation.effective_status]++;
      }
    }
  }
  result.catalog_gaps = buildCatalogCoverageGaps(snapshot, employeeViews);
  result.skill_gaps = [...gaps.values()].sort((a, b) => b.total_gap_points - a.total_gap_points || compareText(a.skill_id, b.skill_id) || compareText(a.goal_source, b.goal_source));
  result.participation.by_activity = [...activities.values()].sort((a, b) => compareText(a.event_id, b.event_id));
  result.no_next_step.sort((a, b) => compareText(a.employee_id, b.employee_id));
  return result;
}
