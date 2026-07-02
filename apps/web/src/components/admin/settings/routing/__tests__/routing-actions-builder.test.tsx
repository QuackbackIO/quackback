// @vitest-environment happy-dom
import type { ChangeEvent, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { type BuilderAction, RoutingActionsBuilder } from '../routing-actions-builder'

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    type = 'button',
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    variant?: string
    size?: string
    className?: string
    'aria-label'?: string
  }) => (
    <button type={type} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: ReactNode
    value: string
    onValueChange: (value: string) => void
  }) => {
    const ariaLabel = ['low', 'normal', 'high', 'urgent'].includes(value)
      ? 'Priority'
      : ['team', 'org', 'shared', 'private'].includes(value)
        ? 'Visibility'
        : 'Action type'
    return (
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
          onValueChange(event.currentTarget.value)
        }
      >
        {children}
      </select>
    )
  },
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}))

vi.mock('@/components/admin/shared/inbox-picker', () => ({
  InboxPicker: ({
    value,
    onValueChange,
  }: {
    value: string | null
    onValueChange: (value: string | null) => void
    allowClear?: boolean
    placeholder?: string
  }) => (
    <select
      aria-label="Inbox"
      value={value ?? ''}
      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
        onValueChange(event.currentTarget.value || null)
      }
    >
      <option value="">No inbox</option>
      <option value="inbox_1">Support inbox</option>
    </select>
  ),
}))

vi.mock('@/components/admin/shared/team-picker', () => ({
  TeamPicker: ({
    value,
    onValueChange,
  }: {
    value: string | null
    onValueChange: (value: string | null) => void
    allowClear?: boolean
    placeholder?: string
  }) => (
    <select
      aria-label="Team"
      value={value ?? ''}
      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
        onValueChange(event.currentTarget.value || null)
      }
    >
      <option value="">No team</option>
      <option value="team_1">Support team</option>
    </select>
  ),
}))

vi.mock('@/components/admin/shared/principal-picker', () => ({
  PrincipalPicker: ({
    value,
    onValueChange,
  }: {
    value: string | null
    onValueChange: (value: string | null) => void
    placeholder?: string
  }) => (
    <select
      aria-label="Principal"
      value={value ?? ''}
      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
        onValueChange(event.currentTarget.value || null)
      }
    >
      <option value="">No principal</option>
      <option value="principal_1">Ada</option>
    </select>
  ),
}))

describe('RoutingActionsBuilder', () => {
  it('adds actions, removes actions, and clears value when the action type changes', () => {
    const onChange = vi.fn()

    render(
      <RoutingActionsBuilder
        value={[{ type: 'assignToInbox', value: 'inbox_1' }]}
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Add action/ }))
    expect(onChange).toHaveBeenCalledWith([
      { type: 'assignToInbox', value: 'inbox_1' },
      { type: 'assignToInbox', value: '' },
    ])

    fireEvent.change(screen.getByLabelText('Action type'), { target: { value: 'assignToTeam' } })
    expect(onChange).toHaveBeenCalledWith([{ type: 'assignToTeam', value: '' }])

    fireEvent.click(screen.getByRole('button', { name: 'Remove action' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('renders every value input branch and updates action values', () => {
    const onChange = vi.fn()
    const actions: BuilderAction[] = [
      { type: 'assignToInbox', value: '' },
      { type: 'assignToTeam', value: '' },
      { type: 'assignToPrincipal', value: '' },
      { type: 'addParticipant', value: '' },
      { type: 'setPriority', value: 'normal' },
      { type: 'setVisibility', value: 'team' },
    ]

    render(<RoutingActionsBuilder value={actions} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Inbox'), { target: { value: 'inbox_1' } })
    expect(onChange).toHaveBeenCalledWith([
      { type: 'assignToInbox', value: 'inbox_1' },
      ...actions.slice(1),
    ])

    fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'team_1' } })
    expect(onChange).toHaveBeenCalledWith([
      actions[0],
      { type: 'assignToTeam', value: 'team_1' },
      ...actions.slice(2),
    ])

    const principalInputs = screen.getAllByLabelText('Principal')
    fireEvent.change(principalInputs[0], { target: { value: 'principal_1' } })
    expect(onChange).toHaveBeenCalledWith([
      ...actions.slice(0, 2),
      { type: 'assignToPrincipal', value: 'principal_1' },
      ...actions.slice(3),
    ])

    fireEvent.change(principalInputs[1], { target: { value: 'principal_1' } })
    expect(onChange).toHaveBeenCalledWith([
      ...actions.slice(0, 3),
      { type: 'addParticipant', value: 'principal_1' },
      ...actions.slice(4),
    ])

    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'urgent' } })
    expect(onChange).toHaveBeenCalledWith([
      ...actions.slice(0, 4),
      { type: 'setPriority', value: 'urgent' },
      actions[5],
    ])

    fireEvent.change(screen.getByLabelText('Visibility'), { target: { value: 'private' } })
    expect(onChange).toHaveBeenCalledWith([
      ...actions.slice(0, 5),
      { type: 'setVisibility', value: 'private' },
    ])
  })
})
