export type Skill = {
  id: string;
  name: string;
  level: number;
  required: number;
  critical?: boolean;
};
export type Course = {
  id: string;
  title: string;
  subtitle: string;
  type: string;
  format: string;
  hours: number;
  date: string;
  skill: string;
  gain: number;
  max: number;
  accent: string;
  reason: string;
  facts: string[];
};
// Authored UI fixtures. Not the original dataset or live AI output.
export const initialSkills: Skill[] = [
  {
    id: "design",
    name: "System Design",
    level: 2,
    required: 4,
    critical: true,
  },
  { id: "api", name: "API Design", level: 3, required: 4, critical: true },
  { id: "python", name: "Python", level: 4, required: 4 },
  { id: "cloud", name: "Cloud Architecture", level: 2, required: 3 },
  { id: "mentor", name: "Менторство", level: 2, required: 3 },
  { id: "communication", name: "Коммуникация", level: 3, required: 3 },
];
export const courses: Course[] = [
  {
    id: "demo-design",
    title: "Архитектура высоких нагрузок",
    subtitle: "От отдельных сервисов к системному мышлению.",
    type: "Воркшоп",
    format: "Офлайн",
    hours: 12,
    date: "7 октября",
    skill: "design",
    gain: 1,
    max: 5,
    accent: "blue",
    reason:
      "System Design — критический навык для вашей цели Senior. Практический воркшоп поможет сократить разрыв на один уровень.",
    facts: [
      "Уровень System Design: 2 из необходимых 4",
      "Требование участия выполнено: System Design ≥ 2",
      "В демо-истории завершены два практических воркшопа",
    ],
  },
  {
    id: "demo-cloud",
    title: "Облако. От теории к практике.",
    subtitle: "Уверенно проектируйте облачную инфраструктуру.",
    type: "Курс",
    format: "В своём темпе",
    hours: 16,
    date: "В любое время",
    skill: "cloud",
    gain: 1,
    max: 3,
    accent: "peach",
    reason:
      "Курс закрывает оставшийся разрыв в Cloud Architecture. Самостоятельный формат позволяет распределить нагрузку.",
    facts: [
      "Cloud Architecture: 2 → 3",
      "Для выбранной цели необходим уровень 3",
      "16 часов можно распределить на несколько недель",
    ],
  },
  {
    id: "demo-mentor",
    title: "Первый шаг в менторство",
    subtitle: "Делитесь опытом. Растите вместе.",
    type: "Программа",
    format: "Онлайн",
    hours: 8,
    date: "15 октября",
    skill: "mentor",
    gain: 1,
    max: 4,
    accent: "green",
    reason:
      "Менторство развивает способность помогать коллегам — один из навыков выбранной траектории Senior.",
    facts: [
      "Менторство: 2 из необходимых 3",
      "Программа доступна грейду Middle",
      "Одна программа закрывает текущий разрыв",
    ],
  },
];
export const people = [
  {
    name: "Акмарал Исмаилова",
    role: "Backend Engineer",
    department: "Разработка",
    progress: 76,
    status: "Есть следующий шаг",
  },
  {
    name: "Данияр Омаров",
    role: "Frontend Engineer",
    department: "Разработка",
    progress: 64,
    status: "Нужен подготовительный шаг",
  },
  {
    name: "Алия Садыкова",
    role: "Data Analyst",
    department: "Аналитика",
    progress: 83,
    status: "Есть следующий шаг",
  },
  {
    name: "Тимур Касымов",
    role: "QA Engineer",
    department: "Разработка",
    progress: 58,
    status: "Пробел в каталоге",
  },
  {
    name: "Мадина Ахметова",
    role: "Product Manager",
    department: "Продукт",
    progress: 71,
    status: "Есть следующий шаг",
  },
];
