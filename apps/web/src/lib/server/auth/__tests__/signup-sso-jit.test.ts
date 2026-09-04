/**
 * An identity provider's own callback, creating the account it was configured
 * to create.
 *
 * `guardBetterAuthUserCreation` is `databaseHooks.user.create.before`, so every
 * account Better-Auth creates passes through it, including the one an OIDC
 * callback creates for an employee signing in for the first time. It asked the
 * public portal's question about all of them. A workspace whose portal is
 * closed to the public — the ordinary shape for a workspace that invites its
 * team by hand — therefore refused its own employees at the IdP its
 * administrator configured, and the refusal lands as `unable_to_create_user`
 * with nothing to tell anybody why.
 *
 * The compensating half cannot help: `handleAutoProvisionAfter` runs in
 * `hooks.after`, which is downstream of the abort, so it never sees a user who
 * was refused.
 *
 * ## Why a path may decide this when a request body may not
 *
 * The policy's standing rule is that no flag on a request may buy an
 * exemption, because a field the caller chooses is a field an attacker
 * chooses. `ctx.path` is not that: it is the endpoint template Better-Auth
 * routed to, and reaching `/oauth2/callback/:providerId` means the provider's
 * token exchange completed. `ctx.params.providerId` is the concrete provider
 * whose callback ran, filled in by the router from the URL it matched, and the
 * facts consulted about it are rows an administrator wrote.
 *
 * ## The scope, asserted from four sides
 *
 * The exemption is the same pair of facts `handleAutoProvisionAfter` decides
 * its default-role promotion on, read off the same row: the callback
 * provider's `autoCreateUsers`, and a verified domain of THAT provider
 * matching the address. Each of the cases below removes exactly one of those
 * and expects the refusal back, so the exemption cannot be standing in for
 * "any OIDC callback" or "any provider" or "any address".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'

const hoisted = vi.hoisted(() => ({
  getWorkspaceSettings: vi.fn(),
  userFindFirst: vi.fn(),
  invitationFindFirst: vi.fn(),
  findHumanAdmin: vi.fn(),
  isOpenToBootstrapClaim: vi.fn(),
  listIdentityProviders: vi.fn(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      user: { findFirst: (...a: unknown[]) => hoisted.userFindFirst(...a) },
      invitation: { findFirst: (...a: unknown[]) => hoisted.invitationFindFirst(...a) },
    },
  },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.getWorkspaceSettings,
}))

vi.mock('@/lib/server/domains/principals/bootstrap-admin', () => ({
  findHumanAdmin: (...a: unknown[]) => hoisted.findHumanAdmin(...a),
  isOpenToBootstrapClaim: (...a: unknown[]) => hoisted.isOpenToBootstrapClaim(...a),
}))

vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: (...a: unknown[]) => hoisted.listIdentityProviders(...a),
}))

// `findProviderForDomainEmail` stays REAL: it is the domain match the whole
// exemption turns on, and a stub for it could not tell a verified domain from
// an unverified one.
const { guardBetterAuthUserCreation } = await import('../signup-policy')

const OIDC_CALLBACK = '/oauth2/callback/:providerId'
// A real TLD, because `normalizeDomain` rejects the RFC 6761 reserved
// suffixes (`.example`, `.test`, `.invalid`, `.localhost`) — a verified domain
// under one of those can never match anything.
const EMPLOYEE = 'bob@acme.com'

function makeProvider(overrides: Partial<IdentityProvider> = {}): IdentityProvider {
  return {
    id: 'idp_acme' as IdentityProvider['id'],
    registrationId: 'acme-idp',
    label: 'Acme IdP',
    kind: 'okta',
    discoveryUrl: 'https://idp.acme.example/.well-known/openid-configuration',
    authorizationUrl: null,
    tokenUrl: null,
    userInfoUrl: null,
    jwksUri: null,
    issuer: null,
    clientId: 'cid',
    scopes: null,
    prompt: null,
    tokenEndpointAuthMethod: null,
    enabled: true,
    configured: true,
    autoCreateUsers: true,
    autoProvisionRole: 'member',
    claimMapping: null,
    showButton: false,
    logoKey: null,
    logoUrl: null,
    detailsChangedAt: null,
    lastSuccessfulTestAt: null,
    lastTestCapture: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    domains: [
      {
        id: 'domain_acme' as `domain_${string}`,
        name: 'acme.com',
        verificationToken: 'tok',
        verifiedAt: '2026-01-01T00:00:00.000Z',
        enforced: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    visibility: 'routed',
    ...overrides,
  }
}

/**
 * `undefined` carries on. A refusal has two shapes and both count: `false` is
 * Better-Auth's abort signal, and a thrown `FORBIDDEN` is what the one-time-code
 * redemption gets instead because that endpoint dereferences the abort.
 */
