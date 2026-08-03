// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GitHubAddRepoDialog } from '../github-add-repo-dialog'

type Repo = {
  id: number
  fullName: string
  private: boolean
}

const mocks = vi.hoisted(() => ({
  fetchGitHubReposFn: vi.fn(),
  getGitHubConnectUrl: vi.fn(),
}))

vi.mock('@/lib/server/integrations/github/functions', () => ({
  fetchGitHubReposFn: mocks.fetchGitHubReposFn,
  getGitHubConnectUrl: mocks.getGitHubConnectUrl,
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
  }: {
    children: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode; className?: string }) => (
    <section>{children}</section>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
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

vi.mock('@heroicons/react/24/solid', () => ({
  ArrowPathIcon: () => <span aria-hidden="true">refresh</span>,
  FolderIcon: () => <span aria-hidden="true">folder</span>,
}))

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 1,
    fullName: 'acme/quackback',
    private: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.fetchGitHubReposFn.mockResolvedValue([
    repo(),
    repo({ id: 2, fullName: 'acme/private', private: true }),
  ])
  mocks.getGitHubConnectUrl.mockResolvedValue('https://github.example.test/connect')
  window.history.replaceState(null, '', '/admin/settings/integrations')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GitHubAddRepoDialog', () => {
  it('fetches repositories when opened, refreshes them, and redirects for a selected repo', async () => {
    render(<GitHubAddRepoDialog open onOpenChange={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /acme\/quackback/ })).toBeInTheDocument()
    })
    expect(screen.getByText('Private')).toBeInTheDocument()
    expect(mocks.fetchGitHubReposFn).toHaveBeenCalledWith({ data: {} })

    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))
    await waitFor(() => {
      expect(mocks.fetchGitHubReposFn).toHaveBeenCalledTimes(2)
    })

    fireEvent.click(screen.getByRole('button', { name: /acme\/private/ }))
    await waitFor(() => {
      expect(mocks.getGitHubConnectUrl).toHaveBeenCalledWith({
        data: { intent: 'new', repoFullName: 'acme/private' },
      })
    })
    expect(window.location.href).toContain('https://github.example.test/connect')
  })

  it('renders an empty state when GitHub returns no repositories', async () => {
    mocks.fetchGitHubReposFn.mockResolvedValueOnce([])

    render(<GitHubAddRepoDialog open onOpenChange={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('No repositories found.')).toBeInTheDocument()
    })
  })

  it('renders fetch errors and starts a new GitHub connection', async () => {
    mocks.fetchGitHubReposFn.mockRejectedValueOnce(new Error('No GitHub token'))
    render(<GitHubAddRepoDialog open onOpenChange={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('No GitHub token')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Connect with GitHub' }))
    await waitFor(() => {
      expect(mocks.getGitHubConnectUrl).toHaveBeenCalledWith({ data: { intent: 'new' } })
    })
    expect(window.location.href).toContain('https://github.example.test/connect')
  })

  it('falls back to the generic connection message and recovers when connect URL creation fails', async () => {
    mocks.fetchGitHubReposFn.mockRejectedValueOnce('missing token')
    mocks.getGitHubConnectUrl.mockRejectedValueOnce(new Error('OAuth denied'))
    render(<GitHubAddRepoDialog open onOpenChange={vi.fn()} />)

    await waitFor(() => {
      expect(
        screen.getByText(
          'No active GitHub connection found. The new connection will authenticate with GitHub.'
        )
      ).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Connect with GitHub' }))
    await waitFor(() => {
      expect(console.error).toHaveBeenCalledWith('Failed to get connect URL:', expect.any(Error))
    })
    expect(screen.getByRole('button', { name: 'Connect with GitHub' })).toBeEnabled()
  })
})
