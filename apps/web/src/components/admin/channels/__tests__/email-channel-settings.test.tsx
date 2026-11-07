// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { EmailSendersDTO, SendingDomainDTO } from '@/lib/server/functions/channel-accounts'

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
const setSender = vi.fn()
const renameAddress = vi.fn()
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
    useDeleteChannelAccount: () => ({ mutate: deleteAccount, isPending: false }),
    useDeleteSendingDomain: () => ({ mutate: deleteDomain, isPending: false }),
    useRestartSendingDomainChecks: () => ({ mutate: restartChecks, isPending: false }),
    useSendTestEmail: () => ({ mutate: sendTest, isPending: false }),
    useSetEmailSender: () => ({ mutate: setSender, isPending: false }),
    useUpdateSendingAddressName: () => ({ mutate: renameAddress, isPending: false }),
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

let added = 0
/** An address; each one made is newer than the last, as the server lists them newest first. */
function address(
  id: string,
  addr: string,
  domainId: string | null = 'dom_1',
  senderName: string | null = null
) {
  added += 1
  return {
    id,
    address: addr,
    senderName,
    config: {},
    sendingDomainId: domainId,
    sendingDomain: null,
    createdAt: new Date(Date.UTC(2026, 9, 1) + added * 60_000).toISOString(),
  }
}

