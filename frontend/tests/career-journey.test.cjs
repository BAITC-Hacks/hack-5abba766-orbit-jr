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
    (id) => id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`) : require(id),
    module, module.exports,
  );
  return module.exports;
}
const { CareerJourney } = load("src/components/quest/career-journey.tsx");
const { CompletionResultPanel } = load("src/components/quest/completion-result.tsx");
const { RecommendationCard } = load("src/components/quest/recommendation-card.tsx");
const { Skills } = load("src/components/quest/skills.tsx");
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
  candidate_id: "step-a", event_id: "event-a", title: "Candidate A",
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

test("skill focus prioritizes critical gaps and keeps non-target skills collapsed", () => {
  const html = render(Skills, { employee, names });
  assert.ok(html.indexOf("Critical skill") < html.indexOf("Broad skill"));
  assert.ok(html.indexOf("Broad skill") < html.indexOf("Covered skill"));
  assert.match(html, /<details class="cq-other-skills">/);
  assert.ok(html.indexOf("<details") < html.indexOf("Unrelated skill"));
  assert.match(html, /Не входит в требования выбранной цели/);
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
