/**
 * AI versus rules on the same profiles.
 *
 * The architecture warns that comparing the model to a deliberately weak rule
 * proves nothing, so the baseline here is the real multi-factor ranker from
 * rank.ts. Agreement is not the goal - the point is to see where they differ
 * and judge those cases by hand.
 *
 * Run: npm run eval
 */
import 'dotenv/config'
import { recommend } from '../src/server/ai/recommend'
import { rulesCards } from '../src/server/ai/rank'
import type { Candidate, RecommendationInput } from '../src/contracts/ai'

type Case = { name: string; input: RecommendationInput; expectTop?: string }

function c(
  id: string,
  title: string,
  opts: Partial<Candidate> & { levels?: number; gap?: boolean; critical?: boolean } = {},
): Candidate {
  const { levels = 1, gap = true, critical = false, ...rest } = opts
  const hours = rest.duration_hours ?? 8
  return {
    event_id: id,
    title,
    action: rest.action ?? 'start',
    duration_hours: hours,
    rating: rest.rating ?? 4,
    peer_count: rest.peer_count ?? 2,
    is_preparatory: rest.is_preparatory ?? false,
    expected_changes: rest.expected_changes ?? [
      { skill_id: 'SK_1', from: 2, to: 2 + levels, closes_gap: gap, critical },
    ],
    facts: rest.facts ?? [
      { id: `${id}-f1`, category: gap ? 'target_gap' : 'skill_gain', text: gap ? `Closes the target gap by ${levels}` : `Adds ${levels} level off-target` },
      { id: `${id}-f2`, category: critical ? 'critical_skill' : 'skill_gain', text: critical ? 'Critical for the target grade' : 'Useful for the role' },
      { id: `${id}-f3`, category: 'duration', text: `${hours} hours` },
      { id: `${id}-f4`, category: 'feedback', text: `Rated ${rest.rating ?? 4}` },
    ],
  }
}

const employee: RecommendationInput['employee'] = {
  employee_id: 'E_EVAL',
  role: 'Analyst',
  grade: 'Middle',
  target_role: 'Analyst',
  target_grade: 'Senior',
  goal_source: 'chosen',
  gap_skill_ids: ['SK_1'],
  critical_skill_ids: ['SK_1'],
}

const make = (candidates: Candidate[]): RecommendationInput => ({ employee, candidates, state_version: 1 })

const CASES: Case[] = [
  {
    name: 'critical gap beats a bigger off-target gain',
    input: make([
      c('EV_CRIT', 'Critical skill workshop', { levels: 1, critical: true }),
      c('EV_BIG', 'Unrelated deep dive', { levels: 3, gap: false }),
    ]),
    expectTop: 'EV_CRIT',
  },
  {
    name: 'finish what was started over an equivalent new course',
    input: make([
      c('EV_GOING', 'Half-finished course', { action: 'continue' }),
      c('EV_NEW', 'Equivalent new course'),
    ]),
    expectTop: 'EV_GOING',
  },
  {
    name: 'short course preferred when the gain is identical',
    input: make([
      c('EV_SHORT', 'Two-hour intensive', { duration_hours: 2 }),
      c('EV_LONG', 'Forty-hour programme', { duration_hours: 40 }),
    ]),
    expectTop: 'EV_SHORT',
  },
  {
    name: 'a capped skill offers nothing',
    input: make([
      c('EV_REAL', 'Still room to grow', { levels: 1 }),
      c('EV_CAPPED', 'Already at the cap', {
        expected_changes: [{ skill_id: 'SK_1', from: 4, to: 4, closes_gap: true, critical: false }],
      }),
    ]),
    expectTop: 'EV_REAL',
  },
]

async function main() {
  const hasKey = Boolean(process.env['OPENAI_API_KEY'])
  if (!hasKey) console.log('OPENAI_API_KEY not set - rules baseline only.\n')

  let agree = 0
  let aiOk = 0
  const latencies: number[] = []

  for (const testCase of CASES) {
    const rules = rulesCards(testCase.input)
    const rulesTop = rules[0]?.event_id ?? '-'
    const expected = testCase.expectTop
    const rulesVerdict = expected ? (rulesTop === expected ? 'PASS' : 'FAIL') : '    '

    let aiTop = '-'
    let mode = 'skipped'
    if (hasKey) {
      const result = await recommend(testCase.input)
      mode = result.mode
      aiTop = result.cards[0]?.event_id ?? '-'
      if (result.diagnostics.llm_ms !== null) latencies.push(result.diagnostics.llm_ms)
      if (result.mode === 'ai') aiOk += 1
      if (result.diagnostics.rejection) console.log(`    rejected: ${result.diagnostics.rejection}`)
    }
    if (aiTop === rulesTop) agree += 1

    const aiVerdict = expected && hasKey ? (aiTop === expected ? 'PASS' : 'FAIL') : '    '
    console.log(`${testCase.name}`)
    console.log(`  expected ${expected ?? '(none)'} | rules ${rulesTop} ${rulesVerdict} | ai ${aiTop} ${aiVerdict} (${mode})`)
  }

  console.log(`\ncases: ${CASES.length}`)
  if (hasKey) {
    console.log(`ai answered usably: ${aiOk}/${CASES.length}`)
    console.log(`ai agreed with rules: ${agree}/${CASES.length}`)
    if (latencies.length > 0) {
      const sorted = [...latencies].sort((a, b) => a - b)
      console.log(`llm ms: min ${sorted[0]} / max ${sorted[sorted.length - 1]}`)
    }
    console.log('\nDisagreements are the interesting rows - read them, do not average them.')
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
