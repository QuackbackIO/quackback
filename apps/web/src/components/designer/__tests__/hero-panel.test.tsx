// @vitest-environment happy-dom
/**
 * The hero's panel on the properties frame: the route's breadcrumb, one
 * scope line, its Look named for the treatment with the colour as a brand
 * colour, its Layout, its Image with alt text and its focal point, Home's
 * Main action, the rarely used rows under More, and its fill and the page's
 * background as summary rows. The words are edited on the page, never here.
 * Each change is a named undo step, such as "Hero: Look".
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { newBlock } from '@/lib/shared/design/home'
import type { DesignerPage } from '@/lib/shared/design/outline'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

const uploads = vi.hoisted(() => ({ asked: [] as string[] }))
vi.mock('@/lib/server/functions/uploads', () => ({
  getBandImageUploadUrlFn: async ({ data }: { data: { filename: string } }) => {
    uploads.asked.push(data.filename)
    return { uploadUrl: 'https://storage.test/put', key: `portal-images/${data.filename}` }
  },
}))

const { HeroPanel } = await import('../hero-panel')

const ALL_ON = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

function show(
  start: PortalDesign = defaultDesign(),
  page: DesignerPage = 'feedback',
  gates = ALL_ON
) {
  const seen = { design: start, labels: [] as Array<string | undefined> }
  const say = vi.fn()
  const up = vi.fn()
  function Harness() {
    const [design, setDesign] = useState(start)
    return (
      <HeroPanel
        crumbs={[{ label: 'Feedback', onSelect: up }, { label: 'Hero' }]}
        design={design}
        page={page}
        gates={gates}
        locale="en"
        say={say}
        update={(change, label) => {
          const next = structuredClone(seen.design)
          change(next)
          seen.design = next
          seen.labels.push(label)
          setDesign(next)
        }}
      />
    )
  }
  const view = render(<Harness />)
  return { seen, say, up, view }
}

const group = (name: string) => screen.getByRole('radiogroup', { name })
const names = (name: string) =>
  within(group(name))
    .getAllByRole('radio')
    .map((radio) => radio.getAttribute('aria-label') ?? radio.textContent)
const line = () => document.querySelector('[data-scope-line] p')!.textContent

afterEach(() => {
  cleanup()
  uploads.asked = []
  vi.unstubAllGlobals()
})

describe('the hero’s frame', () => {
  it('carries the route’s breadcrumb, whose crumbs go up', () => {
    const { up } = show()
    expect(screen.getByRole('heading', { level: 2, name: 'Hero' })).toBeTruthy()
    const nav = screen.getByRole('navigation', { name: 'Where it is' })
    fireEvent.click(within(nav).getByRole('button', { name: 'Feedback' }))
    expect(up).toHaveBeenCalled()
  })

  it('says once that it changes the hero on every page, counting the pages with one', () => {
    const start = defaultDesign()
    start.nav.home.on = true
    show(start, 'home')
    // Home, Feedback, Roadmap, Changelog, Help and Support; never Status or a post.
    expect(line()).toBe('Changing the hero on every page (6)')
    expect(screen.getByRole('button', { name: 'Just this page' })).toBeTruthy()
    // No chips of its own any more.
    expect(screen.queryByText('On every page')).toBeNull()
    expect(screen.queryByText('This page')).toBeNull()
  })

  it('narrows to just this page on Home alone, saying why elsewhere', async () => {
    show(defaultDesign(), 'roadmap')
    const narrow = screen.getByRole('button', { name: 'Just this page' }) as HTMLButtonElement
    // Not pickable, yet still focusable, so its tip says why from the keyboard too.
    expect(narrow.getAttribute('aria-disabled')).toBe('true')
    expect(narrow.disabled).toBe(false)
    expect(narrow.hasAttribute('title')).toBe(false)
    const before = line()
    fireEvent.click(narrow)
    expect(line()).toBe(before)
    fireEvent.focus(narrow)
    expect(
      (await screen.findAllByText('Only Home can keep an image of its own')).length
    ).toBeGreaterThan(0)
  })

  it('has no words fields: the headline and subtitle are edited on the page', () => {
    show(defaultDesign(), 'home')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByLabelText('Headline')).toBeNull()
    expect(screen.queryByLabelText('Subtitle')).toBeNull()
  })

  it('leaves the header blending into it to the header’s panel', () => {
    const start = defaultDesign()
    start.layout.hero = 'brand'
    show(start)
    expect(screen.queryByLabelText('Header blends into the hero')).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })
})

describe('Look', () => {
  it('names each look for its treatment, and takes one as a named step', () => {
    const { seen } = show()
    expect(names('Look')).toEqual([
      'Plain',
      'Tint',
      'Fade',
      'Bold',
      'Bold waves',
      'Bold panel',
      'Blend',
    ])
    fireEvent.click(screen.getByRole('radio', { name: 'Bold waves' }))
    expect(seen.design.layout).toMatchObject({ hero: 'brand', heroArt: 'waves' })
    expect(seen.labels).toEqual(['Hero: Look'])
  })

  it('offers Second once the brand has a second colour', () => {
    const start = defaultDesign()
    start.brand.light.support = '#0ea5e9'
    show(start)
    expect(names('Look')).toContain('Second')
  })

  it('says on hover when the look is one of its own, or the page’s title sits plain', () => {
    const start = defaultDesign()
    start.layout.hero = 'brand'
    start.layout.heroArt = 'petals'
    show(start, 'roadmap')
    const look = screen.getByRole('region', { name: 'Look' })
    const help = look.querySelector('[data-help]')!.getAttribute('aria-label')!
    expect(help).toContain('A custom look. Pick one to replace it.')
    expect(help).toContain('title sits plain')
    expect(screen.queryByText(/custom look/)).toBeNull()
    expect(within(group('Look')).queryByRole('radio', { checked: true })).toBeNull()
  })

  it('draws in a brand colour as a token, shown once the look takes one and the brand has two', async () => {
    const start = defaultDesign()
    start.layout.hero = 'brand'
    show(start)
    expect(screen.queryByRole('button', { name: /^Colour:/ })).toBeNull()
    cleanup()
    start.brand.light.support = '#0ea5e9'
    const { seen } = show(start)
    const chip = screen.getByRole('button', { name: 'Colour: Brand colour' })
    await act(async () => fireEvent.click(chip))
    fireEvent.click(await screen.findByRole('button', { name: 'Second colour' }))
    expect(seen.design.layout.heroColour).toBe('support')
    expect(seen.labels).toEqual(['Hero: Colour'])
    fireEvent.click(screen.getByRole('button', { name: 'Reset to brand colour' }))
    expect(seen.design.layout).not.toHaveProperty('heroColour')
  })

  it('offers art without an image, as drawn tiles', () => {
    const start = defaultDesign()
    start.layout.hero = 'brand'
    const { seen } = show(start)
    fireEvent.click(within(group('Art')).getByRole('radio', { name: 'Dots' }))
    expect(seen.design.layout.heroArt).toBe('dots')
    cleanup()
    start.brand.heroImage = { key: 'portal-images/room.jpg' }
    show(start)
    expect(screen.queryByRole('radiogroup', { name: 'Art' })).toBeNull()
  })
})

describe('Layout', () => {
  it('sets height, alignment and shape as tiles, each its own step, with a dot and Reset', () => {
    const start = defaultDesign()
    start.nav.home.on = true
    start.layout.hero = 'brand'
    const { seen } = show(start, 'home')
    expect(names('Height')).toEqual(['Short', 'Roomy', 'Tall'])
    expect(names('Alignment')).toEqual(['Start', 'Centre'])
    expect(names('Shape')).toEqual(['Full', 'Inset', 'Panel', 'Split'])
    fireEvent.click(within(group('Height')).getByRole('radio', { name: 'Tall' }))
    fireEvent.click(within(group('Alignment')).getByRole('radio', { name: 'Centre' }))
    fireEvent.click(within(group('Shape')).getByRole('radio', { name: 'Panel' }))
    expect(seen.design.layout).toMatchObject({
      heroHeight: 'tall',
      heroAlign: 'centre',
      heroShape: 'panel',
    })
    expect(seen.labels).toEqual(['Hero: Height', 'Hero: Alignment', 'Hero: Shape'])
    fireEvent.click(screen.getByRole('button', { name: 'Reset to roomy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset to start' }))
    expect(seen.design.layout).not.toHaveProperty('heroHeight')
    expect(seen.design.layout).not.toHaveProperty('heroAlign')
  })
})

describe('Image', () => {
  it('is a "+" until there is one, which uploads it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 }))
    )
    const { seen } = show()
    const image = screen.getByRole('region', { name: 'Image' })
    expect(within(image).getByRole('button', { name: 'Add image' })).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'Image sits' })).toBeNull()
    const file = new File(['x'], 'team.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('Add a hero photo'), { target: { files: [file] } })
    await waitFor(() =>
      expect(seen.design.brand.heroImage).toEqual({ key: 'portal-images/team.jpg' })
    )
    expect(uploads.asked).toEqual(['team.jpg'])
  })

  it('sits, keeps its focal point and shows on phones or not, with its advice on hover', () => {
    const start = defaultDesign()
    start.brand.heroImage = { key: 'portal-images/room.jpg' }
    const { seen } = show(start)
    expect(screen.getByRole('button', { name: /A photo or pattern works best/ })).toBeTruthy()
    expect(screen.queryByText(/A photo or pattern works best/)).toBeNull()
    expect(names('Image sits')).toEqual(['Beside', 'Bottom', 'Behind', 'Tiled'])
    fireEvent.click(within(group('Image sits')).getByRole('radio', { name: 'Behind' }))
    fireEvent.click(within(group('On phones')).getByRole('radio', { name: 'Hide' }))
    expect(seen.design.layout).toMatchObject({ imagePlace: 'cover', imagePhone: 'hide' })
    expect(seen.labels).toEqual(['Hero: Image sits', 'Hero: On phones'])
    fireEvent.keyDown(screen.getByRole('button', { name: /^Focal point, 50% across/ }), {
      key: 'ArrowLeft',
    })
    expect(seen.design.layout.imagePoint).toEqual({ x: 45, y: 50 })
    expect(seen.labels.at(-1)).toBe('Hero: Image')
    fireEvent.click(screen.getByRole('button', { name: 'Reset focal point' }))
    expect(seen.design.layout).not.toHaveProperty('imagePoint')
  })

  it('takes alt text, or is marked decorative, and is removed', () => {
    const start = defaultDesign()
    start.brand.heroImage = { key: 'portal-images/room.jpg' }
    const { seen } = show(start)
    fireEvent.change(screen.getByLabelText('Alt text'), { target: { value: 'Our team at work' } })
    expect(seen.design.brand.heroImage).toEqual({
      key: 'portal-images/room.jpg',
      alt: 'Our team at work',
    })
    fireEvent.click(screen.getByLabelText('Decorative'))
    expect(seen.design.brand.heroImage).toMatchObject({ decorative: true })
    expect((screen.getByLabelText('Alt text') as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }))
    expect(seen.design.brand.heroImage).toBeUndefined()
    expect(new Set(seen.labels)).toEqual(new Set(['Hero: Image']))
  })

  it('keeps an image to Home through Just this page, with a dot, Reset and the footer', () => {
    const start = defaultDesign()
    start.nav.home.on = true
    start.brand.heroImage = { key: 'portal-images/room.jpg' }
    const { seen, view } = show(start, 'home')
    fireEvent.click(screen.getByRole('button', { name: 'Just this page' }))
    expect(line()).toBe('Changing the hero on just this page: Home')
    // Only what a page can keep of its own: the look and layout are every page's.
    expect(screen.queryByRole('radiogroup', { name: 'Look' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Just this page' }))
    expect(seen.design.brand.heroImage).toEqual({ key: 'portal-images/room.jpg', homeOnly: true })
    const footer = screen.getByRole('contentinfo', { name: 'Set differently' })
    expect(footer.textContent).toContain('Home page: image, just this page')
    fireEvent.click(screen.getByRole('button', { name: 'Back to every page' }))
    expect(screen.getByRole('radiogroup', { name: 'Look' })).toBeTruthy()
    const row = view.container.querySelector('[data-set]')!
    expect(row.textContent).toContain('Image')
    fireEvent.click(screen.getByRole('button', { name: 'Reset to every page' }))
    expect(seen.design.brand.heroImage).toEqual({ key: 'portal-images/room.jpg' })
    expect(screen.queryByRole('contentinfo', { name: 'Set differently' })).toBeNull()
  })
})

describe('Main action', () => {
  it('picks Home’s main action from four tiles, on Home only', () => {
    const start = defaultDesign()
    start.nav.home.on = true
    start.pages.home.blocks = [{ ...newBlock('composer'), id: 'composer01' }]
    show(start, 'feedback')
    expect(screen.queryByRole('radiogroup', { name: 'Main action' })).toBeNull()
    cleanup()
    const { seen } = show(start, 'home')
    expect(names('Main action')).toEqual(['Composer', 'Search', 'Button', 'None'])
    expect(
      within(group('Main action')).getByRole('radio', { name: 'None' }).getAttribute('aria-checked')
    ).toBe('true')
    fireEvent.click(within(group('Main action')).getByRole('radio', { name: 'Composer' }))
    expect(seen.design.pages.home.composer).toBe('band')
    fireEvent.click(within(group('Main action')).getByRole('radio', { name: 'Search' }))
    expect(seen.design.pages.home.mainAction).toBe('search')
    expect(seen.design.pages.home).not.toHaveProperty('composer')
    expect(seen.labels).toEqual(['Hero: Main action', 'Hero: Main action'])
  })

  it('says where the call to action goes, with a second one, only with Button', () => {
    const start = defaultDesign()
    start.nav.home.on = true
    const { seen } = show(start, 'home')
    expect(screen.queryByRole('radiogroup', { name: 'Goes to' })).toBeNull()
    fireEvent.click(within(group('Main action')).getByRole('radio', { name: 'Button' }))
    expect(screen.queryByRole('radiogroup', { name: 'Composer width' })).toBeNull()
    expect(names('Goes to')).toEqual(['Composer', 'Roadmap', 'Help', 'Support'])
    fireEvent.click(within(group('Goes to')).getByRole('radio', { name: 'Roadmap' }))
    expect(seen.design.pages.home.button).toEqual({ to: 'roadmap' })
    fireEvent.click(screen.getByRole('switch', { name: 'Second button' }))
    expect(seen.design.pages.home.button).toEqual({ to: 'roadmap', second: true })
    expect(seen.labels.slice(-2)).toEqual(['Hero: Goes to', 'Hero: Second button'])
  })

  it('leaves out what a page that is off cannot do, saying why on hover', () => {
    const start = defaultDesign()
    start.nav.home.on = true
    start.pages.home.mainAction = 'button'
    show(start, 'home', { ...ALL_ON, help: false, roadmap: false })
    expect(names('Main action')).toEqual(['Composer', 'Button', 'None'])
    expect(screen.getByRole('button', { name: 'Search needs the help centre on.' })).toBeTruthy()
    expect(names('Goes to')).toEqual(['Composer', 'Support'])
    expect(
      screen.getByRole('button', {
        name: 'The roadmap needs to be on for a button to go there. The help centre needs to be on for a button to go there.',
      })
    ).toBeTruthy()
  })

  it('sizes the composer once it is in the hero, one named step each', () => {
    const start = defaultDesign()
    start.nav.home.on = true
    start.pages.home.blocks = [{ ...newBlock('composer'), id: 'composer01' }]
    const { seen } = show(start, 'home')
    expect(screen.queryByRole('radiogroup', { name: 'Composer width' })).toBeNull()
    fireEvent.click(within(group('Main action')).getByRole('radio', { name: 'Composer' }))
    expect(names('Composer width')).toEqual(['Narrow', 'Medium', 'Wide', 'Full'])
    expect(
      within(group('Composer width'))
        .getByRole('radio', { name: 'Full' })
        .getAttribute('aria-checked')
    ).toBe('true')
    fireEvent.click(within(group('Composer width')).getByRole('radio', { name: 'Narrow' }))
    expect(seen.design.pages.home.composerWidth).toBe('narrow')
    expect(seen.labels.at(-1)).toBe('Hero: Composer width')
  })

  it('colours the call to action in the second colour once there is one', () => {
    const start = defaultDesign()
    start.nav.home.on = true
    show(start, 'home')
    expect(screen.queryByRole('radiogroup', { name: 'Call to action colour' })).toBeNull()
    cleanup()
    start.brand.light.support = '#0ea5e9'
    const { seen } = show(start, 'home')
    fireEvent.click(
      within(group('Call to action colour')).getByRole('radio', { name: 'Second colour' })
    )
    expect(seen.design.shape.action).toBe('support')
  })
})

describe('Home first', () => {
  /** The panel's section titles, in order. */
  const sections = () =>
    [...document.querySelectorAll('[data-hero-panel] h3, [data-hero-panel] h2')]
      .map((heading) => heading.textContent)
      .filter((text) => ['Main action', 'Look', 'Image', 'Layout'].includes(text ?? ''))

  it('leads Home’s hero with its main action, then its look, image and height', () => {
    const start = defaultDesign()
    start.nav.home.on = true
    start.layout.hero = 'brand'
    show(start, 'home')
    expect(sections()).toEqual(['Main action', 'Look', 'Image', 'Layout'])
    expect(names('Height')).toEqual(['Short', 'Roomy', 'Tall'])
    expect(within(group('Height')).getByRole('radio', { name: 'Roomy' })).toBeTruthy()
  })

  it('draws the Look tiles in the design’s own colours, not the builder’s', () => {
    const start = defaultDesign()
    start.nav.home.on = true
    start.brand.light.accent = '#c6ff00'
    start.brand.light.ink = '#0b1b3a'
    show(start, 'home')
    const drawing = document.querySelector<HTMLElement>('[data-look-drawing]')!
    expect(drawing.style.getPropertyValue('--primary')).toBe('#c6ff00')
    expect(drawing.style.getPropertyValue('--foreground')).toBe('#0b1b3a')
  })

  it('offers no height for a plain hero, where it would change nothing', () => {
    const start = defaultDesign()
    start.nav.home.on = true
    start.layout.hero = 'none'
    show(start, 'home')
    expect(screen.queryByRole('radiogroup', { name: 'Height' })).toBeNull()
  })

  it('gives the list pages Home’s look at a fixed height, with no height to set', () => {
    for (const page of ['feedback', 'roadmap', 'changelog', 'help', 'support'] as const) {
      show(defaultDesign(), page)
      expect(screen.queryByRole('radiogroup', { name: 'Height' })).toBeNull()
      expect(sections()).toEqual(['Look', 'Image', 'Layout'])
      cleanup()
    }
  })

  it('leaves where the page title sits to the page’s own panel', () => {
    const start = defaultDesign()
    start.layout.hero = 'brand'
    show(start, 'roadmap')
    expect(screen.queryByRole('radiogroup', { name: 'Other pages’ titles' })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Page title' })).toBeNull()
  })
})

