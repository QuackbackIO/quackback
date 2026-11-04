/**
 * The web address server functions: when a proven zone travels with a
 * hostname to the operator, and when the page is told a hostname is covered.
 *
 * `createServerFn` is mocked so each `.handler()` is captured in export order.
 * The operator double records every request it is sent, and the proof double
 * answers only for hostnames under the zone it holds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

type AnyHandler = (args: { data?: Record<string, unknown> }) => Promise<unknown>
const handlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => new Headers() }))

const PROJECTION = {
  version: 3,
  displayName: 'Acme',
  canonicalOrigin: 'https://acme.example.com',
  platformHostname: 'acme.example.com',
  customDomains: [],
  updatedAt: '2026-10-01T12:00:00.000Z',
}

const h = vi.hoisted(() => ({
  permissions: [] as string[],
  sent: [] as unknown[],
  instructions: [] as unknown[],
  proofReads: 0,
}))

vi.mock('@/lib/server/db', () => ({
  settings: {},
  db: { select: () => ({ from: () => ({ limit: async () => [{ cloudIdentity: {} }] }) }) },
}))
vi.mock('@/lib/server/domains/settings/cloud/identity-projection', () => ({
  parseIdentityProjection: () => PROJECTION,
}))
vi.mock('@/lib/server/domains/settings/cloud/identity-projection.signature', () => ({
  verifyIdentityProjectionToken: async () => ({ workspaceKey: 'ws', projection: PROJECTION }),
}))
vi.mock('@/lib/server/domains/settings/cloud/identity-projection.write', () => ({
  writeIdentityProjection: async () => {},
}))
vi.mock('@/lib/server/setup-state', () => ({}))
vi.mock('@/lib/server/onboarding-board', () => ({}))
vi.mock('@/lib/server/domains/settings/cloud/entitlements', () => ({
  requireEntitlement: async () => {},
  hasEntitlement: async () => true,
}))
vi.mock('@/lib/server/auth', () => ({
  auth: { api: { generateOneTimeToken: async () => ({ token: 'ott' }) } },
}))
vi.mock('../auth-helpers', () => ({
  requireAuth: async () => ({ permissions: h.permissions }),
}))
vi.mock('@/lib/server/control-plane/client', () => ({
  requestWorkspaceIdentityMutation: async (input: unknown) => {
    h.sent.push(input)
    return { projectionToken: 'signed' }
  },
  fetchWorkspaceCustomDomains: async () => h.instructions,
}))

const ACME_PROOF = {
  source: 'email-sending',
  zone: 'acme.com',
  record: { name: '_quackback.acme.com', value: 'quackback-domain-verification=abc' },
}
vi.mock('@/lib/server/domains/domain-proof/hostname-proof', () => ({
  readHostnameProofs: async () => {
    h.proofReads++
    return (hostname: string) =>
      hostname === 'acme.com' || hostname.endsWith('.acme.com') ? ACME_PROOF : null
  },
}))

await import('../cloud-identity')
const getCustomDomains = handlers[2]!
const mutateCustomDomain = handlers[4]!

const FLAG = 'QUACKBACK_CONTROL_PLANE_PROVEN_ZONES'

beforeEach(() => {
  h.permissions = [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN]
  h.sent.length = 0
  h.instructions = []
  h.proofReads = 0
})
afterEach(() => {
  delete process.env[FLAG]
})

const mutate = (action: string, hostname: string) =>
  mutateCustomDomain({ data: { action, hostname } })

describe('mutateCloudCustomDomainFn', () => {
  it('sends the covering proof on add and refresh when the operator accepts proofs', async () => {
    process.env[FLAG] = 'true'
    await mutate('add', 'feedback.acme.com')
    await mutate('refresh', 'feedback.acme.com')
    expect(h.sent).toEqual([
      { customDomain: { action: 'add', hostname: 'feedback.acme.com', proof: ACME_PROOF } },
      { customDomain: { action: 'refresh', hostname: 'feedback.acme.com', proof: ACME_PROOF } },
    ])
  })

  it('sends no proof for a hostname no proven zone covers', async () => {
    process.env[FLAG] = 'true'
    await mutate('add', 'feedback.example.com')
    expect(h.sent).toEqual([{ customDomain: { action: 'add', hostname: 'feedback.example.com' } }])
  })

  it('never sends a proof on make primary or remove', async () => {
    process.env[FLAG] = 'true'
    await mutate('makePrimary', 'feedback.acme.com')
    await mutate('remove', 'feedback.acme.com')
    expect(h.sent).toEqual([
      { customDomain: { action: 'makePrimary', hostname: 'feedback.acme.com' } },
      { customDomain: { action: 'remove', hostname: 'feedback.acme.com' } },
    ])
    expect(h.proofReads).toBe(0)
  })

  it.each([undefined, 'false', '1'])('sends no proof while the flag is %s', async (value) => {
    if (value !== undefined) process.env[FLAG] = value
    await mutate('add', 'feedback.acme.com')
    expect(h.sent).toEqual([{ customDomain: { action: 'add', hostname: 'feedback.acme.com' } }])
    expect(h.proofReads).toBe(0)
  })
})

describe('getCloudCustomDomainsFn', () => {
  const pending = (hostname: string, extra: Record<string, unknown> = {}) => ({
    hostname,
    readiness: 'pending',
    isPrimary: false,
    updatedAt: '2026-10-01T12:00:00.000Z',
    cnameTarget: 'edge.example.net',
    ownershipTxt: null,
    ownershipProof: { name: `_quackback-challenge.${hostname}`, value: 'challenge' },
    ...extra,
  })

  it('marks a covered hostname with its source, named only to who may see it', async () => {
    process.env[FLAG] = 'true'
    h.instructions = [pending('feedback.acme.com'), pending('feedback.example.com')]

    h.permissions = [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN, PERMISSIONS.CHANNEL_ACCOUNT_MANAGE]
    const named = (await getCustomDomains({})) as { hostname: string; provenBy: unknown }[]
    expect(named.map((d) => [d.hostname, d.provenBy])).toEqual([
      ['feedback.acme.com', 'email-sending'],
      ['feedback.example.com', null],
    ])

    h.permissions = [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN]
    const generic = (await getCustomDomains({})) as { hostname: string; provenBy: unknown }[]
    expect(generic.map((d) => d.provenBy)).toEqual(['workspace', null])
  })

  it('marks nothing from its own read while the operator does not accept proofs', async () => {
    h.instructions = [pending('feedback.acme.com')]
    const rows = (await getCustomDomains({})) as { provenBy: unknown }[]
    expect(rows.map((d) => d.provenBy)).toEqual([null])
    expect(h.proofReads).toBe(0)
  })

  it('shows a proof the operator says it accepted', async () => {
    h.instructions = [
      pending('feedback.example.org', {
        ownershipProof: null,
        ownership: 'proven-zone',
        ownershipSource: 'sso',
      }),
    ]
    h.permissions = [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN, PERMISSIONS.AUTH_MANAGE]
    const rows = (await getCustomDomains({})) as { provenBy: unknown }[]
    expect(rows.map((d) => d.provenBy)).toEqual(['sso'])
  })
})
