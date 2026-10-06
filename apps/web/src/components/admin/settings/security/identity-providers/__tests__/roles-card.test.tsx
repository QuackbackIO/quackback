// @vitest-environment happy-dom
/**
 * <RolesCard>: the role each person gets when they sign in, written the way
 * sign-in decides it. Rules first (first match wins), then the default role
 * for an email at a verified domain, then portal user. Always open; Cancel and
 * Save changes appear only with edits, and one Save writes the rules (claim
 * mapping operations) and the default role (a provider patch).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { generateId, type IdentityProviderId } from '@quackback/ids'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import type { VerifiedDomain } from '@/lib/server/domains/settings/settings.types'
import {
  applyClaimMappingEdits,
  type ClaimMappingOperation,
} from '@/lib/shared/sso-claim-mapping-edit'
import type { SsoTestCapture } from '@/lib/shared/sso-test-capture'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { RolesCard } from '../roles-card'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

const { mappingSpy, upsertSpy, toastSpy, adminsRef, rolesRef } = vi.hoisted(() => ({
  mappingSpy: vi.fn(
    async (_args: {
      data: {
        expectedClaimMapping: unknown
        operations: unknown[]
        acknowledgeAdminRules?: boolean
      }
    }) => undefined
  ),
  upsertSpy: vi.fn(async (_args: { data: Record<string, unknown> }) => undefined),
  toastSpy: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  adminsRef: {
    current: { isPending: false, isError: false, data: [], refetch: vi.fn() } as {
      isPending: boolean
      isError: boolean
      data: Array<Record<string, unknown>> | undefined
      refetch: ReturnType<typeof vi.fn>
    },
  },
  rolesRef: { pending: false },
}))

vi.mock('../../sso/use-sso-test-sign-in', () => ({
  useSsoTestSignIn: () => ({ open: vi.fn(), lastSuccess: null, lastCapture: null }),
}))
vi.mock('../../sso/test-sign-in-button', () => ({
  TestSignInButton: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children ?? 'Test sign-in'}</button>
  ),
}))
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))
vi.mock('@/lib/server/functions/sso', () => ({
  upsertIdentityProviderFn: upsertSpy,
  saveIdentityProviderClaimMappingFn: mappingSpy,
}))
vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    roles: () => ({
      queryKey: ['settings', 'roles'],
      queryFn: () =>
        rolesRef.pending
          ? new Promise(() => {})
          : Promise.resolve({ roles: [], maxCustomRoles: null }),
      staleTime: Infinity,
    }),
  },
}))
vi.mock('../use-provider-admins', () => ({ useProviderAdmins: () => adminsRef.current }))
vi.mock('sonner', () => ({ toast: toastSpy }))

const SUPPORT_ROLE_ID = generateId('role')
const SUPPORT_ROLE = {
  id: SUPPORT_ROLE_ID,
  key: 'support',
  name: 'Support',
  description: null,
  isSystem: false,
  permissionKeys: ['conversation.view'],
}

const acmeDomain: VerifiedDomain = {
  id: 'domain_1' as `domain_${string}`,
  name: 'acme.com',
  verificationToken: 'tok',
  verifiedAt: '2026-06-01T00:00:00.000Z',
  enforced: false,
  providerId: 'idp_x' as `idp_${string}`,
  createdAt: '2026-05-01T00:00:00.000Z',
}

function capture(groups: string[], over: { name?: string; email?: string } = {}): SsoTestCapture {
  const email = over.email ?? 'sam@acme.com'
  const name = over.name ?? 'Sam Lee'
  const claims = { sub: 'person-1', email, name, groups }
  return {
    version: 2,
    registrationId: 'oidc_x',
    capturedAt: '2026-09-01T00:00:00.000Z',
    detailsChangedAtAtStart: '2026-08-01T00:00:00.000Z',
    outcome: 'success',
    identity: { id: 'person-1', email, name, sources: { id: 'idToken', email: 'idToken' } },
    claims,
    replay: {
      sources: [
        { source: 'idToken', claims },
        { source: 'userinfo', claims: { sub: 'person-1' } },
      ],
    },
  }
}

function makeProvider(over: Partial<IdentityProvider> = {}): IdentityProvider {
  return {
    id: 'idp_x' as IdentityProviderId,
    registrationId: 'oidc_x',
    label: 'Acme ID',
    kind: null,
    configured: true,
    discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
    authorizationUrl: null,
    tokenUrl: null,
    userInfoUrl: null,
    jwksUri: null,
    issuer: null,
    clientId: 'client-id',
    scopes: null,
    prompt: null,
    tokenEndpointAuthMethod: null,
    idTokenNonce: null,
    enabled: true,
    autoCreateUsers: true,
    autoProvisionRole: null,
    claimMapping: null,
    redirectStyle: 'current',
    showButton: false,
    logoKey: null,
    logoUrl: null,
    detailsChangedAt: '2026-08-01T00:00:00.000Z',
    lastSuccessfulTestAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-05-01T00:00:00.000Z',
    domains: [],
    visibility: 'button',
    lastTestCapture: null,
    ...over,
  }
}

/** The signed-in admin, as the provider-admins list returns them. */
const SAM = {
  principalId: 'principal_sam',
  name: 'Sam Lee',
  email: 'sam@acme.com',
  role: 'admin',
  adminTier: true,
  canManageSso: true,
  atVerifiedDomain: true,
  isCaller: true,
}

