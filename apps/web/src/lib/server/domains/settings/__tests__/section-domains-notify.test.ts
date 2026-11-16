/**
 * The bells the section domain watch rings: to the teammates who may set a
 * section's domain, as a domain needing attention, and never a reason for the
 * watch to fail.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  permissions: [] as string[],
  rings: [] as { type: string; bell: { title: string; body?: string; metadata: unknown } }[],
  fail: false,
}))
vi.mock('@/lib/server/domains/channel-accounts/sending-domain-notify', () => ({
  managersHolding: async (permission: string) => {
    calls.permissions.push(permission)
    if (calls.fail) throw new Error('read failed')
    return [{ principalId: 'principal_1', userId: 'user_1' }]
  },
  ringManagers: async (
    _managers: unknown,
    type: string,
    bell: { title: string; body?: string; metadata: unknown }
  ) => {
    calls.rings.push({ type, bell })
  },
  formatDeadline: (at: Date) => at.toISOString().slice(0, 10),
}))

const { notifySectionDomainLapsed, notifySectionDomainNotAnswering } =
  await import('../section-domains-notify')

describe('section domain notices', () => {
  beforeEach(() => {
    calls.permissions = []
    calls.rings = []
    calls.fail = false
  })

  it('tells whoever may set a section domain that one stopped reaching this server, and by when', async () => {
    await notifySectionDomainNotAnswering('help.acme.com', new Date('2026-11-23T07:00:00Z'))

    expect(calls.permissions).toEqual(['settings.custom_domain'])
    expect(calls.rings).toEqual([
      {
        type: 'domain_needs_attention',
        bell: {
          title: 'help.acme.com needs attention',
          body: 'help.acme.com is not reaching this server. Fix its DNS by 2026-11-23 to keep it verified.',
          metadata: { domain: 'help.acme.com', audience: 'admin' },
        },
      },
    ])
  })

  it('says when one stopped being verified', async () => {
    await notifySectionDomainLapsed('help.acme.com')

    expect(calls.rings).toEqual([
      {
        type: 'domain_needs_attention',
        bell: {
          title: 'help.acme.com is no longer verified',
          body: 'help.acme.com still does not reach this server. Verify it again once its DNS is fixed.',
          metadata: { domain: 'help.acme.com', audience: 'admin' },
        },
      },
    ])
  })

  it('swallows a failure, so the watch keeps what it found', async () => {
    calls.fail = true
    await expect(
      notifySectionDomainNotAnswering('help.acme.com', new Date())
    ).resolves.toBeUndefined()
    await expect(notifySectionDomainLapsed('help.acme.com')).resolves.toBeUndefined()
    expect(calls.rings).toEqual([])
  })
})
