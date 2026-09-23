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
export const emptyGuidance: Record<EmptyReason, string> = {
  GOAL_REQUIRED: "Укажите целевую роль и грейд: без них нельзя оценить пользу обучения.",
  GOAL_REACHED: "Все требования выбранной модели навыков покрыты. Это не подтверждение повышения; следующий карьерный шаг обсудите с руководителем.",
  NO_ELIGIBLE_EVENTS: "Проверьте аудиторию, предварительные навыки и даты в каталоге. Если подходящего варианта нет, обсудите с HR другой формат обучения.",
  NO_BENEFICIAL_EVENTS: "Доступные активности уже пройдены или не повышают текущие уровни навыков. Для дальнейшего развития нужен другой уровень обучения — обсудите его с HR.",
  NO_GOAL_RELEVANT_EVENTS: "В текущем каталоге нет доступного шага, который сокращает оставшиеся пробелы или открывает полезное обучение. Передайте HR список недостающих навыков ниже, чтобы подобрать другой формат развития.",
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
