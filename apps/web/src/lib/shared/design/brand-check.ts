/**
 * The verified critic loop after a brand match: read the drawn preview,
 * score it (the measured fingerprint distance and an art director's critic),
 * and while the score is under the bar, try one revision at a time, keeping
 * it only when a measurement says it is better.
 *
 * Lesson from 2026-10-31: an unverified critique step made results worse
 * (6.65 to 5.89 on the judges). Here a revision is kept only when the
 * measured score does not drop and the combined score rises; anything else
 * goes back to the best so far. The loop stops at the bar, after
 * MAX_ROUNDS, when a round gains nothing, when time runs short, or on a
 * failure, which keeps the best design and says so.
 *
 * Pure: the reading, scoring, revising and applying are passed in, so the
 * builder runs it against its canvas and tests run it against doubles.
 */
import type { Fingerprint } from './fingerprint'

/** Revision rounds at most, after the first reading. */
export const MAX_ROUNDS = 3
/** The combined score (0 to 10) at which the match is good enough to stop. */
export const CHECK_BAR = 8.5
/**
 * The whole loop's time, ms, and what a round takes. Measured live (11-02c
 * gate, 17 runs): a reading about 1s, a score with its critic about 5.5s, a
 * revision about 4.5s, so a round about 11s and the first reading about 6.5s:
 * three rounds come to about 40s. A round the measured score already rejects
 * skips the critic and takes about 6s.
 */
export const CHECK_BUDGET = { total: 40_000, round: 11_000 }

/** What the critic weighs, each 0 to 10. */
export const CRITIC_DIMENSIONS = ['glance', 'colour', 'type', 'shape', 'logo', 'fit'] as const
export type CriticDimension = (typeof CRITIC_DIMENSIONS)[number]

/** How much each dimension counts: being this brand at a glance most. */
export const CRITIC_WEIGHTS: Record<CriticDimension, number> = {
  glance: 2,
  colour: 1.5,
  type: 1,
  shape: 1,
  logo: 0.5,
  fit: 1,
}

/** The critic's dimensions as one 0 to 10 score. */
export function criticScore(dims: Partial<Record<CriticDimension, number>>): number | null {
  let total = 0
  let weight = 0
  for (const d of CRITIC_DIMENSIONS) {
    const v = dims[d]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    total += Math.max(0, Math.min(10, v)) * CRITIC_WEIGHTS[d]
    weight += CRITIC_WEIGHTS[d]
  }
  return weight ? total / weight : null
}

/** The measured score (0 to 100) and the critic's (0 to 10) as one 0 to 10 score, evenly. */
export function combinedScore(measured: number | null, critic: number | null): number | null {
  const parts = [measured === null ? null : measured / 10, critic].filter(
    (v): v is number => v !== null
  )
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null
}

/** A score as the chat says it: one decimal, none when whole. */
export const sayScore = (v: number) => String(Math.round(v * 10) / 10)

export interface CheckScore {
  /** The fingerprint distance, 0 to 100; null when nothing could be compared. */
  measured: number | null
  /** The critic's weighted score, 0 to 10; null when it could not be asked. */
  critic: number | null
  /** Both, 0 to 10. */
  combined: number | null
}

export interface CheckReading {
  fingerprint: Fingerprint
  /** The drawn preview as a JPEG data URL, or null when it could not be captured. */
  picture: string | null
}

export interface CheckChange {
  path: string
  value: unknown
  why?: string
}

export interface CheckCandidate<D> {
  changes: CheckChange[]
  design: D
}

export interface CheckRound {
  /** 0 is the reading after the brand match; 1 to MAX_ROUNDS are revisions. */
  round: number
  score: CheckScore
  /** Whether the revision was kept; the first reading is always kept. */
  kept: boolean
  why: string
  changes: CheckChange[]
  ms: number
}

export type CheckStop = 'bar' | 'rounds' | 'no_gain' | 'no_revision' | 'time' | 'failed'

export interface CheckReport {
  rounds: CheckRound[]
  /** The first reading's score and the best kept. */
  first: CheckScore | null
  best: CheckScore | null
  stopped: CheckStop
  /** What went wrong, when the loop stopped on a failure. */
  error?: string
  ms: number
}

export interface CheckDeps<D, S extends CheckScore = CheckScore> {
  /** Reads the drawn preview, after it has settled. */
  read: () => Promise<CheckReading>
  score: (reading: CheckReading, round: number) => Promise<S>
  /**
   * The measured score (0 to 100) of a reading, worked out without the
   * critic: a candidate whose measured score is already below the best is
   * dropped without asking the critic, as it could never be kept.
   */
  measure?: (reading: CheckReading) => number | null
  /** A revision of the best so far, from its score; null when there is nothing to try. */
  revise: (
    best: { reading: CheckReading; score: S },
    round: number
  ) => Promise<CheckCandidate<D> | null>
  /** Shows a design on the draft (a candidate, or the best again). */
  apply: (design: D) => Promise<void>
  progress?: (text: string) => void
  now?: () => number
}

