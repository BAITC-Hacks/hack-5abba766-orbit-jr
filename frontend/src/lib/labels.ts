import type {
  EmptyReason,
  GoalSource,
  ParticipationStatus,
} from "../../../contracts/backend";
export const statuses: Record<ParticipationStatus, string> = {
  completed: "Завершено",
  in_progress: "В процессе",
  dropped: "Прекращено",
  no_show: "Пропуск",
  declined: "Отказ",
  overdue: "Просрочено",
};
export const goalSources: Record<GoalSource, string> = {
  suggested: "Предложенная цель",
  selected: "Выбранная цель",
  imported: "Цель из профиля",
  missing: "Цель не выбрана",
};
export const emptyReasons: Record<EmptyReason, string> = {
  GOAL_REQUIRED: "Выберите направление развития.",
  GOAL_REACHED: "Навыки соответствуют выбранной цели.",
  NO_ELIGIBLE_EVENTS:
    "Нет доступных активностей: условия участия не выполнены.",
  NO_BENEFICIAL_EVENTS: "Нет активностей с приростом навыков.",
  NO_GOAL_RELEVANT_EVENTS: "Нет подходящего шага для выбранной цели.",
};
export const emptyReasonGuidance: Record<EmptyReason, string> = {
  GOAL_REQUIRED: "Выберите роль и грейд, чтобы сопоставить текущие навыки с требованиями и подобрать обучение.",
  GOAL_REACHED: "По текущим оценкам разрывов с требованиями цели нет. Это не подтверждение повышения. Можно выбрать новое направление развития.",
  NO_ELIGIBLE_EVENTS: "В текущем каталоге нет доступного шага с учётом условий участия и истории. Посмотрите навыки к цели и обсудите с HR подходящую программу или дату.",
  NO_BENEFICIAL_EVENTS: "Активности текущего каталога не дают дополнительного прироста по вашим оценкам навыков. Посмотрите оставшиеся разрывы и обсудите с HR другую программу.",
  NO_GOAL_RELEVANT_EVENTS: "Разрывы с целью ещё есть, но текущий каталог не предлагает шага, который их сократит. Посмотрите навыки к цели и обсудите с HR обучение под эти разрывы.",
};
export const formats = {
  online: "Онлайн",
  offline: "Офлайн",
  self_paced: "В своём темпе",
};
export const eventTypes = {
  compliance: "Обязательное обучение",
  onboarding: "Адаптация",
  course: "Курс",
  workshop: "Воркшоп",
  mentoring: "Менторство",
  certification: "Сертификация",
  meetup: "Встреча",
};
export function activityDate(
  format: keyof typeof formats,
  date: string | null,
) {
  return (
    date ?? (format === "self_paced" ? "В своём темпе" : "Дата не указана")
  );
}
