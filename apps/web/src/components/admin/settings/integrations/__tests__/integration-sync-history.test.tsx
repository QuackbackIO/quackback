// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntegrationSyncHistory } from '../integration-sync-history'
import type { SyncHistoryItem } from '@/lib/shared/integration-sync'
const api = vi.hoisted(() => ({
  list: vi.fn(),
  inspect: vi.fn(),
  recover: vi.fn(),
  verify: vi.fn(),
}))
vi.mock('@/lib/server/functions/integration-sync', () => ({
  listIntegrationSyncHistoryFn: api.list,
  inspectIntegrationSyncFn: api.inspect,
  recoverIntegrationSyncFn: api.recover,
  verifyIntegrationSyncReferenceFn: api.verify,
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
const item: SyncHistoryItem = {
  id: 'sync-1',
  provider: 'github',
  direction: 'outbound',
  kind: 'create',
  state: 'failed',
  version: 3,
  sourceType: 'post',
  sourceId: 'post_123',
  sourceTitle: 'Search feedback',
  remoteUrl: null,
  remoteDisplayId: null,
  attempts: 1,
  error: 'The platform rejected this change.',
  cancelRequested: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  actions: ['retry', 'cancel'],
}
const clients: QueryClient[] = []
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <IntegrationSyncHistory provider="github" />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  api.list.mockResolvedValue({ items: [item], nextCursor: null })
  api.inspect.mockResolvedValue({ preview: null, remote: null, attempts: [] })
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((c) => c.clear())
})
describe('integration sync recovery', () => {
  it('presents incoming status changes as a manual update to the source', async () => {
    api.list.mockResolvedValue({
      items: [
        {
          ...item,
          direction: 'inbound',
          kind: 'status',
          state: 'conflict',
          actions: ['keep_remote', 'cancel'],
        },
      ],
      nextCursor: null,
    })
    api.inspect.mockResolvedValue({
      preview: { title: 'Platform status', content: 'Done' },
      remote: null,
      attempts: [],
    })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Search feedback/ }))
    expect(await screen.findByLabelText('Received platform status')).toHaveValue('Done')
    expect(screen.getByText(/Review the source item and update its status manually/)).toBeVisible()
    expect(screen.queryByText(/apply changes there to preserve its edits/)).toBeNull()
    expect(screen.getByRole('link', { name: 'View source' })).toHaveAttribute(
      'href',
      '/admin/feedback?post=post_123'
    )
    expect(api.recover).not.toHaveBeenCalled()
  })
  it('reuses a recovery request identity after a lost response', async () => {
    api.recover.mockRejectedValue(new Error('Connection interrupted'))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(api.recover).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(api.recover).toHaveBeenCalledTimes(2))
    expect(api.recover.mock.calls[1][0].data).toEqual(api.recover.mock.calls[0][0].data)
  })
  it('does not offer recovery or source details for restricted items', async () => {
    api.list.mockResolvedValue({
      items: [{ ...item, sourceId: null, sourceTitle: null, actions: [] }],
      nextCursor: null,
    })
    mount()
    await screen.findByText('Restricted or deleted item')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.getByRole('button', { name: /Restricted or deleted item/ })).toBeDisabled()
    expect(api.inspect).not.toHaveBeenCalled()
  })
  it('requires verification and explicit confirmation, preserving a failed link draft', async () => {
    api.list.mockResolvedValue({
      items: [{ ...item, state: 'uncertain', actions: ['link_existing'] }],
      nextCursor: null,
    })
    api.verify.mockResolvedValue({
      externalId: '42',
      externalDisplayId: '#42',
      title: 'Search feedback',
      externalUrl: 'https://github.com/acme/widgets/issues/42',
    })
    api.recover.mockRejectedValue(new Error('Connection interrupted'))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Link existing item' }))
    expect(screen.getByRole('button', { name: 'Confirm link' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Remote issue reference'), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify item' }))
    await screen.findByText('#42: Search feedback')
    expect(api.recover).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm link' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Remote issue reference')).toHaveValue('42')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm link' }))
    await waitFor(() => expect(api.recover).toHaveBeenCalledTimes(2))
    expect(api.recover.mock.calls[1][0].data).toEqual(api.recover.mock.calls[0][0].data)
    fireEvent.change(screen.getByLabelText('Remote issue reference'), { target: { value: '43' } })
    expect(screen.getByRole('button', { name: 'Confirm link' })).toBeDisabled()
  })
  it('clears cursor and expanded details when changing filters', async () => {
    api.list.mockResolvedValue({ items: [item], nextCursor: { at: item.createdAt, id: item.id } })
    mount()
    await screen.findByText('Search feedback')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith({
        data: { provider: 'github', filter: 'all', cursor: { at: item.createdAt, id: item.id } },
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Needs attention' }))
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith({
        data: { provider: 'github', filter: 'attention', cursor: undefined },
      })
    )
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  })
})