const TWO_RULES = {
  role: {
    claimPath: 'groups',
    rules: [
      { whenContains: 'admins', role: 'admin' as const },
      { whenContains: 'support', role: 'member' as const },
    ],
  },
}

function renderCard(provider: IdentityProvider, roles: unknown[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (!rolesRef.pending) qc.setQueryData(['settings', 'roles'], { roles, maxCustomRoles: null })
  return render(
    <QueryClientProvider client={qc}>
      <RolesCard provider={provider} />
    </QueryClientProvider>
  )
}

const setAdmins = (data: Array<Record<string, unknown>>) => {
  adminsRef.current = { isPending: false, isError: false, data, refetch: vi.fn() }
}
const saveButton = () => screen.queryByRole('button', { name: 'Save changes' })
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
const ruleRows = () =>
  within(screen.getByRole('list', { name: 'Role rules' })).getAllByRole('listitem')
const lastMapping = () => mappingSpy.mock.calls.at(-1)![0].data
const lastSaved = () =>
  applyClaimMappingEdits(
    lastMapping().expectedClaimMapping,
    lastMapping().operations as ClaimMappingOperation[]
  ) as { role?: { claimPath: string; rules: unknown[]; syncOnEverySignIn?: boolean } } | null
/** Types a value into rule N's value field through its "Use" item. */
const typeValue = async (n: number, value: string) => {
  await userEvent.click(screen.getByRole('combobox', { name: `Value for rule ${n}` }))
  fireEvent.change(screen.getByPlaceholderText('Search or type…'), { target: { value } })
  fireEvent.click(screen.getByText(new RegExp(`Use ["“]${value}["”]`)))
}
const pickRole = async (n: number, option: string) => {
  await userEvent.click(screen.getByRole('combobox', { name: `Role for rule ${n}` }))
  await userEvent.click(screen.getByRole('option', { name: option }))
}

beforeEach(() => {
  mappingSpy.mockClear()
  upsertSpy.mockClear()
  toastSpy.mockClear()
  toastSpy.success.mockClear()
  toastSpy.error.mockClear()
  setAdmins([])
  rolesRef.pending = false
})

describe('<RolesCard> layout', () => {
  it('is always open, titled Roles, with a subtitle naming the provider and no Save at rest', () => {
    renderCard(makeProvider({ claimMapping: TWO_RULES }))
    expect(screen.getByRole('heading', { name: 'Roles' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'The role each person gets when they sign in with Acme ID. Checked from the top; the first match wins.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { expanded: false })).not.toBeInTheDocument()
    expect(ruleRows()).toHaveLength(2)
    expect(saveButton()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('chooses the shared claim once, above the rules, and keeps each rule on one line', () => {
    renderCard(makeProvider({ claimMapping: TWO_RULES }))
    const claim = screen.getByRole('combobox', { name: 'Claim to check' })
    expect(claim).toHaveTextContent('groups')
    expect(screen.getByRole('list', { name: 'Role rules' })).not.toContainElement(claim)
    expect(screen.getAllByRole('combobox', { name: 'Claim to check' })).toHaveLength(1)

    const [first, second] = ruleRows()
    expect(first).toHaveTextContent(/^1\s*If\s*groups\s*contains\s*admins\s*→\s*Admin/)
    expect(second).toHaveTextContent(/^2\s*If\s*groups\s*contains\s*support\s*→\s*Member/)
    // One line from the number to Remove: the sentence and its actions share a
    // row that does not wrap at the card's width.
    for (const [row, n] of [
      [first!, 1],
      [second!, 2],
    ] as const) {
      const sentence = within(row).getByTestId('rule-sentence')
      expect(sentence.className).toMatch(/sm:flex-nowrap/)
      for (const name of [`Value for rule ${n}`, `Role for rule ${n}`]) {
        expect(sentence).toContainElement(within(row).getByRole('combobox', { name }))
      }
      for (const name of [`Move rule ${n} up`, `Move rule ${n} down`, `Remove rule ${n}`]) {
        expect(sentence).toContainElement(within(row).getByRole('button', { name }))
      }
    }
  })

  it('keeps focus styles neutral on every control it adds', () => {
    renderCard(makeProvider({ claimMapping: TWO_RULES }))
    for (const name of [
      'Role for rule 1',
      'Role for rule 2',
      'Role for people at a verified domain',
    ]) {
      const trigger = screen.getByRole('combobox', { name })
      expect(trigger.className).toMatch(/focus:border-muted-foreground/)
    }
    const buttons = [
      screen.getByRole('combobox', { name: 'Claim to check' }),
      screen.getByRole('combobox', { name: 'Value for rule 1' }),
      screen.getByRole('button', { name: 'Move rule 1 up' }),
      screen.getByRole('button', { name: 'Move rule 1 down' }),
      screen.getByRole('button', { name: 'Remove rule 1' }),
      screen.getByRole('button', { name: 'Add rule' }),
    ]
    for (const el of buttons) expect(el.className).toMatch(/focus-visible:ring-muted-foreground/)
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule 2' }))
    for (const name of ['Cancel', 'Save changes']) {
      expect(screen.getByRole('button', { name }).className).toMatch(
        /focus-visible:ring-muted-foreground/
      )
    }
  })

  it('shows the empty state when there are no rules', () => {
    renderCard(makeProvider())
    expect(
      screen.getByText(
        'No rules yet. Everyone gets the roles below. Add a rule to give a role based on a claim such as groups.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Role rules' })).not.toBeInTheDocument()
  })

  it('says roles are not applied while account creation is off', () => {
    renderCard(makeProvider({ autoCreateUsers: false }))
    expect(
      screen.getByText(
        'Account creation is off in Sign-in & access, so these roles are not applied.'
      )
    ).toBeInTheDocument()
  })
})

describe('<RolesCard> editing rules', () => {
  it('adds, reorders and removes rules, then saves them as operations', async () => {
    renderCard(makeProvider({ claimMapping: TWO_RULES }))
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(ruleRows()).toHaveLength(3)
    await typeValue(3, 'contractors')
    await pickRole(3, 'Portal user')
    // Keyboard-reachable reordering: move the new rule to the top.
    expect(screen.getByRole('button', { name: 'Move rule 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move rule 3 down' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Move rule 3 up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move rule 2 up' }))
    expect(ruleRows()[0]).toHaveTextContent('contractors')
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule 3' }))
    expect(ruleRows()).toHaveLength(2)

    save()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastSaved()?.role?.rules).toEqual([
      { whenContains: 'contractors', role: 'user' },
      { whenContains: 'admins', role: 'admin' },
    ])
    // The admin rule was already stored, so it is acknowledged, not re-confirmed.
    expect(lastMapping().acknowledgeAdminRules).toBe(true)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('Cancel drops the edits and hides the buttons', () => {
    renderCard(makeProvider({ claimMapping: TWO_RULES }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule 1' }))
    expect(ruleRows()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(ruleRows()).toHaveLength(2)
    expect(saveButton()).not.toBeInTheDocument()
  })

  it('asks before saving a new admin rule', async () => {
    renderCard(makeProvider())
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    await typeValue(1, 'platform-admins')
    await pickRole(1, 'Admin')
    save()
    const confirm = screen.getByRole('alertdialog')
    expect(confirm).toHaveTextContent('A rule grants admin access.')
    expect(mappingSpy).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().acknowledgeAdminRules).toBe(true)
    expect(lastSaved()?.role).toEqual({
      claimPath: 'groups',
      rules: [{ whenContains: 'platform-admins', role: 'admin' }],
    })
  })

  it('will not save a rule with no value', () => {
    renderCard(makeProvider())
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(saveButton()).toBeDisabled()
    expect(screen.getByText('Each rule needs a claim and a value.')).toBeInTheDocument()
  })

  it('offers custom roles beside the presets and saves one on the member tier', async () => {
    renderCard(makeProvider(), [SUPPORT_ROLE])
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    await typeValue(1, 'support')
    await userEvent.click(screen.getByRole('combobox', { name: 'Role for rule 1' }))
    expect(screen.getByText('Presets')).toBeInTheDocument()
    expect(screen.getByText('Custom roles')).toBeInTheDocument()
    for (const preset of ['Admin', 'Member', 'Portal user']) {
      expect(screen.getByRole('option', { name: preset })).toBeInTheDocument()
    }
    await userEvent.click(screen.getByRole('option', { name: 'Support' }))
    expect(screen.getByRole('combobox', { name: 'Role for rule 1' })).toHaveTextContent('Support')
    save()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().operations).toContainEqual(
      expect.objectContaining({
        op: 'insertRoleRule',
        rule: { whenContains: 'support', role: 'member', roleId: SUPPORT_ROLE_ID },
      })
    )
  })
})

describe('<RolesCard> custom role grants', () => {
  const OPS_ROLE = {
    ...SUPPORT_ROLE,
    id: generateId('role'),
    key: 'ops',
    name: 'Ops admin',
    permissionKeys: [PERMISSIONS.SETTINGS_MANAGE],
  }

  it('acknowledges a stored rule whose custom role reaches admin level', async () => {
    renderCard(
      makeProvider({
        claimMapping: {
          role: {
            claimPath: 'groups',
            rules: [{ whenContains: 'ops', role: 'member', roleId: OPS_ROLE.id }],
          },
        },
      }),
      [OPS_ROLE]
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    await typeValue(2, 'support')
    save()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().acknowledgeAdminRules).toBe(true)
  })

  it('confirms a new rule whose custom role reaches admin level', async () => {
    renderCard(makeProvider(), [OPS_ROLE])
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    await typeValue(1, 'ops')
    await pickRole(1, 'Ops admin')
    save()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('A rule grants admin access.')
  })

  it.each([
    [
      'ROLE_RULE_UNKNOWN_ROLE',
      'A role rule names a role that no longer exists. Pick another role.',
      'This role no longer exists. Pick another role.',
    ],
    [
      'GRANT_CEILING',
      "You can't grant permissions you don't hold: settings.manage",
      "You can't give this role: it has permissions you don't hold.",
    ],
  ])('shows a %s refusal on the rule that caused it', async (code, serverMessage, shown) => {
    mappingSpy.mockRejectedValueOnce(Object.assign(new Error(serverMessage), { code }))
    renderCard(makeProvider({ claimMapping: TWO_RULES }), [SUPPORT_ROLE])
    await pickRole(2, 'Support')
    save()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    const [first, second] = ruleRows()
    expect(await within(second!).findByRole('alert')).toHaveTextContent(shown)
    expect(within(first!).queryByRole('alert')).toBeNull()
    expect(toastSpy.error).not.toHaveBeenCalled()
    // Picking another role clears it.
    await pickRole(2, 'Member')
    expect(within(second!).queryByRole('alert')).toBeNull()
  })

  it('falls back to a plain message for an untyped refusal', async () => {
    mappingSpy.mockRejectedValueOnce(new Error('Something went wrong.'))
    renderCard(makeProvider({ claimMapping: TWO_RULES }), [SUPPORT_ROLE])
    await pickRole(2, 'Support')
    save()
    await waitFor(() => expect(toastSpy.error).toHaveBeenCalledWith('Something went wrong.'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('<RolesCard> rules naming a missing role', () => {
  const GONE_ID = generateId('role')
  const GONE_RULES = {
    role: {
      claimPath: 'groups',
      rules: [
        { whenContains: 'ops', role: 'member' as const, roleId: GONE_ID },
        { whenContains: 'support', role: 'member' as const },
      ],
    },
  }
  const NOTE = 'Role no longer exists. This rule changes nothing until you pick another role.'

  it('warns on the rule and still saves unrelated edits', async () => {
    renderCard(makeProvider({ claimMapping: GONE_RULES }), [SUPPORT_ROLE])
    const [first, second] = ruleRows()
    expect(first).toHaveTextContent(NOTE)
    expect(within(first!).getByText(NOTE).className).toMatch(/text-warning/)
    expect(second).not.toHaveTextContent(NOTE)
    expect(within(first!).getByRole('combobox', { name: 'Role for rule 1' })).toHaveTextContent(
      'Missing role'
    )
    await typeValue(2, 'helpdesk')
    expect(saveButton()).not.toBeDisabled()
    save()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
  })

  it('will not save once the admin edits that rule without picking another role', async () => {
    renderCard(makeProvider({ claimMapping: GONE_RULES }), [SUPPORT_ROLE])
    await typeValue(1, 'operations')
    expect(saveButton()).toBeDisabled()
    expect(
      screen.getByText('Pick a role that exists for the rules you changed.')
    ).toBeInTheDocument()
    await pickRole(1, 'Support')
    expect(saveButton()).not.toBeDisabled()
    expect(ruleRows()[0]).not.toHaveTextContent(NOTE)
  })

  it('does not count a missing role against the caller: it changes nothing', async () => {
    setAdmins([SAM])
    const withAdminRule = {
      role: {
        ...GONE_RULES.role,
        rules: [...GONE_RULES.role.rules, { whenContains: 'admins', role: 'admin' as const }],
      },
    }
    renderCard(makeProvider({ claimMapping: withAdminRule, lastTestCapture: capture(['ops']) }), [
      SUPPORT_ROLE,
    ])
    await userEvent.click(screen.getByRole('radio', { name: /^Every sign-in/ }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(saveButton()).not.toBeDisabled()
  })
})

describe('<RolesCard> last test sign-in', () => {
  it('offers the values the last test sign-in sent', async () => {
    renderCard(
      makeProvider({ claimMapping: TWO_RULES, lastTestCapture: capture(['support', 'ops']) })
    )
    expect(screen.getByText(/Values seen in the last test sign-in/)).toHaveTextContent(
      /support\s*ops/
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'Value for rule 2' }))
    expect(screen.getByRole('option', { name: 'ops' })).toBeInTheDocument()
  })

  it('marks each rule the test person matches, the first match highlighted', () => {
    renderCard(
      makeProvider({ claimMapping: TWO_RULES, lastTestCapture: capture(['admins', 'support']) })
    )
    const [first, second] = ruleRows()
    expect(first).toHaveTextContent('Matches Sam Lee in the last test sign-in')
    expect(second).toHaveTextContent('Matches Sam Lee in the last test sign-in')
    expect(first!.className).toMatch(/border-success/)
    expect(second!.className).not.toMatch(/border-success/)
  })

  it('says nothing on a rule the test person does not match', () => {
    renderCard(makeProvider({ claimMapping: TWO_RULES, lastTestCapture: capture(['support']) }))
    const [first, second] = ruleRows()
    expect(first).not.toHaveTextContent(/Matches/)
    expect(second).toHaveTextContent('Matches Sam Lee in the last test sign-in')
  })
})

describe('<RolesCard> last test sign-in, more', () => {
  it('offers the value of a single-valued claim too', async () => {
    const scalar = capture([])
    const claims = { ...scalar.claims, groups: 'support' }
    renderCard(
      makeProvider({
        claimMapping: TWO_RULES,
        lastTestCapture: {
          ...scalar,
          claims,
          replay: { sources: [{ source: 'idToken', claims }, scalar.replay!.sources[1]!] },
        } as SsoTestCapture,
      })
    )
    expect(screen.getByText(/Values seen in the last test sign-in/)).toHaveTextContent('support')
    await userEvent.click(screen.getByRole('combobox', { name: 'Value for rule 1' }))
    expect(screen.getByRole('option', { name: 'support' })).toBeInTheDocument()
  })

  it('highlights by the rule’s place in the list, skipping one sign-in cannot read', () => {
    renderCard(
      makeProvider({
        claimMapping: {
          role: {
            claimPath: 'groups',
            rules: [
              // A role id on the admin tier is unreadable: sign-in skips this rule.
              { whenContains: 'support', role: 'admin', roleId: generateId('role') },
              { whenContains: 'support', role: 'member' },
            ],
          },
        } as IdentityProvider['claimMapping'],
        lastTestCapture: capture(['support']),
      })
    )
    const [first, second] = ruleRows()
    expect(first!.className).not.toMatch(/border-success/)
    expect(second!.className).toMatch(/border-success/)
  })
})

describe('<RolesCard> otherwise', () => {
  it('names the verified domains and shows the real default, Member when never saved', () => {
    renderCard(makeProvider({ domains: [acmeDomain], autoProvisionRole: null }))
    expect(screen.getByText(/People with an email at/)).toHaveTextContent(
      'People with an email at acme.com'
    )
    expect(
      screen.getByRole('combobox', { name: 'Role for people at a verified domain' })
    ).toHaveTextContent('Member')
    expect(screen.getByText('Everyone else')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Portal users can post, vote and comment, with no access to the team workspace.'
      )
    ).toBeInTheDocument()
    expect(saveButton()).not.toBeInTheDocument()
  })

  it('points at Sign-in & access when the provider has no verified domain', () => {
    renderCard(makeProvider({ domains: [{ ...acmeDomain, verifiedAt: null }] }))
    expect(screen.getByText('People at a verified domain')).toBeInTheDocument()
    expect(screen.queryByText(/People with an email at/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add one in Sign-in & access' })).toHaveAttribute(
      'href',
      '#signin'
    )
    expect(screen.getByText(/Until then, only rules give team roles/)).toBeInTheDocument()
  })

  it('saves the default role as a provider patch and nothing else', async () => {
    renderCard(makeProvider({ domains: [acmeDomain], autoProvisionRole: 'user' }))
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Role for people at a verified domain' })
    )
    await userEvent.click(screen.getByRole('option', { name: 'Member' }))
    save()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(upsertSpy.mock.calls.at(-1)![0].data).toMatchObject({
      id: 'idp_x',
      autoProvisionRole: 'member',
    })
    expect(upsertSpy.mock.calls.at(-1)![0].data).not.toHaveProperty('autoCreateUsers')
    expect(mappingSpy).not.toHaveBeenCalled()
  })

  it('one Save writes both the rules and the default role', async () => {
    renderCard(makeProvider({ domains: [acmeDomain], claimMapping: TWO_RULES }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule 2' }))
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Role for people at a verified domain' })
    )
    await userEvent.click(screen.getByRole('option', { name: 'Portal user' }))
    save()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastMapping().operations).toEqual([{ op: 'removeRoleRule', index: 1 }])
    expect(upsertSpy.mock.calls.at(-1)![0].data).toMatchObject({ autoProvisionRole: 'user' })
    // One toast for one Save.
    expect(toastSpy.success).toHaveBeenCalledTimes(1)
  })
})

describe('<RolesCard> when roles are applied', () => {
  const firstOnly = () => screen.getByRole('radio', { name: /^First sign-in only/ })
  const every = () => screen.getByRole('radio', { name: /^Every sign-in/ })

  it('reads syncOnEverySignIn and explains both choices', () => {
    renderCard(
      makeProvider({ claimMapping: { role: { ...TWO_RULES.role, syncOnEverySignIn: true } } })
    )
    expect(every()).toBeChecked()
    expect(firstOnly()).not.toBeChecked()
    expect(firstOnly()).toHaveAccessibleDescription(
      'Gives a role the first time someone signs in or matches a rule. Never removes a role.'
    )
    expect(every()).toHaveAccessibleDescription(
      'Keeps roles in step with Acme ID. Someone who stops matching loses their team role at their next sign-in.'
    )
  })

  it('saves Every sign-in as syncOnEverySignIn', async () => {
    renderCard(makeProvider({ claimMapping: TWO_RULES }))
    expect(firstOnly()).toBeChecked()
    await userEvent.click(every())
    save()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().operations).toEqual([{ op: 'setRoleSync', syncOnEverySignIn: true }])
    expect(lastSaved()?.role?.syncOnEverySignIn).toBe(true)
  })

  it('saves First sign-in only by dropping the sync flag', async () => {
    renderCard(
      makeProvider({ claimMapping: { role: { ...TWO_RULES.role, syncOnEverySignIn: true } } })
    )
    await userEvent.click(firstOnly())
    save()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().operations).toEqual([{ op: 'setRoleSync', syncOnEverySignIn: false }])
  })
})

describe('<RolesCard> lockout guard', () => {
  const chooseEvery = () => userEvent.click(screen.getByRole('radio', { name: /^Every sign-in/ }))
  const NON_ADMIN_RULES = {
    role: { claimPath: 'groups', rules: [{ whenContains: 'support', role: 'member' as const }] },
  }
  const ANA = {
    principalId: 'principal_ana',
    name: 'Ana Diaz',
    email: 'ana@acme.com',
    role: 'admin',
    adminTier: true,
    canManageSso: true,
    atVerifiedDomain: true,
    isCaller: false,
  }
  const lostList = () => screen.getByRole('list', { name: 'Admins who would lose access' })

  it('blocks Every sign-in when no rule gives Admin, naming everyone it would demote', async () => {
    setAdmins([SAM, ANA])
    renderCard(makeProvider({ domains: [acmeDomain], claimMapping: NON_ADMIN_RULES }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await chooseEvery()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('This would remove admin access from 2 people, including you.')
    expect(alert).toHaveTextContent(
      'They sign in with Acme ID and no rule gives Admin. Add a rule that gives Admin, or keep “First sign-in only”.'
    )
    expect(
      within(lostList())
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual(['Sam Lee (you)', 'Ana Diaz'])
    expect(saveButton()).toBeDisabled()
    fireEvent.click(saveButton()!)
    expect(mappingSpy).not.toHaveBeenCalled()
    // Going back clears it.
    await userEvent.click(screen.getByRole('radio', { name: /^First sign-in only/ }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('leaves out "including you" when the caller does not sign in with this provider', async () => {
    setAdmins([ANA])
    renderCard(makeProvider({ claimMapping: NON_ADMIN_RULES }))
    await chooseEvery()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This would remove admin access from 1 person.'
    )
    expect(screen.getByRole('alert')).not.toHaveTextContent(/including you/)
  })

  it('says "from you" when the caller is the only one', async () => {
    setAdmins([SAM])
    renderCard(makeProvider({ claimMapping: NON_ADMIN_RULES }))
    await chooseEvery()
    expect(screen.getByRole('alert')).toHaveTextContent('This would remove admin access from you.')
  })

  it('only warns when a rule gives Admin, since who matches it is unknown', async () => {
    setAdmins([SAM, ANA])
    renderCard(makeProvider({ claimMapping: TWO_RULES }))
    await chooseEvery()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 admins sign in with Acme ID. Make sure each one matches a rule that gives Admin, or they lose admin access at their next sign-in.'
    )
    expect(saveButton()).not.toBeDisabled()
  })

  it('counts a rule giving a custom role that manages sign-in as keeping access', async () => {
    const opsRole = {
      ...SUPPORT_ROLE,
      id: generateId('role'),
      name: 'Ops admin',
      permissionKeys: [PERMISSIONS.AUTH_MANAGE],
    }
    setAdmins([ANA])
    renderCard(
      makeProvider({
        claimMapping: {
          role: {
            claimPath: 'groups',
            rules: [{ whenContains: 'ops', role: 'member', roleId: opsRole.id }],
          },
        },
      }),
      [opsRole]
    )
    await chooseEvery()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 admin signs in with Acme ID.')
  })

  it('blocks when the caller’s own test sign-in matches only a non-admin rule', async () => {
    setAdmins([SAM, ANA])
    renderCard(
      makeProvider({
        domains: [acmeDomain],
        claimMapping: TWO_RULES,
        lastTestCapture: capture(['support']),
      })
    )
    await chooseEvery()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('This would remove admin access from you.')
    expect(alert).toHaveTextContent('You sign in with Acme ID and no rule gives you Admin.')
    expect(saveButton()).toBeDisabled()
  })

  it('does not block when the caller’s own test sign-in matches the Admin rule', async () => {
    setAdmins([SAM])
    renderCard(
      makeProvider({
        domains: [acmeDomain],
        claimMapping: TWO_RULES,
        lastTestCapture: capture(['admins']),
      })
    )
    await chooseEvery()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(saveButton()).not.toBeDisabled()
  })

  it('stays quiet when nobody with admin access signs in with this provider', async () => {
    setAdmins([])
    renderCard(makeProvider({ claimMapping: NON_ADMIN_RULES }))
    await chooseEvery()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(saveButton()).not.toBeDisabled()
  })

  it('stays quiet when the default role is Admin', async () => {
    setAdmins([SAM])
    renderCard(makeProvider({ domains: [acmeDomain], autoProvisionRole: 'admin' }))
    await chooseEvery()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('leaves out people off the verified domains: with no matching rule sign-in leaves them alone', async () => {
    setAdmins([SAM, { ...ANA, atVerifiedDomain: false }])
    renderCard(makeProvider({ domains: [acmeDomain], claimMapping: NON_ADMIN_RULES }))
    await chooseEvery()
    expect(screen.getByRole('alert')).toHaveTextContent('This would remove admin access from you.')
    expect(
      within(lostList())
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual(['Sam Lee (you)'])
  })

  it('stays quiet when everyone who manages sign-in is off the verified domains', async () => {
    setAdmins([{ ...SAM, atVerifiedDomain: false }])
    renderCard(makeProvider({ claimMapping: NON_ADMIN_RULES }))
    await chooseEvery()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(saveButton()).not.toBeDisabled()
  })

  it('ignores teammates who cannot manage sign-in, even at admin level', async () => {
    setAdmins([{ ...ANA, role: 'member', canManageSso: false }])
    renderCard(makeProvider({ claimMapping: NON_ADMIN_RULES }))
    await chooseEvery()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not count a custom role without sign-in management as keeping access', async () => {
    const reportsRole = {
      ...SUPPORT_ROLE,
      id: generateId('role'),
      name: 'Settings admin',
      permissionKeys: [PERMISSIONS.SETTINGS_MANAGE],
    }
    setAdmins([ANA])
    renderCard(
      makeProvider({
        claimMapping: {
          role: {
            claimPath: 'groups',
            rules: [{ whenContains: 'ops', role: 'member', roleId: reportsRole.id }],
          },
        },
      }),
      [reportsRole]
    )
    await chooseEvery()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This would remove admin access from 1 person.'
    )
  })

  it('fails closed when the admin list cannot be read, with a Retry', async () => {
    const refetch = vi.fn()
    adminsRef.current = { isPending: false, isError: true, data: undefined, refetch }
    renderCard(makeProvider({ claimMapping: TWO_RULES }))
    await chooseEvery()
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't check which admins sign in with Acme ID. Try again."
    )
    expect(saveButton()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalled()
  })

  it.each([
    ['a typed refusal', Object.assign(new Error('Refused'), { code: 'SYNC_LOCKOUT' })],
    ['a refusal whose code only survives in the message', new Error('SYNC_LOCKOUT: refused')],
  ])('shows the server lockout refusal inline for %s', async (_name, error) => {
    mappingSpy.mockRejectedValueOnce(error)
    renderCard(makeProvider({ claimMapping: TWO_RULES }))
    await chooseEvery()
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saving this would remove admin access from people who sign in with Acme ID. Add a rule that gives Admin, or keep “First sign-in only”.'
    )
    expect(toastSpy.error).not.toHaveBeenCalled()
    // Any edit clears it.
    await userEvent.click(screen.getByRole('radio', { name: /^First sign-in only/ }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('warns, without blocking, about admins off the verified domains who could match a non-admin rule', async () => {
    setAdmins([
      { ...SAM, atVerifiedDomain: false },
      { ...ANA, atVerifiedDomain: false },
    ])
    renderCard(makeProvider({ claimMapping: NON_ADMIN_RULES }))
    await chooseEvery()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 admins outside your verified domains sign in with Acme ID. If one matches a rule that does not give Admin, they lose admin access at their next sign-in.'
    )
    expect(screen.queryByRole('list', { name: 'Admins who would lose access' })).toBeNull()
    expect(saveButton()).not.toBeDisabled()
  })

  it('shows the off-domain warning beside a block for those at a verified domain', async () => {
    setAdmins([SAM, { ...ANA, atVerifiedDomain: false }])
    renderCard(makeProvider({ domains: [acmeDomain], claimMapping: NON_ADMIN_RULES }))
    await chooseEvery()
    expect(screen.getByRole('alert')).toHaveTextContent('This would remove admin access from you.')
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 admin outside your verified domains signs in with Acme ID.'
    )
  })

  it('keeps the off-domain warning quiet with no non-admin rule or nobody off-domain', async () => {
    setAdmins([{ ...SAM, atVerifiedDomain: false }])
    const { unmount } = renderCard(makeProvider({ claimMapping: null }))
    await chooseEvery()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    unmount()
    setAdmins([SAM])
    renderCard(makeProvider({ domains: [acmeDomain], claimMapping: NON_ADMIN_RULES }))
    await chooseEvery()
    expect(screen.queryByText(/outside your verified domains/)).not.toBeInTheDocument()
  })

  it('holds Save while the admin check loads', async () => {
    adminsRef.current = { isPending: true, isError: false, data: undefined, refetch: vi.fn() }
    renderCard(makeProvider({ claimMapping: NON_ADMIN_RULES }))
    await chooseEvery()
    expect(saveButton()).toBeDisabled()
    expect(screen.getByText('Checking admins…')).toBeInTheDocument()
  })
})

describe('<RolesCard> role list', () => {
  it('holds Save with a quiet note until the role list loads, so an admin-level role is always confirmed', async () => {
    rolesRef.pending = true
    renderCard(makeProvider({ claimMapping: TWO_RULES }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule 2' }))
    expect(screen.getByText('Loading roles…')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })
})
