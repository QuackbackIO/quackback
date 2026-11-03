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
    dkimMode: 'easy',
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
    expect(first?.textContent).toContain('Default')
    expect(first?.textContent).not.toContain('Default for')
  })

  it('names the areas it still covers once an address is live', () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [LIVE] })
    expect(row('notifications@example.com').textContent).toContain(
      'Default for Feedback and Changelog'
    )
  })

  it('still covers an area whose address is not live yet', () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [domain()] })
    expect(row('notifications@example.com').textContent).not.toContain('Default for')
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
    const footer = screen.getByText("Checking automatically. We'll let you know when it's live.")
    expect(footer.getAttribute('title')).toBe('Last checked less than a minute ago')
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
  })

  it('treats a pending domain with no check window yet as setting up', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com', 'support')],
      domains: [domain({ autoCheckUntil: null })],
    })
    const r = row('help@acme.com')
    expect(within(r).getByText('Setting up')).toBeTruthy()
    expect(within(r).queryByText('Needs attention')).toBeNull()
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
    expect(screen.getByText("We couldn't find these records yet.")).toBeTruthy()
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
    const panel = panels()[0] as HTMLElement
    expect(
      within(panel).getByText("We couldn't find this record. Add it with the name and value above.")
    ).toBeTruthy()
    // One sentence, under the one record that needs it.
    expect(panel.querySelectorAll('[data-slot="dns-record-fix"]')).toHaveLength(1)
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
    expect(screen.queryByRole('menuitem', { name: /DNS records/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Copy instructions' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'SMTP override' })).toBeTruthy()
  })

  it('opens the records of a live domain from the menu, to keep in place', async () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [LIVE] })
    const user = await openMenu('help@acme.com')
    await user.click(screen.getByRole('menuitem', { name: 'DNS records' }))
    expect(screen.getByText('Keep these published.')).toBeTruthy()
  })
})

describe('domains no address uses', () => {
  it('lists each as its own row with the setup panel while it is not live', () => {
    renderSettings({ domains: [domain()] })
    const r = row('acme.com')
    expect(r.textContent).toContain('No address uses this domain')
    expect(within(r).getByText('Setting up')).toBeTruthy()
    expect(panels()).toHaveLength(1)
  })

  it('shows a live one quietly, with its records in the menu', async () => {
    renderSettings({ domains: [LIVE] })
    const r = row('acme.com')
    expect(within(r).queryByText('Setting up')).toBeNull()
    expect(within(r).queryByText('Needs attention')).toBeNull()
    expect(panels()).toHaveLength(0)
    const user = await openMenu('acme.com')
    await user.click(screen.getByRole('menuitem', { name: 'DNS records' }))
    expect(panels()).toHaveLength(1)
  })

  it('flags one that needs attention', () => {
    renderSettings({ domains: [DEMOTED] })
    expect(within(row('acme.com')).getByText('Needs attention')).toBeTruthy()
  })

  it('removes the domain after a confirm', async () => {
    renderSettings({ domains: [LIVE] })
    const user = await openMenu('acme.com')
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(deleteDomain).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove domain' }))
    await waitFor(() => expect(deleteDomain).toHaveBeenCalledWith('dom_1', expect.anything()))
  })

  it('does not list a domain an address uses', () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [LIVE] })
    expect(screen.queryByText('No address uses this domain')).toBeNull()
  })
})

