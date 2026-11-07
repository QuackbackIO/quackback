/**
 * Headings and tracking: the admin and portals on the old theme keep the
 * app's unlayered rules at their old specificity, while a portal on the
 * design engine sets them in the design layer, after utilities and before
 * the workspace's own CSS, so its CSS can restyle a part's type.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dir = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(dir, '../../globals.css'), 'utf8')

describe('the type rules’ layers', () => {
  it('puts the design layer after utilities and before the workspace’s CSS', () => {
    expect(css).toContain('@layer theme, base, components, utilities, design, tenant;')
  })

  it('keeps the app’s heading and tracking rules off a design engine portal, at the same specificity', () => {
    expect(css).toContain(':where(:root:not([data-portal-theme])) :is(h1, h2, h3) {')
    expect(css).toContain(':where(:root:not([data-portal-theme])) {')
    expect(css).not.toMatch(/\nh1,\s*\nh2,\s*\nh3 \{/)
    expect(css).not.toMatch(/\n:root \{\s*-webkit-font-smoothing/)
  })
})