function renderSettings({
  addresses = [] as ReturnType<typeof address>[],
  domains = [] as SendingDomainDTO[],
  inboundRoute = null as unknown,
  addressMode = 'verified-domains' as 'any' | 'verified-domains' | 'unavailable',
  sendingPaused = null as { cause: string | null } | null,
  senders = {} as Partial<EmailSendersDTO>,
  forwardingTargetPermitted = null as boolean | null,
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(emailChannelConfigQuery().queryKey, {
    workspaceName: 'Acme',
    senders: {
      default: null,
      support: null,
      feedback: null,
      changelog: null,
      status: null,
      ...senders,
    },
    forwardingTargetPermitted,
    inboundRoute,
    platformAddress: null,
    sendingAddresses: addresses,
    domains,
    addressMode,
    defaultFrom: 'Acme <notifications@example.com>',
    sendingPaused,
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
    setSender,
    renameAddress,
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

describe('address rows', () => {
  it('titles a row with its sender name, the workspace name when it has none', () => {
    renderSettings({
      addresses: [
        address('a1', 'help@acme.com'),
        address('a2', 'news@acme.com', 'dom_1', 'Acme Updates'),
      ],
      domains: [LIVE],
    })
    expect(row('Acme <help@acme.com>')).toBeTruthy()
    expect(row('Acme Updates <news@acme.com>')).toBeTruthy()
  })

  it('shows no badge and no status line on a live address', () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com')], domains: [LIVE] })
    const r = row('Acme <help@acme.com>')
    expect(r.querySelector('.text-muted-foreground.mt-px')).toBeNull()
    expect(within(r).queryByText('Pending')).toBeNull()
    expect(within(r).queryByText('Needs attention')).toBeNull()
    expect(panels()).toHaveLength(0)
  })

  it('marks a pending address Pending and shows the setup panel under it', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com')],
      domains: [domain({ dnsRecords: records({ ownership: found }) })],
    })
    const r = row('Acme <help@acme.com>')
    expect(within(r).getByText('Pending').getAttribute('data-slot')).toBe('badge')
    expect(within(r).queryByText('Needs attention')).toBeNull()
    expect(screen.getByText('Set up acme.com')).toBeTruthy()
    const footer = screen.getByText("Checking automatically. We'll let you know when it's live.")
    expect(footer.getAttribute('title')).toBe('Last checked less than a minute ago')
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull()
  })

  it('treats a pending domain with no check window yet as pending', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com')],
      domains: [domain({ autoCheckUntil: null })],
    })
    const r = row('Acme <help@acme.com>')
    expect(within(r).getByText('Pending')).toBeTruthy()
    expect(within(r).queryByText('Needs attention')).toBeNull()
  })

  it('shows the setup panel once per domain and the other addresses wait for it', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com'), address('a2', 'news@acme.com')],
      domains: [domain()],
    })
    expect(panels()).toHaveLength(1)
    expect(row('Acme <news@acme.com>').textContent).toContain('Waiting for acme.com')
    expect(within(row('Acme <news@acme.com>')).getByText('Pending')).toBeTruthy()
  })

  it('flags records not found after 72 hours and offers Verify', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com')],
      domains: [NOT_FOUND],
    })
    const r = row('Acme <help@acme.com>')
    expect(within(r).getByText('Needs attention')).toBeTruthy()
    expect(within(r).queryByText('Pending')).toBeNull()
    expect(r.textContent).toContain(
      'Records not found after 72 hours. Email sends from the default address.'
    )
    expect(screen.getByText("We couldn't find these records yet.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(restartChecks).toHaveBeenCalledWith('dom_1', expect.anything())
  })

  it('names the failing record on a domain that stopped verifying and opens its records', () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com')], domains: [DEMOTED] })
    const r = row('Acme <help@acme.com>')
    expect(within(r).getByText('Needs attention')).toBeTruthy()
    expect(r.textContent).toContain(
      'The return path record is missing. Email sends from the default address.'
    )
    const panel = panels()[0] as HTMLElement
    expect(
      within(panel).getByText("We couldn't find this record. Add it with the name and value above.")
    ).toBeTruthy()
    // One sentence, under the one record that needs it.
    expect(panel.querySelectorAll('[data-slot="dns-record-fix"]')).toHaveLength(1)
  })

  it('does not claim email falls back where the guard permits any address', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com')],
      domains: [NOT_FOUND],
      addressMode: 'any',
    })
    const r = row('Acme <help@acme.com>')
    expect(r.textContent).toContain('Records not found after 72 hours.')
    expect(r.textContent).not.toContain('Email sends from the default address.')
    expect(r.textContent).toContain('may land in spam')
  })

  it('shows Send test on a verified address only', async () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com'), address('a2', 'hi@beta.example', 'dom_2')],
      domains: [LIVE, domain({ id: 'dom_2', domain: 'beta.example' })],
    })
    fireEvent.click(within(row('Acme <help@acme.com>')).getByRole('button', { name: 'Send test' }))
    expect(sendTest).toHaveBeenCalledWith('a1', expect.anything())
    expect(
      within(row('Acme <hi@beta.example>')).queryByRole('button', { name: 'Send test' })
    ).toBeNull()

    await openMenu('Acme <hi@beta.example>')
    expect(screen.queryByRole('menuitem', { name: 'Send test email' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /DNS records/ })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Edit name' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /SMTP/ })).toBeNull()
  })

  it('edits the sender name from the row menu', async () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com', 'dom_1', 'Acme Help')],
      domains: [LIVE],
    })
    const user = await openMenu('Acme Help <help@acme.com>')
    await user.click(screen.getByRole('menuitem', { name: 'Edit name' }))
    const dialog = await screen.findByRole('dialog')
    const name = within(dialog).getByLabelText('Sender name') as HTMLInputElement
    expect(name.value).toBe('Acme Help')
    expect(within(dialog).queryByLabelText('Email address')).toBeNull()
    fireEvent.change(name, { target: { value: 'Acme Support' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(renameAddress).toHaveBeenCalledWith(
      { id: 'a1', senderName: 'Acme Support' },
      expect.anything()
    )
  })

  it('stores the workspace name as no name of its own', async () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com', 'dom_1', 'Acme Help')],
      domains: [LIVE],
    })
    const user = await openMenu('Acme Help <help@acme.com>')
    await user.click(screen.getByRole('menuitem', { name: 'Edit name' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Sender name'), { target: { value: 'Acme' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(renameAddress).toHaveBeenCalledWith({ id: 'a1', senderName: null }, expect.anything())
  })

  it('opens the records of a live domain from the menu, to keep in place', async () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com')], domains: [LIVE] })
    const user = await openMenu('Acme <help@acme.com>')
    await user.click(screen.getByRole('menuitem', { name: 'DNS records' }))
    expect(screen.getByText('Keep these published.')).toBeTruthy()
  })
})