describe('the two signing modes', () => {
  const mailFrom = [
    {
      type: 'MX',
      host: 'qb-bounce',
      value: 'feedback-smtp.example.com',
      priority: 10,
      purpose: 'mail-from',
    },
    {
      type: 'TXT',
      host: 'qb-bounce',
      value: 'v=spf1 include:example.com ~all',
      purpose: 'mail-from',
    },
  ]
  const labels = () =>
    [...document.querySelectorAll('[data-slot="dns-record"]')].map(
      (r) => r.querySelector('td')?.textContent?.split(': ')[1]
    )

  it('shows three records for a domain signed with its own key', async () => {
    const byo = domain({
      dkimMode: 'byo',
      dnsRecords: [
        {
          type: 'TXT',
          host: 'qb1a2b3c4d._domainkey',
          value: 'v=DKIM1; k=rsa; p=PUBLICKEY',
          purpose: 'dkim',
        },
        ...mailFrom,
      ] as SendingDomainDTO['dnsRecords'],
    })
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [byo] })
    expect(labels()).toEqual(['Signing', 'Return path', 'Return path'])
    fireEvent.click(screen.getByRole('button', { name: 'Copy instructions' }))
    await waitFor(() => expect(clipboard).toHaveBeenCalled())
    const lines = clipboard.mock.calls[0][0].split('\n').filter((l) => /^(TXT|MX)/.test(l))
    expect(lines).toEqual([
      'TXT  qb1a2b3c4d._domainkey  v=DKIM1; k=rsa; p=PUBLICKEY',
      'MX 10  qb-bounce  feedback-smtp.example.com',
      'TXT  qb-bounce  v=spf1 include:example.com ~all',
    ])
  })

  it('keeps all six records for a domain on the provider’s keys', () => {
    const easy = domain({
      dnsRecords: [
        {
          type: 'TXT',
          host: '_quackback',
          value: 'quackback-domain-verification=abc',
          purpose: 'ownership',
        },
        ...['aaa', 'bbb', 'ccc'].map((t) => ({
          type: 'CNAME',
          host: `${t}._domainkey`,
          value: `${t}.dkim.example.com`,
          purpose: 'dkim',
        })),
        ...mailFrom,
      ] as SendingDomainDTO['dnsRecords'],
    })
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [easy] })
    expect(labels()).toEqual([
      'Ownership',
      'Signing',
      'Signing',
      'Signing',
      'Return path',
      'Return path',
    ])
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

  it('shows MX with its priority, a label per record and a fix only under a broken one', () => {
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
    const rows = document.querySelectorAll('[data-slot="dns-record"]')
    expect(rows[0].textContent).toContain('Found: Ownership')
    expect(rows[1].textContent).toContain('Needs a fix: Signing')
    expect(rows[2].textContent).toContain('Needs a fix: Return path')
    expect(screen.getByText('MX 10')).toBeTruthy()
    expect(
      screen.getByText(
        'This name returns an address instead of pointing to the value above. Turn off any proxy for it.'
      )
    ).toBeTruthy()
    expect(
      screen.getByText(
        'The domain looks like it was entered twice. Use just the part before .acme.com.'
      )
    ).toBeTruthy()
    expect(document.querySelectorAll('[data-slot="dns-record-fix"]')).toHaveLength(2)
  })

  it('shows a missing record as waiting while the domain is being set up', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com', 'support')],
      domains: [domain({ dnsRecords: records({ ownership: found, dkim: missing, mx: missing }) })],
    })
    expect(document.querySelectorAll('[data-slot="dns-record"]')[1].textContent).toContain(
      'Waiting: Signing'
    )
    expect(document.querySelectorAll('[data-slot="dns-record-fix"]')).toHaveLength(0)
  })

  it('leaves out DMARC, pre-flight badges and host tips', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com', 'support')],
      domains: [
        domain({
          preflight: { dmarc: { found: false }, dnsHost: 'cloudflare', mailFromFree: true },
        }),
      ],
    })
    const panel = panels()[0] as HTMLElement
    expect(panel.textContent).not.toMatch(/DMARC|Cloudflare|is free|Enter names/)
    expect(panel.querySelectorAll('[data-slot="dns-record"]')).toHaveLength(3)
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

  it('removes the domain too, in the same confirm, when it was the last address on it', async () => {
    deleteAccount.mockImplementation((_id: string, opts: { onSuccess: (r: unknown) => void }) =>
      opts.onSuccess({ id: 'a1', lastOnDomain: { id: 'dom_1', domain: 'acme.com' } })
    )
    renderSettings({ addresses: [address('a1', 'help@acme.com', 'support')], domains: [LIVE] })
    const user = await openMenu('help@acme.com')
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/acme\.com will be removed too\./)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete address' }))
    await waitFor(() => expect(deleteDomain).toHaveBeenCalledWith('dom_1', expect.anything()))
    expect(screen.queryAllByRole('alertdialog')).toHaveLength(0)
  })

  it('keeps the domain while another address uses it', async () => {
    deleteAccount.mockImplementation((_id: string, opts: { onSuccess: (r: unknown) => void }) =>
      opts.onSuccess({ id: 'a1', lastOnDomain: null })
    )
    renderSettings({
      addresses: [
        address('a1', 'help@acme.com', 'support'),
        address('a2', 'news@acme.com', 'changelog'),
      ],
      domains: [LIVE],
    })
    const user = await openMenu('help@acme.com')
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).not.toContain('will be removed too')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete address' }))
    await waitFor(() => expect(deleteAccount).toHaveBeenCalled())
    expect(deleteDomain).not.toHaveBeenCalled()
  })

  it('never removes a domain the dialog did not name', async () => {
    // The page thought another address used it; the server says none does.
    deleteAccount.mockImplementation((_id: string, opts: { onSuccess: (r: unknown) => void }) =>
      opts.onSuccess({ id: 'a1', lastOnDomain: { id: 'dom_1', domain: 'acme.com' } })
    )
    renderSettings({
      addresses: [
        address('a1', 'help@acme.com', 'support'),
        address('a2', 'news@acme.com', 'changelog'),
      ],
      domains: [LIVE],
    })
    await confirmRemove()
    await waitFor(() => expect(deleteAccount).toHaveBeenCalled())
    expect(deleteDomain).not.toHaveBeenCalled()
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
