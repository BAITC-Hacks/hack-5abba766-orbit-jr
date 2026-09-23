export type EvaluationCaseSuite = 'regression' | 'challenge' | 'acceptance'
export type EvaluationSuite = EvaluationCaseSuite | 'comparison' | 'all'

export type EvaluationOptions = {
  live: boolean
  smoke: boolean
  json: boolean
  suite: EvaluationSuite
  repeat: number
}

const USAGE = 'Usage: npm run eval:ai -- [--live] [--smoke] [--json] [--suite=regression|challenge|acceptance|comparison|all] [--repeat=1..5]'

export function resolveEvaluationSuites(suite: EvaluationSuite): EvaluationCaseSuite[] {
  if (suite === 'all') return ['regression', 'challenge', 'acceptance']
  if (suite === 'comparison') return ['regression', 'challenge']
  return [suite]
}

export function parseEvaluationOptions(args: readonly string[]): EvaluationOptions {
  const options: EvaluationOptions = { live: false, smoke: false, json: false, suite: 'regression', repeat: 1 }
  const seen = new Set<string>()
  for (const arg of args) {
    const name = arg.split('=', 1)[0]!
    if (seen.has(name)) throw new Error(`Duplicate option ${name}. ${USAGE}`)
    seen.add(name)
    if (arg === '--live') options.live = true
    else if (arg === '--smoke') options.smoke = true
    else if (arg === '--json') options.json = true
    else if (/^--suite=(regression|challenge|acceptance|comparison|all)$/.test(arg)) options.suite = arg.slice('--suite='.length) as EvaluationSuite
    else if (/^--repeat=[1-5]$/.test(arg)) options.repeat = Number(arg.slice('--repeat='.length))
    else throw new Error(USAGE)
  }
  if (options.smoke && !options.live) throw new Error('--smoke requires --live')
  if (options.smoke && options.repeat !== 1) throw new Error('--smoke requires --repeat=1')
  return options
}

/** Nearest-rank percentiles; samples are individual recommendation calls. */
export function summarizeLatencies(samples: readonly number[]): { p50: number | null; p95: number | null; max: number | null } {
  if (samples.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Latency samples must be finite nonnegative milliseconds')
  }
  if (!samples.length) return { p50: null, p95: null, max: null }
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1]!,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    max: sorted[sorted.length - 1]!,
  }
}
