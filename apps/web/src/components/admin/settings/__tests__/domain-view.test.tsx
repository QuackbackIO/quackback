// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { EMAIL_SENDING_PERMISSION } from '@/lib/shared/email-sending-permissions'
import type { SendingDomainDTO } from '@/lib/server/functions/channel-accounts'
import type { DomainDetail } from '@/lib/server/functions/domains'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    hash,
    children,
    ...rest
  }: {
    to: string
    search?: Record<string, string>
    hash?: string
    children: ReactNode
  }) => (
    <a
      href={`${to}${search ? `?${new URLSearchParams(search).toString()}` : ''}${hash ? `#${hash}` : ''}`}
      {...rest}
    >
      {children}
    </a>
  ),
}))

const deleteAccount = vi.fn()
const deleteDomain = vi.fn()
const restartChecks = vi.fn()

vi.mock('@/lib/server/functions/channel-accounts', () => ({
  getEmailChannelConfigFn: vi.fn(),
}))
const checkOwnership = vi.fn()
const removeDomainByName = vi.fn()
const addDomainByName = vi.fn()
const removeSignIn = vi.fn()
const clearHelpCenterDomain = vi.fn()
vi.mock('@/lib/server/functions/domains', () => ({
  addDomainFn: addDomainByName,
  checkDomainOwnershipFn: checkOwnership,
  removeDomainFn: removeDomainByName,
}))
const addSignIn = vi.fn()
vi.mock('@/lib/server/functions/sso', () => ({
  removeVerifiedDomainFn: removeSignIn,
  addProviderDomainFn: addSignIn,
  listIdentityProvidersFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/help-center-domain', () => ({
  updateHelpCenterDomainFn: clearHelpCenterDomain,
}))
const addWebAddress = vi.fn()
vi.mock('@/lib/server/functions/cloud-identity', () => ({
  mutateCloudCustomDomainFn: addWebAddress,
}))
const createAddress = vi.fn()
vi.mock('@/lib/client/mutations/channel-accounts', () => ({
  useCreateSendingAddress: () => ({ mutate: createAddress, isPending: false }),
  useUpdateSendingAddressName: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteChannelAccount: () => ({ mutate: deleteAccount, isPending: false }),
  useDeleteSendingDomain: () => ({ mutate: deleteDomain, isPending: false }),
  useRestartSendingDomainChecks: () => ({ mutate: restartChecks, isPending: false }),
}))

const { DomainView } = await import('../domain-view')
const { domainRows } = await import('../domains-overview')
const { domainUseLinks } = await import('@/lib/shared/domains-permissions')
const { visibleDomainUses } = await import('@/lib/shared/domain-uses')
const { emailChannelConfigQuery } = await import('@/lib/client/queries/channel-accounts')
const { settingsQueries } = await import('@/lib/client/queries/settings')

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

const NOW = new Date('2026-11-03T12:00:00.000Z')
const ALL = [
  PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
  EMAIL_SENDING_PERMISSION,
  PERMISSIONS.AUTH_MANAGE,
  PERMISSIONS.HELP_CENTER_MANAGE,
]

const PENDING_DOMAIN: SendingDomainDTO = {
  id: 'dom_1',
  domain: 'acme.com',
  status: 'pending',
  verifiedAt: null,
  dnsRecords: [
    {
      type: 'TXT',
      host: '_quackback',
      value: 'quackback-domain-verification=abc',
      purpose: 'ownership',
    },
  ],
  mailFromLabel: 'qb-bounce',
  dkimMode: 'easy',
  // Read against the clock, so inside its check window whenever the test runs.
  autoCheckUntil: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  lastCheckedAt: null,
  preflight: {},
}

const address = (id: string, addr: string) => ({
  id,
  address: addr,
  senderName: null,
  config: {},
  sendingDomainId: 'dom_1',
  sendingDomain: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  sendable: false,
})

