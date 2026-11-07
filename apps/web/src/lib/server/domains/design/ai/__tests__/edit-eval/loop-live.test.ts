// @vitest-environment node
/**
 * The edit eval against a real model, single call against the loop. Each
 * case is asked as the builder asks it: single is today's one call (with
 * the workspace's CSS off, its default, or on with single-css); loop runs
 * the edit loop with each step's design read from the design itself, as the
 * eval cannot draw it; routed takes the router's way, as the builder does.
 * Judged by each case's rule; timed; results to DESIGN_EVAL_OUT as JSON.
 *
 *   DESIGN_EVAL_LIVE=1 DESIGN_EVAL_MODES=single,loop DESIGN_EVAL_SETS=style \
 *   DESIGN_EVAL_REPEATS=2 DESIGN_EVAL_OUT=/path.json bunx vitest run <this file>
 */
import { writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { homeBlockTypes } from '@/lib/shared/design/home'
import { runEditLoop, type LoopResult } from '@/lib/shared/design/agent/loop'
import { routeRequest } from '@/lib/shared/design/agent/router'
import { staticReadings } from '@/lib/shared/design/agent/static-reading'
import { STYLE_REGISTRY } from '@/lib/shared/design/agent/style-registry'
import { contrastRatio } from '@/lib/shared/design/contrast'
import { parseCssColour } from '@/lib/shared/design/agent/css-values'
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  EVAL_CASES,
  GATES,
  HELD_OUT_CASES,
  MARK_CASES,
  PLACES,
  caseDesign,
  fixtureDesign,
  judge,
  type EvalCase,
} from './cases'
import { OVERRIDE_CASES } from './override-cases'
import { STYLE_CASES, judgeStyle, withImage, type StyleCase } from './style-cases'

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
const MODES = (process.env.DESIGN_EVAL_MODES ?? 'single,loop').split(',') as Mode[]
const SETS = (process.env.DESIGN_EVAL_SETS ?? 'style').split(',') as EvalSet[]
const ONLY = process.env.DESIGN_EVAL_ONLY

type Mode = 'single' | 'single-css' | 'loop' | 'loop1' | 'routed'
type EvalSet = 'eval' | 'held-out' | 'marks' | 'style' | 'overrides'
type AnyCase = (EvalCase | StyleCase) & { set: EvalSet }

interface Outcome {
  name: string
  set: EvalSet
  mode: Mode
  run: number
  /** The way the request went: one call or the loop. */
  way: 'single' | 'loop'
  right: boolean
  refused: boolean
  invalid: boolean
  /** Text that read before and no longer does. */
  broken: string[]
  ms: number
  steps: number
  stopped?: string
  reply: string
  stray: string[]
  applied: number
  trail?: string[]
  design?: unknown
}

const R = STYLE_REGISTRY

/** The element a case picked on the canvas, where it picked one. */
const pickedElement = (c: AnyCase) => (c.picked as EvalCase['picked'])?.element

/** The design a case starts from. */
const startOf = (c: AnyCase) => (c.set === 'style' ? fixtureDesign() : caseDesign(c as EvalCase))
const PAIRS: Array<[string, 'base' | 'hover' | 'current']> = [
  ['button', 'base'],
  ['button', 'hover'],
  ['secondary', 'hover'],
  ['navItem', 'current'],
  ['vote', 'current'],
  ['body', 'base'],
  ['page', 'base'],
  ['card', 'base'],
]

/** Element states whose text read at 4.5:1 before and no longer does. */
function brokenReads(before: PortalDesign, after: PortalDesign): string[] {
  const targets = PAIRS.map(([element, state]) => ({ element, state, block: '' }))
  const ratio = (d: PortalDesign) => {
    const readings = staticReadings(d, R, targets)
    return Object.fromEntries(
      Object.entries(readings).map(([key, r]) => {
        const fg = parseCssColour(r.values.color)
        const fill = parseCssColour(r.values.background)
        const bg = fill && fill.alpha > 0.5 ? fill.hex : r.behind
        return [key, fg && bg ? contrastRatio(fg.hex, bg) : 21]
      })
    )
  }
  const [a, b] = [ratio(before), ratio(after)]
  return Object.keys(b).filter((key) => (a[key] ?? 0) >= 4.5 && (b[key] ?? 0) < 4.5)
}

const allows = (css: boolean) => ({
  blockTypes: homeBlockTypes(GATES),
  writesCss: css,
  checkCss: () => (css ? null : 'no CSS'),
})

async function single(c: AnyCase, css: boolean) {
  const { askDesignAi } = await import('../../design-ai')
  const image = 'image' in c && c.image ? [c.image] : []
  const result = await askDesignAi({
    message: c.request,
    design: startOf(c),
    scope: c.picked?.scope ?? 'site',
    ...(c.picked?.blockId ? { blockId: c.picked.blockId } : {}),
    ...(pickedElement(c) ? { element: pickedElement(c) } : {}),
    history: [],
    ...(image.length ? { images: image } : {}),
    allows: allows(css),
    page: 'home',
    places: PLACES,
    gates: GATES,
  } as Parameters<typeof askDesignAi>[0])
  return result.ok
    ? {
        ok: true as const,
        design: result.design,
        reply: result.reply,
        applied: result.applied.length,
        steps: 1,
        stopped: 'single',
        trail: [] as string[],
      }
    : { ok: false as const, message: result.message }
}

