// @vitest-environment happy-dom
/**
 * The GitHub people section: matched accounts with their teammate, moving a
 * match to another teammate, removing one, suggestions accepted one by one,
 * an account added by login (looked up first), and the hint while no
 * repository has assignee sync on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  remove: vi.fn(),
  suggest: vi.fn(),
  findUser: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/client/mutations', () => ({
  useUpsertIntegrationUserMapping: () => ({ mutate: mocks.upsert, isPending: false }),
  useDeleteIntegrationUserMapping: () => ({ mutate: mocks.remove, isPending: false }),
}))
vi.mock('@/integrations/github/server/functions', () => ({
  suggestGitHubPeopleFn: mocks.suggest,
  findGitHubUserFn: mocks.findUser,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.toastError } }))

import { GitHubPeople } from '../github-people'
import { adminQueries } from '@/lib/client/queries/admin'

const teammates = [
  { id: 'principal_jane', name: 'Jane Doe', email: 'jane@acme.test' },
  { id: 'principal_ravi', name: 'Ravi Kumar', email: 'ravi@acme.test' },
  { id: 'principal_lee', name: 'Lee Wong', email: 'lee@acme.test' },
]
const janeMatch = {
  id: 'integration_user_mapping_1',
  externalUserId: '42',
  externalLogin: 'octojane',
  externalDisplayName: 'Jane D.',
  principalId: 'principal_jane',
  teammateName: 'Jane Doe',
  teammateEmail: 'jane@acme.test',
}

function renderPeople(options: { assigneeSync?: boolean; mappings?: unknown[] } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(
    adminQueries.integrationUserMappings('github').queryKey,
    (options.mappings ?? [janeMatch]) as never
  )
  client.setQueryData(adminQueries.teamMembers().queryKey, teammates as never)
  client.setQueryData(adminQueries.integrationDestinations('github').queryKey, [
    { id: 'd1', kind: 'repo', assigneeSync: options.assigneeSync ?? true },
  ] as never)
  render(
    <IntlProvider locale="en" messages={{}}>
      <QueryClientProvider client={client}>
        <GitHubPeople />
      </QueryClientProvider>
    </IntlProvider>
  )
}

describe('GitHubPeople', () => {
  beforeEach(() => vi.resetAllMocks())
  afterEach(cleanup)

  it('lists a match and says nothing about assignee sync while a repository has it on', () => {
    renderPeople()
    expect(screen.getByText('@octojane')).toBeTruthy()
    expect(screen.getByText('Jane D.')).toBeTruthy()
    expect(screen.queryByText(/No repository has Assignees on yet/)).toBeNull()
  })

  it('says the matches are unused while no repository has assignee sync on', () => {
    renderPeople({ assigneeSync: false })
    expect(screen.getByText(/No repository has Assignees on yet/)).toBeTruthy()
  })

  it('moves a match to another teammate, offering only free teammates', async () => {
    renderPeople()
    await userEvent.click(screen.getByRole('combobox', { name: 'Teammate for @octojane' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Jane Doe',
      'Ravi Kumar',
      'Lee Wong',
    ])
    await userEvent.click(screen.getByRole('option', { name: 'Ravi Kumar' }))
    expect(mocks.upsert.mock.calls[0][0]).toEqual({
      integrationType: 'github',
      externalUserId: '42',
      externalLogin: 'octojane',
      externalDisplayName: 'Jane D.',
      principalId: 'principal_ravi',
    })
  })

  it('removes a match', () => {
    renderPeople()
    fireEvent.click(screen.getByRole('button', { name: 'Remove the match for @octojane' }))
    expect(mocks.remove.mock.calls[0][0]).toEqual({
      integrationType: 'github',
      mappingId: 'integration_user_mapping_1',
    })
  })

  it('suggests matches and accepts one', async () => {
    mocks.suggest.mockResolvedValue({
      scanned: 3,
      suggestions: [
        {
          account: { id: '43', login: 'rkumar', name: null, avatarUrl: null },
          principalId: 'principal_ravi',
          teammateName: 'Ravi Kumar',
          teammateEmail: 'ravi@acme.test',
          reason: 'login',
        },
      ],
    })
    renderPeople()
    fireEvent.click(screen.getByRole('button', { name: 'Suggest matches' }))
    const accept = await screen.findByRole('button', { name: 'Match @rkumar to Ravi Kumar' })
    expect(screen.getByText('Similar login')).toBeTruthy()
    fireEvent.click(accept)
    expect(mocks.upsert.mock.calls[0][0]).toEqual({
      integrationType: 'github',
      externalUserId: '43',
      externalLogin: 'rkumar',
      externalDisplayName: null,
      principalId: 'principal_ravi',
    })
  })

  it('says when there is nothing new to suggest', async () => {
    mocks.suggest.mockResolvedValue({ scanned: 5, suggestions: [] })
    renderPeople()
    fireEvent.click(screen.getByRole('button', { name: 'Suggest matches' }))
    expect(
      await screen.findByText('No new matches among the 5 people who can be assigned issues.')
    ).toBeTruthy()
  })

  it('adds a match by login, looking the account up first', async () => {
    mocks.findUser.mockResolvedValue({ id: '77', login: 'Lee-W', name: 'Lee', avatarUrl: null })
    renderPeople({ mappings: [] })
    await userEvent.type(screen.getByRole('textbox', { name: 'GitHub login' }), '@lee-w')
    await userEvent.click(screen.getByRole('combobox', { name: 'Teammate' }))
    await userEvent.click(screen.getByRole('option', { name: 'Lee Wong' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add match' }))
    await waitFor(() => expect(mocks.upsert).toHaveBeenCalled())
    expect(mocks.findUser).toHaveBeenCalledWith({ data: { login: 'lee-w' } })
    expect(mocks.upsert.mock.calls[0][0]).toEqual({
      integrationType: 'github',
      externalUserId: '77',
      externalLogin: 'Lee-W',
      externalDisplayName: 'Lee',
      principalId: 'principal_lee',
    })
  })

  it('reports a login GitHub does not know', async () => {
    mocks.findUser.mockRejectedValue(new Error('GitHub has no user @ghost'))
    renderPeople({ mappings: [] })
    await userEvent.type(screen.getByRole('textbox', { name: 'GitHub login' }), 'ghost')
    await userEvent.click(screen.getByRole('combobox', { name: 'Teammate' }))
    await userEvent.click(screen.getByRole('option', { name: 'Lee Wong' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add match' }))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('GitHub has no user @ghost'))
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})
