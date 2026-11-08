// @vitest-environment happy-dom
/**
 * A picked block's panel on the properties frame, drawn from the registry:
 * its name with its purpose on hover, its Content rows in order, and the
 * sections its builder gives it. Each control hands back the setting's key
 * and the value picked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { newBlock, type HomeBlock } from '@/lib/shared/design/home'
import { sectionOf, type AnyBlock } from '@/lib/shared/design/blocks'
import { defaultDesign } from '@/lib/shared/design/schema'
import { BlockPanel } from '../block-settings-panel'

const TOPIC = 'kb_category_01h455vb4pex5vsknk084sn02q'

function mount(block: AnyBlock, extra: Partial<Parameters<typeof BlockPanel>[0]> = {}) {
  const onChange = vi.fn()
  render(<BlockPanel block={block} onChange={onChange} {...extra} />)
  return { onChange }
}

const topPosts = () => ({ ...newBlock('ideas'), sort: 'trending', count: 3 }) as HomeBlock

afterEach(cleanup)

describe('a block’s settings panel', () => {
  it('names the block and says what it is for on hover, with no kind tag', () => {
    mount(topPosts())
    const name = screen.getByRole('heading', { level: 2, name: 'Top posts' })
    expect(name.getAttribute('title')).toBe('The posts visitors vote for most')
    expect(screen.queryByText('The posts visitors vote for most')).toBeNull()
    expect(screen.queryByText('Block')).toBeNull()
  })

  it('shows its settings in the registry’s order, under Content', () => {
    mount(topPosts())
    const content = screen.getByRole('region', { name: 'Content' })
    const labels = [
      within(content).getByRole('radiogroup', { name: 'Show' }),
      screen.getByRole('radiogroup', { name: 'How many' }),
    ]
    for (let i = 1; i < labels.length; i++)
      expect(
        labels[i - 1]!.compareDocumentPosition(labels[i]!) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    const show = screen.getByRole('radiogroup', { name: 'Show' })
    expect(within(show).getByRole('radio', { name: 'Trending' }).getAttribute('aria-checked')).toBe(
      'true'
    )
  })

  it('hands back a choice by its key and value', () => {
    const { onChange } = mount(topPosts())
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Show' })).getByRole('radio', {
        name: 'Most votes',
      })
    )
    expect(onChange).toHaveBeenLastCalledWith('sort', 'top')
  })

  it('hands back a count as a number', () => {
    const { onChange } = mount(topPosts())
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'How many' })).getByRole('radio', {
        name: '5',
      })
    )
    expect(onChange).toHaveBeenLastCalledWith('count', 5)
  })

  it('never retypes its words in Content: the heading and the words kept where they sit', () => {
    mount(topPosts())
    expect(screen.queryByLabelText('Heading')).toBeNull()
    expect(screen.queryByLabelText('Link')).toBeNull()
  })

  it('shows a choice it leaves out as its usual one, muted, with no dot', () => {
    mount({ ...newBlock('help_topics'), categoryIds: [] } as HomeBlock)
    const layout = screen.getByRole('radiogroup', { name: 'Layout' })
    expect(layout.closest('[data-property-row]')?.hasAttribute('data-set')).toBe(false)
    expect(within(layout).getByRole('radio', { name: 'Cards' }).className).toContain('dashed')
  })

  it('marks a choice set apart from its usual one, and Reset gives the usual one back', () => {
    const { onChange } = mount({ ...newBlock('help_topics'), layout: 'list' } as HomeBlock)
    const row = screen.getByRole('radiogroup', { name: 'Layout' }).closest('[data-property-row]')!
    expect(row.hasAttribute('data-set')).toBe(true)
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /Reset/ }))
    expect(onChange).toHaveBeenLastCalledWith('layout', 'cards')
  })

  it('draws the sections and actions its builder gives it, in order, and the places set apart', () => {
    const duplicate = vi.fn()
    mount(topPosts(), {
      words: <section aria-label="Words" />,
      layout: <section aria-label="Layout" />,
      look: <section aria-label="Look" />,
      actions: [{ label: 'Duplicate', keys: 'Ctrl+D', onSelect: duplicate }],
      overrides: [{ key: 'one', label: 'Status', detail: 'background Plain', onReset: vi.fn() }],
    })
    const order = ['Words', 'Content', 'Layout', 'Look'].map((name) =>
      screen.getByRole('region', { name })
    )
    for (let i = 1; i < order.length; i++)
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Top posts: more actions' })).toBeTruthy()
    expect(screen.getByText('Set differently in 1 place')).toBeTruthy()
  })

  it('offers no actions for a block that has none, such as a page’s own section', () => {
    mount(sectionOf(defaultDesign(), 'help.topics'))
    expect(screen.queryByRole('button', { name: /more actions/ })).toBeNull()
  })

  it('picks help topics from the workspace’s own', () => {
    const block = { ...newBlock('help_topics'), categoryIds: [] } as HomeBlock
    const { onChange } = mount(block, { sources: { categories: [[TOPIC, 'Billing']] } })
    expect(screen.getByText('The first topics, or pick up to 8')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Billing' }))
    expect(onChange).toHaveBeenLastCalledWith('categoryIds', [TOPIC])
  })

  it('picks the boards Top posts draws from, and offers 10 posts', () => {
    const board = 'board_01h455vb4pex5vsknk084sn02q'
    const { onChange } = mount(topPosts(), { sources: { boards: [[board, 'Mobile']] } })
    expect(screen.getByText('All boards, or pick up to 10')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mobile' }))
    expect(onChange).toHaveBeenLastCalledWith('boardIds', [board])
    const count = screen.getByRole('radiogroup', { name: 'How many' })
    fireEvent.click(within(count).getByRole('radio', { name: '10' }))
    expect(onChange).toHaveBeenLastCalledWith('count', 10)
  })

  it('says when the workspace has nothing to pick', () => {
    mount({ ...newBlock('help_topics'), categoryIds: [] } as HomeBlock)
    expect(screen.getByText('No topics yet. Shows the first topics.')).toBeTruthy()
  })

  it('shows the roadmap a block shows', () => {
    mount({ ...newBlock('roadmap'), roadmapId: null } as HomeBlock, {
      sources: { roadmaps: [['roadmap_01h455vb4pex5vsknk084sn02q', 'Mobile app']] },
    })
    expect(screen.getByRole('combobox', { name: 'Roadmap' }).textContent).toContain(
      'First public roadmap'
    )
  })

  it('leaves link lists to the editor the builder gives it', () => {
    mount(newBlock('links'), {
      renderField: (field) => (field.kind === 'links' ? <p>Links editor</p> : undefined),
    })
    expect(screen.getByText('Links editor')).toBeTruthy()
  })

  it('draws a page section with its switch and without a place on the page', () => {
    const { onChange } = mount(sectionOf(defaultDesign(), 'help.popular'))
    expect(screen.getByRole('heading', { level: 2, name: 'Popular articles' })).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Show popular articles' }))
    expect(onChange).toHaveBeenLastCalledWith('popular', false)
    expect(screen.queryByRole('radiogroup', { name: 'Width' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Move up' })).toBeNull()
  })
})
