// @vitest-environment happy-dom
/**
 * Page background, in Theme and in the hero's panel: the kind as drawn
 * tiles, each kind's few settings as rows, dark mode, and the scope line for
 * a page's own over every page's. Colours are brand variables. Each change
 * is one undo step named for it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'

vi.mock('@/lib/server/functions/uploads', () => ({
  getBandImageUploadUrlFn: vi.fn(),
}))

const { PageBackgroundEntry, PageBackgroundSection } = await import('../page-background-settings')

const IMAGE = 'portal-images/2026/11/0b9c-hills.webp'

function setup(start: PortalDesign = defaultDesign(), page: string | null = null) {
  const seen: { design: PortalDesign; labels: string[] } = { design: start, labels: [] }
  const upload = vi.fn(async () => ({
    key: IMAGE,
    phone: { key: 'portal-images/2026/11/0b9c-hills-phone.webp' },
    tones: ['#1f2937', '#f3f4f6'] as [string, string],
  }))
  function Harness() {
    const [design, setDesign] = useState(start)
    return (
      <PageBackgroundSection
        design={design}
        page={page}
        upload={upload}
        update={(change, label) => {
          const next = structuredClone(design)
          change(next)
          seen.design = portalDesign.parse(next)
          seen.labels.push(label ?? '')
          setDesign(seen.design)
        }}
      />
    )
  }
  const view = render(<Harness />)
  return { seen, upload, view }
}

const tile = (name: string, group = 'Background') =>
  within(screen.getAllByRole('radiogroup', { name: group })[0]!).getByRole('radio', { name })
const radio = (group: string, name: string) =>
  within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name })

afterEach(cleanup)

describe('Page background', () => {
  it('starts on the page colour and writes nothing until a kind is picked', () => {
    const { seen, view } = setup()
    expect(screen.getByRole('heading', { name: 'Page background' })).toBeTruthy()
    // No paragraph explains the page colour.
    expect(view.container.querySelector('p:not([id])')).toBeNull()
    expect(tile('Page colour').getAttribute('aria-checked')).toBe('true')
    expect(seen.labels).toEqual([])
  })

  it('sets a gradient from the tiles, named for undo, and changes its settings', () => {
    const { seen } = setup()
    fireEvent.click(tile('Gradient'))
    expect(seen.design.layout.background).toEqual({ kind: 'gradient', stops: ['accent', 'page'] })
    expect(seen.labels).toEqual(['Page background: Gradient'])
    fireEvent.click(radio('Shape', 'Glow'))
    fireEvent.click(radio('Glow from', 'Corner'))
    fireEvent.click(radio('Strength', 'Soft'))
    fireEvent.click(screen.getByRole('button', { name: 'Add stop' }))
    expect(seen.design.layout.background).toEqual({
      kind: 'gradient',
      stops: ['accent', 'page', 'page'],
      shape: 'radial',
      centre: 'corner',
      strength: 'soft',
    })
    expect(seen.labels.slice(1)).toEqual([
      'Page background: Shape',
      'Page background: Glow from',
      'Page background: Strength',
      'Page background: Colours',
    ])
  })

  it('offers the brand’s colours as variables, and a custom one shows detached with a way back', () => {
    const start = defaultDesign()
    start.brand.light.support = '#f59e0b'
    const { seen } = setup(start)
    fireEvent.click(tile('Soft colour'))
    const chip = screen.getByRole('button', { name: 'Colour: Brand colour' })
    expect(chip.getAttribute('data-token-state')).toBe('linked')
    fireEvent.click(chip)
    const brand = screen.getByRole('group', { name: 'Colour: brand colours' })
    expect(
      within(brand)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Brand colour', 'Second colour', 'Page'])
    fireEvent.click(within(brand).getByRole('button', { name: 'Second colour' }))
    expect(seen.design.layout.background).toEqual({ kind: 'tint', colour: 'support' })
    const writes = seen.labels.length
    // Custom shows the picker; nothing is picked, or stored, until a colour is.
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }))
    expect(seen.labels.length).toBe(writes)
    expect(
      screen.getByRole('button', { name: 'Colour: Second colour' }).getAttribute('data-token-state')
    ).toBe('linked')
    const field = screen.getByRole('textbox', { name: 'Custom' })
    fireEvent.change(field, { target: { value: '#fbf3e4' } })
    fireEvent.blur(field)
    expect(seen.design.layout.background).toEqual({ kind: 'tint', colour: '#fbf3e4' })
    expect(
      screen.getByRole('button', { name: /^Colour: #fbf3e4/i }).getAttribute('data-token-state')
    ).toBe('detached')
    // An exact colour shows as chosen until a strength is asked for.
    expect(radio('Strength', 'As chosen').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /^Link to / }))
    expect(['accent', 'support', 'page']).toContain(
      (seen.design.layout.background as { colour: string }).colour
    )
  })

  it('draws each pattern as a tile and sets its size', () => {
    const { seen } = setup()
    fireEvent.click(tile('Pattern'))
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Pattern' })).getByRole('radio', {
        name: 'Grid',
      })
    )
    fireEvent.click(radio('Size', 'Large'))
    expect(seen.design.layout.background).toEqual({
      kind: 'pattern',
      pattern: 'grid',
      scale: 'large',
    })
  })

  it('uploads an image with its phone copy and tones, then sets how strongly it shows', async () => {
    const { seen, upload } = setup()
    fireEvent.click(tile('Image'))
    // Nothing is written until there is an image.
    expect(seen.labels).toEqual([])
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    const file = new File(['x'], 'hills.png', { type: 'image/png' })
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })
    expect(upload).toHaveBeenCalledWith(file)
    expect(seen.design.layout.background).toEqual({
      kind: 'image',
      image: {
        key: IMAGE,
        phone: { key: 'portal-images/2026/11/0b9c-hills-phone.webp' },
        tones: ['#1f2937', '#f3f4f6'],
      },
    })
    expect(seen.labels).toEqual(['Page background: Image'])
    const strength = screen.getByRole('spinbutton', { name: 'Image strength' })
    fireEvent.change(strength, { target: { value: '80' } })
    fireEvent.blur(strength)
    expect(seen.design.layout.background).toMatchObject({ kind: 'image', strength: 80 })
    expect(seen.labels.at(-1)).toBe('Page background: Image strength')
    // A dark-and-light photo at 80% would hide text: the layer holds it back, and marks it.
    expect(screen.getByRole('img', { name: /^Shown at \d+% to keep text readable$/ })).toBeTruthy()
    fireEvent.click(radio('On scroll', 'Stays still'))
    expect(seen.design.layout.background).toMatchObject({ scroll: 'fixed' })
  })

  it('works dark mode out from light, or makes it plain or its own', () => {
    const { seen } = setup()
    fireEvent.click(tile('Soft colour'))
    expect(radio('Dark mode', 'Auto').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(radio('Dark mode', 'Page'))
    expect(seen.design.layout.background).toEqual({
      kind: 'tint',
      colour: 'accent',
      dark: { kind: 'solid' },
    })
    fireEvent.click(radio('Dark mode', 'Own'))
    // Dark's own look, under light's.
    const darkLook = screen.getByRole('radiogroup', { name: 'Dark background' })
    fireEvent.click(within(darkLook).getByRole('radio', { name: 'Gradient' }))
    expect(seen.design.layout.background?.dark).toEqual({
      kind: 'gradient',
      stops: ['accent', 'page'],
    })
    expect(seen.labels.at(-1)).toBe('Page background: Gradient in dark')
    fireEvent.click(radio('Dark mode', 'Auto'))
    expect(seen.design.layout.background).toEqual({ kind: 'tint', colour: 'accent' })
  })

  it('gives the page shown its own background, and back to every page’s', () => {
    const start = defaultDesign()
    start.layout.background = { kind: 'tint', colour: 'accent' }
    const { seen } = setup(portalDesign.parse(start), 'roadmap')
    expect(screen.getByText(/^Changing/).textContent).toBe('Changing every page')
    fireEvent.click(screen.getByRole('button', { name: 'Just Roadmap' }))
    expect(seen.design.layout.pageBackgrounds?.roadmap).toEqual({ kind: 'tint', colour: 'accent' })
    expect(seen.labels).toEqual(['Roadmap page background: This page only'])
    fireEvent.click(tile('Pattern'))
    expect(seen.design.layout.pageBackgrounds?.roadmap?.kind).toBe('pattern')
    // Every page's stays as it was.
    expect(seen.design.layout.background).toEqual({ kind: 'tint', colour: 'accent' })
    expect(seen.labels.at(-1)).toBe('Roadmap page background: Pattern')
    fireEvent.click(screen.getByRole('button', { name: 'Back to every page' }))
    expect(seen.design.layout.pageBackgrounds).toBeUndefined()
  })

  it('uses real controls with neither title attributes nor a brand-coloured focus', () => {
    const { view } = setup()
    fireEvent.click(tile('Soft colour'))
    expect(view.container.querySelector('[title]')).toBeNull()
    expect(view.container.innerHTML).not.toContain('ring-primary')
  })
})

describe('Page background from the page’s own panel', () => {
  it('says what the page shows, and opens to make it this page’s own', () => {
    const start = defaultDesign()
    start.layout.background = { kind: 'gradient', stops: ['accent', 'page'] }
    let design = portalDesign.parse(start)
    const labels: string[] = []
    const view = render(
      <PageBackgroundEntry
        design={design}
        page="changelog"
        update={(change, label) => {
          const next = structuredClone(design)
          change(next)
          design = portalDesign.parse(next)
          labels.push(label ?? '')
        }}
      />
    )
    const open = screen.getByRole('button', { name: /Page background/ })
    expect(open.textContent).toContain('Every page: Gradient')
    expect(open.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(open)
    fireEvent.click(screen.getByRole('button', { name: 'Just Changelog' }))
    expect(design.layout.pageBackgrounds?.changelog).toEqual({
      kind: 'gradient',
      stops: ['accent', 'page'],
    })
    expect(labels).toEqual(['Changelog page background: This page only'])
    view.unmount()
  })
})
