import { describe, expect, it } from 'vitest'
import { homeCopilotState } from '../copilot-on-home'

describe('Copilot on Home', () => {
  it('is live while the workspace has AI allowance left, or no cap at all', () => {
    expect(homeCopilotState({ enabled: true, credits: 'available' }, true)).toEqual({
      kind: 'live',
    })
    // An older server leaves credits out: that means available.
    expect(homeCopilotState({ enabled: true }, true)).toEqual({ kind: 'live' })
  })

  it('is paused, saying until when, once the allowance for the period is used', () => {
    expect(
      homeCopilotState(
        { enabled: true, credits: 'used', resetsAt: '2026-11-01T00:00:00.000Z', trial: false },
        true
      )
    ).toEqual({ kind: 'paused', resetsAt: '2026-11-01T00:00:00.000Z', trial: false })
  })

  it('is paused for the rest of a trial whose allowance is used, with no reset to name', () => {
    expect(
      homeCopilotState({ enabled: true, credits: 'used', resetsAt: null, trial: true }, true)
    ).toEqual({ kind: 'paused', resetsAt: null, trial: true })
    // An older server says nothing of a trial.
    expect(homeCopilotState({ enabled: true, credits: 'used' }, true)).toEqual({
      kind: 'paused',
      resetsAt: null,
      trial: false,
    })
  })

  it('is not on Home where AI is not set up, or a plan has no AI allowance at all', () => {
    // No AI keys on a self-hosted install: the server says Copilot is not available.
    expect(homeCopilotState({ enabled: false }, true)).toEqual({ kind: 'off' })
    expect(homeCopilotState({ enabled: true, credits: 'none' }, true)).toEqual({ kind: 'off' })
    // The flag or the permission is off, or nothing was asked yet.
    expect(homeCopilotState({ enabled: true, credits: 'available' }, false)).toEqual({
      kind: 'off',
    })
    expect(homeCopilotState(undefined, true)).toEqual({ kind: 'off' })
  })
})
