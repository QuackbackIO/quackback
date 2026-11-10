/**
 * The verified critic loop, run against doubles: an improving revision is
 * kept; one that lowers the measured score is dropped even when the critic
 * likes it, and the best design goes back; it stops at the bar, when a round
 * gains nothing, after the most rounds, when time runs short, and on a
 * failure (keeping the best); and the whole match, kept revisions included,
 * undoes as one step.
 */
import { describe, expect, it } from 'vitest'
import {
  CHECK_BAR,
  CHECK_BUDGET,
  MAX_ROUNDS,
  checkSummary,
  combinedScore,
  criticScore,
  isBetter,
  runCheckLoop,
  type CheckDeps,
  type CheckScore,
} from '../brand-check'
import { createHistory, patchesBetween } from '../history'

type Doc = { v: number }

const score = (measured: number, critic: number): CheckScore => ({
  measured,
  critic,
  combined: combinedScore(measured, critic),
})

/** A loop over designs numbered 0, 1, 2…, each scored as the table says; revisions add one. */
function doubles(scores: CheckScore[], opts: { failAt?: number; noRevisionAt?: number } = {}) {
  let shown: Doc = { v: 0 }
  const applied: number[] = []
  const reads: number[] = []
  const deps: CheckDeps<Doc> = {
    read: async () => {
      reads.push(shown.v)
      return { fingerprint: { page: `v${shown.v}` }, picture: null }
    },
    score: async (reading) => {
      const v = Number(String(reading.fingerprint.page).slice(1))
      if (opts.failAt === v) throw new Error('critic timed out')
      return scores[v]!
    },
    revise: async (best, round) => {
      if (opts.noRevisionAt === round) return null
      const v = Number(String(best.reading.fingerprint.page).slice(1))
      return {
        changes: [{ path: 'tune.headline.size', value: 40 + round }],
        design: { v: Math.max(v, round - 1) + 1 },
      }
    },
    apply: async (design) => {
      applied.push(design.v)
      shown = design
    },
  }
  return { deps, applied, reads, shown: () => shown }
}

