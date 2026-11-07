/**
 * A brand's face, as the bundled face closest to it: itself when bundled, and
 * one of its class and build when it is a well-known typeface, and the open
 * family a company's own cut of one is cut from.
 */
import { describe, expect, it } from 'vitest'
import { nearestBundledFont } from '../font-match'

describe('the bundled face closest to a brand’s', () => {
  it('is the face itself when it is bundled, however the site names it', () => {
    expect(nearestBundledFont('Fraunces')).toBe('fraunces')
    expect(nearestBundledFont('"Plus Jakarta Sans"')).toBe('jakarta')
    expect(nearestBundledFont('Inter Tight')).toBe('inter-tight')
  })

  it('is one of the same class for a well-known typeface', () => {
    expect(nearestBundledFont('sohne-var')).toBe('inter-tight')
    expect(nearestBundledFont('Acme-Avant-Garde')).toBe('outfit')
    expect(nearestBundledFont('Circular Std')).toBe('figtree')
    expect(nearestBundledFont('Cera Pro')).toBe('dm-sans')
    expect(nearestBundledFont('Tiempos Headline')).toBe('source-serif')
    expect(nearestBundledFont('Neue Haas Display')).toBe('archivo')
    expect(nearestBundledFont('Monument Extended')).toBe('unbounded')
    expect(nearestBundledFont('Rockwell')).toBe('roboto-slab')
    expect(nearestBundledFont('Bodoni 72')).toBe('bodoni-moda')
    expect(nearestBundledFont('SF Pro Rounded')).toBe('quicksand')
  })

  it('is the open family a company cut its own face from', () => {
    expect(nearestBundledFont('AcmeInter')).toBe('inter')
    expect(nearestBundledFont('Acme Inter')).toBe('inter')
    expect(nearestBundledFont('Noto Acme')).toBe('noto-sans')
    // Not a cut: a name that merely ends in the letters, or a Noto style of its own.
    expect(nearestBundledFont('Winter')).toBeNull()
    expect(nearestBundledFont('Noto Serif Display')).not.toBe('noto-sans')
  })

  it('reads a stack in order, as a browser does', () => {
    expect(nearestBundledFont('Acme-Avant-Garde, "Helvetica Neue", Helvetica, sans-serif')).toBe(
      'outfit'
    )
    expect(nearestBundledFont('Acme Sans, Fraunces, serif')).toBe('fraunces')
    // A generic fallback is not the brand's face; leading the stack, it is.
    expect(nearestBundledFont('Grotesk, system-ui, sans-serif')).toBeNull()
    expect(nearestBundledFont('system-ui, sans-serif')).toBe('system')
  })

  it('leaves a face it does not know to be chosen', () => {
    expect(nearestBundledFont('Acme House Sans')).toBeNull()
    expect(nearestBundledFont(null)).toBeNull()
  })
})