async function loop(c: AnyCase, steps = 4) {
  const { agentStep } = await import('../../design-agent')
  const original = startOf(c)
  let current = original
  const image = 'image' in c && c.image ? [c.image] : []
  const route = routeRequest(R, { message: c.request, images: image.length })
  const result: LoopResult = await runEditLoop({
    registry: R,
    design: original,
    targets: route.targets,
    budget: { steps, ms: 40_000 },
    deps: {
      step: async (request) => {
        const reply = await agentStep({
          message: c.request,
          design: current,
          scope: c.picked?.scope ?? 'site',
          ...(c.picked?.blockId ? { blockId: c.picked.blockId } : {}),
          ...(pickedElement(c) ? { element: pickedElement(c) } : {}),
          history: [],
          ...(image.length ? { images: image } : {}),
          allows: allows(false),
          page: 'home',
          places: PLACES,
          gates: GATES,
          request,
          maxSteps: steps,
        })
        if (reply.ok) current = reply.design
        return reply
      },
      read: async (targets, which) =>
        staticReadings(which === 'before' ? original : current, R, targets),
    },
  })
  if (!result.ok) return { ok: false as const, message: result.message }
  const { trailOf } = await import('@/lib/shared/design/agent/loop')
  return {
    ok: true as const,
    design: result.design,
    reply: result.reply,
    applied: result.applied.length,
    steps: result.steps.length,
    stopped: result.stopped,
    trail: trailOf(result.steps),
  }
}

async function runCase(c: AnyCase, mode: Mode, run: number): Promise<Outcome> {
  const started = Date.now()
  const images = 'image' in c && c.image ? 1 : 0
  const way: 'single' | 'loop' =
    mode === 'loop' || mode === 'loop1'
      ? 'loop'
      : mode === 'routed'
        ? routeRequest(R, { message: c.request, images }).mode
        : 'single'
  const result = await (
    way === 'loop' ? loop(c, mode === 'loop1' ? 1 : 4) : single(c, mode === 'single-css')
  ).catch((err: unknown) => ({ ok: false as const, message: String(err) }))
  const ms = Date.now() - started
  const base = { name: c.name, set: c.set, mode, run, way, ms }
  if (!result.ok)
    return {
      ...base,
      right: false,
      refused: false,
      invalid: true,
      broken: [],
      steps: 0,
      reply: result.message,
      stray: [],
      applied: 0,
    }
  const before = startOf(c)
  const verdict =
    c.set === 'style'
      ? judgeStyle(c as StyleCase, before, result.design)
      : judge(c as EvalCase, before, result.design)
  return {
    ...base,
    right: verdict.right,
    refused: result.applied === 0,
    invalid: false,
    broken: brokenReads(before, result.design),
    steps: result.steps,
    stopped: result.stopped,
    trail: result.trail,
    reply: result.reply,
    stray: verdict.stray,
    applied: result.applied,
    design: result.design,
  }
}

describe.skipIf(!LIVE)('Ask AI edit eval: single call against the loop (live)', () => {
  it(
    'answers the cases',
    async () => {
      const cases: AnyCase[] = [
        ...(SETS.includes('eval') ? EVAL_CASES.map((c) => ({ ...c, set: 'eval' as const })) : []),
        ...(SETS.includes('held-out')
          ? HELD_OUT_CASES.map((c) => ({ ...c, set: 'held-out' as const }))
          : []),
        ...(SETS.includes('marks') ? MARK_CASES.map((c) => ({ ...c, set: 'marks' as const })) : []),
        ...(SETS.includes('overrides')
          ? OVERRIDE_CASES.map((c) => ({ ...c, set: 'overrides' as const }))
          : []),
        ...(SETS.includes('style')
          ? STYLE_CASES.map((c) => ({ ...withImage(c), set: 'style' as const }))
          : []),
      ].filter((c) => !ONLY || c.name.includes(ONLY))
      const jobs = cases.flatMap((c) =>
        MODES.flatMap((mode) =>
          Array.from({ length: REPEATS }, (_, run) => [c, mode, run] as const)
        )
      )
      const outcomes: Outcome[] = []
      for (let at = 0; at < jobs.length; at += 4) {
        outcomes.push(
          ...(await Promise.all(
            jobs.slice(at, at + 4).map(([c, mode, run]) => runCase(c, mode, run))
          ))
        )
        if (process.env.DESIGN_EVAL_OUT)
          writeFileSync(
            process.env.DESIGN_EVAL_OUT,
            JSON.stringify({ partial: true, outcomes }, null, 2)
          )
      }
      const sum = (some: Outcome[]) => {
        const ms = some.map((o) => o.ms).sort((a, b) => a - b)
        return {
          cases: some.length,
          right: some.filter((o) => o.right).length,
          refused: some.filter((o) => o.refused).length,
          invalid: some.filter((o) => o.invalid).length,
          broken: some.filter((o) => o.broken.length > 0).length,
          looped: some.filter((o) => o.way === 'loop').length,
          meanSteps: +(some.reduce((s, o) => s + o.steps, 0) / Math.max(1, some.length)).toFixed(2),
          medianMs: ms[Math.floor(ms.length / 2)],
          p90Ms: ms[Math.floor(ms.length * 0.9)],
        }
      }
      const summary = Object.fromEntries(
        SETS.flatMap((set) =>
          MODES.map((mode) => [
            `${set}/${mode}`,
            sum(outcomes.filter((o) => o.set === set && o.mode === mode)),
          ])
        )
      )
      if (process.env.DESIGN_EVAL_OUT)
        writeFileSync(process.env.DESIGN_EVAL_OUT, JSON.stringify({ summary, outcomes }, null, 2))
      console.info(JSON.stringify(summary, null, 2))
      expect(outcomes.length).toBe(jobs.length)
    },
    120 * 60_000
  )
})
