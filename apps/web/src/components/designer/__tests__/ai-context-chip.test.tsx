// @vitest-environment happy-dom
/**
 * The block picked in the builder rides along in Quackback AI's composer as
 * a chip; its X takes it out of the chat and lets go of the block.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// This month's website captures, read only once a website is typed.
const usage = vi.hoisted(() => ({ data: undefined as unknown, asked: [] as boolean[] }))
vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({ data: { available: true } }),
  useQuery: (options: { enabled?: boolean }) => {
    usage.asked.push(options.enabled !== false)
    return { data: options.enabled === false ? undefined : usage.data }
  },
}))
vi.mock('@/lib/server/functions/site-capture', () => ({ siteCaptureUsageFn: vi.fn() }))
vi.mock('@/lib/client/queries/portal-design', () => ({
  portalDesignQueries: { aiStatus: () => ({}) },
}))
vi.mock('@/lib/client/image-palette', () => ({}))
vi.mock('@/components/admin/settings/appearance/ask-ai-panel', () => ({
  AskAiPanel: () => null,
  PaletteSwatches: () => null,
}))

const { DesignerAi } = await import('../designer-ai')
const { defaultDesign } = await import('@/lib/shared/design/schema')

afterEach(() => {
  cleanup()
  usage.data = undefined
  usage.asked = []
})

/** A design matched to a brand: its own colour, Home on. */
function matched() {
  const design = defaultDesign()
  design.brand.light.accent = '#0058a3'
  design.brand.matchedAt = '2026-11-07T12:00:00.000Z'
  design.nav.home.on = true
  return design
}

function show(
  selection: string | null,
  selectionName: string | null,
  turns: unknown[] = [],
  element: { element: 'button'; part: string | null } | null = null,
  elementName: string | null = null,
  design = defaultDesign()
) {
  const onCollapse = vi.fn()
  const onClearSelection = vi.fn()
  const ask = vi.fn()
  render(
    <DesignerAi
      ai={{ busy: false, limited: null, ask, turns } as never}
      draft={{ design } as never}
      selection={selection as never}
      selectionName={selectionName}
      element={element}
      elementName={elementName}
      pageName="Home"
      update={vi.fn()}
      onClearSelection={onClearSelection}
      onCollapse={onCollapse}
    />
  )
  return { onClearSelection, ask, onCollapse }
}

describe('the AI context chip', () => {
  it('names the picked block and its page, and its X deselects the block', () => {
    const { onClearSelection } = show('block-topposts1', 'Top posts')
    expect(screen.getByText('On Home')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Top posts from the chat and deselect it' })
    )
    expect(onClearSelection).toHaveBeenCalledOnce()
  })

  it('sends a request about the picked block with the block', () => {
    const { ask } = show('block-topposts1', 'Top posts')
    const box = screen.getByLabelText('Ask Quackback AI')
    fireEvent.change(box, { target: { value: 'fewer posts' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(ask).toHaveBeenCalledWith('fewer posts', 'home', undefined, 'topposts1', undefined)
  })

  it('sends the element picked inside the selection, so "just this" names it', () => {
    const { ask } = show('hero', 'Hero', [], { element: 'button', part: 'hero.home.cta' })
    const box = screen.getByLabelText('Ask Quackback AI')
    fireEvent.change(box, { target: { value: 'just this one black' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(ask).toHaveBeenCalledWith(
      'just this one black',
      'band',
      undefined,
      undefined,
      undefined,
      {
        element: 'button',
        part: 'hero.home.cta',
      }
    )
  })

  it('names the element picked inside the section, with the section beside it', () => {
    const { onClearSelection } = show(
      'hero',
      'Hero',
      [],
      { element: 'button', part: 'hero.home.cta' },
      'Call to action'
    )
    expect(screen.getByText('Call to action')).toBeTruthy()
    expect(screen.getByText('Hero on Home')).toBeTruthy()
    expect(screen.getByLabelText('Ask Quackback AI').getAttribute('placeholder')).toBe(
      'Ask about Call to action'
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Call to action from the chat and deselect it' })
    )
    expect(onClearSelection).toHaveBeenCalledOnce()
  })

  it('carries nothing when nothing is picked', () => {
    show(null, null)
    expect(screen.queryByRole('button', { name: /from the chat and deselect it/ })).toBeNull()
  })
})

describe('Ask AI in its pane', () => {
  it('is a plain chat: one line before the first request, the box under it', () => {
    show(null, null)
    const log = screen.getByRole('log', { name: 'Conversation' })
    expect(log.textContent).toContain('Ask for a change')
    expect(log.querySelector('form, input')).toBeNull()
    expect(screen.getByLabelText('Ask Quackback AI')).toBeTruthy()
    expect(log.textContent).toContain('Paste your website or screenshots to match your brand.')
    expect(log.textContent).not.toMatch(/captures/i)
  })

  it('offers Match my brand first, which points at the box and sends nothing', () => {
    const { ask } = show(null, null)
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Match my brand',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Match my brand' }))
    const box = screen.getByLabelText('Ask Quackback AI') as HTMLTextAreaElement
    expect(box.value).toBe('')
    expect(box.getAttribute('placeholder')).toBe('Paste your website or screenshots')
    expect(document.activeElement).toBe(box)
    expect(ask).not.toHaveBeenCalled()
    // Once the request it asked for is sent, the box says what it says again.
    fireEvent.change(box, { target: { value: 'acme.com' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(ask).toHaveBeenCalledOnce()
    expect(box.getAttribute('placeholder')).not.toBe('Paste your website or screenshots')
  })

  it('offers next edits once matched, with no subline, each put in the box', () => {
    show(null, null, [], null, null, matched())
    const log = screen.getByRole('log', { name: 'Conversation' })
    expect(log.textContent).not.toContain('Paste your website')
    expect(screen.queryByRole('button', { name: 'Match my brand' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try a dark hero' }))
    const box = screen.getByLabelText('Ask Quackback AI') as HTMLTextAreaElement
    expect(box.value).toBe('Try a dark hero')
    expect(document.activeElement).toBe(box)
  })

  it('says how many captures are left only once a website is typed and few remain', () => {
    usage.data = { configured: true, used: 85, limit: 90 }
    show(null, null)
    expect(screen.queryByText(/captures left/)).toBeNull()
    expect(usage.asked.every((asked) => !asked)).toBe(true)
    fireEvent.change(screen.getByLabelText('Ask Quackback AI'), {
      target: { value: 'acme.com' },
    })
    expect(screen.getByText('5 website captures left this month.')).toBeTruthy()
    usage.data = { configured: true, used: 10, limit: 90 }
    fireEvent.change(screen.getByLabelText('Ask Quackback AI'), {
      target: { value: 'acme.com ' },
    })
    expect(screen.queryByText(/captures left/)).toBeNull()
  })

  it('shows the conversation once it has begun', () => {
    show(null, null, [{ id: 1 }])
    expect(screen.queryByText('Ask for a change')).toBeNull()
  })

  it('folds to its rail from its heading', () => {
    const { onCollapse } = show(null, null)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Ask AI' }))
    expect(onCollapse).toHaveBeenCalledOnce()
  })
})