async function creationAllowed(
  email: string,
  ctx: { path?: string; params?: Record<string, unknown> }
): Promise<boolean> {
  try {
    return (await guardBetterAuthUserCreation({ email }, ctx)) === undefined
  } catch (err) {
    expect((err as { body?: { code?: string } }).body?.code).toBe('signup_not_allowed')
    return false
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // A workspace whose team AND portal are both closed to self-service signup:
  // no `openSignup` answer can let this employee in, so anything that does is
  // the SSO exemption and nothing else.
  hoisted.getWorkspaceSettings.mockResolvedValue({
    authConfig: { openSignup: false },
    portalConfig: { openSignup: false },
  })
  hoisted.userFindFirst.mockResolvedValue(null)
  hoisted.invitationFindFirst.mockResolvedValue(null)
  hoisted.findHumanAdmin.mockResolvedValue({ id: 'principal_owner' })
  hoisted.isOpenToBootstrapClaim.mockResolvedValue(false)
  hoisted.listIdentityProviders.mockResolvedValue([makeProvider()])
})

describe('an IdP configured to create users, on its own callback', () => {
  it('lets the employee through', async () => {
    expect(
      await creationAllowed(EMPLOYEE, { path: OIDC_CALLBACK, params: { providerId: 'acme-idp' } })
    ).toBe(true)
  })

  // The control for every refusal below: with no provider row at all, the same
  // address on the same callback is refused. So the cases that expect `false`
  // are observing the scope of the exemption, not its absence.
  it('refuses the same employee when no provider is configured', async () => {
    hoisted.listIdentityProviders.mockResolvedValue([])

    expect(
      await creationAllowed(EMPLOYEE, { path: OIDC_CALLBACK, params: { providerId: 'acme-idp' } })
    ).toBe(false)
  })

  it('refuses when the administrator turned auto-creation off', async () => {
    hoisted.listIdentityProviders.mockResolvedValue([makeProvider({ autoCreateUsers: false })])

    expect(
      await creationAllowed(EMPLOYEE, { path: OIDC_CALLBACK, params: { providerId: 'acme-idp' } })
    ).toBe(false)
  })

  it('refuses an address outside the verified domains of that provider', async () => {
    expect(
      await creationAllowed('stranger@evil.com', {
        path: OIDC_CALLBACK,
        params: { providerId: 'acme-idp' },
      })
    ).toBe(false)
  })

  // A domain row that was never verified is a claim somebody typed, not a
  // domain anybody proved. The real `findProviderForDomainEmail` is what
  // enforces this, which is why it is not stubbed.
  it('refuses at a domain that was never verified', async () => {
    hoisted.listIdentityProviders.mockResolvedValue([
      makeProvider({
        domains: [
          {
            id: 'domain_acme' as `domain_${string}`,
            name: 'acme.com',
            verificationToken: 'tok',
            verifiedAt: null,
            enforced: false,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    ])

    expect(
      await creationAllowed(EMPLOYEE, { path: OIDC_CALLBACK, params: { providerId: 'acme-idp' } })
    ).toBe(false)
  })

  // Provider-scoped, exactly as `handleAutoProvisionAfter` is: a sign-in via
  // provider X only provisions when the address is at one of X's own verified
  // domains, so a gate that answered off any provider's domains would admit
  // accounts the promoter then declines to provision.
  it('refuses when a DIFFERENT provider owns the domain', async () => {
    hoisted.listIdentityProviders.mockResolvedValue([
      makeProvider(),
      makeProvider({
        id: 'idp_other' as IdentityProvider['id'],
        registrationId: 'other-idp',
        domains: [],
      }),
    ])

    expect(
      await creationAllowed(EMPLOYEE, { path: OIDC_CALLBACK, params: { providerId: 'other-idp' } })
    ).toBe(false)
  })

  // The exemption must not leak onto the portal's own doors. Same workspace,
  // same provider, same address, arriving by one-time code instead.
  it('refuses the same employee arriving by email instead', async () => {
    expect(await creationAllowed(EMPLOYEE, { path: '/sign-in/email-otp' })).toBe(false)
  })

  // No path at all is the shape a direct call carries. It must not be treated
  // as a callback.
  it('refuses when no endpoint is named', async () => {
    expect(await creationAllowed(EMPLOYEE, {})).toBe(false)
  })

  // The provider registry is only worth reading on the one path that can use
  // it; the portal doors must not pay for a lookup they never consult.
  it('does not read the provider registry on a portal door', async () => {
    await creationAllowed(EMPLOYEE, { path: '/sign-in/email-otp' })

    expect(hoisted.listIdentityProviders).not.toHaveBeenCalled()
  })
})
