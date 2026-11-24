/**
 * The web address server functions: when a proven zone travels with a
 * hostname to the operator, and when the page is told the operator accepted it.
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
  ensured: [] as string[],
  added: [] as string[],
  operatorFails: false,
  ensureFails: false,
  sectionDomains: {} as Record<string, { hostname: string; verifiedAt: string | null }>,
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
    if (h.operatorFails) throw new Error('operator refused')
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

vi.mock('@/lib/server/domains/settings/section-domains.service', () => ({
  getSectionDomains: async () => h.sectionDomains,
}))

vi.mock('@/lib/server/domains/domain-proof/domains.service', () => ({
  listDomains: async () => h.added.map((name) => ({ name })),
  ensureDomain: async (name: string) => {
    if (h.ensureFails) throw new Error('domains table unavailable')
    h.ensured.push(name)
    return null
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
  h.ensured.length = 0
  h.added = []
  h.operatorFails = false
  h.ensureFails = false
  h.sectionDomains = {}
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

describe('mutateCloudCustomDomainFn and Settings > Domains', () => {
  it('puts an added hostname on Settings > Domains in the same step', async () => {
    await mutate('add', 'feedback.acme.com')
    expect(h.ensured).toEqual(['feedback.acme.com'])
  })

  it('adds no second domain for a hostname under a domain already added', async () => {
    h.added = ['acme.com']
    await mutate('add', 'feedback.acme.com')
    expect(h.ensured).toEqual([])
  })

  it('still reports the add as done when putting it on Settings > Domains fails', async () => {
    h.ensureFails = true
    await expect(mutate('add', 'feedback.acme.com')).resolves.toMatchObject({
      projection: { canonicalOrigin: 'https://acme.example.com' },
    })
  })

  it('adds no domain for any other action, or when the operator refuses the add', async () => {
    await mutate('refresh', 'feedback.acme.com')
    await mutate('makePrimary', 'feedback.acme.com')
    await mutate('remove', 'feedback.acme.com')
    h.operatorFails = true
    await expect(mutate('add', 'feedback.acme.com')).rejects.toThrow('operator refused')
    expect(h.ensured).toEqual([])
  })
})

describe('mutateCloudCustomDomainFn and the section domains', () => {
  // Made primary, a section's hostname would be the primary domain and that
  // section's host at once, and its pages would be sent to themselves.
  it.each([
    ['ready', '2026-10-01T12:00:00.000Z'],
    ['not yet ready', null],
  ])(
    'refuses to make primary a domain a section uses, %s, and tells the operator nothing',
    async (_label, verifiedAt) => {
      h.sectionDomains = { help: { hostname: 'help.acme.com', verifiedAt } }
      await expect(mutate('makePrimary', 'Help.Acme.com')).resolves.toEqual({
        ok: false,
        code: 'CUSTOM_DOMAIN_USED_BY_SECTION',
        message: 'Help center uses this domain. Remove it there first.',
      })
      expect(h.sent).toEqual([])
    }
  )

  it('makes primary a domain no section uses', async () => {
    h.sectionDomains = { help: { hostname: 'help.acme.com', verifiedAt: null } }
    await expect(mutate('makePrimary', 'feedback.acme.com')).resolves.toMatchObject({ ok: true })
    expect(h.sent).toEqual([
      { customDomain: { action: 'makePrimary', hostname: 'feedback.acme.com' } },
    ])
  })

  it("still lets a section's domain be verified or removed", async () => {
    h.sectionDomains = { help: { hostname: 'help.acme.com', verifiedAt: null } }
    await mutate('refresh', 'help.acme.com')
    await mutate('remove', 'help.acme.com')
    expect(h.sent).toHaveLength(2)
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

  it('marks a hostname proven only when the operator accepted the proof', async () => {
    process.env[FLAG] = 'true'
    // feedback.acme.com sits under a zone this workspace proved, but the
    // operator has not accepted that proof yet.
    h.instructions = [
      pending('feedback.acme.com'),
      pending('help.acme.com', {
        ownershipProof: null,
        ownership: 'proven-zone',
        ownershipSource: 'email-sending',
      }),
    ]

    h.permissions = [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN, PERMISSIONS.SETTINGS_MANAGE]
    const named = (await getCustomDomains({})) as { hostname: string; provenBy: unknown }[]
    expect(named.map((d) => [d.hostname, d.provenBy])).toEqual([
      ['feedback.acme.com', null],
      ['help.acme.com', 'email-sending'],
    ])

    h.permissions = [PERMISSIONS.SETTINGS_CUSTOM_DOMAIN]
    const generic = (await getCustomDomains({})) as { hostname: string; provenBy: unknown }[]
    expect(generic.map((d) => d.provenBy)).toEqual([null, 'workspace'])
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
