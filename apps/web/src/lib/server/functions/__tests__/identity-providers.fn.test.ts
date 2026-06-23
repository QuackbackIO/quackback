/**
 * Admin-gate + persistence wiring for the identity-provider server
 * functions (Task 15).
 *
 * Uses the same `createServerFn` capture pattern as the other
 * `functions/__tests__` suites: the builder is mocked so each registered
 * `.handler()` is pushed onto `handlers` in export order. The named
 * exports are the mocked chain objects, not callable handlers, so the
 * test drives the captured handler directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const handlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  listIdentityProviders: vi.fn(),
  upsertIdentityProvider: vi.fn(),
  mockAssertNotManaged: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: vi.fn(),
  actorFromAuth: (auth: { user: { id: string; email: string }; principal: { role: string } }) => ({
    userId: auth.user.id,
    email: auth.user.email,
    role: auth.principal.role,
  }),
  // Pass-through: run the wrapped mutation, ignore the audit spec.
  withAuditEvent: async (_spec: unknown, fn: () => Promise<unknown>) => fn(),
}))

vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: hoisted.listIdentityProviders,
  upsertIdentityProvider: hoisted.upsertIdentityProvider,
  deleteIdentityProvider: vi.fn(),
  stampDetailsChanged: vi.fn(),
}))

vi.mock('@/lib/server/config-file/managed-guard', () => ({
  assertNotManaged: hoisted.mockAssertNotManaged,
}))

// Use the real encoding logic so path assertions stay honest.
vi.mock('@/lib/server/config-file/managed-paths', () => ({
  providerPathKey: (label: string) => encodeURIComponent(label).replace(/\./g, '%2E'),
}))

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({
    user: { id: 'user_admin1', email: 'admin@example.com' },
    principal: { id: 'principal_admin1', role: 'admin' },
  })
  hoisted.listIdentityProviders.mockResolvedValue([])
  hoisted.upsertIdentityProvider.mockImplementation(async (input: { registrationId: string }) => ({
    id: 'idp_123',
    registrationId: input.registrationId,
  }))
  // Default: no managed paths — Fix 7 tests that need a lock override this.
  hoisted.mockAssertNotManaged.mockResolvedValue(undefined)
})

await import('../sso')
// Handler order mirrors the createServerFn export sequence in sso.ts. The
// identity-provider fns are appended after the 3 kept SSO/domain fns
// (clearSsoClientSecretFn, removeVerifiedDomainFn, getVerifiedDomainsFn),
// so listIdentityProvidersFn is index 3 and upsertIdentityProviderFn is
// index 4. If the file is reordered, fix this index along with the comment.
const UPSERT_INDEX = 4
const upsertIdentityProvider = handlers[UPSERT_INDEX]
if (typeof upsertIdentityProvider !== 'function') {
  throw new Error(
    `upsertIdentityProviderFn not at index ${UPSERT_INDEX} — found ${handlers.length} handlers`
  )
}

describe('upsertIdentityProviderFn', () => {
  it('rejects a non-admin (requireAuth throws) and never persists', async () => {
    hoisted.requireAuth.mockRejectedValueOnce(new Error('FORBIDDEN'))

    await expect(
      upsertIdentityProvider({ data: { registrationId: 'oidc_x', label: 'X', clientId: 'c' } })
    ).rejects.toThrow()

    expect(hoisted.upsertIdentityProvider).not.toHaveBeenCalled()
  })

  it('persists a provider for an admin', async () => {
    await upsertIdentityProvider({
      data: { registrationId: 'oidc_x', label: 'Acme', clientId: 'client-123', enabled: true },
    })

    expect(hoisted.upsertIdentityProvider).toHaveBeenCalledTimes(1)
    expect(hoisted.upsertIdentityProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        registrationId: 'oidc_x',
        label: 'Acme',
        clientId: 'client-123',
      })
    )
  })
})

describe('upsertIdentityProviderFn — managed-path guard (Fix 7)', () => {
  // providerPathKey('Acme IdP') = 'Acme%20IdP' (space → %20, no dots)
  const base = `auth.identityProviders.${encodeURIComponent('Acme IdP').replace(/\./g, '%2E')}`

  it('throws FIELD_MANAGED before upsert when discoveryUrl is locked for the provider', async () => {
    const { ForbiddenError } = await import('@/lib/shared/errors')
    hoisted.mockAssertNotManaged.mockImplementation(async (path: string) => {
      if (path === `${base}.discoveryUrl`) {
        throw new ForbiddenError('FIELD_MANAGED', `Field "${path}" is managed`)
      }
    })

    await expect(
      upsertIdentityProvider({
        data: {
          registrationId: 'oidc_x',
          label: 'Acme IdP',
          clientId: 'c',
          discoveryUrl: 'https://idp.example/.well-known/oidc',
        },
      })
    ).rejects.toMatchObject({ code: 'FIELD_MANAGED' })

    expect(hoisted.upsertIdentityProvider).not.toHaveBeenCalled()
  })

  it('throws FIELD_MANAGED before upsert when clientId is locked for the provider', async () => {
    const { ForbiddenError } = await import('@/lib/shared/errors')
    hoisted.mockAssertNotManaged.mockImplementation(async (path: string) => {
      if (path === `${base}.clientId`) {
        throw new ForbiddenError('FIELD_MANAGED', `Field "${path}" is managed`)
      }
    })

    await expect(
      upsertIdentityProvider({
        data: { registrationId: 'oidc_x', label: 'Acme IdP', clientId: 'new-c' },
      })
    ).rejects.toMatchObject({ code: 'FIELD_MANAGED' })

    expect(hoisted.upsertIdentityProvider).not.toHaveBeenCalled()
  })

  it('upserts fine when no paths are managed (unmanaged provider)', async () => {
    hoisted.mockAssertNotManaged.mockResolvedValue(undefined)

    await upsertIdentityProvider({
      data: { registrationId: 'oidc_x', label: 'Acme IdP', clientId: 'c' },
    })

    expect(hoisted.upsertIdentityProvider).toHaveBeenCalledTimes(1)
  })

  it('asserts discoveryUrl and clientId paths on every call', async () => {
    const assertedPaths: string[] = []
    hoisted.mockAssertNotManaged.mockImplementation(async (path: string) => {
      assertedPaths.push(path)
    })

    await upsertIdentityProvider({
      data: { registrationId: 'oidc_x', label: 'Acme IdP', clientId: 'c' },
    })

    expect(assertedPaths).toContain(`${base}.discoveryUrl`)
    expect(assertedPaths).toContain(`${base}.clientId`)
  })

  it('asserts enabled path only when data.enabled is present', async () => {
    const assertedPaths: string[] = []
    hoisted.mockAssertNotManaged.mockImplementation(async (path: string) => {
      assertedPaths.push(path)
    })

    // Without enabled in data — should NOT assert the enabled path.
    await upsertIdentityProvider({
      data: { registrationId: 'oidc_x', label: 'Acme IdP', clientId: 'c' },
    })
    expect(assertedPaths).not.toContain(`${base}.enabled`)

    // With enabled in data — SHOULD assert the enabled path.
    assertedPaths.length = 0
    await upsertIdentityProvider({
      data: { registrationId: 'oidc_x', label: 'Acme IdP', clientId: 'c', enabled: true },
    })
    expect(assertedPaths).toContain(`${base}.enabled`)
  })
})
