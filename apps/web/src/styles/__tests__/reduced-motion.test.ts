/**
 * Where the visitor asks for less motion, every animation and transition in
 * the app ends at once, a looping one (a pulse, a spinner) runs once rather
 * than flickering through its loop, and scrolling jumps rather than glides.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(import.meta.dirname, '../../globals.css'), 'utf8')

/** The global rule: the reduce query's block that styles every element. */
function globalReduceRule(): string {
  const blocks = css.split('@media (prefers-reduced-motion: reduce)').slice(1)
  const rule = blocks.find((block) => /^\s*\{\s*\*,\s*\*::before,\s*\*::after\s*\{/.test(block))
  return rule?.slice(0, rule.indexOf('}')) ?? ''
}

describe('the reduced motion rule', () => {
  it('ends animations and transitions, runs loops once and stops smooth scrolling', () => {
    const rule = globalReduceRule()
    expect(rule).toContain('transition-duration: 0.01ms !important')
    expect(rule).toContain('animation-duration: 0.01ms !important')
    expect(rule).toContain('animation-iteration-count: 1 !important')
    expect(rule).toContain('scroll-behavior: auto !important')
  })
})