describe('rows on a domain with several addresses', () => {
  it('shows no waiting note on a second address of a live domain', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com'), address('a2', 'news@acme.com')],
      domains: [LIVE],
    })
    expect(row('Acme <news@acme.com>').textContent).not.toContain('Waiting for')
  })

  it('says a second address waits for the domain while it is set up', () => {
    const older = address('a1', 'help@acme.com')
    const newer = address('a2', 'news@acme.com')
    renderSettings({ addresses: [newer, older], domains: [domain()] })
    expect(row('Acme <news@acme.com>').textContent).toContain('Waiting for acme.com')
    expect(within(row('Acme <news@acme.com>')).getByText('Pending')).toBeTruthy()
  })

  it('attaches the panel to the address that has been on the domain longest', () => {
    // Newest first, as the server lists them: adding news@ must not move it.
    const older = address('a1', 'help@acme.com')
    const newer = address('a2', 'news@acme.com')
    renderSettings({ addresses: [newer, older], domains: [NOT_FOUND] })
    expect(row('Acme <help@acme.com>').textContent).toContain('Records not found after 72 hours.')
    expect(row('Acme <news@acme.com>').textContent).toContain('Waiting for acme.com')
    const panel = panels()[0] as HTMLElement
    const helpRow = row('Acme <help@acme.com>')
    expect(helpRow.parentElement?.contains(panel)).toBe(true)
  })

  it('lists addresses oldest first, so the newest sits by the Add button', () => {
    const older = address('a1', 'help@acme.com')
    const newer = address('a2', 'news@acme.com')
    renderSettings({ addresses: [newer, older], domains: [NOT_FOUND] })
    const titles = [...document.querySelectorAll('[data-slot="settings-list-row"]')].map(
      (r) => r.querySelector('.font-medium')?.textContent
    )
    expect(titles).toEqual(['Acme <help@acme.com>', 'Acme <news@acme.com>'])
    // The panel sits directly under the first address on the domain.
    expect(row('Acme <help@acme.com>').nextElementSibling).toBe(panels()[0])
  })
})

describe('a domain that broke after it was live', () => {
  it('asks to fix it, not to set it up, and says the records are gone', () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com')], domains: [DEMOTED] })
    expect(screen.getByText('Fix acme.com')).toBeTruthy()
    expect(screen.queryByText('Set up acme.com')).toBeNull()
    expect(screen.getByText("We can't find these records any more.")).toBeTruthy()
  })

  it('keeps the first-time wording for a domain never live', () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com')], domains: [NOT_FOUND] })
    expect(screen.getByText('Set up acme.com')).toBeTruthy()
    expect(screen.getByText("We couldn't find these records yet.")).toBeTruthy()
  })
})

describe('what happens to email meanwhile', () => {
  const SPAM = 'Email still sends from this address but may land in spam until this is fixed.'
  const FALLBACK = 'Email sends from the default address.'

  it.each([
    ['not found', NOT_FOUND],
    ['broken', DEMOTED],
  ])('on a single workspace, says email may land in spam (%s)', (_l, d) => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com')],
      domains: [d],
      addressMode: 'any',
    })
    expect(row('Acme <help@acme.com>').textContent).toContain(SPAM)
    expect(row('Acme <help@acme.com>').textContent).not.toContain(FALLBACK)
    // A status sentence wraps rather than being cut off.
    const meta = within(row('Acme <help@acme.com>')).getByText((t) => t.includes(SPAM))
    expect(meta.className).not.toContain('truncate')
  })

  it('on a shared server, says email sends from the default address', () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com')], domains: [NOT_FOUND] })
    expect(row('Acme <help@acme.com>').textContent).toContain(FALLBACK)
    expect(row('Acme <help@acme.com>').textContent).not.toContain(SPAM)
  })
})

