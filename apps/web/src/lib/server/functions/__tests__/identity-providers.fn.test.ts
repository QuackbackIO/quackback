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
import { createId } from '@quackback/ids'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const handlers: AnyHandler[] = []
/** Each handler's input schema, at the handler's index. */
const validators: Array<{ safeParse(input: unknown): { success: boolean } } | undefined> = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let schema: (typeof validators)[number]
    const chain = {
      validator(s: (typeof validators)[number]) {
        schema = s
        return chain
      },
      handler(fn: AnyHandler) {
        validators[handlers.length] = schema
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
  saveIdentityProviderClaimMapping: vi.fn(),
  listProviderAdmins: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/identity-provider-accounts', () => ({
  listProviderAdmins: hoisted.listProviderAdmins,
}))

vi.mock('@/lib/server/domains/roles/role.rule-grants', () => ({
  roleRuleGrantCheck: (granter: readonly string[]) => ({ granter }),
}))

vi.mock('@/lib/server/domains/settings/cloud/entitlements', () => ({
  requireEntitlement: vi.fn(async () => {}),
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
  saveIdentityProviderClaimMapping: hoisted.saveIdentityProviderClaimMapping,
  deleteIdentityProvider: vi.fn(),
  stampDetailsChanged: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({
    user: { id: 'user_admin1', email: 'admin@example.com' },
    principal: { id: 'principal_admin1', role: 'admin' },
    permissions: ['auth.manage', 'conversation.view'],
  })
  hoisted.listIdentityProviders.mockResolvedValue([])
  hoisted.upsertIdentityProvider.mockImplementation(async (input: { registrationId: string }) => ({
    id: 'idp_123',
    registrationId: input.registrationId,
  }))
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

const SAVE_MAPPING_INDEX = 5
const saveClaimMapping = handlers[SAVE_MAPPING_INDEX]

describe('role rules that grant a workspace role', () => {
  const roleId = createId('role')
  const op = (rule: Record<string, unknown>) => ({
    id: 'idp_01h455vb4pex5vsknk084sn02q',
    expectedClaimMapping: null,
    operations: [{ op: 'insertRoleRule', index: 0, rule }],
  })

  it('the mapping editor accepts a custom role on the member tier only', () => {
    const schema = validators[SAVE_MAPPING_INDEX]!
    expect(schema.safeParse(op({ whenContains: 's', role: 'member', roleId })).success).toBe(true)
    expect(schema.safeParse(op({ whenContains: 's', role: 'admin', roleId })).success).toBe(false)
    expect(
      schema.safeParse(op({ whenContains: 's', role: 'member', roleId: 'support' })).success
    ).toBe(false)
  })

  it('the whole-provider save accepts the same rule shape', () => {
    const schema = validators[UPSERT_INDEX]!
    const input = (rule: Record<string, unknown>) => ({
      registrationId: 'oidc_x',
      label: 'X',
      clientId: 'c',
      claimMapping: { role: { claimPath: 'groups', rules: [rule] } },
    })
    expect(schema.safeParse(input({ whenContains: 's', role: 'member', roleId })).success).toBe(
      true
    )
    expect(schema.safeParse(input({ whenContains: 's', role: 'user', roleId })).success).toBe(false)
  })

  it("both saves check grants against the saver's own permissions", async () => {
    hoisted.listIdentityProviders.mockResolvedValue([
      { id: 'idp_01h455vb4pex5vsknk084sn02q', registrationId: 'oidc_x', claimMapping: null },
    ])
    await saveClaimMapping!({ data: op({ whenContains: 's', role: 'member', roleId }) })
    expect(hoisted.saveIdentityProviderClaimMapping).toHaveBeenCalledWith(
      'idp_01h455vb4pex5vsknk084sn02q',
      expect.objectContaining({
        checkRoleGrants: { granter: ['auth.manage', 'conversation.view'] },
      })
    )

    await upsertIdentityProvider({ data: { registrationId: 'oidc_x', label: 'X', clientId: 'c' } })
    expect(hoisted.upsertIdentityProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        checkRoleGrants: { granter: ['auth.manage', 'conversation.view'] },
      })
    )
  })
})

describe('listProviderAdminsFn', () => {
  // Declared last in sso.ts (append-only ordering).
  const listProviderAdmins = handlers[handlers.length - 1]!

  it('is gated on auth.manage and names the caller', async () => {
    hoisted.requireAuth.mockRejectedValueOnce(new Error('FORBIDDEN'))
    await expect(
      listProviderAdmins({ data: { providerId: 'idp_01h455vb4pex5vsknk084sn02q' } })
    ).rejects.toThrow()
    expect(hoisted.listProviderAdmins).not.toHaveBeenCalled()

    const rows = [{ principalId: 'principal_admin1' }]
    hoisted.listProviderAdmins.mockResolvedValue(rows)
    const result = await listProviderAdmins({
      data: { providerId: 'idp_01h455vb4pex5vsknk084sn02q' },
    })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: 'auth.manage' })
    expect(hoisted.listProviderAdmins).toHaveBeenCalledWith(
      'idp_01h455vb4pex5vsknk084sn02q',
      'principal_admin1'
    )
    expect(result).toBe(rows)
  })

  it('accepts only an identity provider id', () => {
    const schema = validators[handlers.length - 1]!
    expect(schema.safeParse({ providerId: 'idp_01h455vb4pex5vsknk084sn02q' }).success).toBe(true)
    expect(schema.safeParse({ providerId: 'role_01h455vb4pex5vsknk084sn02q' }).success).toBe(false)
  })
})
