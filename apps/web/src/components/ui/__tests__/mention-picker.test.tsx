// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MentionPicker } from '../mention-picker'
import type { MentionItem } from '../mention-picker'

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
]

describe('MentionPicker', () => {
  it('renders each item with a role badge', () => {
    render(<MentionPicker items={items} command={() => {}} />)
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('Jake Smith')).toBeInTheDocument()
    expect(screen.getByText(/Member/i)).toBeInTheDocument()
    expect(screen.getByText(/Admin/i)).toBeInTheDocument()
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

  it('updates selection on mouse enter of a row', () => {
    render(<MentionPicker items={items} command={() => {}} />)
    const jake = screen.getByText('Jake Smith').closest('button')!
    fireEvent.mouseEnter(jake)
    expect(jake).toHaveAttribute('aria-selected', 'true')
  })
})
