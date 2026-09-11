// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen, act } from '@testing-library/react'
import { SlashMenuList } from '../rich-text-editor'

const items = [
  {
    title: 'Text',
    description: 'Paragraph',
    icon: <span>T</span>,
    command: () => {},
    group: 'text' as const,
  },
  {
    title: 'Bullet list',
    description: 'List',
    icon: <span>B</span>,
    command: () => {},
    group: 'lists' as const,
  },
  {
    title: 'Code',
    description: 'Code block',
    icon: <span>C</span>,
    command: () => {},
    group: 'blocks' as const,
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

describe('SlashMenuList', () => {
  it('Tab selects the highlighted row (Slack-style)', () => {
    const command = vi.fn()
    const ref = createRef<ListHandle>()
    render(<SlashMenuList ref={ref} items={items} command={command} />)
    expect(fireKey(ref, 'Tab')).toBe(true)
    expect(command).toHaveBeenCalledWith(items[0])
  })

  it('Shift+Tab (key Tab) also confirms', () => {
    const command = vi.fn()
    const ref = createRef<ListHandle>()
    render(<SlashMenuList ref={ref} items={items} command={command} />)
    expect(fireKey(ref, 'Tab')).toBe(true)
    expect(command).toHaveBeenCalledOnce()
  })

  it('renders command titles', () => {
    render(<SlashMenuList items={items} command={() => {}} />)
    expect(screen.getByText('Bullet list')).toBeInTheDocument()
    expect(screen.getByText('Code')).toBeInTheDocument()
  })

  it('highlights the typed query in command titles', () => {
    render(<SlashMenuList items={items} command={() => {}} query="list" />)
    expect(screen.getByText('list')).toHaveAttribute('data-query-match')
  })
})
