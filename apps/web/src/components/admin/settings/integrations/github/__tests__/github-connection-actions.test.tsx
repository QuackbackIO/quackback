// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GitHubConnectionActions, GitHubReconnectButton } from '../github-connection-actions'

const mocks = vi.hoisted(() => ({
  getGitHubConnectUrl: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/server/integrations/github/functions', () => ({
  getGitHubConnectUrl: mocks.getGitHubConnectUrl,
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
  },
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type = 'button',
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    variant?: string
    size?: string
    className?: string
    'aria-label'?: string
  }) => (
    <button type={type} disabled={disabled} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}))

vi.mock('@heroicons/react/24/solid', () => ({
  ArrowPathIcon: () => <span aria-hidden="true">refresh</span>,
}))

vi.mock('../../oauth-connection-actions', () => ({
  OAuthConnectionActions: ({
    integrationId,
    isConnected,
    getConnectUrl,
    displayName,
    disconnectDescription,
  }: {
    integrationId?: string
    isConnected: boolean
    searchParamKey: string
    getConnectUrl: () => Promise<string>
    displayName: string
    disconnectDescription: string
  }) => (
    <section>
      <span>
        OAuth {displayName} {isConnected ? 'connected' : 'disconnected'} {integrationId ?? 'none'}
      </span>
      <span>{disconnectDescription}</span>
      <button type="button" onClick={() => void getConnectUrl()}>
        Start OAuth
      </button>
    </section>
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.getGitHubConnectUrl.mockResolvedValue('https://github.example.test/connect')
  window.history.replaceState(null, '', '/admin/settings/integrations')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GitHubReconnectButton', () => {
  it('requests a reconnect URL and redirects the browser', async () => {
    render(<GitHubReconnectButton integrationId="integration_1" label="Reconnect now" />)

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect GitHub' }))

    await waitFor(() => {
      expect(mocks.getGitHubConnectUrl).toHaveBeenCalledWith({
        data: { intent: 'reconnect', integrationId: 'integration_1' },
      })
    })
    expect(window.location.href).toContain('https://github.example.test/connect')
  })

  it('reports reconnect URL failures and re-enables the button', async () => {
    mocks.getGitHubConnectUrl.mockRejectedValueOnce(new Error('Reconnect denied'))
    render(<GitHubReconnectButton integrationId="integration_1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect GitHub' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Reconnect denied')
    })
    expect(console.error).toHaveBeenCalledWith('Failed to get reconnect URL:', expect.any(Error))
    expect(screen.getByRole('button', { name: 'Reconnect GitHub' })).toBeEnabled()
  })
})

describe('GitHubConnectionActions', () => {
  it('renders reconnect only for connected integrations and wires new OAuth URL creation', async () => {
    const { rerender } = render(
      <GitHubConnectionActions integrationId="integration_1" isConnected />
    )

    expect(screen.getByRole('button', { name: 'Reconnect GitHub' })).toBeInTheDocument()
    expect(screen.getByText(/OAuth GitHub connected integration_1/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start OAuth' }))
    await waitFor(() => {
      expect(mocks.getGitHubConnectUrl).toHaveBeenCalledWith({ data: { intent: 'new' } })
    })

    rerender(<GitHubConnectionActions isConnected={false} />)
    expect(screen.queryByRole('button', { name: 'Reconnect GitHub' })).not.toBeInTheDocument()
    expect(screen.getByText(/OAuth GitHub disconnected none/)).toBeInTheDocument()
  })
})
