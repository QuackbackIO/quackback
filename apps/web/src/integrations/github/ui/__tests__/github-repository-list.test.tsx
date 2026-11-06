// @vitest-environment happy-dom
/**
 * The repository list and the add dialog: one card per synced repository, an
 * empty state, and an add dialog that leaves out repositories already synced,
 * filters as you type and adds the one picked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({
  destinations: vi.fn(),
  repos: vi.fn(),
  add: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    integrationDestinations: (type: string) => ({
      queryKey: ['admin', 'integrations', type, 'destinations'],
      queryFn: mocks.destinations,
    }),
  },
}))
vi.mock('@/integrations/github/server/functions', () => ({ fetchGitHubReposFn: mocks.repos }))
vi.mock('@/lib/client/mutations', () => ({
  useAddIntegrationDestination: () => ({ mutate: mocks.add, isPending: false }),
}))
vi.mock('@/integrations/github/ui/github-repository-card', () => ({
  GitHubRepositoryCard: ({ destination }: { destination: { externalId: string } }) => (
    <p>card:{destination.externalId}</p>
  ),
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

import { GitHubRepositoryList } from '../github-repository-list'

const repo = (id: string, externalId: string) => ({ id, externalId, kind: 'repo' })

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={{}}>
        <GitHubRepositoryList />
      </IntlProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.repos.mockResolvedValue([
    { id: 1, fullName: 'acme/app', private: false },
    { id: 2, fullName: 'acme/api', private: true },
    { id: 3, fullName: 'acme/docs', private: false },
  ])
})
afterEach(cleanup)

describe('GitHubRepositoryList', () => {
  it('shows a card per synced repository', async () => {
    mocks.destinations.mockResolvedValue([repo('d1', 'acme/app'), repo('d2', 'acme/api')])
    renderList()
    expect(await screen.findByText('card:acme/app')).toBeTruthy()
    expect(screen.getByText('card:acme/api')).toBeTruthy()
  })

  it('says so when no repository is synced yet', async () => {
    mocks.destinations.mockResolvedValue([])
    renderList()
    expect(await screen.findByText(/No repositories yet/)).toBeTruthy()
  })

  it('adds a repository that is not synced yet, searched by name', async () => {
    mocks.destinations.mockResolvedValue([repo('d1', 'acme/app')])
    renderList()
    await screen.findByText('card:acme/app')
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }))

    expect(await screen.findByRole('button', { name: 'acme/api' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'acme/docs' })).toBeTruthy()
    // Already synced: not offered again.
    expect(screen.queryByRole('button', { name: 'acme/app' })).toBeNull()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search repositories' }), {
      target: { value: 'doc' },
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'acme/api' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'acme/docs' }))

    const [input, opts] = mocks.add.mock.calls[0]
    expect(input).toEqual({ integrationType: 'github', kind: 'repo', externalId: 'acme/docs' })
    opts.onError(new Error('acme/docs is already synced'))
    expect(mocks.toastError).toHaveBeenCalledWith('acme/docs is already synced')
  })
})
