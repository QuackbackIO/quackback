// @vitest-environment node
/**
 * The edit eval against a real model: each case asked of Ask AI as the
 * designer asks it, judged by its rule, timed. Skipped unless
 * DESIGN_EVAL_LIVE is set; the model is the workspace's design model
 * (AI_DESIGN_MODEL, Haiku 5.5). Results go to DESIGN_EVAL_OUT as JSON.
 *
 *   DESIGN_EVAL_LIVE=1 DESIGN_EVAL_OUT=/path/results.json bunx vitest run <this file>
 */
import { writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  EVAL_CASES,
  GATES,
  HELD_OUT_CASES,
  MARK_CASES,
  PLACES,
  caseDesign,
  judge,
  type EvalCase,
} from './cases'
import { OVERRIDE_CASES } from './override-cases'
import { homeBlockTypes } from '@/lib/shared/design/home'

// The AI's settings from the environment alone; the rest of the config needs a whole server.
vi.mock('@/lib/server/config', () => ({
  config: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicVersion: process.env.ANTHROPIC_VERSION,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    aiDesignModel: process.env.AI_DESIGN_MODEL,
    aiAssistantModel: process.env.AI_DESIGN_MODEL,
    aiReasoningEffort: process.env.AI_REASONING_EFFORT,
    aiReasoningExclude: process.env.AI_REASONING_EXCLUDE === 'true',
  },
}))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  aiAllowanceNow: async () => ({ credits: 'available', resetsAt: null, trial: false }),
}))
vi.mock('@/lib/server/domains/ai/usage-middleware', () => ({
  createUsageLoggingMiddleware: () => ({ name: 'usage' }),
}))

const LIVE = !!process.env.DESIGN_EVAL_LIVE
const REPEATS = Number(process.env.DESIGN_EVAL_REPEATS ?? 1)

interface Outcome {
  name: string
  /** The set it is from: the eval set, the cases written after the contract, or those about marks. */
  set: 'eval' | 'held-out' | 'marks' | 'overrides'
  run: number
  right: boolean
  refused: boolean
  invalid: boolean
  ms: number
  reply: string
  stray: string[]
  applied: number
  /** The design it left, for judging again. */
  design?: unknown
}

async function runCase(c: EvalCase, run: number, set: Outcome['set']): Promise<Outcome> {
  const { askDesignAi } = await import('../../design-ai')
  const before = caseDesign(c)
  const started = Date.now()
  const result = await askDesignAi({
    message: c.request,
    design: before,
    scope: c.picked?.scope ?? 'site',
    ...(c.picked?.blockId ? { blockId: c.picked.blockId } : {}),
    ...(c.picked?.element ? { element: c.picked.element } : {}),
    history: [],
    allows: { blockTypes: homeBlockTypes(GATES), writesCss: false, checkCss: () => 'no CSS' },
    page: 'home',
    places: PLACES,
    gates: GATES,
  } as Parameters<typeof askDesignAi>[0]).catch((err: unknown) => ({
    ok: false as const,
    code: 'AI_FAILED' as const,
    message: String(err),
  }))
  const ms = Date.now() - started
  if (!result.ok)
    return {
      name: c.name,
      set,
      run,
      right: false,
      refused: false,
      invalid: true,
      ms,
      reply: result.message,
      stray: [],
      applied: 0,
    }
  const verdict = judge(c, before, result.design)
  return {
    name: c.name,
    set,
    run,
    right: verdict.right,
    refused: result.applied.length === 0,
    invalid: false,
    ms,
    reply: result.reply,
    stray: verdict.stray,
    applied: result.applied.length,
    design: result.design,
  }
}

describe.skipIf(!LIVE)('Ask AI edit eval (live)', () => {
  it(
    'answers the cases',
    async () => {
      const jobs = [
        ...EVAL_CASES.map((c) => [c, 'eval'] as const),
        ...HELD_OUT_CASES.map((c) => [c, 'held-out'] as const),
        ...MARK_CASES.map((c) => [c, 'marks'] as const),
        ...OVERRIDE_CASES.map((c) => [c, 'overrides'] as const),
      ].flatMap(([c, set]) => Array.from({ length: REPEATS }, (_, run) => [c, run, set] as const))
      const outcomes: Outcome[] = []
      // A few at a time, as people would.
      for (let at = 0; at < jobs.length; at += 4)
        outcomes.push(
          ...(await Promise.all(
            jobs.slice(at, at + 4).map(([c, run, set]) => runCase(c, run, set))
          ))
        )
      const sum = (some: Outcome[]) => {
        const ms = some.map((o) => o.ms).sort((a, b) => a - b)
        return {
          cases: some.length,
          right: some.filter((o) => o.right).length,
          refused: some.filter((o) => o.refused).length,
          invalid: some.filter((o) => o.invalid).length,
          medianMs: ms[Math.floor(ms.length / 2)],
          p90Ms: ms[Math.floor(ms.length * 0.9)],
        }
      }
      const summary = {
        eval: sum(outcomes.filter((o) => o.set === 'eval')),
        heldOut: sum(outcomes.filter((o) => o.set === 'held-out')),
        marks: sum(outcomes.filter((o) => o.set === 'marks')),
        overrides: sum(outcomes.filter((o) => o.set === 'overrides')),
      }
      if (process.env.DESIGN_EVAL_OUT)
        writeFileSync(process.env.DESIGN_EVAL_OUT, JSON.stringify({ summary, outcomes }, null, 2))
      console.info(JSON.stringify(summary))
      expect(outcomes.length).toBe(jobs.length)
    },
    30 * 60_000
  )
})
