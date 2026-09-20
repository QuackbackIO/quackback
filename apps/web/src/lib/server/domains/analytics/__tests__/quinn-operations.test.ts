/**
 * The operational summary's rate maths (QUINN-PRODUCT Step 11, P8).
 *
 * The property that matters most here is the empty one: a range with no runs
 * reports null for every rate, never zero, so a surface renders an honest
 * blank and explains the next step instead of printing a 0% nobody measured.
 */
import { describe, expect, it } from 'vitest'
import { summarizeQuinnRuns, type QuinnRunRow } from '../quinn-operations'

const base = new Date('2026-03-01T00:00:00.000Z')
const at = (offsetMs: number) => new Date(base.getTime() + offsetMs)

function run(overrides: Partial<QuinnRunRow> = {}): QuinnRunRow {
  return {
    status: 'succeeded',
    outcome: 'answer',
    disposition: null,
    createdAt: base,
    startedAt: at(1_000),
    finishedAt: at(5_000),
    ...overrides,
  }
}

describe('summarizeQuinnRuns', () => {
  it('reports nothing rather than zero when there were no runs', () => {
    const summary = summarizeQuinnRuns([])
    expect(summary.runs).toBe(0)
    expect(summary.failureRate).toBeNull()
    expect(summary.supersessionRate).toBeNull()
    expect(summary.unsupportedRate).toBeNull()
    expect(summary.queueToStartP50Ms).toBeNull()
    expect(summary.queueToStartP95Ms).toBeNull()
    expect(summary.totalP50Ms).toBeNull()
  })

  it('counts each terminal state as itself', () => {
    const summary = summarizeQuinnRuns([
      run(),
      run({ status: 'failed' }),
      run({ status: 'superseded' }),
      run({ status: 'suppressed' }),
      run({ status: 'cancelled' }),
      run({ status: 'running', finishedAt: null }),
      run({ status: 'waiting_action', finishedAt: null }),
    ])
    expect(summary.published).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.superseded).toBe(1)
    expect(summary.suppressed).toBe(1)
    expect(summary.cancelled).toBe(1)
    // Open is a backlog, not an outcome: both non-terminal states land here.
    expect(summary.open).toBe(2)
    expect(summary.runs).toBe(7)
  })

  it('reads an unsupported answer off the validator fence, not off the outcome', () => {
    const summary = summarizeQuinnRuns([
      run({ status: 'suppressed', disposition: 'validation:unsupported' }),
      run({ status: 'suppressed', disposition: 'engine:suppressed' }),
      run({ status: 'cancelled', disposition: 'fence:handed_off' }),
      run(),
    ])
    expect(summary.unsupported).toBe(1)
    expect(summary.unsupportedRate).toBe(25)
  })

  it('measures the wait before a worker claimed the turn', () => {
    const summary = summarizeQuinnRuns([
      run({ startedAt: at(1_000) }),
      run({ startedAt: at(3_000) }),
      run({ startedAt: at(9_000), finishedAt: at(20_000) }),
    ])
    expect(summary.queueToStartP50Ms).toBe(3_000)
    expect(summary.queueToStartP95Ms).toBe(9_000)
    expect(summary.totalP50Ms).toBe(5_000)
  })

  it('ignores a run that never started rather than counting it as instant', () => {
    const summary = summarizeQuinnRuns([
      run({ status: 'superseded', startedAt: null, finishedAt: at(2_000) }),
      run({ startedAt: at(4_000) }),
    ])
    expect(summary.queueToStartP50Ms).toBe(4_000)
  })

  it('accepts the string timestamps a raw query hands back', () => {
    const summary = summarizeQuinnRuns([
      {
        status: 'succeeded',
        outcome: 'answer',
        disposition: null,
        createdAt: '2026-03-01T00:00:00.000Z',
        startedAt: '2026-03-01T00:00:02.000Z',
        finishedAt: '2026-03-01T00:00:06.000Z',
      },
    ])
    expect(summary.queueToStartP50Ms).toBe(2_000)
    expect(summary.totalP50Ms).toBe(6_000)
  })

  it('reports a failure rate only against the runs it actually saw', () => {
    const summary = summarizeQuinnRuns([run({ status: 'failed' }), run(), run(), run()])
    expect(summary.failureRate).toBe(25)
    expect(summary.supersessionRate).toBe(0)
  })
})

it('separates substantive answers from inability, clarification, greeting and handoff', () => {
  const summary = summarizeQuinnRuns(
    ['answer', 'inability', 'clarification', 'greeting', 'handoff'].map((outcome) =>
      run({ outcome })
    )
  )
  expect(summary).toMatchObject({ published: 5, answered: 1, unanswered: 2 })
})
