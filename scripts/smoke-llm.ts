/**
 * The 20-minute check the architecture asks for: does the key work, which
 * models does this account actually have, and how long does one real ranking
 * call take against the 8s budget.
 *
 * Run: npm run smoke
 */
import 'dotenv/config'
import OpenAI from 'openai'
import { recommend } from '../src/server/ai/recommend'
import { getModel, getTimeoutMs } from '../src/server/ai/provider'
import type { Candidate, RecommendationInput } from '../src/contracts/ai'

function demoCandidate(id: string, title: string, hours: number, critical: boolean): Candidate {
  return {
    event_id: id,
    title,
    action: 'start',
    duration_hours: hours,
    rating: 4.2,
    peer_count: 3,
    is_preparatory: false,
    expected_changes: [
      { skill_id: 'SK_SQL', from: 2, to: 3, closes_gap: true, critical },
    ],
    facts: [
      { id: `${id}-f1`, category: 'target_gap', text: 'Raises SQL from 2 to 3, the target needs 3' },
      { id: `${id}-f2`, category: critical ? 'critical_skill' : 'skill_gain', text: critical ? 'SQL is critical for the target grade' : 'Adds a skill the target role uses' },
      { id: `${id}-f3`, category: 'duration', text: `${hours} hours` },
      { id: `${id}-f4`, category: 'feedback', text: 'Rated 4.2 by past attendees' },
      { id: `${id}-f5`, category: 'participation', text: '3 colleagues at your grade attended' },
    ],
  }
}

const input: RecommendationInput = {
  employee: {
    employee_id: 'E_DEMO',
    role: 'Analyst',
    grade: 'Middle',
    target_role: 'Analyst',
    target_grade: 'Senior',
    goal_source: 'chosen',
    gap_skill_ids: ['SK_SQL'],
    critical_skill_ids: ['SK_SQL'],
  },
  candidates: [
    demoCandidate('EV_A', 'Advanced SQL for analysts', 12, true),
    demoCandidate('EV_B', 'SQL refresher', 4, false),
    demoCandidate('EV_C', 'Data storytelling', 16, false),
  ],
  state_version: 1,
}

async function main() {
  if (!process.env['OPENAI_API_KEY']) {
    console.error('OPENAI_API_KEY is not set. Copy .env.example to .env.local and fill it in.')
    process.exit(1)
  }

  console.log(`model:   ${getModel()}`)
  console.log(`timeout: ${getTimeoutMs()}ms\n`)

  console.log('--- models this account can use (first 20) ---')
  try {
    const client = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] })
    const models = await client.models.list()
    const ids = models.data.map((m) => m.id).sort()
    console.log(ids.slice(0, 20).join('\n'))
    if (!ids.includes(getModel())) {
      console.log(`\n!! OPENAI_MODEL="${getModel()}" is not in this account's list. Pick one above.`)
    }
  } catch (error) {
    console.log(`could not list models: ${error instanceof Error ? error.message : String(error)}`)
  }

  console.log('\n--- one real ranking call ---')
  const started = Date.now()
  const result = await recommend(input)
  const total = Date.now() - started

  console.log(`mode:      ${result.mode}`)
  console.log(`llm_ms:    ${result.diagnostics.llm_ms ?? 'n/a'}`)
  console.log(`total_ms:  ${total}  (brief allows 10000)`)
  if (result.diagnostics.rejection) console.log(`rejected:  ${result.diagnostics.rejection}`)
  console.log(`cards:     ${result.cards.map((c) => c.event_id).join(' > ')}`)
  for (const card of result.cards) {
    console.log(`  ${card.event_id} ${card.title}`)
    for (const factor of card.factors) console.log(`    - [${factor.category}] ${factor.text}`)
  }

  if (total > 10_000) console.log('\n!! over the 10s budget from the brief')
  if (result.mode !== 'ai') process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
