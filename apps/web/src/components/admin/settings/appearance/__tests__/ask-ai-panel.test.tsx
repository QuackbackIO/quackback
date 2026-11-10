// @vitest-environment happy-dom
/**
 * Ask AI says each step in one line with one Undo for the whole step; the
 * changes, as "Thing: old → new", wait behind Show changes. With no model
 * set up it says so in one line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { AskAiPanel, replyText } from '../ask-ai-panel'
import type { DesignAiTurn } from '../use-design-ai'

let draft: PortalDesign
/** Each change's undo name, in order. */
let labels: Array<string | undefined>
/** Changes the draft from outside the panel, as the draft bar's Undo does. */
let setOutside: (design: PortalDesign) => void

/** The panel over a draft held in state, so it redraws as the draft changes. */
function Harness(props: Partial<Parameters<typeof AskAiPanel>[0]>) {
  const [design, setDesign] = useState(draft)
  setOutside = (next) => {
    draft = next
    setDesign(next)
  }
  return (
    <AskAiPanel
      available
      turns={[]}
      busy={false}
      onWiden={() => {}}
      {...props}
      design={design}
      update={(change, label) => {
        const next = structuredClone(draft)
        change(next)
        labels.push(label)
        setOutside(next)
      }}
    />
  )
}

const mount = (props: Partial<Parameters<typeof AskAiPanel>[0]> = {}) =>
  render(<Harness {...props} />)

beforeEach(() => {
  draft = defaultDesign()
  labels = []
})
afterEach(cleanup)

