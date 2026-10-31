/**
 * A brand's measurements become exact values a person would choose: rounded
 * to steps, held within what a page can carry, and silent where nothing was
 * measured.
 */
import { describe, expect, it } from 'vitest'
import { tuneSchema } from '../tune'
import { tuneFromMeasurements } from '../measured-tune'

describe('exact values from a brand’s measurements', () => {
  it('rounds type and shapes to steps a person would choose', () => {
    const tune = tuneFromMeasurements({
      headline: { size: 48.4, weight: 310, tracking: -0.0198, leading: 1.1500001 },
      heading: { size: 32, weight: 300, tracking: 0.002, leading: 1.1 },
      label: { size: 14, weight: 425, leading: 1.4 },
      button: { radius: 4, height: 40.2 },
      card: { radius: 6, borderWidth: 0, shadow: false },
      field: { radius: 1000 },
    })
    expect(tune).toEqual({
      headline: { size: 48, weight: 300, tracking: -0.02, leading: 1.15 },
      // A 32px light section heading titles a card at 21px, eased to read at that size.
      heading: { size: 21, weight: 400, tracking: 0, leading: 1.15 },
      label: { size: 14, weight: 400 },
      button: { radius: 4, height: 40 },
      card: { radius: 6, border: 0, shadow: 'none' },
      field: { radius: 999 },
    })
    expect(tuneSchema.safeParse(tune).success).toBe(true)
  })

  it('holds what it measured within what a page can carry', () => {
    const tune = tuneFromMeasurements({
      headline: { size: 260, weight: 1000, leading: 3 },
      heading: { size: 58 },
      button: { height: 90, radius: 60 },
      card: { radius: 80, borderWidth: 9 },
    })
    expect(tune.headline).toEqual({ size: 88, weight: 900, leading: 1.8 })
    // A marketing section's hero-sized heading titles a card here.
    expect(tune.heading).toEqual({ size: 24 })
    expect(tune.button).toEqual({ radius: 60, height: 60 })
    expect(tune.card).toEqual({ radius: 32, border: 4 })
    expect(tuneSchema.safeParse(tune).success).toBe(true)
  })

  it('keeps the colours and button type it measured', () => {
    const tune = tuneFromMeasurements({
      headline: { size: 64, colour: '#163300' },
      label: { size: 15, colour: '#163300' },
      button: { fill: '#163300', ink: '#9FE870', weight: 600, upper: true },
    })
    expect(tune.headline).toEqual({ size: 64, colour: '#163300' })
    // A label's colour is the menu's own, not one a tune sets.
    expect(tune.label).toEqual({ size: 15 })
    expect(tune.button).toEqual({ fill: '#163300', ink: '#9fe870', weight: 600, case: 'upper' })
    expect(tuneSchema.safeParse(tune).success).toBe(true)
  })

  it('sets nothing it did not measure', () => {
    expect(tuneFromMeasurements({ headline: null, button: { radius: null } })).toEqual({})
  })
})
