// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SendingDomainDTO } from '@/lib/server/functions/channel-accounts'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

const deleteAccount = vi.fn()
const deleteDomain = vi.fn()
const clearRoute = vi.fn()
const createAddress = vi.fn()
const restartChecks = vi.fn()
const sendTest = vi.fn()
const toastError = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }))

vi.mock('@/lib/server/functions/channel-accounts', () => ({
  getEmailChannelConfigFn: vi.fn(),
}))
vi.mock('@/lib/client/mutations/channel-accounts', () => {
  const idle = () => ({ mutate: vi.fn(), isPending: false })
  return {
    useCreateInboundRoute: idle,
    useCreateSendingAddress: () => ({ mutate: createAddress, isPending: false }),
    useUpdateInboundTrust: idle,
    useClearInboundForwarding: () => ({ mutate: clearRoute, isPending: false }),
    useUpdateSendingAddressSmtp: idle,
    useDeleteChannelAccount: () => ({ mutate: deleteAccount, isPending: false }),
    useDeleteSendingDomain: () => ({ mutate: deleteDomain, isPending: false }),
    useRestartSendingDomainChecks: () => ({ mutate: restartChecks, isPending: false }),
    useSendTestEmail: () => ({ mutate: sendTest, isPending: false }),
  }
})

const { EmailChannelSettings } = await import('../email-channel-settings')
const { emailChannelConfigQuery } = await import('@/lib/client/queries/channel-accounts')

const HOUR = 60 * 60 * 1000
const CHECKED = new Date(Date.now() - 20_000).toISOString()

const found = { state: 'found' as const, checkedAt: CHECKED }
const missing = { state: 'missing' as const, checkedAt: CHECKED }

function records(
  over: Partial<Record<'ownership' | 'dkim' | 'mx', object>> = {}
): SendingDomainDTO['dnsRecords'] {
  return [
    {
      type: 'TXT',
      host: '_quackback',
      value: 'quackback-domain-verification=abc',
      purpose: 'ownership',
      ...(over.ownership ? { check: over.ownership } : {}),
    },
    {
      type: 'CNAME',
      host: 'aaa._domainkey',
      value: 'aaa.dkim.example.com',
      purpose: 'dkim',
      ...(over.dkim ? { check: over.dkim } : {}),
    },
    {
      type: 'MX',
      host: 'qb-bounce',
      value: 'feedback-smtp.example.com',
      priority: 10,
      purpose: 'mail-from',
      ...(over.mx ? { check: over.mx } : {}),
    },
  ] as SendingDomainDTO['dnsRecords']
}

function domain(over: Partial<SendingDomainDTO> = {}): SendingDomainDTO {
  return {
    id: 'dom_1',
    domain: 'acme.com',
    status: 'pending',
    verifiedAt: null,
    dnsRecords: records(),
    mailFromLabel: 'qb-bounce',
    autoCheckUntil: new Date(Date.now() + 48 * HOUR).toISOString(),
    lastCheckedAt: null,
    preflight: {},
    ...over,
  }
}

const LIVE = domain({ status: 'verified', verifiedAt: CHECKED })
const NOT_FOUND = domain({ autoCheckUntil: new Date(Date.now() - HOUR).toISOString() })
const DEMOTED = domain({
  verifiedAt: '2026-10-01T00:00:00.000Z',
  dnsRecords: records({ ownership: found, dkim: found, mx: missing }),
})

function address(id: string, addr: string, module: string, domainId: string | null = 'dom_1') {
  return { id, address: addr, module, config: {}, sendingDomainId: domainId, sendingDomain: null }
}