describe('runCheckLoop', () => {
  it('keeps a revision that improves both scores', async () => {
    const d = doubles([score(70, 6), score(80, 7), score(80, 7)])
    const report = await runCheckLoop({ v: 0 }, d.deps)
    expect(report.rounds[1]).toMatchObject({ round: 1, kept: true })
    expect(report.best).toEqual(score(80, 7))
    expect(d.shown()).toEqual({ v: 1 })
  })

  it('drops a revision that lowers the measured score, even when the critic likes it', async () => {
    const d = doubles([score(80, 6), score(78, 9.5)])
    const report = await runCheckLoop({ v: 0 }, d.deps)
    expect(report.rounds[1]).toMatchObject({ kept: false })
    expect(report.rounds[1]!.why).toMatch(/measured match fell from 80 to 78/)
    expect(report.stopped).toBe('no_gain')
    expect(report.best).toEqual(score(80, 6))
    // The candidate went on, then the best came back.
    expect(d.applied).toEqual([1, 0])
    expect(d.shown()).toEqual({ v: 0 })
  })

  it('drops a revision whose combined score does not rise, and stops', async () => {
    const d = doubles([score(80, 6), score(80, 6)])
    const report = await runCheckLoop({ v: 0 }, d.deps)
    expect(report.stopped).toBe('no_gain')
    expect(report.rounds).toHaveLength(2)
    expect(d.shown()).toEqual({ v: 0 })
  })

  it('stops at the bar without revising', async () => {
    const d = doubles([score(95, 8.5)])
    const report = await runCheckLoop({ v: 0 }, d.deps)
    expect(report.stopped).toBe('bar')
    expect(report.rounds).toHaveLength(1)
    expect(d.applied).toEqual([])
    expect(combinedScore(95, 8.5)!).toBeGreaterThanOrEqual(CHECK_BAR)
  })

  it('stops once a kept revision reaches the bar', async () => {
    const d = doubles([score(70, 6), score(95, 9), score(99, 10)])
    const report = await runCheckLoop({ v: 0 }, d.deps)
    expect(report.stopped).toBe('bar')
    expect(report.rounds).toHaveLength(2)
  })

  it('runs at most the set number of rounds', async () => {
    const d = doubles([score(60, 5), score(62, 5.5), score(64, 6), score(66, 6.5), score(68, 7)])
    const report = await runCheckLoop({ v: 0 }, d.deps)
    expect(report.stopped).toBe('rounds')
    expect(report.rounds).toHaveLength(MAX_ROUNDS + 1)
    expect(report.rounds.every((r) => r.kept)).toBe(true)
    expect(d.shown()).toEqual({ v: MAX_ROUNDS })
  })

  it('stops when nothing more is proposed', async () => {
    const d = doubles([score(60, 5)], { noRevisionAt: 1 })
    expect((await runCheckLoop({ v: 0 }, d.deps)).stopped).toBe('no_revision')
  })

  it('stops before a round that would run past the time', async () => {
    let clock = 0
    const d = doubles([score(60, 5), score(62, 5.5), score(64, 6), score(66, 6.5)])
    const slow: CheckDeps<Doc> = {
      ...d.deps,
      now: () => clock,
      score: async (reading, round) => {
        clock += 9_000
        return d.deps.score(reading, round)
      },
    }
    const report = await runCheckLoop({ v: 0 }, slow, { total: 30_000, round: 7_000 })
    expect(report.stopped).toBe('time')
    expect(report.ms).toBeLessThanOrEqual(30_000)
  })

  it('fits all three rounds in its budget at the stage times measured live', async () => {
    // 11-02c gate, 17 runs: a reading about 1s, the score with its critic about 5.5s,
    // a revision about 4.5s. The first reading and three rounds come to about 40s.
    let clock = 0
    const d = doubles([score(60, 5), score(62, 5.5), score(64, 6), score(66, 6.5)])
    const live: CheckDeps<Doc> = {
      ...d.deps,
      now: () => clock,
      read: async () => {
        clock += 1_000
        return d.deps.read()
      },
      score: async (reading, round) => {
        clock += 5_500
        return d.deps.score(reading, round)
      },
      revise: async (best, round) => {
        clock += 4_500
        return d.deps.revise(best, round)
      },
    }
    const report = await runCheckLoop({ v: 0 }, live)
    expect(report.stopped).toBe('rounds')
    expect(report.rounds).toHaveLength(MAX_ROUNDS + 1)
    expect(report.ms).toBeLessThanOrEqual(CHECK_BUDGET.total)
    expect(CHECK_BUDGET.total).toBeLessThanOrEqual(42_000)
  })

  it('drops a revision the measured score already says is worse, without asking the critic', async () => {
    const d = doubles([score(80, 6), score(70, 9)])
    const asked: number[] = []
    const report = await runCheckLoop(
      { v: 0 },
      {
        ...d.deps,
        // The measured score is worked out in the builder: 80 for the first, 70 for the candidate.
        measure: (reading) => (reading.fingerprint.page === 'v0' ? 80 : 70),
        score: async (reading, round) => {
          asked.push(round)
          return d.deps.score(reading, round)
        },
      }
    )
    expect(asked).toEqual([0])
    expect(report.rounds[1]).toMatchObject({ kept: false, score: { measured: 70, critic: null } })
    expect(report.rounds[1]!.why).toMatch(/measured match fell from 80 to 70/)
    expect(report.stopped).toBe('no_gain')
    expect(d.shown()).toEqual({ v: 0 })
  })

  it('still asks the critic when the measured score holds or rises', async () => {
    const d = doubles([score(70, 6), score(80, 7)], { noRevisionAt: 2 })
    const asked: number[] = []
    await runCheckLoop(
      { v: 0 },
      {
        ...d.deps,
        measure: (reading) => (reading.fingerprint.page === 'v0' ? 70 : 80),
        score: async (reading, round) => {
          asked.push(round)
          return d.deps.score(reading, round)
        },
      }
    )
    expect(asked).toEqual([0, 1])
  })

  it('keeps the best design when a round fails', async () => {
    const d = doubles([score(60, 5), score(70, 6)], { failAt: 2 })
    const report = await runCheckLoop({ v: 0 }, d.deps)
    expect(report.stopped).toBe('failed')
    expect(report.error).toBe('critic timed out')
    expect(d.shown()).toEqual({ v: 1 })
    expect(checkSummary(report)).toMatch(/stopped early/)
  })

  it('stops at Stop: nothing more is read, scored, revised or shown', async () => {
    const controller = new AbortController()
    const d = doubles([score(60, 5), score(70, 6), score(80, 7)])
    const revise = d.deps.revise
    const report = await runCheckLoop(
      { v: 0 },
      {
        ...d.deps,
        signal: controller.signal,
        revise: async (best, round) => {
          const candidate = await revise(best, round)
          // The person presses Stop while round 2's revision is on its way.
          if (round === 2) controller.abort()
          return candidate
        },
      }
    )
    expect(report.stopped).toBe('stopped')
    // Round 1 was kept and stays; round 2's candidate never goes on.
    expect(d.applied).toEqual([1])
    expect(d.reads).toEqual([0, 1])
    expect(d.shown()).toEqual({ v: 1 })
  })

  it('puts the best back when Stop lands while a candidate is on trial', async () => {
    const controller = new AbortController()
    const d = doubles([score(60, 5), score(70, 6)])
    const scoreOf = d.deps.score
    const report = await runCheckLoop(
      { v: 0 },
      {
        ...d.deps,
        signal: controller.signal,
        score: async (reading, round) => {
          if (round === 1) controller.abort()
          return scoreOf(reading, round)
        },
      }
    )
    expect(report.stopped).toBe('stopped')
    // The unverified candidate goes back to the match as applied, and nothing more runs.
    expect(d.applied).toEqual([1, 0])
    expect(report.rounds.filter((r) => r.round > 0)).toEqual([])
  })

  it('does nothing when stopped before it starts', async () => {
    const controller = new AbortController()
    controller.abort()
    const d = doubles([score(60, 5)])
    const report = await runCheckLoop({ v: 0 }, { ...d.deps, signal: controller.signal })
    expect(report.stopped).toBe('stopped')
    expect(d.reads).toEqual([])
    expect(d.applied).toEqual([])
  })

  it('words a kept revision by the rule that kept it: measured held and the combined score rose', () => {
    // A revision is kept when its measured match does not drop and the combined score rises:
    // one kept with the measured match unchanged must not be said to have measured better.
    const report = {
      rounds: [
        {
          round: 0,
          score: { measured: 82.5, critic: 6, combined: 7.2 },
          kept: true,
          why: '',
          changes: [],
          ms: 1,
        },
        {
          round: 1,
          score: { measured: 82.5, critic: 7, combined: 7.6 },
          kept: true,
          why: '',
          changes: [],
          ms: 1,
        },
      ],
      first: { measured: 82.5, critic: 6, combined: 7.2 },
      best: { measured: 82.5, critic: 7, combined: 7.6 },
      stopped: 'rounds' as const,
      ms: 2,
    }
    const said = checkSummary(report)
    expect(said).not.toMatch(/measured better/)
    expect(said).toMatch(
      /1 of 1 revision kept, each only when the measured match held and the overall score rose/
    )
  })

  it('says it could not check when the first reading fails', async () => {
    const d = doubles([score(60, 5)], { failAt: 0 })
    const report = await runCheckLoop({ v: 0 }, d.deps)
    expect(report.stopped).toBe('failed')
    expect(d.applied).toEqual([])
    expect(checkSummary(report)).toBe('I could not check the match, so the design is as applied.')
  })

  it('says plainly what it is doing as it goes, never a score', async () => {
    const said: string[] = []
    const d = doubles([score(60, 6), score(80, 8), score(80, 8)])
    await runCheckLoop({ v: 0 }, { ...d.deps, progress: (t) => said.push(t) })
    expect(said).toEqual(['Checking the match', 'Refining the match'])
  })
})