describe('AskAiPanel', () => {
  it('is a chat: no start form before the first request', () => {
    mount()
    expect(screen.queryByLabelText('Describe your brand')).toBeNull()
    expect(screen.queryByLabelText(/website|logo or a screenshot/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Start/ })).toBeNull()
  })

  it('shows the card for the logo a brand match placed, under its reply', () => {
    mount({
      turns: [
        {
          role: 'assistant',
          text: 'I matched your brand from your screenshot.',
          brand: {
            shot: {} as never,
            box: { x: 0, y: 0, w: 0.1, h: 0.1 },
            full: false,
            title: null,
          },
        },
      ],
      renderBrand: (_turn, index) => <p>Logo card {index}</p>,
    })
    expect(screen.getByText('Logo card 0')).toBeTruthy()
  })

  it('says why in one line when no model is set up', () => {
    mount({ available: false })
    expect(screen.getByText(/not set up. Everything else works/)).toBeTruthy()
  })

  it('says a step in its reply with one Undo, the changes behind Show changes', () => {
    draft.layout.density = 'compact'
    draft.brand.light.accent = '#0f766e'
    const turns: DesignAiTurn[] = [
      { role: 'user', text: 'Tighter, green' },
      {
        role: 'assistant',
        text: 'Tighter and greener.',
        changes: [
          { path: 'layout.density', before: 'comfortable', after: 'compact', why: 'asked' },
          { path: 'brand.light.accent', before: 'oklch(0.886 0.176 86)', after: '#0f766e' },
        ],
        readability: ['button text on the accent'],
      },
    ]
    mount({ turns })
    expect(screen.getByText('Tighter and greener.', { selector: 'li p' })).toBeTruthy()
    // Quiet by default: no list, no card heading, no reasons, no credit.
    expect(screen.queryByText('Comfortable')).toBeNull()
    expect(screen.queryByText(/Changes applied/)).toBeNull()
    expect(screen.queryByText(/Why:/)).toBeNull()
    expect(screen.queryByText(/Quackback AI/)).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Undo/ })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Show changes' }))
    const rows = screen.getAllByRole('listitem').filter((row) => row.closest('[data-changes]'))
    expect(rows.map((row) => row.textContent)).toEqual([
      'Density:Comfortable→Compact',
      'Brand colour:Yellow→Teal',
    ])
    expect(screen.getByText(/Also adjusted button text on the accent/)).toBeTruthy()
    expect(screen.queryByText('1.')).toBeNull()
    expect(screen.queryByText(/Why:/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(draft.layout.density).toBe('comfortable')
    expect(draft.brand.light.accent).toBe('oklch(0.886 0.176 86)')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.getByText('Undone')).toBeTruthy()
  })

  it('leaves out a row whose before and after read the same', () => {
    const block = (w: number) => ({
      id: 'statusaaaa',
      type: 'status',
      grid: { x: 0, y: 0, w, h: 1 },
    })
    draft.pages.home.blocks = [block(12)] as PortalDesign['pages']['home']['blocks']
    draft.layout.density = 'compact'
    mount({
      turns: [
        {
          role: 'assistant',
          text: 'Done.',
          changes: [
            { path: 'pages.home.blocks', before: [block(4)], after: [block(12)] },
            { path: 'layout.density', before: 'comfortable', after: 'compact' },
          ],
        },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Show changes' }))
    expect(screen.queryByText(/1 block/)).toBeNull()
    expect(screen.getByText(/Density/)).toBeTruthy()
  })

  it('leaves out exact sizes and lists that would only say Changed', () => {
    draft.layout.density = 'compact'
    mount({
      turns: [
        {
          role: 'assistant',
          text: 'Done.',
          changes: [
            { path: 'tune.button.radius', before: null, after: 999 },
            { path: 'brand.light.extra', before: null, after: ['#123456'] },
            { path: 'layout.density', before: 'comfortable', after: 'compact' },
          ],
        },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Show changes' }))
    const rows = screen.getAllByRole('listitem').filter((row) => row.closest('[data-changes]'))
    expect(rows.map((row) => row.textContent)).toEqual(['Density:Comfortable→Compact'])
  })

  it('says a brand match in one line of the parts it matched', () => {
    draft.brand.light.accent = '#0058a3'
    mount({
      turns: [
        { role: 'user', text: 'match my brand' },
        {
          role: 'assistant',
          text: 'I matched your brand from your screenshot: blue (#0058a3) as the brand colour, Inter for the type.',
          matched: true,
          changes: [
            { path: 'brand.light.accent', before: '#000000', after: '#0058a3', why: 'logo' },
            { path: 'brand.fonts.heading', before: null, after: { kind: 'bundled', id: 'inter' } },
          ],
        },
      ],
    })
    expect(
      screen.getByText('Matched your brand: colours and fonts.', { selector: 'li p' })
    ).toBeTruthy()
    expect(screen.queryByText(/Inter for the type/)).toBeNull()
  })

  it('undoes an override step by its one Undo, its lines in plain words', () => {
    const after = [
      {
        id: 'part:hero.home.cta:button',
        target: { scope: 'part', part: 'hero.home.cta', element: 'button' },
        style: { base: { background: 'black' } },
      },
    ] as NonNullable<PortalDesign['overrides']>
    draft.overrides = structuredClone(after)
    mount({
      turns: [
        { role: 'user', text: 'Just this one black' },
        {
          role: 'assistant',
          text: 'Made the call to action black.',
          changes: [
            {
              path: 'overrides',
              before: null,
              after: after as never,
              label: 'Call to action · Hero: background to black',
            },
          ],
        },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Show changes' }))
    expect(screen.getByText('Call to action background: Brand → Black (this one)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(draft.overrides ?? []).toEqual([])
  })

  it('undoes only what still holds when the draft moved on since', () => {
    draft.layout.density = 'compact'
    draft.brand.light.accent = '#0f766e'
    mount({
      turns: [
        {
          role: 'assistant',
          text: 'Tighter and greener.',
          changes: [
            { path: 'layout.density', before: 'comfortable', after: 'compact' },
            { path: 'brand.light.accent', before: '#123456', after: '#0f766e' },
          ],
        },
      ],
    })
    // A later change of the person's own moves the colour on; Undo leaves it.
    const later = structuredClone(draft)
    later.brand.light.accent = '#ff0000'
    act(() => setOutside(later))
    expect(screen.queryByText('Changed since')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(draft.layout.density).toBe('comfortable')
    expect(draft.brand.light.accent).toBe('#ff0000')
    // Nothing of the step holds now, so its Undo goes, quietly.
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.queryByText('No longer in your draft')).toBeNull()
  })

  it('announces an answer as its one line through a status that is always there', () => {
    draft.layout.density = 'compact'
    const { rerender } = mount({ busy: true, stage: 'Reading example.com…' })
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Reading example.com…')
    expect(document.querySelector('[aria-busy]')).toBeNull()
    rerender(
      <Harness
        turns={[
          { role: 'user', text: 'Tighter' },
          {
            role: 'assistant',
            text: 'Tighter.',
            where: 'Headline',
            changes: [
              { path: 'layout.density', before: 'comfortable', after: 'compact' },
              { path: 'brand.light.accent', before: '#123456', after: '#0f766e' },
            ],
          },
        ]}
      />
    )
    expect(screen.getByRole('status')).toBe(status)
    expect(status.textContent).toBe('Tighter.')
    // The list itself is not live, so a person's own words and each row are not read again.
    expect(document.querySelector('ol')?.hasAttribute('aria-live')).toBe(false)
  })

  it('says one row per operation, in words, with no swatch for a relative value', () => {
    draft.layout.hero = 'tint'
    draft.style = { button: { hover: { background: 'oklch(from var(--primary) l c h)' } } }
    mount({
      turns: [
        {
          role: 'assistant',
          text: 'Calmer.',
          changes: [
            // One look, two fields, each carrying the look's name, as the critique saw it.
            { path: 'layout.hero', before: 'none', after: 'tint', label: 'Hero look: Tint' },
            { path: 'layout.heroArt', before: 'dots', after: null, label: 'Hero look: Tint' },
            {
              path: 'style',
              before: null,
              after: { button: { hover: { background: 'oklch(from var(--primary) l c h)' } } },
              label: 'Main buttons on hover: background darker',
            },
          ],
        },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Show changes' }))
    const rows = screen.getAllByRole('listitem').filter((row) => row.closest('[data-changes]'))
    expect(rows.map((row) => row.textContent)).toEqual([
      'Hero look: Tint',
      'Main buttons on hover: background darker',
    ])
    expect(document.querySelectorAll('[data-changes] [data-swatch]')).toHaveLength(0)
  })

  it('offers Show on each row the canvas can point at, which goes to the change', () => {
    draft.layout.hero = 'tint'
    draft.shape.corners = 'pill'
    const go = vi.fn()
    mount({
      show: { can: (at) => at.path.startsWith('layout.'), go },
      turns: [
        {
          role: 'assistant',
          text: 'Calmer.',
          changes: [
            { path: 'layout.hero', before: 'none', after: 'tint', label: 'Hero look: Tint' },
            { path: 'shape.corners', before: 'rounded', after: 'pill', label: 'Corners to pill' },
          ],
        },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Show changes' }))
    const shows = screen.getAllByRole('button', { name: /^Show / })
    expect(shows.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Show Hero look: Tint on the page',
    ])
    expect(shows[0]!.textContent).toBe('Show')
    fireEvent.click(shows[0]!)
    expect(go).toHaveBeenCalledWith(
      { path: 'layout.hero', before: 'none', after: 'tint' },
      'Hero look: Tint'
    )
  })

  it('reads a switch as On and Off', () => {
    mount({
      turns: [
        {
          role: 'assistant',
          text: 'The welcome message shows.',
          changes: [{ path: 'pages.feedback.welcome.show', before: false, after: true }],
        },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Show changes' }))
    expect(screen.getByText('Off')).toBeTruthy()
    expect(screen.getByText('On')).toBeTruthy()
    expect(screen.queryByText('false')).toBeNull()
  })

  it('offers to ask about the whole site when a request reached outside the section', () => {
    const widened: string[] = []
    mount({
      turns: [
        { role: 'user', text: 'A green band' },
        {
          role: 'assistant',
          text: 'That is outside the header, so nothing changed.',
          widen: 'A green band',
        },
      ],
      onWiden: (text) => widened.push(text),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask about the whole site' }))
    expect(widened).toEqual(['A green band'])
  })

  it('shows a brand match’s stages as they run, the last one in progress', () => {
    mount({
      busy: true,
      stage: 'Matching fonts…',
      steps: ['Reading your screenshots', 'Matching fonts'],
    })
    const progress = screen.getByRole('list', { name: 'Progress' })
    expect(progress.textContent).toContain('✓Reading your screenshots')
    expect(progress.textContent).toContain('Matching fonts…')
  })

  it('asks a match’s questions quietly and offers follow-ups, its notes with the changes', () => {
    const onChip = vi.fn()
    const turns: DesignAiTurn[] = [
      { role: 'user', text: 'match my brand' },
      {
        role: 'assistant',
        text: 'I matched your brand.',
        matched: true,
        changes: [
          {
            path: 'brand.light.accent',
            before: '#000000',
            after: '#0058a3',
            why: 'seen in the logo',
          },
        ],
        asks: ['Add a screenshot of a product or account page and I’ll match them exactly.'],
        notes: ['Not visible in screenshots, so left as is: hover.'],
        chips: ['Use more blue', 'Bolder hero'],
      },
    ]
    draft = {
      ...draft,
      brand: { ...draft.brand, light: { ...draft.brand.light, accent: '#0058a3' } },
    }
    mount({ turns, onChip })
    expect(screen.getByText(/Add a screenshot of a product/)).toBeTruthy()
    expect(screen.queryByText(/Not visible in screenshots/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show changes' }))
    expect(screen.getByText(/Not visible in screenshots/)).toBeTruthy()
    expect(screen.queryByText(/seen in the logo/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Use more blue' }))
    expect(onChip).toHaveBeenCalledWith('Use more blue')
  })
})

describe('the capture a match was made from', () => {
  const capture = {
    host: 'acme.test',
    url: 'acme.test',
    image: 'data:image/jpeg;base64,AAAA',
    cached: true,
    capturedAt: '2026-11-03T08:00:00.000Z',
    againFrom: '2026-11-04T08:00:00.000Z',
  }

  it('shows the page, where it came from, and Capture again once a day has passed', async () => {
    const { SiteCapture } = await import('../ask-ai-panel')
    const onRecapture = vi.fn()
    const { rerender } = render(
      <SiteCapture
        capture={capture}
        busy={false}
        onRecapture={onRecapture}
        now={Date.parse('2026-11-03T09:00:00Z')}
      />
    )
    expect(screen.getByRole('img', { name: 'Captured from acme.test' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Capture again' }).hasAttribute('disabled')).toBe(
      true
    )
    rerender(
      <SiteCapture
        capture={capture}
        busy={false}
        onRecapture={onRecapture}
        now={Date.parse('2026-11-04T09:00:00Z')}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Capture again' }))
    expect(onRecapture).toHaveBeenCalledWith('acme.test')
  })
})

describe('a brand match that could not match a font', () => {
  const matched: DesignAiTurn = {
    role: 'assistant',
    text: 'I matched your brand from your screenshot: green as the brand colour.',
    matched: true,
    changes: [],
    font: { family: 'Acme Grotesk', slot: 'heading' },
  }

  it('offers its upload and a way to the fonts, under the one line', () => {
    const onUploadFont = vi.fn()
    const onFonts = vi.fn()
    mount({ turns: [matched], onUploadFont, onFonts })
    fireEvent.click(screen.getByRole('button', { name: 'Upload Acme Grotesk' }))
    expect(onUploadFont).toHaveBeenCalledWith({ family: 'Acme Grotesk', slot: 'heading' })
    fireEvent.click(screen.getByRole('button', { name: 'Fonts in Theme' }))
    expect(onFonts).toHaveBeenCalledOnce()
  })

  it('offers nothing where the panel cannot open the fonts', () => {
    mount({ turns: [matched] })
    expect(screen.queryByRole('button', { name: 'Upload Acme Grotesk' })).toBeNull()
  })
})

describe('the one line a brand match says about fonts', () => {
  const turn = (over: Partial<Extract<DesignAiTurn, { role: 'assistant' }>>) =>
    ({
      role: 'assistant',
      text: 'I matched your brand.',
      matched: true,
      changes: [
        { path: 'brand.light.accent', before: '#000000', after: '#0058a3' },
        { path: 'brand.fonts.heading', before: null, after: null },
      ],
      ...over,
    }) as Extract<DesignAiTurn, { role: 'assistant' }>

  it('claims fonts only where the brand’s own face was drawn', () => {
    expect(replyText(turn({}))).toBe('Matched your brand: colours and fonts.')
    expect(replyText(turn({ font: { family: 'Acme Grotesk', slot: 'heading' } }))).toBe(
      'Matched your brand: colours.'
    )
    expect(replyText(turn({ fontsNearest: true }))).toBe('Matched your brand: colours.')
  })
})