function renderSettings({
  addresses = [] as ReturnType<typeof address>[],
  domains = [] as SendingDomainDTO[],
  inboundRoute = null as unknown,
  addressMode = 'verified-domains' as 'any' | 'verified-domains' | 'unavailable',
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(emailChannelConfigQuery().queryKey, {
    inboundRoute,
    platformAddress: null,
    sendingAddresses: addresses,
    domains,
    addressMode,
    defaultFrom: 'Acme <notifications@example.com>',
  } as never)
  return render(
    <QueryClientProvider client={client}>
      <EmailChannelSettings />
    </QueryClientProvider>
  )
}

/** The settings row whose title is `title`. */
const row = (title: string) =>
  screen
    .getByText(title, { selector: 'span' })
    .closest('[data-slot="settings-list-row"]') as HTMLElement

const panels = () => document.querySelectorAll('[data-slot="domain-setup-panel"]')

async function openMenu(title: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: `Actions for ${title}` }))
  return user
}

const clipboard = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  for (const fn of [
    deleteAccount,
    deleteDomain,
    clearRoute,
    createAddress,
    restartChecks,
    sendTest,
    toastError,
    toastSuccess,
  ]) {
    fn.mockReset()
  }
  clipboard.mockReset().mockResolvedValue()
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: clipboard },
    configurable: true,
  })
})
afterEach(cleanup)

describe('the default address', () => {
  it('is the first row and covers every area when nothing else is live', () => {
    renderSettings()
    const first = document.querySelector('[data-slot="settings-list-row"]')
    expect(first?.textContent).toContain('notifications@example.com')
    expect(first?.textContent).toContain('Default for every area')
  })

  it('names the areas it still covers once an address is live', () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [LIVE] })
    expect(row('notifications@example.com').textContent).toContain(
      'Default for Feedback and Changelog'
    )
  })

  it('still covers an area whose address is not live yet', () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [domain()] })
    expect(row('notifications@example.com').textContent).toContain('Default for every area')
  })
})

describe('address rows', () => {
  it('shows no badge on a live address, just its area', () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [LIVE] })
    const r = row('help@acme.com')
    expect(r.textContent).toContain('Support')
    expect(within(r).queryByText('Setting up')).toBeNull()
    expect(within(r).queryByText('Needs attention')).toBeNull()
    expect(panels()).toHaveLength(0)
  })

  it('marks a pending address Setting up and shows the setup panel under it', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com', 'support')],
      domains: [domain({ dnsRecords: records({ ownership: found }) })],
    })
    const r = row('help@acme.com')
    expect(within(r).getByText('Setting up').getAttribute('data-slot')).toBe('badge')
    expect(within(r).queryByText('Needs attention')).toBeNull()
    expect(screen.getByText('Set up acme.com')).toBeTruthy()
    expect(
      screen.getByText('Checking automatically for 72 hours · last checked less than a minute ago')
    ).toBeTruthy()
  })

  it('shows the setup panel once per domain and the other addresses wait for it', () => {
    renderSettings({
      addresses: [
        address('a1', 'help@acme.com', 'support'),
        address('a2', 'news@acme.com', 'changelog'),
      ],
      domains: [domain()],
    })
    expect(panels()).toHaveLength(1)
    expect(row('news@acme.com').textContent).toContain('Waiting for acme.com')
    expect(within(row('news@acme.com')).getByText('Setting up')).toBeTruthy()
  })

  it('flags records not found after 72 hours and offers Check again', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com', 'support')],
      domains: [NOT_FOUND],
    })
    const r = row('help@acme.com')
    expect(within(r).getByText('Needs attention')).toBeTruthy()
    expect(within(r).queryByText('Setting up')).toBeNull()
    expect(r.textContent).toContain(
      'Records not found after 72 hours. Replies send from the default address.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(restartChecks).toHaveBeenCalledWith('dom_1', expect.anything())
  })

  it('names the failing record on a domain that stopped verifying and opens its records', () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [DEMOTED] })
    const r = row('help@acme.com')
    expect(within(r).getByText('Needs attention')).toBeTruthy()
    expect(r.textContent).toContain(
      'The return path record is missing. Replies send from the default address.'
    )
    expect(within(panels()[0] as HTMLElement).getByText('Missing')).toBeTruthy()
  })

  it('does not claim replies fall back where the guard permits any address', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com', 'support')],
      domains: [NOT_FOUND],
      addressMode: 'any',
    })
    const r = row('help@acme.com')
    expect(r.textContent).toContain('Records not found after 72 hours.')
    expect(r.textContent).not.toContain('Replies send from the default address.')
  })

  it('offers Send test email on a live address only', async () => {
    renderSettings({
      addresses: [
        address('a1', 'help@acme.com', 'support'),
        address('a2', 'hi@beta.example', 'feedback', 'dom_2'),
      ],
      domains: [LIVE, domain({ id: 'dom_2', domain: 'beta.example' })],
    })
    let user = await openMenu('help@acme.com')
    await user.click(screen.getByRole('menuitem', { name: 'Send test email' }))
    expect(sendTest).toHaveBeenCalledWith('a1', expect.anything())

    user = await openMenu('hi@beta.example')
    expect(screen.queryByRole('menuitem', { name: 'Send test email' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Copy instructions' })).toBeTruthy()
  })

  it('opens the records of a live domain from the menu, to keep in place', async () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [LIVE] })
    const user = await openMenu('help@acme.com')
    await user.click(screen.getByRole('menuitem', { name: 'DNS records' }))
    expect(screen.getByText("Keep these published. They're checked daily.")).toBeTruthy()
  })
})