describe('the whole match undoes as one step', () => {
  it('groups the match, a kept revision and a dropped one under one label', async () => {
    const history = createHistory({ limit: 10, mergeMs: 0 })
    let doc: Doc = { v: -1 }
    const show = (next: Doc, label: string) => {
      const [patches, inverse] = patchesBetween(doc as never, next as never)
      history.getState().push(label, patches, inverse)
      doc = next
    }
    history.getState().begin('Match your brand')
    show({ v: 0 }, 'Match your brand')
    const d = doubles([score(70, 6), score(80, 7), score(79, 9)])
    await runCheckLoop(
      { v: 0 },
      {
        ...d.deps,
        apply: async (next) => {
          await d.deps.apply(next)
          show(next, 'Check')
        },
      }
    )
    history.getState().end()
    expect(doc).toEqual({ v: 1 })
    expect(history.getState().past).toHaveLength(1)
    expect(history.getState().past[0]!.label).toBe('Match your brand')
    expect(history.getState().undo(doc as never)?.doc).toEqual({ v: -1 })
  })
})

describe('scores', () => {
  it('weighs being the brand at a glance most', () => {
    expect(criticScore({ glance: 10, colour: 0, type: 0, shape: 0, logo: 0, fit: 0 })).toBeCloseTo(
      20 / 7,
      9
    )
    expect(criticScore({})).toBeNull()
  })

  it('combines the measured and critic scores evenly, or uses the one there is', () => {
    expect(combinedScore(80, 6)).toBe(7)
    expect(combinedScore(null, 6)).toBe(6)
    expect(combinedScore(null, null)).toBeNull()
  })

  it('compares on the measured score alone when the critic answered only once', () => {
    const noCritic = { measured: 80, critic: null, combined: 8 }
    expect(isBetter(score(80, 6), noCritic)).toBe(false)
    expect(isBetter(score(81, 4), noCritic)).toBe(true)
    expect(isBetter({ measured: 82, critic: null, combined: 8.2 }, score(80, 9))).toBe(true)
  })

  it('never counts a revision better when the measured score cannot be read', () => {
    expect(isBetter({ measured: null, critic: 9, combined: 9 }, score(80, 6))).toBe(false)
  })
})
