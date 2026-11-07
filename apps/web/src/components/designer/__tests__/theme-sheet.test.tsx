// @vitest-environment happy-dom
/**
 * Theme, a sheet over the right panel, on the properties frame: titled
 * sections in order (brand kit, colours, fonts, style, page background, site
 * images), a closed More with the looks of each part and custom CSS, and the
 * places set differently at its foot. No paragraphs in the normal state. The
 * hero's settings are its own, never here, and opening Theme writes nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import type { PortalPageGates } from '@/lib/shared/design/paths'

vi.mock('@/lib/client/builder-events', () => ({
  designerAdvancedOpened: vi.fn(),
  designerLookChosen: vi.fn(),
}))
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
  CustomCssEditor: () => <textarea aria-label="CSS" />,
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

function renderTheme(start: PortalDesign, { page = null as string | null } = {}) {
  const seen = { design: start, updates: 0, labels: [] as string[] }
  const jumps: string[] = []
  function Harness() {
    const [design, setDesign] = useState(start)
    const [more, setMore] = useState(false)
    return (
      <ThemeContent
        design={design}
        gates={ALL_ON}
        logoUrl={null}
        cssWarnings={[]}
        more={more}
        onMore={setMore}
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
const more = () => document.getElementById('theme-more')!.querySelector('summary')!

afterEach(cleanup)

describe('Theme', () => {
  it('opening it writes nothing, even over a hero no look makes', async () => {
    const start = imported()
    const before = structuredClone(start)
    const { seen } = renderTheme(start)
    expect(seen.updates).toBe(0)
    expect(seen.design).toEqual(before)
  })

  it('is titled sections in order, with no paragraph in the normal state', () => {
    const { view } = renderTheme(defaultDesign())
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Brand kit',
      'Colours',
      'Fonts',
      'Style',
      'Page background',
      'Site images',
    ])
    expect(view.container.textContent).not.toMatch(/All of this is in your draft/)
    expect(view.container.textContent).not.toMatch(/set under Colours/)
  })

  it('keeps brand-wide settings only: the hero’s are in its own panel', () => {
    const start = defaultDesign()
    start.brand.bandImage = { key: 'portal-images/room.jpg' }
    start.brand.light.support = '#0ea5e9'
    renderTheme(start)
    fireEvent.click(more())
    fireEvent.click(screen.getByText('Advanced'))
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

  it('keeps the looks of each part and custom CSS under More, closed at first', () => {
    renderTheme(defaultDesign())
    const details = more().closest('details')!
    expect(details.open).toBe(false)
    expect(screen.queryByText('Advanced')).toBeNull()
    fireEvent.click(more())
    expect(details.open).toBe(true)
    expect(screen.getByText('Advanced')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Vote boxes/ })).toBeTruthy()
  })

  it('offers a full logo under Site images, in place of the icon and title', () => {
    const { seen } = renderTheme(defaultDesign())
    const full = screen.getByRole('switch', { name: 'Use a full logo image instead' })
    expect(full.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(full)
    expect(seen.design.brand.logo.display).toBe('wordmark')
    expect(screen.getByText('Shows icon and title')).toBeTruthy()
    fireEvent.click(full)
    expect(seen.design.brand.logo.display).toBe('mark_and_name')
  })

  it('keeps a stored wordmark design as it is: the full logo switch is on', () => {
    const start = defaultDesign()
    start.brand.logo.display = 'wordmark'
    start.brand.logo.wordmark.light = { key: 'logos/full.svg' }
    renderTheme(start)
    expect(
      screen
        .getByRole('switch', { name: 'Use a full logo image instead' })
        .getAttribute('aria-checked')
    ).toBe('true')
    expect(screen.getByLabelText('Replace full logo')).toBeTruthy()
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