describe('the record table', () => {
  it('copies the name relative to the domain, not the full name', async () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [domain()] })
    fireEvent.click(screen.getByRole('button', { name: 'Copy name _quackback' }))
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith('_quackback'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy name qb-bounce' }))
    await waitFor(() => expect(clipboard).toHaveBeenLastCalledWith('qb-bounce'))
  })

  it('shows MX with its priority and each record state', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com', 'support')],
      domains: [
        domain({
          dnsRecords: records({
            ownership: found,
            dkim: { state: 'proxied', checkedAt: CHECKED },
            mx: {
              state: 'mismatch',
              seen: 'qb-bounce.acme.com.acme.com',
              reason: 'doubled-name',
              checkedAt: CHECKED,
            },
          }),
        }),
      ],
    })
    expect(screen.getByText('MX 10')).toBeTruthy()
    expect(screen.getByText('Found')).toBeTruthy()
    expect(screen.getByText('Proxied')).toBeTruthy()
    expect(screen.getByText('Wrong value')).toBeTruthy()
    expect(
      screen.getByText(
        'The domain looks like it was entered twice. Use just the part before .acme.com.'
      )
    ).toBeTruthy()
  })

  it('says found, waiting for confirmation, when every record is in place', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com', 'support')],
      domains: [domain({ dnsRecords: records({ ownership: found, dkim: found, mx: found }) })],
    })
    expect(screen.getAllByText('Found, waiting for confirmation')).toHaveLength(3)
  })

  it('offers DMARC as optional only when the domain has none', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com', 'support')],
      domains: [domain({ preflight: { dmarc: { found: false } } })],
    })
    expect(screen.getByText('v=DMARC1; p=none')).toBeTruthy()
    cleanup()
    renderSettings({
      addresses: [address('a1', 'help@acme.com', 'support')],
      domains: [
        domain({ preflight: { dmarc: { found: true, policy: 'none' }, dnsHost: 'cloudflare' } }),
      ],
    })
    expect(screen.queryByText('v=DMARC1; p=none')).toBeNull()
    expect(screen.getByText('DMARC found')).toBeTruthy()
    expect(
      screen.getByText(
        'Cloudflare: set the three _domainkey records to DNS only. Enter names without .acme.com; Cloudflare adds it.'
      )
    ).toBeTruthy()
  })

  it('copies instructions as plain text with relative names', async () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [domain()] })
    fireEvent.click(screen.getByRole('button', { name: 'Copy instructions' }))
    await waitFor(() => expect(clipboard).toHaveBeenCalled())
    const text = clipboard.mock.calls[0][0]
    expect(text).toContain('TXT  _quackback  quackback-domain-verification=abc')
    expect(text).toContain('MX 10  qb-bounce  feedback-smtp.example.com')
    expect(text).not.toContain('_quackback.acme.com')
  })
})