/**
 * Whether a revision is better: the measured score holds and the combined
 * score rises. When the critic answered for only one of the two, the
 * combined scores are not alike, so the measured score alone must rise.
 */
export function isBetter(next: CheckScore, best: CheckScore): boolean {
  if (next.measured === null && best.measured !== null) return false
  if (next.measured !== null && best.measured !== null && next.measured < best.measured)
    return false
  if ((next.critic === null) !== (best.critic === null))
    return next.measured !== null && best.measured !== null && next.measured > best.measured
  if (next.combined === null || best.combined === null) return false
  return next.combined > best.combined
}

const whyOf = (next: CheckScore, best: CheckScore): string => {
  if (next.measured !== null && best.measured !== null && next.measured < best.measured)
    return `measured match fell from ${sayScore(best.measured)} to ${sayScore(next.measured)}`
  if ((next.critic === null) !== (best.critic === null))
    return isBetter(next, best)
      ? `measured match rose (the critic answered only once)`
      : `measured match did not rise (the critic answered only once)`
  if (next.combined === null || best.combined === null) return 'could not be scored'
  return next.combined > best.combined
    ? `combined score rose from ${sayScore(best.combined)} to ${sayScore(next.combined)}`
    : `combined score did not rise (${sayScore(best.combined)} to ${sayScore(next.combined)})`
}

export async function runCheckLoop<D, S extends CheckScore = CheckScore>(
  start: D,
  deps: CheckDeps<D, S>,
  budget: { total: number; round: number } = CHECK_BUDGET
): Promise<CheckReport> {
  const now = deps.now ?? Date.now
  const began = now()
  const rounds: CheckRound[] = []
  const say = (text: string) => deps.progress?.(text)
  let bestDesign = start
  let best: { reading: CheckReading; score: S } | null = null
  let first: CheckScore | null = null
  // Whether the draft shows a candidate that is not the best.
  let trying = false
  const report = (stopped: CheckStop, error?: string): CheckReport => ({
    rounds,
    first,
    best: best?.score ?? null,
    stopped,
    ...(error ? { error } : {}),
    ms: now() - began,
  })
  // Said plainly while it runs, never as scores.
  const progress = () => {
    if (rounds.length > 1) say('Refining the match')
  }

  try {
    say('Checking the match')
    let t = now()
    const reading = await deps.read()
    const score = await deps.score(reading, 0)
    best = { reading, score }
    first = score
    rounds.push({
      round: 0,
      score,
      kept: true,
      why: 'the match as applied',
      changes: [],
      ms: now() - t,
    })
    progress()
    for (let round = 1; ; round++) {
      if (best.score.combined !== null && best.score.combined >= CHECK_BAR) return report('bar')
      if (round > MAX_ROUNDS) return report('rounds')
      if (now() - began + budget.round > budget.total) return report('time')
      t = now()
      const candidate = await deps.revise(best, round)
      if (!candidate || !candidate.changes.length) return report('no_revision')
      trying = true
      await deps.apply(candidate.design)
      const next = await deps.read()
      const quick = deps.measure?.(next) ?? null
      const fell: boolean =
        quick !== null && best.score.measured !== null && quick < best.score.measured
      const nextScore: S = fell
        ? ({ measured: quick, critic: null, combined: combinedScore(quick, null) } as S)
        : await deps.score(next, round)
      const kept = isBetter(nextScore, best.score)
      const why = whyOf(nextScore, best.score)
      rounds.push({ round, score: nextScore, kept, why, changes: candidate.changes, ms: now() - t })
      if (!kept) {
        await deps.apply(bestDesign)
        trying = false
        return report('no_gain')
      }
      trying = false
      bestDesign = candidate.design
      best = { reading: next, score: nextScore }
      progress()
    }
  } catch (err) {
    // A failure keeps the best design: a candidate on show goes back.
    if (trying) await deps.apply(bestDesign).catch(() => {})
    return report('failed', err instanceof Error ? err.message : String(err))
  }
}

/** The loop's outcome in a line for the chat. */
export function checkSummary(report: CheckReport): string {
  if (report.stopped === 'failed' && !report.first)
    return 'I could not check the match, so the design is as applied.'
  const kept = report.rounds.filter((r) => r.round > 0 && r.kept).length
  const tried = report.rounds.filter((r) => r.round > 0).length
  const from = report.first?.combined
  const to = report.best?.combined
  const scores =
    from != null && to != null
      ? kept
        ? `${sayScore(from)} to ${sayScore(to)} out of 10`
        : `${sayScore(to)} out of 10`
      : null
  const parts = [
    scores ? `Checked the match: ${scores}` : 'Checked the match',
    tried
      ? `${kept} of ${tried} revision${tried === 1 ? '' : 's'} kept, each only when the measured match held and the overall score rose`
      : null,
  ].filter(Boolean)
  const tail =
    report.stopped === 'failed' ? ' The check stopped early, so the best design so far stays.' : ''
  return `${parts.join('; ')}.${tail}`
}
