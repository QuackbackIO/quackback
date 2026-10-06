import { describe, it, expect } from 'vitest'
import type { JsonValue } from '../json'
import type { IdentityProviderClaimMapping } from '../oidc-claim-mapping'
import {
  previewClaimMapping,
  previewProfileValues,
  selectMappingCapture,
} from '../sso-mapping-preview'
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

describe('previewClaimMapping profile sync', () => {
  it('exposes the avatar the draft resolves', () => {
    const preview = previewClaimMapping({
      draft: { profile: { claims: { image: 'photo_url' } } },
      capture: v2Capture({
        replay: {
          sources: [
            {
              source: 'idToken',
              claims: {
                sub: 'person-123',
                email: 'jane@example.test',
                name: 'Jane',
                photo_url: 'https://cdn.example.com/photos/123',
              },
            },
            { source: 'userinfo', claims: { sub: 'person-123' } },
          ],
        },
      }),
      definitions: defs,
      providerPolicy: policy,
    })
    expect(preview.identity?.image).toBe('https://cdn.example.com/photos/123')
  })

  it('says existing profiles are not changed when sync is off', () => {
    const preview = previewClaimMapping({
      draft: null,
      capture: v2Capture(),
      definitions: defs,
      providerPolicy: policy,
    })
    const text = preview.limitations.join(' ')
    expect(text).toMatch(/not changed on later sign-ins/)
    expect(text).not.toMatch(/Later sign-ins update/)
  })

  it('says later sign-ins update the name and avatar when sync is on', () => {
    const preview = previewClaimMapping({
      draft: { profile: { syncOnSignIn: true } },
      capture: v2Capture(),
      definitions: defs,
      providerPolicy: policy,
    })
    const text = preview.limitations.join(' ')
    expect(text).toMatch(/Later sign-ins update the name and avatar/)
    expect(text).not.toMatch(/not changed on later sign-ins/)
  })
})

