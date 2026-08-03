// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WebhookInboxPicker } from '../webhook-inbox-picker'

const mocks = vi.hoisted(() => ({
  query: {
    data: [
      { id: 'inbox_1', name: 'Support', slug: 'support' },
      { id: 'inbox_2', name: 'Billing', slug: 'billing' },
    ],
    isLoading: false,
  } as {
    data?: Array<{ id: string; name: string; slug: string }>
    isLoading: boolean
  },
}))

vi.mock('@/lib/client/hooks/use-inboxes-queries', () => ({
  useInboxes: vi.fn(() => mocks.query),
}))

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    disabled,
    onCheckedChange,
    'aria-label': ariaLabel,
  }: {
    checked?: boolean
    disabled?: boolean
    onCheckedChange?: () => void
    'aria-label'?: string
  }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.()}
    >
      {checked ? 'checked' : 'unchecked'}
    </button>
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: { children: ReactNode; className?: string }) => <span>{children}</span>,
}))

beforeEach(() => {
  mocks.query = {
    data: [
      { id: 'inbox_1', name: 'Support', slug: 'support' },
      { id: 'inbox_2', name: 'Billing', slug: 'billing' },
    ],
    isLoading: false,
  }
})

describe('WebhookInboxPicker', () => {
  it('selects, clears, and removes inbox filters while active', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <WebhookInboxPicker value={[]} onChange={onChange} active disabled={false} />
    )

    expect(screen.getByText('Inboxes (optional)')).toBeInTheDocument()
    expect(screen.getByText('Empty = match tickets in any inbox.')).toBeInTheDocument()
    expect(screen.getByText('Support')).toBeInTheDocument()
    expect(screen.getByText('support')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Filter by inbox Support' }))
    expect(onChange).toHaveBeenCalledWith(['inbox_1'])

    rerender(<WebhookInboxPicker value={['inbox_1']} onChange={onChange} active />)
    expect(
      screen.getByText('Only deliver ticket events from the selected inbox.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter by inbox Support' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Filter by inbox Support' }))
    expect(onChange).toHaveBeenCalledWith([])

    rerender(<WebhookInboxPicker value={['inbox_1', 'inbox_2']} onChange={onChange} active />)
    expect(
      screen.getByText('Only deliver ticket events from the selected inboxes.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('disables filters and shows the inactive hint when no ticket events are selected', () => {
    const onChange = vi.fn()
    render(<WebhookInboxPicker value={['inbox_1']} onChange={onChange} active={false} />)

    expect(screen.getByText(/Filter is ignored unless/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter by inbox Support' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Filter by inbox Support' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders loading and empty inbox states', () => {
    mocks.query = { data: undefined, isLoading: true }
    const { rerender } = render(
      <WebhookInboxPicker value={[]} onChange={vi.fn()} active disabled={false} />
    )

    expect(screen.getByText(/Loading inboxes/)).toBeInTheDocument()

    mocks.query = { data: [], isLoading: false }
    rerender(<WebhookInboxPicker value={[]} onChange={vi.fn()} active disabled={false} />)

    expect(screen.getByText('No inboxes configured.')).toBeInTheDocument()
  })
})
