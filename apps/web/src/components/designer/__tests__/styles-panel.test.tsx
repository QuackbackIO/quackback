// @vitest-environment happy-dom
/**
 * Styles, under Theme's More options: how the portal uses the brand kit.
 * Opening it never changes the design. It lists only the parts the modules
 * that are on draw, and its Advanced, which holds custom CSS, is counted when
 * opened. (Corners are in Theme itself; the hero's look is in its own panel.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import type { PortalPageGates } from '@/lib/shared/design/paths'

const events = vi.hoisted(() => ({
  designerAdvancedOpened: vi.fn(),
  designerLookChosen: vi.fn(),
}))
vi.mock('@/lib/client/builder-events', () => events)
vi.mock('@/lib/server/functions/portal-design-saved', () => ({
  listPortalDesignSavedFn: async () => ({ checkpoints: [], looks: [] }),
  savePortalDesignFn: vi.fn(),
  getPortalDesignCheckpointFn: vi.fn(),
  deletePortalDesignSavedFn: vi.fn(),
}))
vi.mock('@/components/admin/settings/branding/custom-css-editor', () => ({
  CustomCssEditor: ({ value, onChange }: { value: string; onChange: (css: string) => void }) => (
    <textarea aria-label="CSS" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))

const { StylesPanel } = await import('../styles-panel')

const ALL_ON: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

/** A hero as Quackback AI leaves it. */
function imported(): PortalDesign {
  const design = defaultDesign()
  design.layout.band = 'brand'
  design.layout.bandShape = 'split'
  design.layout.bandArt = 'petals'
  return design
}

function renderPanel(start: PortalDesign, gates: PortalPageGates = ALL_ON) {
  const seen = { design: start, updates: 0 }
  function Harness() {
    const [design, setDesign] = useState(start)
    return (
      <StylesPanel
        design={design}
        gates={gates}
        update={(change) => {
          seen.updates += 1
          const next = structuredClone(design)
          change(next)
          seen.design = next
          setDesign(next)
        }}
      />
    )
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>
  )
  return { seen }
}

afterEach(() => {
  cleanup()
  events.designerAdvancedOpened.mockReset()
})

describe('opening Styles', () => {
  it('changes nothing, even with Advanced open', async () => {
    const start = imported()
    const before = structuredClone(start)
    const { seen } = renderPanel(start)
    const details = screen.getByText('Advanced').closest('details')!
    details.open = true
    await screen.findByLabelText('CSS')
    expect(seen.updates).toBe(0)
    expect(seen.design).toEqual(before)
  })
})

describe('what Theme already has', () => {
  it('leaves the looks to Theme’s Style, never a second picker here', () => {
    renderPanel(imported())
    expect(screen.queryByRole('heading', { name: 'Looks' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Looks' })).toBeNull()
  })
})

describe('the elements', () => {
  it('lists vote boxes only while Feedback is on, and opens the element panel in place', () => {
    renderPanel(defaultDesign())
    fireEvent.click(screen.getByRole('button', { name: /^Vote boxes/ }))
    expect(screen.getByRole('heading', { name: 'Vote boxes' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Where it is' }).textContent).toBe(
      'StylesVote boxes'
    )
    // Opened from Styles, it is every vote box, with no one-offs.
    expect(document.querySelector('[data-scope-line] p')!.textContent).toBe(
      'Changing every vote box'
    )
    expect(screen.queryByRole('button', { name: 'This page' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Styles' }))
    expect(screen.getByRole('button', { name: /^Vote boxes/ })).toBeTruthy()
    cleanup()
    renderPanel(defaultDesign(), { ...ALL_ON, feedback: false })
    expect(screen.queryByRole('button', { name: /^Vote boxes/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^Main buttons/ })).toBeTruthy()
  })

  it('lists every element in one list, each with its brand choices and what is set', () => {
    const design = defaultDesign()
    design.shape.buttons = 'pill'
    design.style = { button: { base: { radius: 4 }, hover: { background: 'support' } } }
    renderPanel(design)
    expect(screen.getByRole('button', { name: /^Main buttons/ }).textContent).toBe(
      'Main buttons2 set·Brand colour · Pill'
    )
    for (const name of ['Cards', 'Menu items', 'Page headlines', 'Home blocks', 'Images', 'Logo'])
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toBeTruthy()
    expect(screen.queryByText(/and \d+ more/)).toBeNull()
  })

  it('sets a brand choice and an exact value from the element’s panel, and keeps no second copy', () => {
    const { seen } = renderPanel(defaultDesign())
    fireEvent.click(screen.getByRole('button', { name: /^Main buttons/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'Pill' }))
    expect(seen.design.shape.buttons).toBe('pill')
    fireEvent.change(screen.getByLabelText('Corners'), { target: { value: '6' } })
    expect(seen.design.style).toEqual({ button: { base: { radius: 6 } } })
    expect(seen.design.tune).toBeUndefined()
    expect(screen.queryByText(/Exact values/)).toBeNull()
  })

  it('keeps the logo’s own settings, with a way back', () => {
    renderPanel(defaultDesign())
    fireEvent.click(screen.getByRole('button', { name: /^Logo/ }))
    expect(screen.getByRole('heading', { name: 'Logo' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Styles' }))
    expect(screen.getByRole('button', { name: /^Logo/ })).toBeTruthy()
  })
})

describe('Advanced', () => {
  it('is closed at first, counts each opening and holds the custom CSS', async () => {
    const { seen } = renderPanel(defaultDesign())
    expect(screen.queryByLabelText('CSS')).toBeNull()
    expect(events.designerAdvancedOpened).not.toHaveBeenCalled()
    const details = screen.getByText('Advanced').closest('details')!
    details.open = true
    await waitFor(() => expect(events.designerAdvancedOpened).toHaveBeenCalledWith('site:styles'))
    fireEvent.change(await screen.findByLabelText('CSS'), {
      target: { value: '[data-qb-part="post-card"] { color: red; }' },
    })
    expect(seen.design.css).toBe('[data-qb-part="post-card"] { color: red; }')
    // Closing is not an opening.
    details.open = false
    await waitFor(() => expect(screen.queryByLabelText('CSS')).toBeNull())
    expect(events.designerAdvancedOpened).toHaveBeenCalledTimes(1)
  })
})
