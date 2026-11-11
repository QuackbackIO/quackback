// @vitest-environment happy-dom
/**
 * The builder's one swatch: an edge that shows on any colour in either
 * mode, a hatched fill for none, and a split for a light and dark pair.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Swatch } from '../swatch'

afterEach(cleanup)

const drawn = (node: Parameters<typeof render>[0]) =>
  render(node).container.firstElementChild as HTMLElement

describe('Swatch', () => {
  it('edges every colour in the text colour, so a dark one shows in dark mode', () => {
    const swatch = drawn(<Swatch colour="#0a0a0a" />)
    expect(swatch.className).toContain('border-foreground/25')
    expect(swatch.className).not.toContain('border-border')
    expect(swatch.style.background).not.toBe('')
  })

  it('hatches no colour, and splits a light and dark pair', () => {
    expect(drawn(<Swatch colour={undefined} />).className).toContain('repeating-linear-gradient')
    cleanup()
    const pair = drawn(<Swatch colour="#ffffff" dark="#000000" />)
    expect(pair.dataset.swatch).toBe('half')
    expect(pair.style.background).toContain('linear-gradient')
  })
})
