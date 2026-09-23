import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertCompletionAllowed, employeeView, getCandidates } from '../src/domain';
import { sourceHash } from '../src/validation';
import { loadDataset } from '../src/validation/load-dataset';
import type { DatasetSnapshot } from '../src/types';

/** Simulate the current first-choice policy in memory, independently per person.
 * This is a policy rollout, not a search for every possible route to the goal.
 * Output is aggregate-only: no names, employee IDs, history or source records.
 */
export function auditJourneys(source: DatasetSnapshot) {
  const originalHash = sourceHash(source);
  const terminalCounts: Record<string, number> = {};
  let totalSteps = 0;
  let longestJourney = 0;
  let profilesWithGoal = 0;
  let profilesWithInitialStep = 0;
  let coverageBefore = 0;
  let coverageAfter = 0;
  let criticalGapsBefore = 0;
  let criticalGapsAfter = 0;
  for (const person of source.employees) {
    let snapshot = { ...source, employee_revisions: { ...source.employee_revisions } };
    const before = employeeView(snapshot, person.employee_id);
    if (before.progress) {
      profilesWithGoal++;
      coverageBefore += before.progress.coverage;
      criticalGapsBefore += before.progress.missing_critical_skill_ids.length;
    }
    const bound = source.events.reduce((sum, event) => sum + (event.repeatable
      ? new Set([...event.upcoming_sessions, ...source.history.filter(row =>
        row.employee_id === person.employee_id && row.event_id === event.event_id).map(row => row.date)]).size
      : 1), 0);
    const visited = new Set<string>();
    for (let step = 0; ; step++) {
      const { employee, candidates, emptyReason } = getCandidates(snapshot, person.employee_id);
      if (!candidates.length) {
        if (!emptyReason) throw new Error('A terminal journey must have an explicit reason');
        terminalCounts[emptyReason] = (terminalCounts[emptyReason] ?? 0) + 1;
        longestJourney = Math.max(longestJourney, step);
        if (employee.progress) {
          coverageAfter += employee.progress.coverage;
          criticalGapsAfter += employee.progress.missing_critical_skill_ids.length;
        }
        break;
      }
      if (step === 0) profilesWithInitialStep++;
      if (step >= bound) throw new Error('Journey exceeded the finite occurrence bound');
      const candidate = candidates[0];
      const allowed = assertCompletionAllowed(snapshot, person.employee_id, {
        expected_version: employee.version, simulation: true,
        target: candidate.action === 'continue'
          ? { kind: 'existing_participation', participation_id: candidate.participation_id! }
          : { kind: 'new_participation', event_id: candidate.event_id, session_date: candidate.session_date },
      });
      const identity = JSON.stringify([allowed.event_id, allowed.occurrence_key]);
      if (visited.has(identity)) throw new Error('Journey attempted to credit an occurrence twice');
      visited.add(identity);
      snapshot = { ...snapshot,
        employee_revisions: { ...snapshot.employee_revisions, [person.employee_id]: employee.version.employee_revision + 1 },
        global_revision: snapshot.global_revision + 1,
        completions: [...snapshot.completions, {
          id: `audit-${step}`, employee_id: person.employee_id, ...allowed,
          applied_as_of: snapshot.as_of_date, recorded_at: `${snapshot.as_of_date}T00:00:00.000Z`,
          sequence: Math.max(0, ...snapshot.completions.map(row => row.sequence)) + 1,
        }],
      };
      totalSteps++;
    }
  }
  if (sourceHash(source) !== originalHash) throw new Error('Audit must not mutate its source');
  return {
    policy: 'first domain-ranked candidate; recompute after each simulated completion',
    scope: 'Source dataset only, in-memory simulations, fixed dataset date; no DB writes or AI calls',
    limitation: 'A stopped rollout does not prove that every possible sequence is blocked. Skill effects are simulated, not measured learning.',
    asOfDate: source.as_of_date,
    sourceSha256: originalHash,
    employeeCount: source.employees.length,
    profilesWithGoal,
    profilesWithInitialStep,
    totalSteps,
    longestJourney,
    goalsReached: terminalCounts.GOAL_REACHED ?? 0,
    terminalCounts,
    meanGoalCoverageBefore: profilesWithGoal ? coverageBefore / profilesWithGoal : null,
    meanGoalCoverageAfter: profilesWithGoal ? coverageAfter / profilesWithGoal : null,
    criticalSkillGapsBefore: criticalGapsBefore,
    criticalSkillGapsAfter: criticalGapsAfter,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !arg.startsWith('--dataset=') && !arg.startsWith('--output='))) {
    throw new Error('Usage: audit:journeys [--dataset=directory] [--output=aggregate-report.json]');
  }
  const directory = args.find(arg => arg.startsWith('--dataset='))?.slice('--dataset='.length);
  const report = { timestamp: new Date().toISOString(), ...auditJourneys(await loadDataset(directory)) };
  const json = JSON.stringify(report, null, 2) + '\n';
  const output = args.find(arg => arg.startsWith('--output='))?.slice('--output='.length);
  if (output) {
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await writeFile(output, json, 'utf8');
  }
  process.stdout.write(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Journey audit failed'); process.exitCode = 1; });
}
