// Rendering safeguards for versioned recommendations and saved completion results.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function load(file) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)(
    (id) => id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`) : id.startsWith(".") ? load(path.join(path.dirname(file), `${id}.tsx`)) : require(id),
    module, module.exports,
  );
  return module.exports;
}
const { CareerJourney } = load("src/components/quest/career-journey.tsx");
const { CompletionResultPanel } = load("src/components/quest/completion-result.tsx");
const { RecommendationCard } = load("src/components/quest/recommendation-card.tsx");
const { Skills } = load("src/components/quest/skills.tsx");
const { EmployeeProfile } = load("src/components/quest/employee-profile.tsx");
const version = { dataset_revision: 1, employee_revision: 2 };
const employee = {
  version, employee_id: "synthetic", grade: "Junior", role: "Engineer",
  goal: { source: "selected", target: { target_grade: "Middle", target_role: "Engineer" } },
  progress: { coverage: .555, gap_points: 4, missing_critical_skill_ids: ["critical"] },
  skills: [
    { skill_id: "unrelated", current_level: 5, required_level: null, gap: null, critical: false },
    { skill_id: "broad", current_level: 1, required_level: 4, gap: 3, critical: false },
    { skill_id: "covered", current_level: 3, required_level: 3, gap: 0, critical: false },
    { skill_id: "critical", current_level: 2, required_level: 3, gap: 1, critical: true },
  ],
};
const names = { critical: "Critical skill", broad: "Broad skill", covered: "Covered skill", unrelated: "Unrelated skill" };
const card = {
  candidate_id: "step-a", event_id: "event-a", title: "Candidate A", rank: 1,
  event_type: "course", format: "self_paced", duration_hours: 2,
  relevance: "prerequisite", action: "start", session_date: null,
  unlocks_event_ids: ["advanced"], goal_coverage_delta: .1,
  expected_skill_changes: [], reason_fact_ids: ["included"],
  facts: [
    { fact_id: "included", category: "history", text: "Verified cited history" },
    { fact_id: "omitted", category: "target_requirement", text: "Unselected evidence" },
  ],
};
const noop = () => {};
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test("employee profile renders source details and handles a missing goal without invented progress", () => {
  const profile = { ...employee, department: "Разработка", tenure_months: 5,
    work_format: "remote", preferred_language: "kk", last_review_date: "2026-09-11",
    history: [], goal: { source: "missing", target: null }, progress: null };
  const html = render(EmployeeProfile, { employee: profile, names, onGoal: noop, disabled: false });
  assert.match(html, /Удалённо/);
  assert.match(html, /Қазақша/);
  assert.match(html, /11 сентября 2026/);
  assert.match(html, /5 мес\./);
  assert.match(html, /Выбрать цель/);
  assert.doesNotMatch(html, /<progress/);
});

test("standalone profile discloses simulated indicators without implying earned skills or promotion", () => {
  const profile = { ...employee, department: "Development", tenure_months: 5,
    work_format: "remote", preferred_language: "ru", last_review_date: "2026-09-11",
    history: [], has_simulated_progress: true };
  const props = { employee: profile, names, onGoal: noop, disabled: false };
  const html = render(EmployeeProfile, props);
  assert.match(html, /Показатели включают расчётные демопрохождения/);
  assert.match(html, /не подтверждают посещение внешнего обучения/);
  assert.match(html, /Соответствие навыков требованиям роли не означает повышение/);
  assert.match(html, /<dt>Навыков в каталоге<\/dt><dd>4<\/dd>/);
  assert.doesNotMatch(html, /Навыков в профиле/);
  const withoutSimulation = render(EmployeeProfile, { ...props, employee: { ...profile, has_simulated_progress: false } });
  assert.doesNotMatch(withoutSimulation, /расчётные демопрохождения/);
  const withoutGoal = render(EmployeeProfile, { ...props, employee: { ...profile, goal: { source: "missing", target: null }, progress: null } });
  assert.match(withoutGoal, /расчётные демопрохождения/);
  assert.doesNotMatch(withoutGoal, /не означает повышение/);
});

test("journey hides stale choices and names prerequisite activities in the current snapshot", () => {
  const result = { version, mode: "rules_fallback", recommendations: [card] };
  const props = { employee, recommendations: result, names, eventNames: { advanced: "Advanced course" }, onSelect: noop };
  const current = render(CareerJourney, props);
  assert.match(current, /Candidate A/);
  assert.match(current, /Advanced course/);
  assert.doesNotMatch(current, /к advanced[<.]/);
  const stale = render(CareerJourney, { ...props, recommendations: { ...result, version: { ...version, employee_revision: 1 } } });
  assert.doesNotMatch(stale, /Candidate A/);
});

test("prerequisite without unlock targets still explains participation requirements cleanly", () => {
  const result = { version, mode: "rules_fallback", recommendations: [{ ...card, unlocks_event_ids: [] }] };
  const html = render(CareerJourney, { employee, recommendations: result, names, eventNames: {}, onSelect: noop });
  assert.match(html, /Подготовительный шаг/);
  assert.match(html, /Доступ зависит от условий участия\./);
  assert.doesNotMatch(html, /<p>\s*\. Доступ/);
});

test("skill focus prioritizes critical gaps and keeps non-target skills collapsed", () => {
  const html = render(Skills, { employee, names });
  assert.ok(html.indexOf("Critical skill") < html.indexOf("Broad skill"));
  assert.ok(html.indexOf("Broad skill") < html.indexOf("Covered skill"));
  assert.match(html, /<details class="cq-other-skills">/);
  assert.ok(html.indexOf("<details") < html.indexOf("Unrelated skill"));
  assert.match(html, /Вне цели/);
});

test("recommendation explanation includes only cited facts and the supplied action", () => {
  const html = render(RecommendationCard, { employee, card, names, eventNames: { advanced: "Advanced course" }, select: noop, actionLabel: "Открыть демо-курс" });
  assert.match(html, /Что учтено из истории/);
  assert.match(html, /Verified cited history/);
  assert.doesNotMatch(html, /Unselected evidence/);
  assert.match(html, /Advanced course/);
  assert.match(html, /Открыть демо-курс/);
});

test("completion compares saved skill changes and coverage without inventing an earlier snapshot", () => {
  const result = {
    employee: { ...employee, progress: { ...employee.progress, coverage: .615 } },
    skill_changes: [{ skill_id: "critical", before: 2, after: 3, gain: 1 }],
  };
  const props = { result, previousProgress: employee.progress, names, onClose: noop };
  const html = render(CompletionResultPanel, props);
  assert.match(html, /55,5%/);
  assert.match(html, /61,5%/);
  assert.match(html, /\+6 п\. п\./);
  assert.match(html, /Critical skill/);
  assert.doesNotMatch(html, /Broad skill/);
  const unknownBefore = render(CompletionResultPanel, { ...props, previousProgress: null });
  assert.doesNotMatch(unknownBefore, /55,5%/);
  assert.doesNotMatch(unknownBefore, /\+6 п\. п\./);
  assert.match(unknownBefore, /61,5%/);
});
