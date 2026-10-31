/**
 * A brand's face, as the bundled face closest to it: itself when bundled, and
 * one of its class and build when it is a well-known brand face.
 */
import { describe, expect, it } from 'vitest'
import { nearestBundledFont } from '../font-match'

describe('the bundled face closest to a brand’s', () => {
  it('is the face itself when it is bundled, however the site names it', () => {
    expect(nearestBundledFont('Fraunces')).toBe('fraunces')
    expect(nearestBundledFont('"Plus Jakarta Sans"')).toBe('jakarta')
    expect(nearestBundledFont('Inter Tight')).toBe('inter-tight')
  })

  it('is one of the same class for a well-known brand face', () => {
    expect(nearestBundledFont('sohne-var')).toBe('inter-tight')
    expect(nearestBundledFont('Salesforce-Avant-Garde')).toBe('outfit')
    expect(nearestBundledFont('Circular Std')).toBe('figtree')
    expect(nearestBundledFont('MonzoSansDisplay')).toBe('dm-sans')
    expect(nearestBundledFont('Noto IKEA')).toBe('noto-sans')
    expect(nearestBundledFont('Tiempos Headline')).toBe('source-serif')
  })

  it('leaves a face it does not know to be chosen', () => {
    expect(nearestBundledFont('Acme House Sans')).toBeNull()
    expect(nearestBundledFont(null)).toBeNull()
  })
})
