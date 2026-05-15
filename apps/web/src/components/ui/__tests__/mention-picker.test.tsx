// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MentionPicker } from '../mention-picker'
import type { MentionItem, MentionPickerHandle } from '../mention-picker'

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({
    settings: {
      brandingData: { logoUrl: 'https://cdn.example.com/logo.png', name: 'Acme' },
      name: 'Acme',
    },
  }),
}))

const items: MentionItem[] = [
  {
    principalId: 'principal_jane',
    displayName: 'Jane Doe',
    avatarUrl: null,
    role: 'member',
  },
  {
    principalId: 'principal_jake',
    displayName: 'Jake Smith',
    avatarUrl: null,
    role: 'admin',
  },
  {
    principalId: 'principal_carl',
    displayName: 'Carl Customer',
    avatarUrl: null,
    role: 'user',
  },
]

function fireKey(ref: React.RefObject<MentionPickerHandle | null>, key: string): boolean {
  let result = false
  act(() => {
    result = ref.current!.onKeyDown({ event: new KeyboardEvent('keydown', { key }) })
  })
  return result
}

describe('MentionPicker', () => {
  it('renders each item by display name', () => {
    render(<MentionPicker items={items} command={() => {}} />)
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('Jake Smith')).toBeInTheDocument()
    expect(screen.getByText('Carl Customer')).toBeInTheDocument()
  })

  it('shows the org logo badge after team-member names only', () => {
    render(<MentionPicker items={items} command={() => {}} />)
    const memberRow = screen.getByText('Jane Doe').closest('button')!
    const adminRow = screen.getByText('Jake Smith').closest('button')!
    const customerRow = screen.getByText('Carl Customer').closest('button')!

    expect(memberRow.querySelector('.mention-picker__team-badge')).not.toBeNull()
    expect(adminRow.querySelector('.mention-picker__team-badge')).not.toBeNull()
    expect(customerRow.querySelector('.mention-picker__team-badge')).toBeNull()

    const logoImg = memberRow.querySelector(
      '.mention-picker__team-badge img'
    ) as HTMLImageElement | null
    expect(logoImg?.src).toBe('https://cdn.example.com/logo.png')
  })

  it('does not render the old role text labels', () => {
    render(<MentionPicker items={items} command={() => {}} />)
    expect(screen.queryByText(/^Member$/i)).toBeNull()
    expect(screen.queryByText(/^Admin$/i)).toBeNull()
    expect(screen.queryByText(/^Customer$/i)).toBeNull()
  })

  it('invokes command(item) when a row is clicked', () => {
    const command = vi.fn()
    render(<MentionPicker items={items} command={command} />)
    fireEvent.click(screen.getByText('Jane Doe'))
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'principal_jane', label: 'Jane Doe' })
    )
  })

  it('shows empty state when items is empty', () => {
    render(<MentionPicker items={[]} command={() => {}} />)
    expect(screen.getByText(/no people match/i)).toBeInTheDocument()
  })

  it('renders the first item as selected by default', () => {
    render(<MentionPicker items={items} command={() => {}} />)
    const jane = screen.getByText('Jane Doe').closest('button')
    expect(jane).toHaveAttribute('aria-selected', 'true')
  })

  it('re-selects the first row when items change', () => {
    const ref = createRef<MentionPickerHandle>()
    const { rerender } = render(<MentionPicker ref={ref} items={items} command={() => {}} />)
    // Arrow down to the second row.
    fireKey(ref, 'ArrowDown')
    expect(screen.getByText('Jake Smith').closest('button')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    // New search results come in — selection should snap back to row 0.
    const nextItems: MentionItem[] = [
      {
        principalId: 'principal_kim',
        displayName: 'Kim Lee',
        avatarUrl: null,
        role: 'admin',
      },
      {
        principalId: 'principal_kyle',
        displayName: 'Kyle Park',
        avatarUrl: null,
        role: 'user',
      },
    ]
    rerender(<MentionPicker ref={ref} items={nextItems} command={() => {}} />)
    expect(screen.getByText('Kim Lee').closest('button')).toHaveAttribute('aria-selected', 'true')
  })

  it('does not change selection on mouse enter (keyboard is source of truth)', () => {
    render(<MentionPicker items={items} command={() => {}} />)
    const jake = screen.getByText('Jake Smith').closest('button')!
    fireEvent.mouseEnter(jake)
    expect(jake).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('Jane Doe').closest('button')).toHaveAttribute('aria-selected', 'true')
  })

  it('ArrowDown/ArrowUp navigate with wrap-around', () => {
    const ref = createRef<MentionPickerHandle>()
    render(<MentionPicker ref={ref} items={items} command={() => {}} />)
    fireKey(ref, 'ArrowDown')
    expect(screen.getByText('Jake Smith').closest('button')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    fireKey(ref, 'ArrowDown')
    fireKey(ref, 'ArrowDown') // wraps to first
    expect(screen.getByText('Jane Doe').closest('button')).toHaveAttribute('aria-selected', 'true')
    fireKey(ref, 'ArrowUp') // wraps to last
    expect(screen.getByText('Carl Customer').closest('button')).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('Home/End jump to first/last row', () => {
    const ref = createRef<MentionPickerHandle>()
    render(<MentionPicker ref={ref} items={items} command={() => {}} />)
    expect(fireKey(ref, 'End')).toBe(true)
    expect(screen.getByText('Carl Customer').closest('button')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(fireKey(ref, 'Home')).toBe(true)
    expect(screen.getByText('Jane Doe').closest('button')).toHaveAttribute('aria-selected', 'true')
  })

  it('Enter selects the highlighted row', () => {
    const command = vi.fn()
    const ref = createRef<MentionPickerHandle>()
    render(<MentionPicker ref={ref} items={items} command={command} />)
    fireKey(ref, 'ArrowDown')
    expect(fireKey(ref, 'Enter')).toBe(true)
    expect(command).toHaveBeenCalledWith({ id: 'principal_jake', label: 'Jake Smith' })
  })

  it('Tab selects the highlighted row (Slack-style)', () => {
    const command = vi.fn()
    const ref = createRef<MentionPickerHandle>()
    render(<MentionPicker ref={ref} items={items} command={command} />)
    expect(fireKey(ref, 'Tab')).toBe(true)
    expect(command).toHaveBeenCalledWith({ id: 'principal_jane', label: 'Jane Doe' })
  })

  it('returns false for unrelated keys so the editor keeps handling them', () => {
    const ref = createRef<MentionPickerHandle>()
    render(<MentionPicker ref={ref} items={items} command={() => {}} />)
    expect(fireKey(ref, 'a')).toBe(false)
    expect(fireKey(ref, ' ')).toBe(false)
  })
})
