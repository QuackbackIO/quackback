import { describe, it, expect } from 'vitest'
import type { IdentityProviderClaimMapping } from '../oidc-claim-mapping'
import { previewClaimMapping, selectMappingCapture } from '../sso-mapping-preview'
import type { SsoTestCapture } from '../sso-test-capture'

const REG = 'oidc_x'

function v2Capture(over: Partial<SsoTestCapture> = {}): SsoTestCapture {
  return {
    version: 2,
    registrationId: REG,
    capturedAt: '2026-09-01T00:00:00.000Z',
    detailsChangedAtAtStart: null,
    outcome: 'success',
    identity: {
      id: 'person-123',
      email: 'jane@example.test',
      name: 'Jane',
      sources: { id: 'idToken' },
    },
    claims: {
      sub: 'person-123',
      email: 'Jane@Example.TEST',
      name: 'Jane',
      groups: ['engineering'],
    },
    replay: {
      sources: [
        {
          source: 'idToken',
          claims: {
            sub: 'person-123',
            email: 'Jane@Example.TEST',
            name: 'Jane',
            groups: ['engineering'],
          },
        },
        { source: 'userinfo', claims: { sub: 'person-123', department: 'Engineering' } },
      ],
    },
    ...over,
  }
}

const defs = [{ key: 'department', type: 'string' as const, label: 'Department' }]
const policy = {
  autoCreateUsers: true,
  autoProvisionRole: 'user' as const,
  registrationId: REG,
}

describe('selectMappingCapture', () => {
  it('wrong provider capture is ignored', () => {
    expect(
      selectMappingCapture({
        registrationId: REG,
        sessionCapture: v2Capture({ registrationId: 'oidc_other' }),
        persistedCapture: v2Capture({ registrationId: 'oidc_other' }),
      })
    ).toBeNull()
  })

  it('newer failed mapping capture supersedes old success for debugging', () => {
    const olderSuccess = v2Capture({
      capturedAt: '2026-09-01T00:00:00.000Z',
      outcome: 'success',
    })
    const newerFail = v2Capture({
      capturedAt: '2026-09-01T01:00:00.000Z',
      outcome: 'mapping_failed',
      identity: undefined,
    })
    const selected = selectMappingCapture({
      registrationId: REG,
      sessionCapture: newerFail,
      persistedCapture: olderSuccess,
    })
    expect(selected?.outcome).toBe('mapping_failed')
    expect(selected?.capturedAt).toBe('2026-09-01T01:00:00.000Z')
  })
})

