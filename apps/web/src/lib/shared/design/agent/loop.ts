/**
 * Ask AI's edit loop: plan and act, check what was drawn, correct, within a
 * few steps and a time budget. Each step is one model answer (step-schema.ts)
 * applied to the draft by the server; the builder then reads the drawn
 * preview for what the answer said to check, judges it (verify.ts), and
 * hands the results to the next step. It ends when a step says it is done
 * and every check it can see is met, or when the steps or the time run out,
 * and says plainly what it changed, what it checked, and what it could not
 * do. Every change across the steps is one list, each field once, so the
 * whole request is one step to undo.
 *
 * Pure: the model, the draft and the preview come in as dependencies, so
 * the builder, the server and the eval run the same loop.
 */
import type { AppliedDesignChange, DesignAiScope } from '../apply-changes'
import { alsoNotes, oneSentence, reachClause, withReach } from '../ai-reach'
import { plainReasons, plainWords } from '../colour-names'
import type { DesignerPage } from '../paths'
import type { PortalDesign } from '../schema'
import type { AgentStepAnswer } from './step-schema'
import {
  hostKey,
  matchText,
  readingText,
  type WebsiteMatch,
  type WebsiteReading,
} from './website-tool'
import { mergeChanges, roleColour, type LoopApplyOutcome } from './style-ops'
import { readOverrideOp, setAsOverride } from '../override-ops'
import {
  placeOf,
  propertyOf,
  targetKey,
  targetWords,
  type StyleRegistry,
  type StyleTarget,
} from './style-registry'
import {
  evaluateCheck,
  readabilityChecks,
  uniqueChecks,
  type CheckResult,
  type Readings,
  type StyleCheck,
} from './verify'

/** What a step did, as the next step reads it. */
export interface LoopTurn {
  step: number
  plan: string
  did: string[]
  refused: Array<{ what: string; reason: string }>
  /** Each check, as seen: met, failed or not seen. */
  checks: Array<{ ok: boolean | null; saw: string }>
}

/** Values read as drawn, in words, for the model. */
export interface ReadNote {
  target: string
  values: Record<string, string>
}

export interface StepRequest {
  step: number
  /** The steps before, in order. */
  turns: LoopTurn[]
  /** Elements read as drawn since the last step: before acting, or as a step asked. */
  readings: ReadNote[]
  /** A small picture of the page as drawn, where a step asked to see one. */
  picture: string | null
  /** Whether this is the last step the budget allows. */
  last: boolean
  /** What the website tools gave since the request began, as text for the model. */
  website?: string[]
  /** A capture of a website read, for the model to see. */
  capture?: string | null
}

export type StepReply =
  | {
      ok: true
      answer: AgentStepAnswer
      outcome: Omit<LoopApplyOutcome, 'design'>
      design: PortalDesign
    }
  | { ok: false; code: string; message: string }

export interface LoopDeps {
  /** One model step, applied to the draft. */
  step: (request: StepRequest) => Promise<StepReply>
  /** Reads targets as drawn: in the design now, or in the design before the request. */
  read: (targets: StyleTarget[], which: 'before' | 'now') => Promise<Readings>
  /** A small picture of the page as drawn now, or null. */
  picture?: () => Promise<string | null>
  /** Says what the loop is doing, as a step in the conversation. */
  progress?: (line: string) => void
  now?: () => number
  /** read_website: the site's facts and a capture (as a JPEG data URL), cache first. */
  readWebsite?: (url: string) => Promise<{ reading: WebsiteReading; capture: string | null }>
  /**
   * match_website: the whole brand match on the site, saved to the draft; its
   * design after. Given only for a request about the whole site: a request
   * about one part borrows from a site with read_website.
   */
  matchWebsite?: (
    url: string
  ) => Promise<{ match: WebsiteMatch; design: PortalDesign | null; applied: AppliedDesignChange[] }>
}

export interface LoopBudget {
  /** Model steps at most. */
  steps: number
  /** Time, ms: no step starts once a step's usual time would pass it. */
  ms: number
}

export const LOOP_BUDGET: LoopBudget = { steps: 4, ms: 24_000 }

