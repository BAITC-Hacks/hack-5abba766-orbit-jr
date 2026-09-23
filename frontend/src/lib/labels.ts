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
  selected: "Цель выбрана сотрудником",
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