describe('More and the summary rows', () => {
  it('keeps glow, blend and fade under a closed More', () => {
    const start = defaultDesign()
    start.layout.hero = 'brand'
    show(start)
    const more = screen.getByText('More').closest('details')!
    expect(more.open).toBe(false)
    expect(within(more).getByRole('radiogroup', { name: 'Glow' })).toBeTruthy()
    expect(within(more).queryByRole('radiogroup', { name: 'Blend' })).toBeNull()
  })

  it('sums up its fill and the page’s background, each opening in place', () => {
    const start = defaultDesign()
    start.style = { hero: { base: { radius: 4 } } } as PortalDesign['style']
    show(start)
    const fill = screen.getByRole('button', { name: 'Fill and edge' })
    expect(fill.textContent).toBe('Set')
    expect(fill.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(fill)
    expect(fill.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'Background' }).textContent).toContain('Every page')
  })
})

describe('Title', () => {
  it('leaves what sits by the title to the page’s own panel, its one writer', () => {
    for (const page of ['changelog', 'help', 'roadmap'] as const) {
      show(defaultDesign(), page)
      expect(screen.queryByRole('region', { name: 'Title' })).toBeNull()
      expect(screen.queryByRole('radiogroup', { name: 'Subscribe' })).toBeNull()
      expect(screen.queryByRole('radiogroup', { name: 'Search size' })).toBeNull()
      cleanup()
    }
  })
})