export interface StepRecord {
  step: number
  plan: string
  did: string[]
  refused: Array<{ what: string; reason: string }>
  checks: CheckResult[]
  /** Time the step's model call and apply took, and the reading after it, ms. */
  ms: { step: number; read: number }
}

export type LoopResult =
  | {
      ok: true
      reply: string
      design: PortalDesign
      applied: AppliedDesignChange[]
      steps: StepRecord[]
      /** Checks that failed in the last step that made any. */
      unmet: CheckResult[]
      refused: Array<{ what: string; reason: string }>
      /**
       * What the reply leaves to Show changes: what was left alone and why,
       * what did not come out as asked, what else a change reaches.
       */
      notes: string[]
      /** Why it ended; `stopped` is the person's Stop. */
      stopped: 'done' | 'steps' | 'time' | 'failed' | 'stalled' | 'stopped'
      ms: number
    }
  | { ok: false; code: string; message: string }

/** The steps' lines, for the conversation: what each did and what it checked. */
export function trailOf(steps: readonly StepRecord[]): string[] {
  return steps.map((record) => {
    const met = record.checks.filter((c) => c.ok === true).length
    const failed = record.checks.filter((c) => c.ok === false).length
    const seen = record.checks.filter((c) => c.ok !== null).length
    const unseen = record.checks.length - seen
    const checked = !record.checks.length
      ? ''
      : seen === 0
        ? ' Not on the page checked, so not measured.'
        : ` Checked ${met}/${seen}${failed ? `, ${failed} to correct` : ''}${unseen ? `; ${unseen} not on the page checked` : ''}.`
    const did = record.did.length
      ? ` ${record.did.length} change${record.did.length === 1 ? '' : 's'}.`
      : ''
    return `${record.step + 1}. ${record.plan.trim() || 'Changed the design.'}${did}${checked}`
  })
}

