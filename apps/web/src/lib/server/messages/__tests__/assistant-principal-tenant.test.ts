/**
 * The assistant's principal id is a row in ONE workspace's database. Memoized
 * process-wide it becomes a foreign key another workspace writes onto its own
 * message rows — and, on the read side, the value every thread loader compares
 * against to decide whose turn is the assistant's.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  /** tenantId -> the principal that workspace's database holds, or null. */
  principals: new Map<string, string | null>(),
  lookups: [] as string[],
  currentTenantId: (): string => '',
}))

vi.mock('@/lib/server/domains/assistant/assistant.principal', () => ({
  getAssistantPrincipal: async () => {
    const id = hoisted.currentTenantId()
    hoisted.lookups.push(id)
    const found = hoisted.principals.get(id)
    return found ? { id: found } : null
  },
}))

const { assistantPrincipalIdOnce } = await import('../assistant-principal')
const { withTenant } = await import('@/lib/server/__tests__/tenant-scope')
const { getCurrentTenant } = await import('@/lib/server/tenancy/tenant-context')

hoisted.currentTenantId = () => getCurrentTenant()?.tenantId ?? ''

beforeEach(() => {
  hoisted.principals.clear()
  hoisted.lookups.length = 0
})

describe('assistantPrincipalIdOnce', () => {
  it('resolves each tenant to its own principal', async () => {
    hoisted.principals.set('tenant-alpha', 'principal_alpha')
    hoisted.principals.set('tenant-bravo', 'principal_bravo')

    expect(await withTenant('tenant-alpha', () => assistantPrincipalIdOnce())).toBe(
      'principal_alpha'
    )
    expect(await withTenant('tenant-bravo', () => assistantPrincipalIdOnce())).toBe(
      'principal_bravo'
    )
  })

  it('resolves correctly in the other order too', async () => {
    hoisted.principals.set('tenant-charlie', 'principal_charlie')
    hoisted.principals.set('tenant-delta', 'principal_delta')

    expect(await withTenant('tenant-delta', () => assistantPrincipalIdOnce())).toBe(
      'principal_delta'
    )
    expect(await withTenant('tenant-charlie', () => assistantPrincipalIdOnce())).toBe(
      'principal_charlie'
    )
  })

  it('does not hand a tenant with no assistant another tenant id', async () => {
    hoisted.principals.set('tenant-echo', 'principal_echo')
    await withTenant('tenant-echo', () => assistantPrincipalIdOnce())

    expect(await withTenant('tenant-foxtrot', () => assistantPrincipalIdOnce())).toBeNull()
  })

  it('still memoizes within a tenant', async () => {
    hoisted.principals.set('tenant-golf', 'principal_golf')

    await withTenant('tenant-golf', async () => {
      await assistantPrincipalIdOnce()
      await assistantPrincipalIdOnce()
      await assistantPrincipalIdOnce()
    })

    expect(hoisted.lookups.filter((id) => id === 'tenant-golf')).toHaveLength(1)
  })
})
