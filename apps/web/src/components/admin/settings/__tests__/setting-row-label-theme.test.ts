import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '../../../../globals.css'), 'utf8')

/** Declarations of the rule whose selector is exactly `selector`. */
function declarations(selector: string): string | undefined {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) return undefined
  return css.slice(start, css.indexOf('}', start))
}

describe('theme setting row labels', () => {
  const formLabel = '[data-settings-page] [data-slot="label"]'
  const rowLabel = '[data-settings-page] [data-slot="setting-row"] [data-slot="label"]'

  it('keeps form field labels at 13px semibold', () => {
    const rule = declarations(formLabel)
    expect(rule).toContain('font-size: 13px')
    expect(rule).toContain('font-weight: 600')
  })

  it('sets a setting row label to 14px medium with a more specific, later rule', () => {
    const rule = declarations(rowLabel)
    expect(rule).toContain('font-size: 14px')
    expect(rule).toContain('font-weight: 500')
    expect(css.indexOf(rowLabel)).toBeGreaterThan(css.indexOf(formLabel))
  })
})