describe('domains no address uses', () => {
  it('lists each as its own row with the setup panel while it is not live', () => {
    renderSettings({ domains: [domain()] })
    const r = row('acme.com')
    expect(r.textContent).toContain('No address uses this domain')
    expect(within(r).getByText('Pending')).toBeTruthy()
    expect(panels()).toHaveLength(1)
  })

  it('shows a live one quietly, with its records in the menu', async () => {
    renderSettings({ domains: [LIVE] })
    const r = row('acme.com')
    expect(within(r).queryByText('Pending')).toBeNull()
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
    renderSettings({ addresses: [address('a1', 'help@acme.com')], domains: [LIVE] })
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
    renderSettings({ addresses: [address('a1', 'help@acme.com')], domains: [byo] })
    expect(labels()).toEqual(['DKIM', 'Return path', 'Return path'])
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
    renderSettings({ addresses: [address('a1', 'help@acme.com')], domains: [easy] })
    expect(labels()).toEqual(['Ownership', 'DKIM', 'DKIM', 'DKIM', 'Return path', 'Return path'])
  })
})

describe('a domain whose identity already had a key (shared)', () => {
  const ownKey = {
    type: 'TXT',
    host: 'qb1a2b3c4d._domainkey',
    value: 'v=DKIM1; k=rsa; p=PUBLICKEY',
    purpose: 'dkim',
  }
  const returnPath = [
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
  const MUTED = 'Signing uses a key already set up for acme.com.'

  it('labels its own key Ownership and the provider CNAMEs DKIM', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com')],
      domains: [
        domain({
          dkimMode: 'shared',
          dnsRecords: [
            ownKey,
            {
              type: 'CNAME',
              host: 'aaa._domainkey',
              value: 'aaa.dkim.example.com',
              purpose: 'dkim',
            },
            ...returnPath,
          ] as SendingDomainDTO['dnsRecords'],
        }),
      ],
    })
    expect(labels()).toEqual(['Ownership', 'DKIM', 'Return path', 'Return path'])
    expect(screen.queryByText(MUTED)).toBeNull()
  })

  it('says signing uses a key already set up when none is listed', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com')],
      domains: [
        domain({
          dkimMode: 'shared',
          dnsRecords: [ownKey, ...returnPath] as SendingDomainDTO['dnsRecords'],
        }),
      ],
    })
    expect(labels()).toEqual(['Ownership', 'Return path', 'Return path'])
    expect(screen.getByText(MUTED)).toBeTruthy()
  })

  it('labels its own key DKIM while the identity waits to be re-keyed to it', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com')],
      domains: [
        domain({
          dkimMode: 'shared',
          signingKeyPending: true,
          dnsRecords: [ownKey, ...returnPath] as SendingDomainDTO['dnsRecords'],
        }),
      ],
    })
    expect(labels()).toEqual(['DKIM', 'Return path', 'Return path'])
    expect(screen.queryByText(MUTED)).toBeNull()
  })

  it('names the signing key when every listed record is found and it still is not live', () => {
    const found = { state: 'found', checkedAt: CHECKED }
    renderSettings({
      addresses: [address('a1', 'help@acme.com')],
      domains: [
        domain({
          dkimMode: 'shared',
          verifiedAt: '2026-10-01T00:00:00.000Z',
          dnsRecords: [ownKey, ...returnPath].map((r) => ({
            ...r,
            check: found,
          })) as SendingDomainDTO['dnsRecords'],
        }),
      ],
    })
    const sentence = "The signing key for acme.com isn't working."
    expect(row('Acme <help@acme.com>').textContent).toContain(sentence)
    expect(within(panels()[0] as HTMLElement).getByText(sentence)).toBeTruthy()
  })
})

