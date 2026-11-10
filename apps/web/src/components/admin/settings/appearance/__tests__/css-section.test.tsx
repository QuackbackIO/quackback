// @vitest-environment happy-dom
/**
 * Custom CSS: the editor writes the draft's CSS, emptying it
 * removes it, and "Fix it for me" swaps each internal class for its part,
 * only where the class name is whole.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

vi.mock('@/components/admin/settings/branding/custom-css-editor', () => ({
  CustomCssEditor: ({ value, onChange }: { value: string; onChange: (css: string) => void }) => (
    <textarea aria-label="CSS" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))

const { CssFields, applyFixes } = await import('../css-section')

const NAV = { find: '.portal-nav__item', replace: '[data-qb-part="nav-item"]' }
const ACTIVE = {
  find: '.portal-nav__item--active',
  replace: '[data-qb-part="nav-item"][data-state="active"]',
}

describe('applyFixes', () => {
  it('swaps whole class names, the longest first', () => {
    expect(
      applyFixes(
        '.portal-nav__item { a: b } .portal-nav__item--active { c: d } .portal-nav__item-x {}',
        [
          { message: '', fix: NAV },
          { message: '', fix: ACTIVE },
        ]
      )
    ).toBe(
      '[data-qb-part="nav-item"] { a: b } [data-qb-part="nav-item"][data-state="active"] { c: d } .portal-nav__item-x {}'
    )
  })
})

function renderSection(
  start: PortalDesign,
  warnings = [] as Parameters<typeof CssFields>[0]['warnings']
) {
  const seen = { design: start }
  function Harness() {
    const [design, setDesign] = useState(start)
    return (
      <CssFields
        design={design}
        warnings={warnings}
        update={(change) => {
          const next = structuredClone(design)
          change(next)
          seen.design = next
          setDesign(next)
        }}
      />
    )
  }
  render(<Harness />)
  return seen
}

afterEach(cleanup)

describe('Custom CSS', () => {
  it('lists the hero’s parts by their hero names, never band', () => {
    renderSection(defaultDesign())
    const list = screen.getByText(/Parts:/).textContent ?? ''
    expect(list).toMatch(/\bhero, hero-image, hero-foot-image\b/)
    expect(list).toContain('post-hero')
    expect(list).not.toMatch(/band/)
  })

  it('writes the draft’s CSS, and emptying it removes it', async () => {
    const seen = renderSection(defaultDesign())
    const editor = await screen.findByRole('textbox', { name: 'CSS' })
    fireEvent.change(editor, {
      target: { value: '[data-qb-part="post-card"] { border-width: 2px; }' },
    })
    expect(seen.design.css).toBe('[data-qb-part="post-card"] { border-width: 2px; }')
    fireEvent.change(editor, { target: { value: '  ' } })
    expect('css' in seen.design).toBe(false)
  })

  it('lists the warnings and fixes internal classes on request', async () => {
    const doc = defaultDesign()
    doc.css = '.portal-nav__item--active { font-weight: 700; }'
    const seen = renderSection(doc, [
      { message: '.portal-nav__item--active is internal and may change.', line: 1, fix: ACTIVE },
      { message: '!important on color.', line: 1 },
    ])
    expect(screen.getByRole('list', { name: 'CSS warnings' }).textContent).toContain(
      'Line 1: !important on color.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Fix it for me' }))
    expect(seen.design.css).toBe(
      '[data-qb-part="nav-item"][data-state="active"] { font-weight: 700; }'
    )
  })
})
