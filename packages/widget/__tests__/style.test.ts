// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { ensureStyles, removeStyles } from '../src/core/style'

function css(): string {
  return document.getElementById('quackback-widget-styles')?.textContent ?? ''
}

// The floating panel's base rule, before any media query.
function floatingRule(): string {
  const text = css()
  return text.slice(0, text.indexOf('}') + 1)
}

function expandedRule(): string {
  const text = css()
  const start = text.indexOf('.quackback-panel.quackback-expanded{')
  return text.slice(start, text.indexOf('}', start) + 1)
}

const VERTICAL_INSETS = 'env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px)'

describe('floating panel styles', () => {
  afterEach(() => removeStyles())

  // On a wide page drawn under the system bars (viewport-fit=cover), the
  // launcher moves in by the safe-area insets; the panel above it follows.
  it.each(['left', 'right'] as const)(
    'sits above a launcher moved in by the insets (%s)',
    (side) => {
      ensureStyles(side)
      const rule = floatingRule()
      expect(rule).toContain('bottom:calc(88px + env(safe-area-inset-bottom,0px))')
      expect(rule).toContain(`${side}:calc(24px + env(safe-area-inset-${side},0px))`)
      expect(rule).toContain(`calc(100vh - 108px - ${VERTICAL_INSETS})`)
    }
  )

  it('keeps the expanded panel inside the insets and below the top edge', () => {
    ensureStyles('right')
    const rule = expandedRule()
    expect(rule).toContain(
      'calc(100vw - 48px - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px))'
    )
    expect(rule).toContain(`calc(100vh - 108px - ${VERTICAL_INSETS})`)
  })
})