describe('previewClaimMapping', () => {
  it('preview uses production binder for unsaved draft', () => {
    const draft: IdentityProviderClaimMapping = {
      profile: { claims: { email: 'upn' } },
    }
    const capture = v2Capture({
      replay: {
        sources: [
          {
            source: 'idToken',
            claims: {
              sub: 'person-123',
              upn: 'Jane@Idp.Example',
              email: 'other@x.test',
              name: 'Jane',
            },
          },
          { source: 'userinfo', claims: { sub: 'person-123' } },
        ],
      },
    })
    const preview = previewClaimMapping({
      draft,
      capture,
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.status).toBe('ready')
    expect(preview.identity?.email).toBe('jane@idp.example')
    expect(preview.identity?.provenance.email?.path).toBe('upn')
    expect(preview.identity?.id).toBe('person-123')
  })

  it('wrong provider capture is ignored', () => {
    const preview = previewClaimMapping({
      draft: null,
      capture: v2Capture({ registrationId: 'oidc_other' }),
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.capture).toBeNull()
    expect(preview.identity).toBeNull()
  })

  it('marks a session capture stale when details changed after the handshake started', () => {
    const preview = previewClaimMapping({
      draft: null,
      capture: v2Capture({
        detailsChangedAtAtStart: '2026-09-01T00:00:00.000Z',
        capturedAt: '2026-09-01T00:02:00.000Z',
      }),
      definitions: defs,
      providerPolicy: { ...policy, detailsChangedAt: '2026-09-01T00:01:00.000Z' },
    })
    expect(preview.stale).toBe(true)
    expect(preview.capture).not.toBeNull()
    expect(preview.limitations.join(' ')).toMatch(/re-test/i)
  })

  it('does not mark stale when current details match the handshake start', () => {
    const preview = previewClaimMapping({
      draft: null,
      capture: v2Capture({
        detailsChangedAtAtStart: '2026-09-01T00:00:00.000Z',
        capturedAt: '2026-09-01T00:02:00.000Z',
      }),
      definitions: defs,
      providerPolicy: { ...policy, detailsChangedAt: '2026-09-01T00:00:00.000Z' },
    })
    expect(preview.stale).toBe(false)
    expect(preview.limitations.join(' ')).not.toMatch(/re-test/i)
  })

  it('legacy capture asks for retest', () => {
    const capture: SsoTestCapture = {
      registrationId: REG,
      capturedAt: '2026-09-01T00:00:00.000Z',
      identity: { id: 'person-123', email: 'jane@example.test', sources: { id: 'idToken' } },
      claims: { sub: 'person-123', email: 'jane@example.test' },
    }
    const preview = previewClaimMapping({
      draft: null,
      capture,
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.status).toBe('needs_retest')
    expect(preview.limitations.join(' ')).toMatch(/preview mappings accurately/i)
    expect(preview.identity).toBeNull()
  })

  it('source change never invents provenance', () => {
    const draft: IdentityProviderClaimMapping = {
      profile: { sources: ['idToken', 'userinfo', 'accessTokenJwt'] },
    }
    const preview = previewClaimMapping({
      draft,
      capture: v2Capture(),
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.status).toBe('needs_retest')
    expect(preview.missingSource).toBe('accessTokenJwt')
    expect(preview.identity).toBeNull()
  })

  it('role preview warns about off-domain admin rules even if test matches member', () => {
    const draft: IdentityProviderClaimMapping = {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'platform-admins', role: 'admin' },
          { whenContains: 'engineering', role: 'member' },
        ],
      },
    }
    const preview = previewClaimMapping({
      draft,
      capture: v2Capture(),
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.roleMatch).toEqual({ role: 'member', ruleIndex: 1 })
    expect(draft.role?.rules.some((r) => r.role === 'admin')).toBe(true)
  })

  it('auto-create off suppresses role application but not People preview', () => {
    const draft: IdentityProviderClaimMapping = {
      role: { claimPath: 'groups', rules: [{ whenContains: 'engineering', role: 'member' }] },
      attributes: { map: [{ claimPath: 'department', attributeKey: 'department' }] },
    }
    const preview = previewClaimMapping({
      draft,
      capture: v2Capture(),
      definitions: defs,
      providerPolicy: { ...policy, autoCreateUsers: false },
    })
    expect(preview.roleMatch?.role).toBe('member')
    expect(preview.peoplePlan?.valid.department).toBe('Engineering')
  })

  it('placeholder preview never generates an address', () => {
    const draft: IdentityProviderClaimMapping = {
      profile: { allowMissingEmail: true },
    }
    const capture = v2Capture({
      replay: {
        sources: [
          { source: 'idToken', claims: { sub: 'person-123', name: 'Jane' } },
          { source: 'userinfo', claims: { sub: 'person-123' } },
        ],
      },
    })
    const preview = previewClaimMapping({
      draft,
      capture,
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.identity?.kind).toBe('placeholder_required')
    expect(preview.identity?.email).toBeUndefined()
    expect(preview.identity?.placeholderEmail).toBe(true)
  })

  it('metadata preview cannot claim existing values were kept', () => {
    const draft: IdentityProviderClaimMapping = {
      attributes: {
        map: [{ claimPath: 'department', attributeKey: 'department' }],
        overrideExisting: false,
      },
    }
    const preview = previewClaimMapping({
      draft,
      capture: v2Capture(),
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.peoplePlan?.skips?.some((s) => s.reason === 'kept_existing')).toBeFalsy()
    expect(preview.peoplePlan?.valid.department).toBe('Engineering')
  })

  it('newer failed mapping capture still previews the draft', () => {
    const capture = v2Capture({
      outcome: 'mapping_failed',
      identity: undefined,
      replay: {
        sources: [
          {
            source: 'idToken',
            claims: { sub: 'person-123', upn: 'jane@example.test', name: 'Jane' },
          },
          { source: 'userinfo', claims: { sub: 'person-123' } },
        ],
      },
    })
    const preview = previewClaimMapping({
      draft: { profile: { claims: { email: 'upn' } } },
      capture,
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.status).toBe('mapping_failed')
    expect(preview.identity?.email).toBe('jane@example.test')
  })
})