/** acme.com as the list would row it, with the uses asked for. */
function rowWith({
  email = false,
  customDomain = false,
  signIn = false,
  signInVerified = true,
}: {
  email?: boolean
  customDomain?: boolean
  signIn?: boolean
  signInVerified?: boolean
}) {
  return domainRows({
    now: NOW,
    sending: email
      ? [
          {
            id: 'dom_1',
            domain: 'acme.com',
            status: 'pending',
            verifiedAt: null,
            autoCheckUntil: '2026-11-05T00:00:00.000Z',
            localParts: ['help@'],
            ownershipProven: false,
          },
        ]
      : [],
    signIn: signIn
      ? [{ id: 'domain_a', name: 'acme.com', verified: signInVerified, provenBy: null }]
      : [],
    helpCenterDomain: customDomain ? { domain: 'acme.com', verified: false } : null,
    added: [{ name: 'acme.com', verified: false }],
  })[0]!
}

/** acme.com as its page reads it: added, pending, its own record to publish. */
const DETAIL: DomainDetail = {
  name: 'acme.com',
  added: true,
  status: 'pending',
  record: { host: '_quackback', value: 'quackback-domain-verification=own-token' },
  verifiedAt: null,
  lastCheckedAt: null,
  provenBy: null,
  inUse: false,
}

function renderView(
  row: ReturnType<typeof rowWith>,
  {
    permissions = ALL as string[],
    addresses = [address('acct_1', 'help@acme.com')],
    onChanged = vi.fn(),
    onRemoved = vi.fn(),
    domain = PENDING_DOMAIN,
    detail = { ...DETAIL, inUse: row.uses.length > 0 } as DomainDetail | null,
    cloud = false,
    helpCenterDomain = null as string | null,
    providers = [{ id: 'idp_1' }] as { id: string }[],
  } = {}
) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(emailChannelConfigQuery().queryKey, {
    workspaceName: 'Acme',
    senders: { default: null, support: null, feedback: null, changelog: null, status: null },
    forwardingTargetPermitted: null,
    inboundRoute: null,
    platformAddress: null,
    sendingAddresses: addresses,
    domains: [domain],
    defaultFrom: 'Acme <notifications@example.com>',
    addressMode: 'verified-domains',
    sendingPaused: null,
  } as never)
  client.setQueryData(settingsQueries.identityProviders().queryKey, providers as never)
  return render(
    <QueryClientProvider client={client}>
      <DomainView
        row={row}
        links={domainUseLinks({ permissions, cloudEnabled: cloud, helpCenterOn: true })}
        helpCenterDomain={helpCenterDomain}
        visibleUses={visibleDomainUses(permissions)}
        domain={detail}
        canManage={permissions.includes(PERMISSIONS.SETTINGS_MANAGE)}
        onChanged={onChanged}
        onRemoved={onRemoved}
      />
    </QueryClientProvider>
  )
}

const card = (title: string) =>
  screen.getByRole('heading', { level: 2, name: title }).closest('section') as HTMLElement

const usesCard = () => card('Used for')

/** The titles of the use rows, in order. */
const useTitles = () =>
  [...usesCard().querySelectorAll('[data-slot="settings-list-row"]')].map(
    (r) => r.querySelector('span.font-medium')?.textContent ?? ''
  )

const useRow = (title: string) =>
  within(usesCard())
    .getByText(title, { selector: 'span.font-medium' })
    .closest('[data-slot="settings-list-row"]') as HTMLElement