describe('the record table', () => {
  it('copies the name relative to the domain, not the full name', async () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com')], domains: [domain()] })
    fireEvent.click(screen.getByRole('button', { name: 'Copy name _quackback' }))
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith('_quackback'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy name qb-bounce' }))
    await waitFor(() => expect(clipboard).toHaveBeenLastCalledWith('qb-bounce'))
  })

  it('shows MX with its priority, a label per record and a fix only under a broken one', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com')],
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
    expect(rows[1].textContent).toContain('Needs a fix: DKIM')
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
      addresses: [address('a1', 'help@acme.com')],
      domains: [domain({ dnsRecords: records({ ownership: found, dkim: missing, mx: missing }) })],
    })
    expect(document.querySelectorAll('[data-slot="dns-record"]')[1].textContent).toContain(
      'Waiting: DKIM'
    )
    expect(document.querySelectorAll('[data-slot="dns-record-fix"]')).toHaveLength(0)
  })

  it('leaves out DMARC, pre-flight badges and host tips', () => {
    renderSettings({
      addresses: [address('a1', 'help@acme.com')],
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
    renderSettings({ addresses: [address('a1', 'help@acme.com')], domains: [domain()] })
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
    const user = await openMenu('Acme <help@acme.com>')
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Delete address',
      })
    )
  }

  it('asks first and deletes only on confirm', async () => {
    renderSettings({ addresses: [address('a1', 'help@acme.com')], domains: [LIVE] })
    const user = await openMenu('Acme <help@acme.com>')
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
    renderSettings({ addresses: [address('a1', 'help@acme.com')], domains: [LIVE] })
    const user = await openMenu('Acme <help@acme.com>')
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
      addresses: [address('a1', 'help@acme.com'), address('a2', 'news@acme.com')],
      domains: [LIVE],
    })
    const user = await openMenu('Acme <help@acme.com>')
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).not.toContain('will be removed too')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete address' }))
    await waitFor(() => expect(deleteAccount).toHaveBeenCalled())
    expect(deleteDomain).not.toHaveBeenCalled()
  })

  async function removeDialog(title: string) {
    const user = await openMenu(title)
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    return screen.findByRole('alertdialog')
  }

  it('says which kinds of email fall back to the default', async () => {
    renderSettings({
      addresses: [address('a1', 'hello@acme.com'), address('a2', 'news@acme.com')],
      domains: [LIVE],
      senders: {
        default: { mode: 'address', id: 'a1' },
        changelog: { mode: 'address', id: 'a2' },
        status: { mode: 'address', id: 'a2' },
      },
    })
    const dialog = await removeDialog('Acme <news@acme.com>')
    expect(dialog.textContent).toContain(
      'Changelog and Status page email will send from the default address.'
    )
  })

  it('says email falls to the Quackback address when removing the default', async () => {
    renderSettings({
      addresses: [address('a1', 'hello@acme.com')],
      domains: [LIVE],
      senders: { default: { mode: 'address', id: 'a1' } },
    })
    const dialog = await removeDialog('Acme <hello@acme.com>')
    expect(dialog.textContent).toContain(
      "It's the default address, so email sent from it will send from Acme <notifications@example.com>."
    )
  })

  it('keeps the plain sentence for an address nothing sends from', async () => {
    renderSettings({
      addresses: [address('a1', 'hello@acme.com'), address('a2', 'spare@acme.com')],
      domains: [LIVE],
      senders: { default: { mode: 'address', id: 'a1' } },
    })
    const dialog = await removeDialog('Acme <spare@acme.com>')
    expect(dialog.textContent).toContain('Email can no longer be sent from this address.')
  })

  it('never removes a domain the dialog did not name', async () => {
    // The page thought another address used it; the server says none does.
    deleteAccount.mockImplementation((_id: string, opts: { onSuccess: (r: unknown) => void }) =>
      opts.onSuccess({ id: 'a1', lastOnDomain: { id: 'dom_1', domain: 'acme.com' } })
    )
    renderSettings({
      addresses: [address('a1', 'help@acme.com'), address('a2', 'news@acme.com')],
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

describe('adding an address', () => {
  async function openAdd() {
    fireEvent.click(screen.getByRole('button', { name: 'Add address' }))
    return screen.findByRole('dialog')
  }

  it('opens a dialog with the address and a sender name that starts as the workspace name', async () => {
    renderSettings()
    const dialog = await openAdd()
    expect((within(dialog).getByLabelText('Email address') as HTMLInputElement).value).toBe('')
    expect((within(dialog).getByLabelText('Sender name') as HTMLInputElement).value).toBe('Acme')
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    expect(
      (within(dialog).getByRole('button', { name: 'Add address' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('adds the address, keeping the workspace name as no name of its own', async () => {
    renderSettings()
    const dialog = await openAdd()
    fireEvent.change(within(dialog).getByLabelText('Email address'), {
      target: { value: ' help@acme.com ' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add address' }))
    expect(createAddress).toHaveBeenCalledWith(
      { address: 'help@acme.com', senderName: null },
      expect.anything()
    )
  })

  it('adds the address under a sender name of its own', async () => {
    renderSettings()
    const dialog = await openAdd()
    fireEvent.change(within(dialog).getByLabelText('Email address'), {
      target: { value: 'help@acme.com' },
    })
    fireEvent.change(within(dialog).getByLabelText('Sender name'), {
      target: { value: 'Acme Support' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add address' }))
    expect(createAddress).toHaveBeenCalledWith(
      { address: 'help@acme.com', senderName: 'Acme Support' },
      expect.anything()
    )
  })

  it('shows a failure inside the dialog, not as a toast, until the next attempt', async () => {
    createAddress.mockImplementationOnce(
      (_data: unknown, opts: { onError: (e: unknown) => void }) =>
        opts.onError(new Error('Your plan allows 3 sending domains.'))
    )
    renderSettings()
    const dialog = await openAdd()
    fireEvent.change(within(dialog).getByLabelText('Email address'), {
      target: { value: 'help@acme.com' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add address' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toBe('Your plan allows 3 sending domains.')
    expect(toastError).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add address' }))
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull())
  })

  it('is disabled with one line on a shared server that cannot set up domains', () => {
    renderSettings({ addressMode: 'unavailable' })
    expect(
      screen.getByText("Custom sending addresses aren't available on this server.")
    ).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Add address' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it.each(['any', 'verified-domains'] as const)('is enabled with no note in %s mode', (mode) => {
    renderSettings({ addressMode: mode })
    expect(
      screen.queryByText("Custom sending addresses aren't available on this server.")
    ).toBeNull()
    expect(
      (screen.getByRole('button', { name: 'Add address' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('uses one outline button per form, and no separate domain form', () => {
    renderSettings()
    for (const name of ['Set route', 'Add address']) {
      const button = screen.getByRole('button', { name })
      expect(button.className).toContain('border-border/50')
      expect(button.className).not.toContain('bg-primary')
    }
    expect(screen.queryByRole('button', { name: 'Add domain' })).toBeNull()
  })
})

describe('a paused workspace', () => {
  afterEach(cleanup)
  const LINE = /Sending is paused by the email provider because of bounces or complaints\./

  it('says nothing while mail sends', () => {
    renderSettings()
    expect(screen.queryByText(LINE)).toBeNull()
  })

  it('shows one line with the provider reason when sending is paused', () => {
    renderSettings({ sendingPaused: { cause: 'Bounce rate above threshold.' } })
    const line = screen.getByText(LINE)
    expect(line.textContent).toContain('Bounce rate above threshold.')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('shows the line without a reason when none is kept', () => {
    renderSettings({ sendingPaused: { cause: null } })
    expect(screen.getByText(LINE).textContent).toBe(
      'Sending is paused by the email provider because of bounces or complaints.'
    )
  })
})