describe('removing a sending address', () => {
  async function confirmRemove() {
    const user = await openMenu('help@acme.com')
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Delete address',
      })
    )
  }

  it('asks first and deletes only on confirm', async () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [LIVE] })
    const user = await openMenu('help@acme.com')
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(deleteAccount).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete address' }))
    await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith('a1', expect.anything()))
  })

  it('offers to remove the domain too when it was the last address on it', async () => {
    deleteAccount.mockImplementation((_id: string, opts: { onSuccess: (r: unknown) => void }) =>
      opts.onSuccess({ id: 'a1', lastOnDomain: { id: 'dom_1', domain: 'acme.com' } })
    )
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [LIVE] })
    await confirmRemove()
    const title = await screen.findByText('Also remove acme.com?')
    const dialog = title.closest('[role="alertdialog"]') as HTMLElement
    expect(deleteDomain).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove domain' }))
    await waitFor(() => expect(deleteDomain).toHaveBeenCalledWith('dom_1', expect.anything()))
  })

  it('does not ask about the domain when other addresses still use it', async () => {
    deleteAccount.mockImplementation((_id: string, opts: { onSuccess: (r: unknown) => void }) =>
      opts.onSuccess({ id: 'a1', lastOnDomain: null })
    )
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [LIVE] })
    await confirmRemove()
    await waitFor(() => expect(deleteAccount).toHaveBeenCalled())
    expect(screen.queryByText('Also remove acme.com?')).toBeNull()
  })
})

describe('removing the inbound route', () => {
  const route = { config: { forwardingTarget: 'support@acme.com' }, inboundTrust: 'strict' }

  it('asks first and clears the route only on confirm', async () => {
    renderSettings({ inboundRoute: route })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(clearRoute).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Delete inbound route?')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete route' }))
    await waitFor(() => expect(clearRoute).toHaveBeenCalledTimes(1))
  })

  it('cancelling keeps the route', async () => {
    renderSettings({ inboundRoute: route })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(clearRoute).not.toHaveBeenCalled()
  })
})

describe('the add form', () => {
  it('uses one outline Add button per form, and no separate domain form', () => {
    renderSettings()
    for (const name of ['Set route', 'Add']) {
      const button = screen.getByRole('button', { name })
      expect(button.className).toContain('border-border/50')
      expect(button.className).not.toContain('bg-primary')
    }
    expect(screen.queryByRole('button', { name: 'Add domain' })).toBeNull()
  })

  it('is disabled with one line on a shared server that cannot set up domains', () => {
    renderSettings({ addressMode: 'unavailable' })
    expect(
      screen.getByText("Custom sending addresses aren't available on this server.")
    ).toBeTruthy()
    expect((screen.getByLabelText('Address') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each(['any', 'verified-domains'] as const)(
    'is enabled with no note in %s mode',
    (addressMode) => {
      renderSettings({ addressMode })
      expect(
        screen.queryByText("Custom sending addresses aren't available on this server.")
      ).toBeNull()
      expect((screen.getByLabelText('Address') as HTMLInputElement).disabled).toBe(false)
      expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true)
    }
  )

  it('shows a failure inline, not as a toast, until the next attempt', async () => {
    createAddress.mockImplementationOnce(
      (_data: unknown, opts: { onError: (e: unknown) => void }) =>
        opts.onError(new Error('Your plan allows 3 sending domains.'))
    )
    renderSettings()
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'help@acme.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Your plan allows 3 sending domains.')
    expect(toastError).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(createAddress).toHaveBeenLastCalledWith(
      { address: 'help@acme.com', module: 'support' },
      expect.anything()
    )
  })
})
