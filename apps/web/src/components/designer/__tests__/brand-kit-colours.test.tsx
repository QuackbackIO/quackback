// @vitest-environment happy-dom
/**
 * Readability lives on the colour rows: the Colours heading says whether
 * every pair reads, and a text colour that is hard to read says so on its
 * row with a one-click fix to the nearest colour that reads.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

const { BrandKitColours } = await import('../brand-kit-colours')
const { colourPairs } = await import('@/lib/shared/design/colour-pairs')

/** A target at least 24px tall, as small text links and buttons are given. */
const at24 = (el: Element) => expect(el.className).toMatch(/(^|\s)(min-h-6|size-6|min-h-7)(\s|$)/)

afterEach(cleanup)

const seen: { design: PortalDesign | null } = { design: null }

function Harness({ start }: { start: PortalDesign }) {
  const [design, setDesign] = useState(start)
  return (
    <BrandKitColours
      design={design}
      update={(change) =>
        setDesign((before) => {
          const next = structuredClone(before)
          change(next)
          seen.design = next
          return next
        })
      }
    />
  )
}

/** Types a hex into the open picker of a colour row. */
function typeHex(name: string, hex: string) {
  const field = screen.getByRole('textbox', { name })
  fireEvent.change(field, { target: { value: hex } })
  fireEvent.blur(field)
}

describe('From your logo', () => {
  it('offers the logo colours beside the brand colour; one sets it', () => {
    const design = defaultDesign()
    design.brand.light.accent = '#0058a3'
    design.brand.logoColours = ['#0058a3', '#e4002b', '#111111']
    render(<Harness start={design} />)
    const group = screen.getByRole('group', { name: 'From your logo' })
    // Its name sits on one line, in the rows' label column.
    expect(within(group).getByText('From your logo').className).toContain('whitespace-nowrap')
    // The colour already in use is not offered again.
    expect(within(group).queryByRole('button', { name: /#0058a3/ })).toBeNull()
    fireEvent.click(within(group).getByRole('button', { name: 'Use #e4002b as brand colour' }))
    expect(seen.design?.brand.light.accent).toBe('#e4002b')
  })

  it('shows nothing until the logo has colours', () => {
    render(<Harness start={defaultDesign()} />)
    expect(screen.queryByRole('group', { name: 'From your logo' })).toBeNull()
  })
})

describe('BrandKitColours', () => {
  it('says every pair reads well when they do', () => {
    render(<Harness start={defaultDesign()} />)
    // Quiet: the mark shows, its words are for a screen reader and on hover.
    expect(screen.getByText('Every pair reads well').className).toContain('sr-only')
    expect(screen.queryByRole('button', { name: /^Fix/ })).toBeNull()
  })

  it('counts no part colour that is not drawn, as it has no row to fix it on', () => {
    // A white subtitle on a navy hero, with titles that sit on the white page: none reads on both.
    const design = defaultDesign()
    design.brand.light.accent = '#0b1f4d'
    design.layout.hero = 'brand'
    design.tune = { subtitle: { colour: '#ffffff' } }
    expect(colourPairs(design).some((pair) => pair.unused && !pair.passes)).toBe(true)
    render(<Harness start={design} />)
    expect(screen.getByText('Every pair reads well')).toBeTruthy()
  })

  it('marks a text colour that is hard to read on its row, and fixes it in one click', () => {
    const design = defaultDesign()
    design.brand.light.ink = '#bbbbbb'
    render(<Harness start={design} />)
    expect(screen.getByText(/Hard to read on the page/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Fix Text' }))
    expect(screen.queryByText(/Hard to read on/)).toBeNull()
  })

  it('names the default brand colour by its hex, never as it is stored', () => {
    render(<Harness start={defaultDesign()} />)
    const accent = document.getElementById('kit-accent')!
    expect(accent.textContent).not.toMatch(/oklch/i)
    expect(accent.textContent).toMatch(/#[0-9a-f]{6}/i)
    expect(accent.getAttribute('aria-label')).toMatch(/^Brand colour: #[0-9a-f]{6}$/i)
  })

  it('shows each colour as a variable row with its value', () => {
    const design = defaultDesign()
    design.brand.light.accent = '#1d4ed8'
    render(<Harness start={design} />)
    const accent = screen.getByRole('button', { name: 'Brand colour: #1d4ed8' })
    expect(accent.textContent).toBe('#1d4ed8')
    expect(accent.getAttribute('data-colour-state')).toBe('set')
    expect(document.getElementById('kit-ink')!.getAttribute('aria-label')).toMatch(/^Text: /)
    expect(document.getElementById('kit-background')!.getAttribute('aria-label')).toMatch(/^Page: /)
  })

  it('keeps the worked-out colours under More, Auto until set, then a dot and Reset', () => {
    render(<Harness start={defaultDesign()} />)
    const cards = screen.getByRole('button', { name: 'Cards: Auto' })
    expect(cards.closest('details')?.open).toBe(false)
    for (const name of ['Raised', 'Secondary text', 'Borders'])
      expect(screen.getByRole('button', { name: `${name}: Auto` })).toBeTruthy()
    fireEvent.click(cards)
    typeHex('Cards', '#fafafa')
    expect(seen.design?.brand.light.surface).toBe('#fafafa')
    fireEvent.click(screen.getByRole('button', { name: 'Reset to auto' }))
    expect(seen.design?.brand.light).not.toHaveProperty('surface')
  })

  it('adds a second colour with "+ Add colour", writing nothing until one is picked', () => {
    seen.design = null
    render(<Harness start={defaultDesign()} />)
    expect(screen.queryByLabelText('Second colour')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add colour' }))
    expect(seen.design).toBeNull()
    typeHex('Second colour', '#0ea5e9')
    expect(seen.design!.brand.light.support).toBe('#0ea5e9')
    fireEvent.click(screen.getByRole('button', { name: 'Remove second colour' }))
    expect(seen.design!.brand.light).not.toHaveProperty('support')
  })

  it('names dark mode’s colours as light’s, each Auto until set', () => {
    render(<Harness start={defaultDesign()} />)
    const dark = document.querySelector('[data-dark-values]')!
    for (const name of ['Page', 'Text', 'Brand colour'])
      expect(
        within(dark as HTMLElement).getByRole('button', { name: `Dark mode: ${name}: Auto` })
      ).toBeTruthy()
  })

  it('gives Reset all to auto a target 24px tall, once dark mode has its own colours', () => {
    const design = defaultDesign()
    design.brand.dark = { accent: '#38bdf8' }
    render(<Harness start={design} />)
    at24(screen.getByRole('button', { name: 'Reset all to auto' }))
  })

  it('shows no dark mode row for a light-only design', () => {
    const design = defaultDesign()
    design.mode = 'light'
    render(<Harness start={design} />)
    expect(document.querySelector('[data-dark-values]')).toBeNull()
  })
})
