import { describe, expect, it } from 'vitest'
import type { SetupState } from '@/lib/shared/db-types'
import {
  LAUNCH_WINDOW_DAYS,
  isFirstWinInLaunchWindow,
  isLaunchWindowOpen,
  launchWindowFor,
  setupCompletedAt,
} from '../launch-window'

const DAY = 86_400_000
const created = '2026-10-01T09:00:00.000Z'
const createdMs = Date.parse(created)

function state(overrides: Partial<SetupState> = {}): SetupState {
  return {
    version: 2,
    steps: {
      core: true,
      workspace: true,
      startingPoint: {
        outcome: 'product_feedback',
        resourceType: 'none',
        source: 'wizard',
        resolution: 'deferred',
        completedAt: '2026-10-01T09:05:00.000Z',
      },
    },
    completedAt: '2026-10-01T09:05:00.000Z',
    ...overrides,
  }
}

describe('setupCompletedAt', () => {
  it('takes the earliest recorded completion', () => {
    expect(
      setupCompletedAt(
        state({
          completedAt: '2026-10-03T00:00:00.000Z',
          steps: {
            ...state().steps,
            startingPoint: {
              ...state().steps.startingPoint!,
              completedAt: '2026-10-02T00:00:00.000Z',
            },
          },
        })
      )
    ).toBe('2026-10-02T00:00:00.000Z')
    expect(setupCompletedAt(state({ completedAt: undefined }))).toBe('2026-10-01T09:05:00.000Z')
  })

  it('is null before setup finishes or for unreadable timestamps', () => {
    expect(setupCompletedAt(null)).toBeNull()
    expect(
      setupCompletedAt(
        state({
          completedAt: 'not a date',
          steps: { core: true, workspace: true, startingPoint: null },
        })
      )
    ).toBeNull()
  })
})

describe('launchWindowFor', () => {
  it('opens at setup completion for a workspace set up when it was created', () => {
    expect(launchWindowFor({ setupState: state(), workspaceCreatedAt: created })).toEqual({
      startsAt: '2026-10-01T09:05:00.000Z',
      endsAt: new Date(
        Date.parse('2026-10-01T09:05:00.000Z') + LAUNCH_WINDOW_DAYS * DAY
      ).toISOString(),
    })
    expect(
      launchWindowFor({ setupState: state(), workspaceCreatedAt: new Date(createdMs) })?.startsAt
    ).toBe('2026-10-01T09:05:00.000Z')
  })

  it('gives an established workspace whose completion is stamped late no window', () => {
    const stampedOnUpgrade = new Date(createdMs + 200 * DAY).toISOString()
    expect(
      launchWindowFor({
        setupState: state({
          completedAt: stampedOnUpgrade,
          steps: {
            core: true,
            workspace: true,
            startingPoint: { ...state().steps.startingPoint!, completedAt: stampedOnUpgrade },
          },
        }),
        workspaceCreatedAt: created,
      })
    ).toBeNull()
  })

  it('keeps a setup finished just inside the window of creation', () => {
    const late = new Date(createdMs + LAUNCH_WINDOW_DAYS * DAY).toISOString()
    const window = launchWindowFor({
      setupState: state({ completedAt: late, steps: { ...state().steps, startingPoint: null } }),
      workspaceCreatedAt: created,
    })
    expect(window?.startsAt).toBe(late)
    expect(
      launchWindowFor({
        setupState: state({
          completedAt: new Date(createdMs + LAUNCH_WINDOW_DAYS * DAY + 1).toISOString(),
          steps: { ...state().steps, startingPoint: null },
        }),
        workspaceCreatedAt: created,
      })
    ).toBeNull()
  })

  it('has no window without a creation time or a completed setup', () => {
    expect(launchWindowFor({ setupState: state(), workspaceCreatedAt: null })).toBeNull()
    expect(launchWindowFor({ setupState: null, workspaceCreatedAt: created })).toBeNull()
  })
})

describe('isLaunchWindowOpen', () => {
  const window = launchWindowFor({ setupState: state(), workspaceCreatedAt: created })
  const start = Date.parse('2026-10-01T09:05:00.000Z')

  it('is open from setup completion through the last day', () => {
    expect(isLaunchWindowOpen(window, start)).toBe(true)
    expect(isLaunchWindowOpen(window, start + 13 * DAY)).toBe(true)
    expect(isLaunchWindowOpen(window, start + LAUNCH_WINDOW_DAYS * DAY)).toBe(true)
  })

  it('is closed after the window and for a workspace without one', () => {
    expect(isLaunchWindowOpen(window, start + LAUNCH_WINDOW_DAYS * DAY + 1)).toBe(false)
    expect(isLaunchWindowOpen(null, start)).toBe(false)
    expect(isLaunchWindowOpen(undefined, start)).toBe(false)
  })

  it('treats a legacy completion at the epoch as long closed', () => {
    const legacy = launchWindowFor({
      setupState: state({
        completedAt: undefined,
        steps: {
          core: true,
          workspace: true,
          startingPoint: {
            ...state().steps.startingPoint!,
            completedAt: '1970-01-01T00:00:00.000Z',
          },
        },
      }),
      workspaceCreatedAt: created,
    })
    expect(isLaunchWindowOpen(legacy, createdMs)).toBe(false)
  })
})

describe('isFirstWinInLaunchWindow', () => {
  const window = launchWindowFor({ setupState: state(), workspaceCreatedAt: created })

  it('counts a win after setup completion and inside the window', () => {
    expect(isFirstWinInLaunchWindow('2026-10-02T00:00:00.000Z', window)).toBe(true)
    expect(isFirstWinInLaunchWindow(window!.endsAt, window)).toBe(true)
  })

  it('ignores a win before setup finished, after the window, or without a window', () => {
    expect(isFirstWinInLaunchWindow('2026-10-01T09:00:00.000Z', window)).toBe(false)
    expect(
      isFirstWinInLaunchWindow(new Date(Date.parse(window!.endsAt) + 1).toISOString(), window)
    ).toBe(false)
    expect(isFirstWinInLaunchWindow('2026-10-02T00:00:00.000Z', null)).toBe(false)
    expect(isFirstWinInLaunchWindow(null, window)).toBe(false)
    expect(isFirstWinInLaunchWindow('garbage', window)).toBe(false)
  })
})
