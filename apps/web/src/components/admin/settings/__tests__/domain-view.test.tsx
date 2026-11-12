// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { EMAIL_SENDING_PERMISSION } from '@/lib/shared/email-sending-permissions'
import type { SendingDomainDTO } from '@/lib/server/functions/channel-accounts'

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
vi.mock('@/lib/client/mutations/channel-accounts', () => ({
  useDeleteChannelAccount: () => ({ mutate: deleteAccount, isPending: false }),
  useDeleteSendingDomain: () => ({ mutate: deleteDomain, isPending: false }),
  useRestartSendingDomainChecks: () => ({ mutate: restartChecks, isPending: false }),
}))

const { DomainView } = await import('../domain-view')
const { domainRows } = await import('../domains-overview')
const { domainUseLinks } = await import('@/lib/shared/domains-permissions')
const { visibleDomainUses } = await import('@/lib/shared/domain-uses')
const { emailChannelConfigQuery } = await import('@/lib/client/queries/channel-accounts')

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
  })[0]!
}

function renderView(
  row: ReturnType<typeof rowWith>,
  {
    permissions = ALL as string[],
    addresses = [address('acct_1', 'help@acme.com')],
    onChanged = vi.fn(),
    domain = PENDING_DOMAIN,
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
  return render(
    <QueryClientProvider client={client}>
      <DomainView
        row={row}
        links={domainUseLinks({ permissions, cloudEnabled: false, helpCenterOn: true })}
        visibleUses={visibleDomainUses(permissions)}
        onChanged={onChanged}
      />
    </QueryClientProvider>
  )
}

const cardTitles = () =>
  screen
    .getAllByRole('heading', { level: 2 })
    .map((h) => h.textContent)
    .filter((t) => t !== 'Sending addresses')

const card = (title: string) =>
  screen.getByRole('heading', { level: 2, name: title }).closest('section') as HTMLElement

describe('domain view cards', () => {
  it('shows one card per use, email first, then custom domain, then sign-in', () => {
    renderView(rowWith({ email: true, customDomain: true, signIn: true }))
    expect(cardTitles()).toEqual(['Email sending', 'Custom domain', 'Sign-in'])
  })

  it('shows both cards of a domain used for email and sign-in, each with its status', () => {
    renderView(rowWith({ email: true, signIn: true }))
    expect(cardTitles()).toEqual(['Email sending', 'Sign-in'])
    expect(card('Email sending')).toHaveTextContent('Pending')
    expect(card('Email sending')).toHaveTextContent('help@')
    // A healthy use is quiet: no status word at all.
    expect(card('Sign-in')).not.toHaveTextContent('Verified')
    expect(card('Sign-in')).not.toHaveTextContent('Pending')
  })

  it('shows the email records and checks them again from the card', () => {
    renderView(rowWith({ email: true }))
    const email = card('Email sending')
    expect(email).toHaveTextContent('quackback-domain-verification=abc')
    fireEvent.click(within(email).getByRole('button', { name: 'Check now' }))
    expect(restartChecks).toHaveBeenCalledWith('dom_1', expect.anything())
  })

  it('links sign-in and custom domain to the page that owns their setup', () => {
    renderView(rowWith({ customDomain: true, signIn: true, signInVerified: false }))
    expect(card('Sign-in')).toHaveTextContent('Pending')
    expect(within(card('Sign-in')).getByRole('link', { name: 'Sign-in settings' })).toHaveAttribute(
      'href',
      '/admin/settings/security/authentication?tab=sign-in'
    )
    expect(card('Custom domain')).toHaveTextContent('Pending')
    expect(
      within(card('Custom domain')).getByRole('link', { name: 'Help center settings' })
    ).toHaveAttribute('href', '/admin/settings/help-center?tab=domains-languages')
  })

  it('never says live, mail or Security', () => {
    const { container } = renderView(rowWith({ email: true, customDomain: true, signIn: true }))
    expect(container.textContent).not.toMatch(/\blive\b/i)
    expect(container.textContent).not.toMatch(/\bmail\b/i)
    expect(container).not.toHaveTextContent('Security')
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

  it('shows a sign-in manager the sign-in card only', () => {
    renderView(all(), { permissions: [PERMISSIONS.AUTH_MANAGE] })
    expect(cardTitles()).toEqual(['Sign-in'])
    expect(screen.queryByText('Check now')).toBeNull()
    expect(screen.queryByText('help@acme.com')).toBeNull()
  })

  it('shows an email manager the email card only', () => {
    renderView(all(), { permissions: [EMAIL_SENDING_PERMISSION] })
    expect(cardTitles()).toEqual(['Email sending'])
    expect(screen.queryByRole('link', { name: 'Sign-in settings' })).toBeNull()
  })

  it('shows the custom domain card without a link to a page the viewer cannot open', () => {
    renderView(all(), { permissions: [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN] })
    expect(cardTitles()).toEqual(['Custom domain'])
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('domain view uses', () => {
  const uses = () => card('Sending addresses')

  it('does not name a verified domain again inside its email card', () => {
    renderView(rowWith({ email: true }), {
      domain: {
        ...PENDING_DOMAIN,
        status: 'verified',
        verifiedAt: '2026-10-01T00:00:00.000Z',
        autoCheckUntil: null,
      },
    })
    // The page is titled with the domain; the records need no second heading.
    expect(within(card('Email sending')).queryByRole('heading', { level: 3 })).toBeNull()
    expect(card('Email sending')).toHaveTextContent('_quackback')
  })

  it('removes one use at a time and offers nothing that removes them all', () => {
    renderView(rowWith({ email: true, signIn: true }))
    expect(screen.queryByRole('button', { name: /remove (domain|all|everything)/i })).toBeNull()
    expect(screen.queryByText(/remove (domain|all|everything)/i)).toBeNull()

    // Email is removed here, an address at a time.
    expect(within(uses()).getAllByRole('button', { name: 'Remove' })).toHaveLength(1)
    // Sign-in is removed on the page that owns it, linked once, from its own card.
    const links = screen.getAllByRole('link', { name: 'Sign-in settings' })
    expect(links).toHaveLength(1)
    expect(card('Sign-in')).toContainElement(links[0]!)
    // A domain still being set up keeps its instruction heading.
    expect(within(card('Email sending')).getByRole('heading', { level: 3 })).toHaveTextContent(
      'Set up acme.com'
    )
  })

  it('removes the last address with the wording Email settings uses, and the domain with it', () => {
    const onChanged = vi.fn()
    renderView(rowWith({ email: true, signIn: true }), { onChanged })
    expect(uses()).toHaveTextContent('help@acme.com')
    fireEvent.click(within(uses()).getByRole('button', { name: 'Remove' }))

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('Remove help@acme.com?')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Email can no longer be sent from this address.')
    expect(dialog).toHaveTextContent('acme.com will be removed too.')
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
    const buttons = within(uses()).getAllByRole('button', { name: 'Remove' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[0]!)
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent('will be removed too')
  })

  it('removes an email domain no address uses', () => {
    renderView(rowWith({ email: true }), { addresses: [] })
    expect(uses()).toHaveTextContent('No address uses this domain')
    fireEvent.click(within(uses()).getByRole('button', { name: 'Remove' }))
    const dialog = screen.getByRole('alertdialog')
    // Only email stops: the dialog must not read as removing the whole domain.
    expect(within(dialog).getByText('Stop sending email from acme.com?')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Its other uses stay as they are.')
    expect(within(dialog).queryByRole('button', { name: 'Remove domain' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop sending email' }))
    expect(deleteDomain).toHaveBeenCalledWith('dom_1', expect.anything())
  })

  it('lists only the uses the viewer may see', () => {
    renderView(rowWith({ email: true, signIn: true }), { permissions: [PERMISSIONS.AUTH_MANAGE] })
    expect(screen.queryByRole('heading', { level: 2, name: 'Sending addresses' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.queryByText('help@acme.com')).toBeNull()
  })
})
