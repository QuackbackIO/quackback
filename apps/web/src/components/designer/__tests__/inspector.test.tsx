// @vitest-environment happy-dom
/**
 * The feed's panel owns what the feed does and shows; how every post card
 * and status looks has one home, their element, which a summary row picks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

vi.mock('../use-block-sources', () => ({
  useBlockSources: () => ({
    boards: [
      ['board_ideas', 'Ideas'],
      ['board_bugs', 'Bugs'],
    ],
    roadmaps: [],
    categories: [],
    columns: [],
  }),
}))

const { Inspector } = await import('../inspector')

afterEach(cleanup)

const gates: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

function feed(change?: (draft: PortalDesign) => void) {
  const design = defaultDesign()
  design.layout.cards = 'raised'
  change?.(design)
  const update = vi.fn((fn: (draft: PortalDesign) => void) => fn(design))
  const onElement = vi.fn()
  render(
    <Inspector
      selection="feed"
      crumbs={[{ label: 'Feedback' }, { label: 'Feed' }]}
      title="Feed"
      design={design}
      update={update}
      gates={gates}
      onElement={onElement}
    />
  )
  return { design, update, onElement }
}

describe('the feed’s panel', () => {
  it('has no second editor for the post cards’ look, shadow, density or status', () => {
    feed()
    for (const name of ['Cards', 'Shadow', 'Density', 'Status'])
      expect(screen.queryByRole('radiogroup', { name })).toBeNull()
  })

  it('shows the post cards’ and statuses’ looks as rows that pick their elements', () => {
    const { onElement, update } = feed()
    fireEvent.click(screen.getByRole('button', { name: 'Post card look: Raised · Comfortable' }))
    expect(onElement).toHaveBeenLastCalledWith('postCard')
    fireEvent.click(screen.getByRole('button', { name: 'Status look: Dot' }))
    expect(onElement).toHaveBeenLastCalledWith('badge')
    expect(update).not.toHaveBeenCalled()
  })

  it('keeps what the feed does: its sort and what each post card shows', () => {
    const { design } = feed()
    fireEvent.click(screen.getByRole('radio', { name: 'Top' }))
    expect(design.pages.feedback.defaultSort).toBe('top')
    fireEvent.click(screen.getByRole('switch', { name: 'Show tags' }))
    expect(design.layout.postCardHides).toEqual(['tags'])
  })
})

async function pick(name: string) {
  const opens = screen.getByRole('combobox', { name: 'Opens on' })
  opens.focus()
  fireEvent.keyDown(opens, { key: 'ArrowDown' })
  const option = await screen.findByRole('option', { name })
  fireEvent.pointerDown(option)
  fireEvent.pointerUp(option)
  fireEvent.click(option)
}

describe('the board the feed opens on', () => {
  it('opens on every board until one is picked, and sets one by its id', async () => {
    const { design, update } = feed()
    const opens = screen.getByRole('combobox', { name: 'Opens on' })
    expect(opens.textContent).toContain('All boards')
    expect(opens.closest('[data-find]')?.getAttribute('data-find')).toBe('feed-opens-on')
    await pick('Bugs')
    expect(design.pages.feedback.openOn).toBe('board_bugs')
    expect(update).toHaveBeenLastCalledWith(expect.any(Function), 'Opens on')
  })

  it('goes back to every board, leaving no choice stored', async () => {
    const { design } = feed((draft) => (draft.pages.feedback.openOn = 'board_bugs' as never))
    const opens = screen.getByRole('combobox', { name: 'Opens on' })
    expect(opens.textContent).toContain('Bugs')
    await pick('All boards')
    expect(design.pages.feedback).not.toHaveProperty('openOn')
  })
})
