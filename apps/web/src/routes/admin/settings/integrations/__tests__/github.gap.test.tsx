// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

type RouteOptions = {
  component: () => ReactElement
  loader: (ctx: unknown) => Promise<unknown>
}

type Connection = { id: string; status: string }

const mocks = vi.hoisted(() => ({
  search: {} as Record<string, string | undefined>,
  data: {
    connections: [] as Connection[],
    platformCredentialFields: [] as unknown[],
    platformCredentialsConfigured: false,
  },
  invalidateQueries: vi.fn(),
  ensureQueryData: vi.fn(async () => undefined),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useSearch: (..._a: unknown[]) => mocks.search,
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: (..._a: unknown[]) => ({ data: mocks.data }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    githubIntegrations: () => ({ queryKey: ['githubIntegrations'] }),
    integrations: () => ({ queryKey: ['integrations'] }),
  },
}))

vi.mock('@/components/admin/settings/integrations/integration-header', () => ({
  IntegrationHeader: ({ status, actions }: { status: string | null; actions?: ReactNode }) => (
    <div data-testid="integration-header" data-status={status ?? 'null'}>
      {actions}
    </div>
  ),
}))

vi.mock('@/components/admin/settings/integrations/integration-setup-card', () => ({
  IntegrationSetupCard: ({ connectionForm }: { connectionForm?: ReactNode }) => (
    <div data-testid="setup-card">{connectionForm}</div>
  ),
}))

vi.mock('@/components/admin/settings/integrations/platform-credentials-dialog', () => ({
  PlatformCredentialsDialog: ({ open }: { open: boolean }) => (
    <div data-testid="credentials-dialog" data-open={String(open)} />
  ),
}))

vi.mock('@/components/admin/settings/integrations/github/github-connection-card', () => ({
  GitHubConnectionCard: ({ connection }: { connection: Connection }) => (
    <div data-testid={`connection-${connection.id}`} />
  ),
}))

vi.mock('@/components/admin/settings/integrations/github/github-add-repo-dialog', () => ({
  GitHubAddRepoDialog: ({ open }: { open: boolean }) => (
    <div data-testid="add-repo-dialog" data-open={String(open)} />
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))

vi.mock('@heroicons/react/24/solid', () => ({
  CheckCircleIcon: () => <svg data-testid="check-icon" />,
  ExclamationTriangleIcon: () => <svg data-testid="warn-icon" />,
  PlusIcon: () => <svg data-testid="plus-icon" />,
}))

vi.mock('@/components/icons/integration-icons', () => ({
  GitHubIcon: () => <svg data-testid="gh-icon" />,
}))

vi.mock('@/lib/shared/integration-catalog', () => ({
  githubCatalog: { id: 'github', name: 'GitHub' },
}))

const { Route } = await import('../github')

function routeOptions(): RouteOptions {
  return (Route as unknown as { options: RouteOptions }).options
}

function renderPage() {
  const Component = routeOptions().component
  return render(<Component />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.search = {}
  mocks.data = {
    connections: [],
    platformCredentialFields: [],
    platformCredentialsConfigured: false,
  }
})

describe('github integration route loader', () => {
  it('prefetches github integrations query data', async () => {
    const result = await routeOptions().loader({
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(1)
    expect(result).toEqual({})
  })
})

describe('GitHubIntegrationPage rendering', () => {
  it('renders setup card with no connections and shows configure credentials when fields present and not configured', () => {
    mocks.data.connections = []
    mocks.data.platformCredentialFields = [{ key: 'token' }]
    mocks.data.platformCredentialsConfigured = false
    renderPage()
    expect(screen.getByTestId('setup-card')).toBeInTheDocument()
    expect(screen.getByText('Configure credentials')).toBeInTheDocument()
    const header = screen.getByTestId('integration-header')
    expect(header.getAttribute('data-status')).toBe('null')
  })

  it('renders setup card configured branch with both buttons and opens dialogs', () => {
    mocks.data.connections = []
    mocks.data.platformCredentialFields = [{ key: 'token' }]
    mocks.data.platformCredentialsConfigured = true
    renderPage()
    // Two "Configure credentials" buttons exist (header has none since no connections)
    fireEvent.click(screen.getByText('Configure credentials'))
    expect(screen.getByTestId('credentials-dialog').getAttribute('data-open')).toBe('true')
    fireEvent.click(screen.getByText('Add repository'))
    expect(screen.getByTestId('add-repo-dialog').getAttribute('data-open')).toBe('true')
  })

  it('renders connections with active status and header actions (configure + add repo)', () => {
    mocks.data.connections = [{ id: 'c1', status: 'active' }]
    mocks.data.platformCredentialFields = [{ key: 'token' }]
    mocks.data.platformCredentialsConfigured = true
    renderPage()
    expect(screen.getByTestId('connection-c1')).toBeInTheDocument()
    expect(screen.getByTestId('integration-header').getAttribute('data-status')).toBe('active')
    fireEvent.click(screen.getByText('Configure credentials'))
    expect(screen.getByTestId('credentials-dialog').getAttribute('data-open')).toBe('true')
    fireEvent.click(screen.getByText('Add repository'))
    expect(screen.getByTestId('add-repo-dialog').getAttribute('data-open')).toBe('true')
  })

  it('renders paused status when connections exist but none active', () => {
    mocks.data.connections = [{ id: 'c2', status: 'paused' }]
    renderPage()
    expect(screen.getByTestId('integration-header').getAttribute('data-status')).toBe('paused')
  })
})

describe('GitHubIntegrationPage oauth notice effect', () => {
  it('does nothing when github search param is absent', () => {
    mocks.search = {}
    renderPage()
    expect(mocks.invalidateQueries).not.toHaveBeenCalled()
    expect(screen.queryByTestId('check-icon')).not.toBeInTheDocument()
    expect(screen.queryByTestId('warn-icon')).not.toBeInTheDocument()
  })

  it('shows success notice and invalidates queries when github=connected', () => {
    vi.useFakeTimers()
    mocks.search = { github: 'connected' }
    renderPage()
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('check-icon')).toBeInTheDocument()
    expect(screen.getByText('GitHub connection refreshed.')).toBeInTheDocument()
    // success notice auto-clears after 3s
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.queryByText('GitHub connection refreshed.')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('shows error notice with mapped reason when github=error', () => {
    mocks.search = { github: 'error', reason: 'github_denied' }
    renderPage()
    expect(screen.getByTestId('warn-icon')).toBeInTheDocument()
    expect(screen.getByText('GitHub authorization was cancelled.')).toBeInTheDocument()
  })
})
