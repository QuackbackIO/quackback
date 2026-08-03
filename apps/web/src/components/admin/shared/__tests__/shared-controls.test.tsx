// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRouteErrorComponent, RouteErrorBoundary } from '../route-error-boundary'
import { ScopeSelector } from '../scope-selector'

vi.mock('@/components/ui/alert', () => ({
  Alert: ({ children }: { children: ReactNode; variant?: string; className?: string }) => (
    <section role="alert">{children}</section>
  ),
  AlertDescription: ({ children }: { children: ReactNode; className?: string }) => (
    <div>{children}</div>
  ),
  AlertTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type = 'button',
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    variant?: string
    size?: string
    className?: string
  }) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('../team-picker', () => ({
  TeamPicker: ({
    value,
    onValueChange,
    disabled,
  }: {
    value: string | null
    onValueChange: (value: string | null) => void
    disabled?: boolean
  }) => (
    <section>
      Team picker {value ?? 'none'}
      <button type="button" disabled={disabled} onClick={() => onValueChange('team_2')}>
        Pick team
      </button>
    </section>
  ),
}))

vi.mock('../inbox-picker', () => ({
  InboxPicker: ({
    value,
    onValueChange,
    disabled,
  }: {
    value: string | null
    onValueChange: (value: string | null) => void
    disabled?: boolean
  }) => (
    <section>
      Inbox picker {value ?? 'none'}
      <button type="button" disabled={disabled} onClick={() => onValueChange('inbox_2')}>
        Pick inbox
      </button>
    </section>
  ),
}))

vi.mock('@heroicons/react/24/outline', () => ({
  ExclamationCircleIcon: () => <span aria-hidden="true">error</span>,
}))

describe('RouteErrorBoundary', () => {
  it('renders errors and factory-bound titles with reset actions', () => {
    const reset = vi.fn()
    const { rerender } = render(
      <RouteErrorBoundary error={new Error('Loader failed')} reset={reset} title="Custom failure" />
    )

    expect(screen.getByRole('heading', { name: 'Custom failure' })).toBeInTheDocument()
    expect(screen.getByText('Loader failed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalled()

    const Bound = createRouteErrorComponent('Bound failure')
    rerender(<Bound error={new Error('Route failed')} reset={reset} />)
    expect(screen.getByRole('heading', { name: 'Bound failure' })).toBeInTheDocument()
    expect(screen.getByText('Route failed')).toBeInTheDocument()
  })
})

describe('ScopeSelector', () => {
  it('switches workspace, team, and inbox scopes', () => {
    const onValueChange = vi.fn()
    const { rerender } = render(
      <ScopeSelector
        value={{ kind: 'workspace' }}
        onValueChange={onValueChange}
        allowedKinds={['workspace', 'team', 'inbox']}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'team' }))
    expect(onValueChange).toHaveBeenCalledWith({ kind: 'team', teamId: null, inboxId: null })

    rerender(
      <ScopeSelector
        value={{ kind: 'team', teamId: 'team_1' as never }}
        onValueChange={onValueChange}
      />
    )
    expect(screen.getByText(/Team picker team_1/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pick team' }))
    expect(onValueChange).toHaveBeenCalledWith({
      kind: 'team',
      teamId: 'team_2',
      inboxId: null,
    })

    rerender(
      <ScopeSelector
        value={{ kind: 'inbox', inboxId: 'inbox_1' as never }}
        onValueChange={onValueChange}
        disabled
      />
    )
    expect(screen.getByText(/Inbox picker inbox_1/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pick inbox' })).toBeDisabled()
  })
})
