// @vitest-environment happy-dom
/**
 * Theme, a sheet over the right panel, on the properties frame: titled
 * sections in a fixed order (brand kit, colours, fonts, style, elements, site
 * images, advanced), the elements always in view, custom CSS under a closed
 * Advanced, and the places set differently at its foot. No paragraphs in the
 * normal state. The hero's settings are its own, never here, and opening
 * Theme writes nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import type { PortalPageGates } from '@/lib/shared/design/paths'

const events = vi.hoisted(() => ({
  designerAdvancedOpened: vi.fn(),
  designerLookChosen: vi.fn(),
}))
vi.mock('@/lib/client/builder-events', () => events)
vi.mock('@/lib/client/queries/portal-design', () => ({
  portalDesignQueries: {
    aiStatus: () => ({ queryKey: ['ai-status'], queryFn: async () => ({ available: true }) }),
    saved: () => ({ queryKey: ['saved'], queryFn: async () => ({ checkpoints: [], looks: [] }) }),
  },
}))
vi.mock('@/lib/server/functions/portal-design-saved', () => ({
  listPortalDesignSavedFn: async () => ({ checkpoints: [], looks: [] }),
  savePortalDesignFn: vi.fn(),
  getPortalDesignCheckpointFn: vi.fn(),
  deletePortalDesignSavedFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/uploads', () => ({
  getWordmarkUploadUrlFn: vi.fn(),
  getFaviconUploadUrlFn: vi.fn(),
  getShareImageUploadUrlFn: vi.fn(),
  getBandImageUploadUrlFn: vi.fn(),
  getFontUploadUrlFn: vi.fn(),
  checkS3ConfiguredFn: async () => ({ configured: true }),
}))
vi.mock('@/components/admin/settings/branding/custom-css-editor', () => ({
  CustomCssEditor: ({ value, onChange }: { value: string; onChange: (css: string) => void }) => (
    <textarea aria-label="CSS" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))

const { ThemeContent } = await import('../theme-sheet')
const { DESIGN_PRESETS, replaceDesign } = await import('@/lib/shared/design/presets')
const { withLook } = await import('@/lib/shared/design/looks')

const ALL_ON: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

/** A band as Quackback AI leaves it. */
function imported(): PortalDesign {
  const design = defaultDesign()
  design.layout.band = 'brand'
  design.layout.bandShape = 'split'
  design.layout.bandArt = 'petals'
  return design
}

function renderTheme(
  start: PortalDesign,
  { page = null as string | null, gates = ALL_ON, more = false } = {}
) {
  const seen = { design: start, updates: 0, labels: [] as string[] }
  const jumps: string[] = []
  function Harness() {
    const [design, setDesign] = useState(start)
    return (
      <ThemeContent
        design={design}
        gates={gates}
        logoUrl={null}
        cssWarnings={[]}
        more={more}
        page={page}
        onOverride={(o) => jumps.push(o.id)}
        update={(change, label) => {
          seen.updates += 1
          seen.labels.push(label ?? '')
          const next = structuredClone(design)
          change(next)
          seen.design = next
          setDesign(next)
        }}
      />
    )
  }
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>
  )
  return { seen, jumps, view }
}

const radio = (group: string, name: string) =>
  within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name })
const advanced = () => screen.getByRole('button', { name: 'Advanced' })

afterEach(() => {
  cleanup()
  events.designerAdvancedOpened.mockReset()
})

