// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen, act } from '@testing-library/react'
import { EmojiSuggestionList } from '../rich-text-editor'
import type { EmojiItem } from '@/lib/shared/content-emoji'

const items: EmojiItem[] = [
  {
    name: 'crossed_fingers',
    emoji: '🤞',
    shortcodes: ['fingers_crossed'],
    tags: ['finger'],
  },
  {
    name: 'tada',
    emoji: '🎉',
    shortcodes: ['tada'],
    tags: ['party'],
  },
  {
    name: 'fire',
    emoji: '🔥',
    shortcodes: ['fire'],
    tags: ['hot'],
  },
]

type ListHandle = { onKeyDown: (p: { event: KeyboardEvent }) => boolean }

function fireKey(ref: React.RefObject<ListHandle | null>, key: string): boolean {
  let result = false
  act(() => {
    result = ref.current!.onKeyDown({ event: new KeyboardEvent('keydown', { key }) })
  })
  return result
}

describe('EmojiSuggestionList', () => {
  it('Tab selects the highlighted row (Slack-style)', () => {
    const command = vi.fn()
    const ref = createRef<ListHandle>()
    render(<EmojiSuggestionList ref={ref} items={items} command={command} />)
    expect(fireKey(ref, 'Tab')).toBe(true)
    expect(command).toHaveBeenCalledWith(items[0])
  })

  it('Home/End jump to first/last row', () => {
    const command = vi.fn()
    const ref = createRef<ListHandle>()
    render(<EmojiSuggestionList ref={ref} items={items} command={command} />)
    expect(fireKey(ref, 'End')).toBe(true)
    expect(fireKey(ref, 'Enter')).toBe(true)
    expect(command).toHaveBeenCalledWith(items[2])
    command.mockClear()
    expect(fireKey(ref, 'Home')).toBe(true)
    expect(fireKey(ref, 'Enter')).toBe(true)
    expect(command).toHaveBeenCalledWith(items[0])
  })

  it('renders shortcodes so the highlighted suggestion is visible', () => {
    const { container } = render(<EmojiSuggestionList items={items} command={() => {}} />)
    expect(container.querySelector('[data-emoji-shortcode="fingers_crossed"]')).not.toBeNull()
    expect(container.querySelector('[data-emoji-shortcode="tada"]')).not.toBeNull()
  })

  it('highlights the typed query in the Slack name (:crossed_fingers:)', () => {
    const { container } = render(
      <EmojiSuggestionList items={items} command={() => {}} query="fingers" />
    )
    expect(container.querySelector('[data-emoji-shortcode="crossed_fingers"]')).not.toBeNull()
    const marks = screen.getAllByText('fingers')
    expect(marks[0]).toHaveAttribute('data-query-match')
    expect(marks[0]).toHaveClass('text-amber-600')
  })

  it('labels Recent then Popular when recentCount is set (bare `:` )', () => {
    render(<EmojiSuggestionList items={items} command={() => {}} recentCount={1} />)
    expect(screen.getByText('Recent')).toBeInTheDocument()
    expect(screen.getByText('Popular')).toBeInTheDocument()
  })
})
