import { describe, expect, it } from 'vitest'
import { telemetryOutcome } from '../payload'

const steps = { core: true, workspace: true, startingPoint: null }

describe('the onboarding outcome telemetry reports', () => {
  it('reports the status page goal', () => {
    expect(
      telemetryOutcome({ version: 2, steps, useCase: 'status_page', goals: ['status_page'] })
    ).toBe('status_page')
  })

  it('reports private feedback as internal feedback', () => {
    expect(
      telemetryOutcome({
        version: 2,
        steps,
        useCase: 'product_feedback',
        goals: ['product_feedback'],
        feedbackPrivate: true,
      })
    ).toBe('internal')
    expect(
      telemetryOutcome({ version: 2, steps, useCase: 'product_feedback', feedbackPrivate: false })
    ).toBe('product_feedback')
  })

  it('reports nothing without a goal', () => {
    expect(telemetryOutcome(null)).toBeNull()
    expect(telemetryOutcome({ version: 2, steps })).toBeNull()
  })
})