describe('Theme', () => {
  it('opening it writes nothing, even over a hero no look makes', async () => {
    const start = imported()
    const before = structuredClone(start)
    const { seen } = renderTheme(start)
    expect(seen.updates).toBe(0)
    expect(seen.design).toEqual(before)
  })

  it('is titled sections in a fixed order, with no paragraph in the normal state', () => {
    const { view } = renderTheme(defaultDesign())
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Brand kit',
      'Colours',
      'Fonts',
      'Style',
      'Elements',
      'Site images',
      'Advanced',
    ])
    // One kind of disclosure at the top level: Advanced. Nothing hides under More.
    expect(view.container.querySelector('#theme-more')).toBeNull()
    expect(view.container.querySelector('[data-theme-sheet] > details')).toBeNull()
    expect(view.container.textContent).not.toMatch(/All of this is in your draft/)
    expect(view.container.textContent).not.toMatch(/set under Colours/)
  })

  it('keeps brand-wide settings only: the hero’s are in its own panel', () => {
    const start = defaultDesign()
    start.brand.bandImage = { key: 'portal-images/room.jpg' }
    start.brand.light.support = '#0ea5e9'
    renderTheme(start)
    fireEvent.click(advanced())
    for (const gone of [
      /top of each page/i,
      // The custom CSS part names (band, band-image) are code, not words.
      /\b(top|the) band\b|\bband (image|look|options|colour)/i,
      /\bhero\b/i,
      /header blends/i,
      /call to action/i,
      /image sits/i,
    ])
      expect(screen.queryAllByText(gone), String(gone)).toEqual([])
    expect(screen.queryByLabelText('Image description')).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Art' })).toBeNull()
  })

  it('sets the corners and the appearance from tiles, named as everywhere', () => {
    const { seen } = renderTheme(defaultDesign())
    const corners = within(screen.getByRole('radiogroup', { name: 'Corners' }))
      .getAllByRole('radio')
      .map((r) => r.textContent)
    expect(corners).toEqual(['Sharp', 'Soft', 'Round', 'Pill'])
    fireEvent.click(radio('Corners', 'Soft'))
    expect(seen.design.shape.corners).toBe('subtle')
    fireEvent.click(radio('Appearance', 'Auto'))
    expect(seen.design.mode).toBe('auto')
    fireEvent.click(radio('Appearance', 'Dark'))
    expect(seen.design.mode).toBe('dark')
  })

  it('names the look the draft has, or Custom, and opens the looks to choose one', () => {
    const start = defaultDesign()
    const preset = DESIGN_PRESETS[1]!
    replaceDesign(start, withLook(start, preset.look))
    renderTheme(start)
    expect(screen.getByRole('button', { name: `Look: ${preset.label}` })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `Look: ${preset.label}` }))
    const looks = screen.getByRole('list', { name: 'Looks' })
    expect(within(looks).getByRole('button', { current: true }).textContent).toContain(preset.label)
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    fireEvent.click(radio('Corners', preset.look.shape.corners === 'pill' ? 'Sharp' : 'Pill'))
    expect(screen.getByRole('button', { name: 'Look: Custom' })).toBeTruthy()
  })

  it('sets the page width under Style, with one name for each width', () => {
    const { seen } = renderTheme(defaultDesign())
    const style = screen.getByRole('region', { name: 'Style' })
    const widths = within(within(style).getByRole('radiogroup', { name: 'Page width' }))
      .getAllByRole('radio')
      .map((r) => r.textContent)
    expect(widths).toEqual(['Narrow', 'Standard', 'Wide'])
    expect(screen.queryByText('Default')).toBeNull()
    fireEvent.click(radio('Page width', 'Wide'))
    expect(seen.design.layout.width).toBe('wide')
  })

  it('writes Hover’s Lift as post cards’ and main buttons’ hover under Style, None taking it back', () => {
    const { seen } = renderTheme(defaultDesign())
    const style = screen.getByRole('region', { name: 'Style' })
    expect(within(style).getByRole('radiogroup', { name: 'Hover' })).toBeTruthy()
    fireEvent.click(radio('Hover', 'Lift'))
    // One source: the element Hover values, never a motion of its own.
    expect(seen.design.shape).not.toHaveProperty('hover')
    expect(seen.design.style).toEqual({
      postCard: { hover: { lift: 2, shadow: 'floating' } },
      button: { hover: { lift: 2, shadow: 'floating' } },
    })
    expect(radio('Hover', 'Lift').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(radio('Hover', 'None'))
    expect(seen.design.shape).not.toHaveProperty('hover')
    expect(seen.design.style).toBeUndefined()
  })

  it('keeps an element’s own hover when Lift goes, and shows Lift for a lift set on post cards', () => {
    const design = defaultDesign()
    design.style = { postCard: { hover: { lift: 4, borderColor: 'accent' } } }
    const { seen } = renderTheme(design)
    expect(radio('Hover', 'Lift').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(radio('Hover', 'Arrow'))
    expect(seen.design.shape.hover).toBe('arrow')
    expect(seen.design.style).toEqual({ postCard: { hover: { borderColor: 'accent' } } })
    expect(radio('Hover', 'Arrow').getAttribute('aria-checked')).toBe('true')
  })

  it('opens at Style when asked from elsewhere, such as the page’s width', () => {
    const scroll = vi.fn()
    const before = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scroll
    try {
      renderTheme(defaultDesign(), { more: true })
      expect(scroll).toHaveBeenCalled()
      expect(scroll.mock.contexts[0]).toBe(screen.getByRole('region', { name: 'Style' }))
    } finally {
      Element.prototype.scrollIntoView = before
    }
  })

  it('keeps the elements in view, each opening its panel in place with a way back', () => {
    renderTheme(defaultDesign())
    const elements = screen.getByRole('region', { name: 'Elements' })
    expect(within(elements).getByRole('button', { name: /^Main buttons/ })).toBeTruthy()
    fireEvent.click(within(elements).getByRole('button', { name: /^Vote boxes/ }))
    expect(screen.getByRole('heading', { name: 'Vote boxes' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Where it is' }).textContent).toBe(
      'ThemeVote boxes'
    )
    expect(document.querySelector('[data-scope-line] p')!.textContent).toBe(
      'Changing every vote box'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    expect(screen.getByRole('region', { name: 'Elements' })).toBeTruthy()
  })

  it('lists every element in one list, each with its brand choices and what is set', () => {
    const design = defaultDesign()
    design.shape.buttons = 'pill'
    design.style = { button: { base: { radius: 4 }, hover: { background: 'support' } } }
    renderTheme(design)
    const elements = within(screen.getByRole('region', { name: 'Elements' }))
    expect(elements.getByRole('button', { name: /^Main buttons/ }).textContent).toBe(
      'Main buttons2 set·Brand colour · Pill'
    )
    for (const name of [
      'Post cards',
      'Panels',
      'Menu items',
      'Page headlines',
      'Home blocks',
      'Images',
    ])
      expect(elements.getByRole('button', { name: new RegExp(`^${name}`) })).toBeTruthy()
  })

  it('lists the elements most changed first, in the order the portal is read', () => {
    renderTheme(defaultDesign())
    const names = within(screen.getByRole('region', { name: 'Elements' }))
      .getAllByRole('listitem')
      .map((item) => item.querySelector('span')!.textContent)
    expect(names.slice(0, 11)).toEqual([
      'Main buttons',
      'Links',
      'Menu items',
      'Tabs and filters',
      'Post cards',
      'Panels',
      'Vote boxes',
      'Tags',
      'Page headlines',
      'Section headings',
      'Fields',
    ])
  })

  it('lists post cards, tabs and filters only while Feedback or the roadmap is on, and panels always', () => {
    renderTheme(defaultDesign(), { gates: { ...ALL_ON, feedback: false, roadmap: false } })
    const elements = within(screen.getByRole('region', { name: 'Elements' }))
    expect(elements.queryByRole('button', { name: /^Post cards/ })).toBeNull()
    expect(elements.queryByRole('button', { name: /^Tabs and filters/ })).toBeNull()
    expect(elements.getByRole('button', { name: /^Panels/ })).toBeTruthy()
  })

  it('sets a brand choice and an exact value from an element’s panel, and keeps no second copy', () => {
    const { seen } = renderTheme(defaultDesign())
    fireEvent.click(screen.getByRole('button', { name: /^Main buttons/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'Pill' }))
    expect(seen.design.shape.buttons).toBe('pill')
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Corners' })).getByRole('radio', {
        name: 'Custom',
      })
    )
    fireEvent.change(screen.getByLabelText('Custom corners'), { target: { value: '6' } })
    // Everywhere, an exact value lives in one place: the tune.
    expect(seen.design.tune).toEqual({ button: { radius: 6 } })
    expect(seen.design.style).toBeUndefined()
  })

  it('lists only what the pages that are on draw, and no logo: the logo is picked on the page', () => {
    renderTheme(defaultDesign(), { gates: { ...ALL_ON, feedback: false } })
    const elements = screen.getByRole('region', { name: 'Elements' })
    expect(within(elements).queryByRole('button', { name: /^Vote boxes/ })).toBeNull()
    expect(within(elements).queryByRole('button', { name: /^Logo/ })).toBeNull()
  })

  it('keeps custom CSS under Advanced, closed at first, counting each opening', async () => {
    const { seen } = renderTheme(defaultDesign())
    expect(screen.queryByLabelText('CSS')).toBeNull()
    expect(advanced().getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(advanced())
    expect(events.designerAdvancedOpened).toHaveBeenCalledWith('site:styles')
    fireEvent.change(await screen.findByLabelText('CSS'), {
      target: { value: '[data-qb-part="post-card"] { color: red; }' },
    })
    expect(seen.design.css).toBe('[data-qb-part="post-card"] { color: red; }')
    fireEvent.click(advanced())
    expect(screen.queryByLabelText('CSS')).toBeNull()
    expect(events.designerAdvancedOpened).toHaveBeenCalledTimes(1)
  })

  it('shows the page background as a row, opening its editor with the scope line', () => {
    const { seen } = renderTheme(defaultDesign(), { page: 'roadmap' })
    fireEvent.click(screen.getByRole('button', { name: /^Page background: Every page/ }))
    expect(screen.getByText(/^Changing/).textContent).toBe('Changing every page')
    fireEvent.click(screen.getByRole('button', { name: 'Just Roadmap' }))
    expect(seen.labels.at(-1)).toBe('Roadmap page background: This page only')
    expect(screen.getByText(/^Changing/).textContent).toBe('Changing Roadmap only')
    fireEvent.click(screen.getByRole('button', { name: 'Back to every page' }))
    expect(seen.design.layout.pageBackgrounds).toBeUndefined()
  })

  it('keeps the site images open: the favicon and share image say what shows without them', () => {
    renderTheme(defaultDesign())
    const images = screen.getByRole('region', { name: 'Site images' })
    expect(within(images).getByLabelText('Upload favicon')).toBeTruthy()
    expect(within(images).getByText('Automatic')).toBeTruthy()
  })

  it('lists the places set differently at its foot, each with Reset and a way to it', () => {
    const start = portalDesign.parse({
      ...defaultDesign(),
      overrides: [
        {
          id: '',
          target: { scope: 'page', page: 'feedback', element: 'button' },
          style: { base: { radius: 2 } },
        },
      ],
    })
    const { seen, jumps } = renderTheme(start)
    const foot = screen.getByRole('region', { name: 'Set differently' })
    expect(foot.closest('footer')).toBeTruthy()
    const [place] = seen.design.overrides!
    const reset = within(foot).getByRole('button', { name: /^Reset / })
    const name = reset.getAttribute('aria-label')!.replace(/^Reset /, '')
    fireEvent.click(within(foot).getByRole('button', { name }))
    expect(jumps).toEqual([place!.id])
    fireEvent.click(reset)
    expect(seen.design.overrides ?? []).toEqual([])
    expect(screen.queryByRole('region', { name: 'Set differently' })).toBeNull()
  })

  it('shows no footer with nothing set differently', () => {
    renderTheme(defaultDesign())
    expect(screen.queryByRole('region', { name: 'Set differently' })).toBeNull()
  })
})