describe('domain view uses', () => {
  it('lists the three uses in order, each set up or not', () => {
    renderView(rowWith({ email: true, customDomain: true, signIn: true }))
    expect(useTitles()).toEqual(['Email sending', 'Custom domain', 'Sign-in'])
  })

  it("shows each use's status, and Set up for one that is not on", () => {
    renderView(rowWith({ email: true, signIn: true }))
    expect(useRow('Email sending')).toHaveTextContent('Pending')
    expect(useRow('Email sending')).toHaveTextContent('help@')
    // A healthy use is quiet: no status word at all.
    expect(useRow('Sign-in')).not.toHaveTextContent('Verified')
    expect(useRow('Sign-in')).not.toHaveTextContent('Pending')
    expect(within(useRow('Custom domain')).getByRole('button', { name: 'Set up' })).toBeVisible()
    expect(within(useRow('Custom domain')).queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('offers Set up for every use of a domain with none, each run on this page', () => {
    renderView(rowWith({}))
    expect(useTitles()).toEqual(['Email sending', 'Custom domain', 'Sign-in'])
    for (const title of ['Email sending', 'Custom domain', 'Sign-in']) {
      expect(within(useRow(title)).getByRole('button', { name: 'Set up' })).toBeVisible()
    }
    expect(within(usesCard()).queryByRole('link')).toBeNull()
    expect(within(usesCard()).queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('shows the email records and checks them again from their card', () => {
    renderView(rowWith({ email: true }))
    const email = card('Email records')
    expect(email).toHaveTextContent('quackback-domain-verification=abc')
    fireEvent.click(within(email).getByRole('button', { name: 'Check now' }))
    expect(restartChecks).toHaveBeenCalledWith('dom_1', expect.anything())
  })

  it('links sign-in and custom domain to the page that owns their setup', () => {
    renderView(rowWith({ customDomain: true, signIn: true, signInVerified: false }))
    expect(useRow('Sign-in')).toHaveTextContent('Pending')
    expect(
      within(useRow('Sign-in')).getByRole('link', { name: 'Sign-in settings' })
    ).toHaveAttribute('href', '/admin/settings/security/authentication?tab=sign-in')
    expect(useRow('Custom domain')).toHaveTextContent('Pending')
    expect(
      within(useRow('Custom domain')).getByRole('link', { name: 'Help center settings' })
    ).toHaveAttribute('href', '/admin/settings/help-center?tab=domains-languages')
  })

  it('never says live, mail or Security', () => {
    const { container } = renderView(rowWith({ email: true, customDomain: true, signIn: true }))
    expect(container.textContent).not.toMatch(/\blive\b/i)
    expect(container.textContent).not.toMatch(/\bmail\b/i)
    expect(container).not.toHaveTextContent('Security')
  })
})

describe('domain view set up', () => {
  const setUp = (title: string) =>
    fireEvent.click(within(useRow(title)).getByRole('button', { name: 'Set up' }))

  it('opens Add address with the domain filled in for email', () => {
    renderView(rowWith({}))
    setUp('Email sending')
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Add address' })).toBeVisible()
    expect(within(dialog).getByLabelText('Email address')).toHaveValue('@acme.com')
  })

  it('adds the domain as a web address on Cloud', async () => {
    const onChanged = vi.fn()
    addWebAddress.mockResolvedValue({ projection: {}, transferToken: null })
    renderView(rowWith({}), { cloud: true, onChanged })
    setUp('Custom domain')
    expect(addWebAddress).toHaveBeenCalledWith({ data: { action: 'add', hostname: 'acme.com' } })
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('puts the help center on the domain when it has none', async () => {
    const onChanged = vi.fn()
    clearHelpCenterDomain.mockResolvedValue({ domain: 'acme.com', verifiedAt: null })
    renderView(rowWith({}), { onChanged })
    setUp('Custom domain')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(clearHelpCenterDomain).toHaveBeenCalledWith({ data: { domain: 'acme.com' } })
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('names the current help center domain and changes nothing until confirmed', async () => {
    clearHelpCenterDomain.mockResolvedValue({ domain: 'acme.com', verifiedAt: null })
    renderView(rowWith({}), { helpCenterDomain: 'help.acme.io' })

    setUp('Custom domain')
    let dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('help.acme.io will stop serving the help center.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(clearHelpCenterDomain).not.toHaveBeenCalled()

    setUp('Custom domain')
    dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move help center' }))
    expect(clearHelpCenterDomain).toHaveBeenCalledWith({ data: { domain: 'acme.com' } })
  })

  it('adds the domain to the one sign-in provider', async () => {
    const onChanged = vi.fn()
    addSignIn.mockResolvedValue({ id: 'domain_new', name: 'acme.com' })
    renderView(rowWith({}), { onChanged })
    setUp('Sign-in')
    expect(addSignIn).toHaveBeenCalledWith({ data: { providerId: 'idp_1', name: 'acme.com' } })
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it.each([
    ['no', []],
    ['more than one', [{ id: 'idp_1' }, { id: 'idp_2' }]],
  ])('links to Sign-in settings with %s sign-in provider', (_, providers) => {
    renderView(rowWith({}), { providers })
    expect(within(useRow('Sign-in')).getByRole('link', { name: 'Set up' })).toHaveAttribute(
      'href',
      '/admin/settings/security/authentication?tab=sign-in'
    )
    expect(addSignIn).not.toHaveBeenCalled()
  })

  it("shows a use's row without Set up to a viewer who cannot set it up", () => {
    // The custom domain's permission alone reads the use; the help center is
    // set up by whoever manages it.
    renderView(rowWith({}), { permissions: [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN] })
    expect(useTitles()).toEqual(['Custom domain'])
    expect(within(usesCard()).queryByRole('button', { name: 'Set up' })).toBeNull()
  })

  it('offers Set up only for the uses whose permission the viewer holds', () => {
    renderView(rowWith({}), { permissions: [PERMISSIONS.AUTH_MANAGE] })
    expect(useTitles()).toEqual(['Sign-in'])
    expect(within(usesCard()).getAllByRole('button', { name: 'Set up' })).toHaveLength(1)
  })
})

describe('domain view ownership', () => {
  it("shows the domain's own record while pending, and checks it now", async () => {
    const onChanged = vi.fn()
    checkOwnership.mockResolvedValue({ ok: true, via: 'dns' })
    renderView(rowWith({}), { onChanged })
    const ownership = card('Ownership')
    expect(ownership).toHaveTextContent('Pending')
    expect(ownership).toHaveTextContent('_quackback')
    expect(ownership).toHaveTextContent('quackback-domain-verification=own-token')
    fireEvent.click(within(ownership).getByRole('button', { name: 'Check now' }))
    expect(checkOwnership).toHaveBeenCalledWith({ data: { name: 'acme.com' } })
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('says what the check found when the record is not there yet', async () => {
    checkOwnership.mockResolvedValue({ ok: false, reason: 'no-record' })
    renderView(rowWith({}))
    fireEvent.click(within(card('Ownership')).getByRole('button', { name: 'Check now' }))
    expect(await within(card('Ownership')).findByRole('alert')).toHaveTextContent(
      "We couldn't find the record yet."
    )
  })

  it('shows a verified domain with no badge and no Check now', () => {
    renderView(rowWith({}), {
      detail: { ...DETAIL, status: 'verified', verifiedAt: '2026-11-01T00:00:00.000Z' },
    })
    const ownership = card('Ownership')
    expect(ownership).not.toHaveTextContent('Pending')
    expect(ownership).not.toHaveTextContent('Verified')
    expect(within(ownership).queryByRole('button', { name: 'Check now' })).toBeNull()
    // Still shown, so it stays published.
    expect(ownership).toHaveTextContent('quackback-domain-verification=own-token')
  })

  it('needs no record under a zone this workspace already proved', () => {
    renderView(rowWith({}), { detail: { ...DETAIL, provenBy: 'email-sending' } })
    const ownership = card('Ownership')
    expect(ownership).toHaveTextContent('Verified through email sending')
    expect(ownership).not.toHaveTextContent('Pending')
    expect(ownership).not.toHaveTextContent('own-token')
    expect(within(ownership).queryByRole('button', { name: 'Check now' })).toBeNull()
  })

  it('offers no Check now to a viewer who cannot manage the domain', () => {
    renderView(rowWith({}), { permissions: [PERMISSIONS.AUTH_MANAGE] })
    expect(card('Ownership')).toHaveTextContent('Pending')
    expect(within(card('Ownership')).queryByRole('button', { name: 'Check now' })).toBeNull()
    expect(within(card('Ownership')).queryByRole('button', { name: 'Remove domain' })).toBeNull()
  })

  it('gives a domain only a use holds a record of its own when asked', async () => {
    const onChanged = vi.fn()
    addDomainByName.mockResolvedValue({ name: 'acme.com' })
    renderView(rowWith({ signIn: true }), {
      onChanged,
      detail: { ...DETAIL, added: false, record: null, inUse: true },
    })
    expect(card('Ownership')).toHaveTextContent('Not verified yet.')
    fireEvent.click(within(card('Ownership')).getByRole('button', { name: 'Verify ownership' }))
    expect(addDomainByName).toHaveBeenCalledWith({ data: { name: 'acme.com' } })
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })
})

describe('domain view permissions', () => {
  const all = () => rowWith({ email: true, customDomain: true, signIn: true })

  it('maps each use to the permission that owns it', () => {
    expect(visibleDomainUses([EMAIL_SENDING_PERMISSION])).toEqual(['email'])
    expect(visibleDomainUses([PERMISSIONS.SETTINGS_CUSTOM_DOMAIN])).toEqual(['customDomain'])
    expect(visibleDomainUses([PERMISSIONS.AUTH_MANAGE])).toEqual(['signIn'])
    expect(visibleDomainUses([PERMISSIONS.HELP_CENTER_MANAGE])).toEqual([])
  })

  it('shows a sign-in manager the sign-in use only', () => {
    renderView(all(), { permissions: [PERMISSIONS.AUTH_MANAGE] })
    expect(useTitles()).toEqual(['Sign-in'])
    expect(screen.queryByText('Check now')).toBeNull()
    expect(screen.queryByText('help@acme.com')).toBeNull()
  })

  it('shows an email manager the email use only', () => {
    renderView(all(), { permissions: [EMAIL_SENDING_PERMISSION] })
    expect(useTitles()).toEqual(['Email sending'])
    expect(screen.queryByRole('link', { name: 'Sign-in settings' })).toBeNull()
  })

  it('shows the custom domain without a link to a page the viewer cannot open', () => {
    renderView(all(), { permissions: [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN] })
    expect(useTitles()).toEqual(['Custom domain'])
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('domain view removal', () => {
  const addresses = () => card('Sending addresses')

  it('does not name a verified domain again inside its email records', () => {
    renderView(rowWith({ email: true }), {
      domain: {
        ...PENDING_DOMAIN,
        status: 'verified',
        verifiedAt: '2026-10-01T00:00:00.000Z',
        autoCheckUntil: null,
      },
    })
    // The page is titled with the domain; the records need no second heading.
    expect(within(card('Email records')).queryByRole('heading', { level: 3 })).toBeNull()
    expect(card('Email records')).toHaveTextContent('_quackback')
  })

  it('removes one use at a time, and no Remove domain while a use is on', () => {
    renderView(rowWith({ email: true, signIn: true }))
    expect(screen.queryByRole('button', { name: /remove (domain|all|everything)/i })).toBeNull()

    // Email is removed an address at a time.
    expect(within(addresses()).getAllByRole('button', { name: 'Remove' })).toHaveLength(1)
    // Sign-in has its own Remove, and its page linked once, from its own row.
    expect(within(useRow('Sign-in')).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: 'Sign-in settings' })
    expect(links).toHaveLength(1)
    expect(useRow('Sign-in')).toContainElement(links[0]!)
    // A domain still being set up keeps its instruction heading.
    expect(within(card('Email records')).getByRole('heading', { level: 3 })).toHaveTextContent(
      'Set up acme.com'
    )
  })

  it('stops sign-in on the domain from its row', async () => {
    const onChanged = vi.fn()
    removeSignIn.mockResolvedValue({ success: true })
    renderView(rowWith({ signIn: true }), { onChanged })
    fireEvent.click(within(useRow('Sign-in')).getByRole('button', { name: 'Remove' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Stop using acme.com for sign-in?')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(removeSignIn).toHaveBeenCalledWith({ data: { id: 'domain_a' } })
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('stops serving the help center on the domain from its row', async () => {
    clearHelpCenterDomain.mockResolvedValue({ domain: null, verifiedAt: null })
    renderView(rowWith({ customDomain: true }))
    fireEvent.click(within(useRow('Custom domain')).getByRole('button', { name: 'Remove' }))
    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(clearHelpCenterDomain).toHaveBeenCalledWith({ data: { domain: null } })
  })

  it('removes the last address with the wording Email settings uses, and the domain with it', () => {
    const onChanged = vi.fn()
    renderView(rowWith({ email: true, signIn: true }), { onChanged })
    expect(addresses()).toHaveTextContent('help@acme.com')
    fireEvent.click(within(addresses()).getByRole('button', { name: 'Remove' }))

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('Remove help@acme.com?')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Email can no longer be sent from this address.')
    expect(dialog).toHaveTextContent('acme.com stops sending email too.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove address' }))

    expect(deleteAccount).toHaveBeenCalledWith('acct_1', expect.anything())
    // The server says the address was the last on the domain: the domain goes too.
    deleteAccount.mock.calls[0]![1].onSuccess({
      lastOnDomain: { id: 'dom_1', domain: 'acme.com' },
    })
    expect(deleteDomain).toHaveBeenCalledWith('dom_1', expect.anything())
    expect(onChanged).not.toHaveBeenCalled()
    deleteDomain.mock.calls[0]![1].onSettled()
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('lists each address of a domain with more than one, and keeps the domain until the last', () => {
    renderView(rowWith({ email: true }), {
      addresses: [address('acct_1', 'help@acme.com'), address('acct_2', 'billing@acme.com')],
    })
    const buttons = within(addresses()).getAllByRole('button', { name: 'Remove' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[0]!)
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent('stops sending email too')
  })

  it('stops email on a domain no address uses, from its row', () => {
    renderView(rowWith({ email: true }), { addresses: [] })
    expect(screen.queryByRole('heading', { level: 2, name: 'Sending addresses' })).toBeNull()
    expect(useRow('Email sending')).toHaveTextContent('No address uses this domain')
    fireEvent.click(within(useRow('Email sending')).getByRole('button', { name: 'Remove' }))
    const dialog = screen.getByRole('alertdialog')
    // Only email stops: the dialog must not read as removing the whole domain.
    expect(within(dialog).getByText('Stop sending email from acme.com?')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Its email DNS records can be deleted afterwards.')
    expect(dialog).not.toHaveTextContent('other uses')
    expect(within(dialog).queryByRole('button', { name: 'Remove domain' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop sending email' }))
    expect(deleteDomain).toHaveBeenCalledWith('dom_1', expect.anything())
  })

  it('removes a domain with no use left, once confirmed', async () => {
    const onRemoved = vi.fn()
    removeDomainByName.mockResolvedValue({ name: 'acme.com' })
    renderView(rowWith({}), { onRemoved })
    fireEvent.click(screen.getByRole('button', { name: 'Remove domain' }))
    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove domain' }))
    expect(removeDomainByName).toHaveBeenCalledWith({ data: { name: 'acme.com' } })
    await waitFor(() => expect(onRemoved).toHaveBeenCalled())
  })

  it('keeps Remove domain hidden while a use the viewer cannot see still holds it', () => {
    renderView(rowWith({}), { detail: { ...DETAIL, inUse: true } })
    expect(screen.queryByRole('button', { name: 'Remove domain' })).toBeNull()
  })

  it('offers Remove domain only to a viewer who manages domains', () => {
    renderView(rowWith({}), { permissions: [PERMISSIONS.AUTH_MANAGE] })
    expect(screen.queryByRole('button', { name: 'Remove domain' })).toBeNull()
  })

  it('lists only the uses the viewer may see', () => {
    renderView(rowWith({ email: true, signIn: true }), { permissions: [PERMISSIONS.AUTH_MANAGE] })
    expect(screen.queryByRole('heading', { level: 2, name: 'Sending addresses' })).toBeNull()
    expect(screen.queryByText('help@acme.com')).toBeNull()
  })
})