const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`

/** What a request stopped by the person says: whether anything it did stays. */
export const stoppedReply = (changed: boolean) =>
  changed ? 'Stopped. What changed so far stays.' : 'Stopped. Nothing changed.'

/**
 * The reply, said only of what happened, in one sentence: what changed, how
 * far it reached beyond the page shown, and that the loop stopped early
 * where it did. Everything else is said under Show changes (loopNotes).
 */
export function loopReply(input: {
  answer: AgentStepAnswer | null
  applied: readonly AppliedDesignChange[]
  done: readonly string[]
  refused: ReadonlyArray<{ what: string; reason: string }>
  unmet: readonly CheckResult[]
  stopped: Extract<LoopResult, { ok: true }>['stopped']
  /** Parts of the request left alone because they are outside what was picked. */
  leftAlone?: readonly string[]
  /** How far the changes reached beyond the page shown, such as "on every page". */
  reach?: string
}): string {
  const { answer, applied, done, refused, unmet } = input
  if (input.stopped === 'stopped') return stoppedReply(applied.length > 0)
  const why = plainReasons(refused.map((each) => each.reason))
  if (applied.length === 0) {
    if (refused.length > 0)
      return why ? `Nothing changed: ${why}.` : 'Nothing changed: I could not do that here.'
    if (input.leftAlone?.length) return 'That is outside what was picked, so nothing changed.'
    return plainWords(oneSentence(answer?.reply?.trim() || 'Nothing changed.'))
  }
  const clean = unmet.length === 0 && refused.length === 0 && !!answer?.done
  const said =
    clean && answer?.reply.trim()
      ? oneSentence(answer.reply)
      : `I changed ${[...new Set(done)].slice(0, 8).map(lowerFirst).join(', ')}.`
  const reached = withReach(said, input.reach ?? '')
  const stoppedEarly = input.stopped === 'time' || input.stopped === 'failed'
  return plainWords(
    stoppedEarly
      ? `${reached.replace(/[.!]+$/, '')}, but I stopped before checking everything.`
      : reached
  )
}

/** What the reply leaves to Show changes, each a short line. */
export function loopNotes(input: {
  unmet: readonly CheckResult[]
  refused: ReadonlyArray<{ what: string; reason: string }>
  leftAlone: readonly string[]
  applied: readonly AppliedDesignChange[]
  /** Notes the steps brought, such as the language words were written in. */
  own: readonly string[]
  scope: DesignAiScope
}): string[] {
  const why = plainReasons(input.refused.map((each) => each.reason))
  const left = [...new Set(input.leftAlone)]
  return [
    ...(input.applied.length && input.unmet.length
      ? ['Some of it did not come out as asked, so ask again to finish.']
      : []),
    ...(left.length
      ? [`Left alone, as it is outside what was picked: ${left.map(lowerFirst).join(', ')}.`]
      : []),
    ...(input.applied.length && input.refused.length
      ? [why ? `I left the rest: ${why}.` : 'I could not do the rest here.']
      : []),
    ...alsoNotes(input.applied, input.scope),
    ...new Set(input.own),
  ].map(plainWords)
}

const uniqueTargets = (targets: readonly StyleTarget[]) => {
  const seen = new Set<string>()
  return targets.filter((t) => {
    const key = targetKey(t)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The targets a check needs read: its own, and the element at rest when it compares with that. */
function checkTargets(check: StyleCheck): StyleTarget[] {
  const own: StyleTarget = {
    element: check.element,
    state: check.state,
    block: check.block,
    ...(placeOf(check) ? { target: placeOf(check) } : {}),
  }
  const relative = ['darker', 'lighter', 'more', 'less'].includes(check.expect)
  return relative && check.state !== 'base' && check.value !== 'before'
    ? [own, { ...own, state: 'base' }]
    : [own]
}

/** A check's value as a colour where it names a role ("is accent"), so it can be measured. */
function withRoleColour(
  registry: StyleRegistry,
  check: StyleCheck,
  design: PortalDesign
): StyleCheck {
  if (check.expect !== 'is' || propertyOf(registry, check.property)?.kind !== 'colour') return check
  const hex = roleColour(design, check.value.trim().toLowerCase())
  return hex ? { ...check, value: hex } : check
}

/**
 * The overrides a step set, as the element, state and property each styles
 * where it went, so the text on a fill or a colour set for one place is
 * checked there as a style's is everywhere.
 */
function overrideStyles(
  design: PortalDesign,
  ops: AgentStepAnswer['ops']
): Array<StyleTarget & { property: string; phone: boolean }> {
  return ops.flatMap((op) => {
    const named = op.op === 'set' ? setAsOverride(design, op) : null
    const asOverride =
      op.op === 'override' || /^(overrides|stylePhone)\./.test(op.key)
        ? { target: op.target, key: op.key, value: op.value }
        : named
    if (!asOverride) return []
    const read = readOverrideOp(design, asOverride.target, asOverride.key, asOverride.value)
    if (!read.ok) return []
    const { where, element, state, prop, layer } = read.read
    const target =
      where.kind === 'part'
        ? `part:${where.part.id}`
        : where.kind === 'page'
          ? `page:${where.page}`
          : where.kind === 'block'
            ? `block:${where.block}`
            : ''
    return [
      {
        element,
        state,
        block: '',
        ...(target ? { target } : {}),
        property: prop,
        phone: layer === 'phone',
      },
    ]
  })
}

const needsBefore = (check: StyleCheck) =>
  (['darker', 'lighter', 'more', 'less'].includes(check.expect) &&
    (check.value === 'before' || check.state === 'base')) ||
  check.expect === 'changed'

const notes = (registry: StyleRegistry, targets: readonly StyleTarget[], readings: Readings) =>
  targets.flatMap((target) => {
    const reading = readings[targetKey(target)]
    if (!reading?.found) return []
    return [{ target: targetWords(registry, target), values: reading.values }]
  })

/** Runs a request through the loop. */
export async function runEditLoop(input: {
  registry: StyleRegistry
  /** The draft before the request. */
  design: PortalDesign
  /** The elements the request names, read before the first step. */
  targets: readonly StyleTarget[]
  deps: LoopDeps
  budget?: LoopBudget
  /** What was picked and the page shown, for how far the reply says the changes reached. */
  pick?: { scope: DesignAiScope; page?: DesignerPage }
  /** The person's Stop: no step starts after it, and what applied stays. */
  signal?: AbortSignal
}): Promise<LoopResult> {
  const { registry, deps } = input
  const budget = input.budget ?? LOOP_BUDGET
  const now = deps.now ?? (() => Date.now())
  const started = now()
  const records: StepRecord[] = []
  const turns: LoopTurn[] = []
  const lists: AppliedDesignChange[][] = []
  const refused: Array<{ what: string; reason: string }> = []
  const done: string[] = []
  const leftAlone: string[] = []
  const own: string[] = []
  let design = input.design
  let answer: AgentStepAnswer | null = null
  let unmet: CheckResult[] = []
  let stopped: Extract<LoopResult, { ok: true }>['stopped'] = 'steps'
  let idle = 0
  const active = new Map<string, StyleCheck>()
  // Elements' properties set by an override for phones only, and for every screen.
  const phoneOnly = new Set<string>()
  const allScreens = new Set<string>()

  const baseTargets = uniqueTargets(input.targets)
  if (baseTargets.length) deps.progress?.('Step 1: reading the preview')
  const before: Readings = baseTargets.length ? await deps.read([...baseTargets], 'before') : {}
  let readings = notes(registry, baseTargets, before)
  let picture: string | null = null
  // The website tools' results, each site read and matched once a request.
  const website: string[] = []
  let capture: string | null = null
  const readSites = new Map<string, { reading: WebsiteReading; capture: string | null }>()
  const matchedSites = new Set<string>()
  let matchReply: string | null = null
  // The website tools' own time (a capture, a match) is not the steps' budget.
  let toolMs = 0

  // Whether anything has landed in the draft: a step that fails after one did keeps it.
  const changed = () => lists.some((list) => list.length > 0)
  try {
    for (let step = 0; step < budget.steps; step++) {
      if (input.signal?.aborted) {
        stopped = 'stopped'
        break
      }
      const spent = now() - started - toolMs
      const usual = records.length
        ? records.reduce((sum, r) => sum + r.ms.step + r.ms.read, 0) / records.length
        : 0
      if (step > 0 && spent + usual > budget.ms) {
        stopped = 'time'
        break
      }
      deps.progress?.(
        step === 0
          ? 'Step 1: planning the change'
          : `Step ${step + 1}: correcting what the check found`
      )
      const stepStart = now()
      let reply: StepReply
      try {
        reply = await deps.step({
          step,
          turns: [...turns],
          readings,
          picture,
          last: step === budget.steps - 1,
          ...(website.length ? { website: [...website] } : {}),
          ...(capture ? { capture } : {}),
        })
      } catch (err) {
        // A step cut off by Stop: what the steps before applied stays.
        if (!input.signal?.aborted) throw err
        stopped = 'stopped'
        break
      }
      const stepMs = now() - stepStart
      if (!reply.ok) {
        if (records.length === 0 && !changed()) return reply
        stopped = 'failed'
        break
      }
      answer = reply.answer
      design = reply.design
      lists.push(reply.outcome.applied)
      refused.push(...reply.outcome.refused)
      done.push(...reply.outcome.done)
      const outside = reply.outcome.outOfScope ?? []
      leftAlone.push(...outside)
      own.push(...(reply.outcome.notes ?? []))
      // read_website and match_website: once a site, whatever the model asks.
      capture = null
      const toolStart = now()
      const toRead = hostKey(answer.read_website ?? '')
      if (toRead && deps.readWebsite) {
        const kept = readSites.get(toRead)
        if (kept) website.push(`${toRead} is already read; use the result above.`)
        else {
          deps.progress?.(`Reading ${toRead}`)
          const got = await deps.readWebsite(answer.read_website)
          readSites.set(toRead, got)
          website.push(readingText(got.reading))
          capture = got.capture
        }
      }
      const toMatch = hostKey(answer.match_website ?? '')
      if (toMatch && !deps.matchWebsite)
        website.push(
          'match_website is not offered: only part of the site was picked. Use read_website to borrow from a site.'
        )
      if (toMatch && deps.matchWebsite && !matchedSites.has(toMatch)) {
        matchedSites.add(toMatch)
        deps.progress?.(`Matching ${toMatch}`)
        const matched = await deps.matchWebsite(answer.match_website)
        website.push(matchText(matched.match))
        if (matched.design) {
          design = matched.design
          lists.push(matched.applied)
          done.push(`matched ${toMatch}`)
          matchReply = matched.match.reply
        }
      }
      const usedTools = !!toRead || !!toMatch
      toolMs += now() - toolStart

      // verify: every check so far (a correction is held to what the first step meant),
      // read as drawn, with what the step asked to read.
      const overridden = overrideStyles(design, answer.ops)
      for (const set of overridden)
        if (set.phone) phoneOnly.add(`${set.element}|${set.property}`)
        else allScreens.add(`${set.element}|${set.property}`)
      for (const style of answer.styles) allScreens.add(`${style.element}|${style.property}`)
      for (const check of uniqueChecks([
        ...answer.checks,
        ...readabilityChecks([...answer.styles, ...overridden.filter((set) => !set.phone)]),
      ] as StyleCheck[]))
        // A check restated for the same element and property replaces the one before.
        active.set(`${targetKey(check)}|${check.property}`, check)
      const checks = [...active.values()]
      const asked = answer.read.map((r) => ({ ...r }) as StyleTarget)
      const targets = uniqueTargets([...checks.flatMap(checkTargets), ...asked])
      const readStart = now()
      if (targets.length) deps.progress?.(`Step ${step + 1}: checking the drawn preview`)
      const drawn = targets.length ? await deps.read(targets, 'now') : {}
      const missing = uniqueTargets(
        checks
          .filter(needsBefore)
          .flatMap(checkTargets)
          .filter((t) => !before[targetKey(t)])
      )
      if (missing.length) Object.assign(before, await deps.read(missing, 'before'))
      picture = answer.look && deps.picture ? await deps.picture() : null
      const readMs = now() - readStart
      // What was set for phones only is not on the page as read, at full width: not measured.
      const results = checks.map((check): CheckResult => {
        const key = `${check.element}|${check.property}`
        if (phoneOnly.has(key) && !allScreens.has(key))
          return {
            check,
            ok: null,
            saw: `${targetWords(registry, check)}: ${check.property} on phones, not measured at full width`,
          }
        return evaluateCheck(registry, withRoleColour(registry, check, design), drawn, before)
      })
      const failing = results.filter((r) => r.ok === false)
      unmet = failing

      records.push({
        step,
        plan: answer.plan,
        did: reply.outcome.done,
        refused: reply.outcome.refused,
        checks: results,
        ms: { step: stepMs, read: readMs },
      })
      turns.push({
        step,
        plan: answer.plan,
        did: reply.outcome.done,
        // What was left outside the pick, so the next step can put it on the pick instead.
        refused: [
          ...reply.outcome.refused,
          ...outside.map((what) => ({ what, reason: 'outside what was picked: left alone' })),
        ],
        checks: results.map((r) => ({ ok: r.ok, saw: r.saw })),
      })
      readings = notes(registry, asked, drawn)

      if (answer.done && failing.length === 0 && !usedTools) {
        stopped = 'done'
        break
      }
      // A step that neither changes, reads nor finds anything to correct twice running is stuck.
      const acted =
        reply.outcome.done.length > 0 || asked.length > 0 || failing.length > 0 || usedTools
      idle = acted ? 0 : idle + 1
      if (idle >= 2) {
        stopped = 'stalled'
        break
      }
    }
  } catch (err) {
    // Stopped by the person: what applied stays. Otherwise, nothing changed: the
    // request failed as a whole; something did: it stays, with its Undo.
    if (input.signal?.aborted) stopped = 'stopped'
    else if (!changed()) throw err
    else stopped = 'failed'
  }

  const applied = mergeChanges(input.design, design, lists)
  const scope = input.pick?.scope ?? 'site'
  const reach = reachClause(design, applied, {
    scope,
    ...(input.pick?.page ? { page: input.pick.page } : {}),
  })
  const said = loopReply({ answer, applied, done, refused, unmet, stopped, leftAlone, reach })
  return {
    ok: true,
    // A match says what it did; what the steps added is under Show changes.
    reply: matchReply ? plainWords(oneSentence(matchReply)) : said,
    design,
    applied,
    steps: records,
    unmet,
    refused,
    notes: loopNotes({ unmet, refused, leftAlone, applied, own, scope }),
    stopped,
    ms: now() - started,
  }
}