describe('previewProfileValues', () => {
  function capture(
    idToken: Record<string, JsonValue>,
    userinfo: Record<string, JsonValue> = { sub: 'person-123' }
  ): SsoTestCapture {
    return v2Capture({
      replay: {
        sources: [
          { source: 'idToken', claims: idToken },
          { source: 'userinfo', claims: userinfo },
        ],
      },
    })
  }
  const base = { sub: 'person-123', email: 'Jane@Example.TEST', name: 'Jane' }

  it('returns null without a capture', () => {
    expect(previewProfileValues(null, null)).toBeNull()
  })

  it('returns null whenever the outcome rail would ask for a new test', () => {
    const notReplayable = { ...capture(base), detailsChangedAtAtStart: undefined }
    expect(previewProfileValues(null, notReplayable)).toBeNull()
    expect(
      previewProfileValues({ profile: { sources: ['accessTokenJwt'] } }, capture(base))
    ).toBeNull()
  })

  it('leaves the name out when the provider sent none, as sign-up would generate one', () => {
    const values = previewProfileValues(
      null,
      capture({ sub: 'person-123', email: 'jane@example.test', preferred_username: 'jane' })
    )
    expect(values?.name).toBeUndefined()
    expect(values?.username).toBe('jane')
  })

  it('matches the profile outcome the rail shows', () => {
    const draft = { profile: { claims: { image: 'photo_url', username: 'handle' } } }
    const railFor = (shown: SsoTestCapture) =>
      previewClaimMapping({ draft, capture: shown, definitions: defs, providerPolicy: policy })
        .identity
    const named = capture({ ...base, handle: 'jd', photo_url: 'https://cdn.example.com/p/1' })
    const rail = railFor(named)
    expect(previewProfileValues(draft, named)).toEqual({
      id: rail?.id,
      email: rail?.email,
      name: rail?.name,
      username: rail?.username,
      image: rail?.image,
    })

    // No name sent: the rail shows the generated one, the column shows none.
    const unnamed = capture(
      { sub: 'person-123', email: 'jane@example.test', photo_url: 'https://cdn.example.com/p/1' },
      { sub: 'person-123', handle: 'jd' }
    )
    const unnamedRail = railFor(unnamed)
    expect(unnamedRail?.name).toBe('jd')
    expect(previewProfileValues(draft, unnamed)).toEqual({
      id: unnamedRail?.id,
      email: unnamedRail?.email,
      username: unnamedRail?.username,
      image: unnamedRail?.image,
    })
  })

  it('shows the account ID, email and name the draft resolves', () => {
    expect(previewProfileValues(null, capture(base))).toMatchObject({
      id: 'person-123',
      email: 'jane@example.test',
      name: 'Jane',
    })
    expect(
      previewProfileValues(
        { profile: { claims: { name: 'display' } } },
        capture({ ...base, display: 'Jane Doe' })
      )?.name
    ).toBe('Jane Doe')
  })

  it('reads picture when no avatar claim is mapped', () => {
    expect(
      previewProfileValues(null, capture({ ...base, picture: 'https://cdn.example.com/a.png' }))
        ?.image
    ).toBe('https://cdn.example.com/a.png')
  })

  it('reads the mapped avatar claim, with no file extension, instead of picture', () => {
    const values = previewProfileValues(
      { profile: { claims: { image: 'photo_url' } } },
      capture({
        ...base,
        picture: 'https://cdn.example.com/standard.png',
        photo_url: 'https://cdn.example.com/photos/123',
      })
    )
    expect(values?.image).toBe('https://cdn.example.com/photos/123')
  })

  it('reads a nested avatar claim and one sent only in userinfo', () => {
    expect(
      previewProfileValues(
        { profile: { claims: { image: 'profile.photo' } } },
        capture({ ...base, profile: { photo: 'https://cdn.example.com/p/9' } })
      )?.image
    ).toBe('https://cdn.example.com/p/9')
    expect(
      previewProfileValues(
        null,
        capture(base, { sub: 'person-123', picture: 'https://cdn.example.com/u/1' })
      )?.image
    ).toBe('https://cdn.example.com/u/1')
  })

  it('has no avatar when the mapped claim is missing or is not an http(s) URL', () => {
    const withPicture = capture({ ...base, picture: 'https://cdn.example.com/a.png' })
    expect(
      previewProfileValues({ profile: { claims: { image: 'photo_url' } } }, withPicture)?.image
    ).toBeUndefined()
    expect(
      previewProfileValues({ profile: { claims: { image: 'name' } } }, withPicture)?.image
    ).toBeUndefined()
    expect(previewProfileValues(null, capture(base))?.image).toBeUndefined()
  })

  it('uses preferred_username, then nickname, for an unmapped username', () => {
    expect(
      previewProfileValues(null, capture({ ...base, preferred_username: 'jane', nickname: 'jd' }))
        ?.username
    ).toBe('jane')
    expect(previewProfileValues(null, capture({ ...base, nickname: 'jd' }))?.username).toBe('jd')
    expect(previewProfileValues(null, capture(base))?.username).toBeUndefined()
  })

  it('reads only the mapped username claim, wherever the test sent it', () => {
    const mapped = { profile: { claims: { username: 'profile.handle' } } }
    expect(
      previewProfileValues(
        mapped,
        capture({ ...base, preferred_username: 'jane', profile: { handle: 'jane.d' } })
      )?.username
    ).toBe('jane.d')
    expect(
      previewProfileValues(mapped, capture({ ...base, preferred_username: 'jane' }))?.username
    ).toBeUndefined()
    expect(
      previewProfileValues(
        { profile: { claims: { username: 'handle' } } },
        capture(base, { sub: 'person-123', handle: 'jd' })
      )?.username
    ).toBe('jd')
  })
})

describe('the default new-account role', () => {
  it('is Member when none is saved, the same value sign-in uses', async () => {
    const { DEFAULT_PROVISION_ROLE } = await import('../sso-mapping-preview')
    expect(DEFAULT_PROVISION_ROLE).toBe('member')
    const { runtimeFallbackRole } = await import('../sso-mapping-preview')
    expect(runtimeFallbackRole(null)).toEqual({ role: 'member', label: 'Member' })
  })
})
