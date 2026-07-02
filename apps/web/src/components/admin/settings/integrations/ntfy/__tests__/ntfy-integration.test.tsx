// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NtfyConfig } from '../ntfy-config'
import { NtfyConnectionActions } from '../ntfy-connection-actions'

const mocks = vi.hoisted(() => ({
  saveNtfyFn: vi.fn(),
  deleteIntegration: vi.fn(),
  updateIntegration: vi.fn(),
  deleteState: {
    isPending: false,
  },
  updateState: {
    isPending: false,
    isError: false,
    error: null as Error | null,
  },
}))

vi.mock('@/lib/server/integrations/ntfy/functions', () => ({
  saveNtfyFn: mocks.saveNtfyFn,
}))

vi.mock('@/lib/client/mutations', () => ({
  useDeleteIntegration: () => ({
    mutate: mocks.deleteIntegration,
    ...mocks.deleteState,
  }),
  useUpdateIntegration: () => ({
    mutate: mocks.updateIntegration,
    ...mocks.updateState,
  }),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    variant?: string
    size?: string
    className?: string
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    id,
    type = 'text',
    value,
    onChange,
    disabled,
    placeholder,
  }: {
    id?: string
    type?: string
    value?: string
    onChange?: (event: { target: { value: string } }) => void
    disabled?: boolean
    placeholder?: string
    className?: string
  }) => (
    <input
      id={id}
      type={type}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange?.({ target: { value: event.currentTarget.value } })}
    />
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({
    children,
    htmlFor,
    className,
  }: {
    children: ReactNode
    htmlFor?: string
    className?: string
  }) => (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    id,
    checked,
    disabled,
    onCheckedChange,
  }: {
    id?: string
    checked?: boolean
    disabled?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
}))

vi.mock('@/components/shared/confirm-dialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    description,
    confirmLabel,
    isPending,
    onConfirm,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description: string
    confirmLabel?: string
    isPending?: boolean
    onConfirm: () => void
  }) =>
    open ? (
      <section>
        <h2>{title}</h2>
        <p>{description}</p>
        <button type="button" disabled={isPending} onClick={onConfirm}>
          {confirmLabel ?? 'Confirm'}
        </button>
      </section>
    ) : null,
}))

vi.mock('@heroicons/react/24/solid', () => ({
  ArrowPathIcon: () => <span aria-hidden="true">refresh</span>,
  CheckCircleIcon: () => <span aria-hidden="true">check</span>,
  ExclamationCircleIcon: () => <span aria-hidden="true">error</span>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.saveNtfyFn.mockResolvedValue({ id: 'ntfy_1' })
  mocks.deleteState.isPending = false
  mocks.updateState.isPending = false
  mocks.updateState.isError = false
  mocks.updateState.error = null
})

describe('NtfyConnectionActions', () => {
  it('saves trimmed ntfy connection settings and renders success', async () => {
    render(<NtfyConnectionActions isConnected={false} />)

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('ntfy Topic URL'), {
      target: { value: '  https://ntfy.sh/quackback  ' },
    })
    fireEvent.change(screen.getByLabelText(/Access token/), {
      target: { value: '  tk_secret  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mocks.saveNtfyFn).toHaveBeenCalledWith({
        data: {
          url: 'https://ntfy.sh/quackback',
          token: 'tk_secret',
        },
      })
    })
    expect(screen.getByText('ntfy connected and verified!')).toBeInTheDocument()
  })

  it('shows generic save errors for non-Error failures', async () => {
    mocks.saveNtfyFn.mockRejectedValueOnce('denied')
    render(<NtfyConnectionActions isConnected={false} />)

    fireEvent.change(screen.getByLabelText('ntfy Topic URL'), {
      target: { value: 'https://ntfy.sh/quackback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Failed to save ntfy settings')).toBeInTheDocument()
    })
  })

  it('confirms disconnect for connected ntfy integrations', () => {
    render(<NtfyConnectionActions isConnected integrationId="ntfy_1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    expect(screen.getByText('Disconnect ntfy?')).toBeInTheDocument()
    expect(
      screen.getByText(
        'This will remove the ntfy integration and stop all push notifications. You can reconnect at any time.'
      )
    ).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' })[1])
    expect(mocks.deleteIntegration).toHaveBeenCalledWith({ id: 'ntfy_1' })
  })

  it('does not disconnect without an integration id', () => {
    render(<NtfyConnectionActions isConnected />)

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' })[1])

    expect(mocks.deleteIntegration).not.toHaveBeenCalled()
  })
})

describe('NtfyConfig', () => {
  it('toggles the integration enabled state and disables event switches while paused', () => {
    render(
      <NtfyConfig
        integrationId="ntfy_1"
        enabled
        initialEventMappings={[{ id: 'map_1', eventType: 'post.created', enabled: true }]}
      />
    )

    const switches = screen.getAllByRole('switch')
    expect(switches[0]).toHaveAttribute('aria-checked', 'true')
    expect(switches[1]).toHaveAttribute('aria-checked', 'true')
    expect(switches[2]).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(switches[0])

    expect(mocks.updateIntegration).toHaveBeenCalledWith({ id: 'ntfy_1', enabled: false })
    expect(screen.getAllByRole('switch')[1]).toBeDisabled()
  })

  it('persists event mapping toggles for every configured event', () => {
    render(
      <NtfyConfig
        integrationId="ntfy_1"
        enabled
        initialEventMappings={[
          { id: 'map_1', eventType: 'post.created', enabled: true },
          { id: 'map_2', eventType: 'comment.created', enabled: false },
        ]}
      />
    )

    fireEvent.click(screen.getAllByRole('switch')[2])

    expect(mocks.updateIntegration).toHaveBeenCalledWith({
      id: 'ntfy_1',
      eventMappings: [
        { eventType: 'post.created', enabled: true },
        { eventType: 'post.status_changed', enabled: true },
        { eventType: 'comment.created', enabled: false },
      ],
    })
  })

  it('renders saving and error states from the update mutation', () => {
    mocks.updateState.isPending = true
    mocks.updateState.isError = true
    mocks.updateState.error = new Error('Cannot update ntfy')

    render(<NtfyConfig integrationId="ntfy_1" enabled initialEventMappings={[]} />)

    expect(screen.getByText('Saving...')).toBeInTheDocument()
    expect(screen.getByText('Cannot update ntfy')).toBeInTheDocument()
    for (const toggle of screen.getAllByRole('switch')) {
      expect(toggle).toBeDisabled()
    }
  })
})
