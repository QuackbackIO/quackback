// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const deleteAccount = vi.fn()
const deleteDomain = vi.fn()
const clearRoute = vi.fn()

vi.mock('@/lib/server/functions/channel-accounts', () => ({
  getEmailChannelConfigFn: vi.fn(),
}))
vi.mock('@/lib/client/mutations/channel-accounts', () => {
  const idle = () => ({ mutate: vi.fn(), isPending: false })
  return {
    useCreateInboundRoute: idle,
    useCreateSendingAddress: idle,
    useCreateSendingDomain: idle,
    useVerifySendingDomain: idle,
    useUpdateInboundTrust: idle,
    useClearInboundForwarding: () => ({ mutate: clearRoute, isPending: false }),
    useUpdateSendingAddressSmtp: idle,
    useDeleteChannelAccount: () => ({ mutate: deleteAccount, isPending: false }),
    useDeleteSendingDomain: () => ({ mutate: deleteDomain, isPending: false }),
  }
})

const { EmailChannelSettings } = await import('../email-channel-settings')
const { emailChannelConfigQuery } = await import('@/lib/client/queries/channel-accounts')

function renderSettings(inboundRoute: unknown = null) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(emailChannelConfigQuery().queryKey, {
    inboundRoute,
    platformAddress: null,
    sendingAddresses: [
      {
        id: 'addr_1',
        address: 'help@acme.com',
        module: 'support',
        config: {},
        sendingDomain: null,
      },
    ],
    domains: [{ id: 'dom_1', domain: 'acme.com', status: 'verified', dnsRecords: [] }],
  } as never)
  return render(
    <QueryClientProvider client={client}>
      <EmailChannelSettings />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  deleteAccount.mockReset()
  deleteDomain.mockReset()
  clearRoute.mockReset()
})
afterEach(cleanup)

describe('removing a sending address', () => {
  it('asks first and deletes only on confirm', async () => {
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Remove address' }))
    expect(deleteAccount).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Delete address?')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete address' }))
    await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith('addr_1', expect.anything()))
  })

  it('cancelling leaves the address alone', async () => {
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Remove address' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(deleteAccount).not.toHaveBeenCalled()
  })
})

describe('removing a sending domain', () => {
  it('asks first and deletes only on confirm', async () => {
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Remove acme.com' }))
    expect(deleteDomain).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Delete domain?')).toBeTruthy()
    expect(within(dialog).getByText(/until you add it again/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete domain' }))
    await waitFor(() => expect(deleteDomain).toHaveBeenCalledWith('dom_1', expect.anything()))
  })
})

describe('removing the inbound route', () => {
  const route = { config: { forwardingTarget: 'support@acme.com' }, inboundTrust: 'strict' }

  it('asks first and clears the route only on confirm', async () => {
    renderSettings(route)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(clearRoute).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Delete inbound route?')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete route' }))
    await waitFor(() => expect(clearRoute).toHaveBeenCalledTimes(1))
  })

  it('cancelling keeps the route', async () => {
    renderSettings(route)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(clearRoute).not.toHaveBeenCalled()
  })
})

describe('add forms', () => {
  it('use one outline Add button each', () => {
    renderSettings()
    for (const name of ['Set route', 'Add', 'Add domain']) {
      const button = screen.getByRole('button', { name })
      expect(button.className).toContain('border-border/50')
      expect(button.className).not.toContain('bg-primary')
    }
  })
})
