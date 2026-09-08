// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OutcomePreviewRail } from '../outcome-preview-rail'
import type { SsoTestCapture } from '@/lib/shared/sso-test-capture'
import type { IdentityProviderClaimMapping } from '@/lib/shared/oidc-claim-mapping'

vi.mock('../../sso/use-sso-test-sign-in', () => ({
  useSsoTestSignIn: () => ({ open: vi.fn(), lastSuccess: null, lastCapture: null }),
}))

vi.mock('../../sso/test-sign-in-button', () => ({
  TestSignInButton: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children ?? 'Test sign-in'}</button>
  ),
}))

vi.mock('@/lib/client/hooks/use-user-attributes-queries', () => ({
  useUserAttributes: () => ({
    data: [{ key: 'department', type: 'string', label: 'Department' }],
  }),
}))

const REG = 'oidc_x'
const defs = [{ key: 'department', type: 'string' as const, label: 'Department' }]
const policy = {
  autoCreateUsers: true,
  autoProvisionRole: null as 'user' | 'member' | 'admin' | null,
  registrationId: REG,
}

function v2(over: Partial<SsoTestCapture> = {}): SsoTestCapture {
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
            iss: 'https://idp.example',
          },
        },
        { source: 'userinfo', claims: { sub: 'person-123', department: 'Engineering' } },
      ],
    },
    ...over,
  }
}

function renderRail(over: {
  capture?: SsoTestCapture | null
  draft?: IdentityProviderClaimMapping | null
  dirty?: boolean
  autoCreateUsers?: boolean
  detailsChangedAt?: string | null
}) {
  return render(
    <OutcomePreviewRail
      capture={over.capture === undefined ? v2() : over.capture}
      draft={over.draft ?? null}
      definitions={defs}
      providerPolicy={{
        ...policy,
        autoCreateUsers: over.autoCreateUsers ?? true,
        detailsChangedAt: over.detailsChangedAt,
      }}
      dirty={over.dirty ?? false}
      registrationId={REG}
      canTest
    />
  )
}

describe('OutcomePreviewRail', () => {
  it('preview uses production binder for unsaved draft', () => {
    renderRail({
      dirty: true,
      draft: { profile: { claims: { email: 'upn' } } },
      capture: v2({
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
      }),
    })
    expect(screen.getByText('Preview of unsaved changes')).toBeInTheDocument()
    expect(screen.getByText('jane@idp.example')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save and test' })).toBeInTheDocument()
  })

  it('wrong provider capture is ignored', () => {
    renderRail({ capture: v2({ registrationId: 'oidc_other' }) })
    expect(screen.getByText(/Run a test sign-in to inspect this IdP's claims/)).toBeInTheDocument()
  })

  it('legacy capture asks for retest', () => {
    renderRail({
      capture: {
        registrationId: REG,
        capturedAt: '2026-09-01T00:00:00.000Z',
        identity: { id: 'person-123', email: 'jane@example.test', sources: { id: 'idToken' } },
        claims: { sub: 'person-123' },
      },
    })
    expect(screen.getByText(/preview mappings accurately/i)).toBeInTheDocument()
    expect(screen.queryByText('Identifier')).not.toBeInTheDocument()
  })

  it('source change never invents provenance', () => {
    renderRail({
      draft: { profile: { sources: ['idToken', 'userinfo', 'accessTokenJwt'] } },
    })
    expect(screen.getByText(/Access token JWT was not captured/i)).toBeInTheDocument()
    expect(screen.queryByText('Identifier')).not.toBeInTheDocument()
  })

  it('role preview warns about off-domain admin rules even if test matches member', () => {
    renderRail({
      draft: {
        role: {
          claimPath: 'groups',
          rules: [
            { whenContains: 'platform-admins', role: 'admin' },
            { whenContains: 'engineering', role: 'member' },
          ],
        },
      },
    })
    // Only the matched rule is shown; the editor holds the full list.
    expect(screen.getByText(/rule 2 matched/)).toBeInTheDocument()
    expect(screen.getByText('engineering')).toBeInTheDocument()
    expect(screen.queryByText('platform-admins')).not.toBeInTheDocument()
    expect(screen.getByText(/even outside this provider's verified domains/)).toBeInTheDocument()
    expect(screen.getByText(/does not limit this admin rule/)).toBeInTheDocument()
  })

  it('auto-create off suppresses role application but not People preview', () => {
    renderRail({
      autoCreateUsers: false,
      draft: {
        role: { claimPath: 'groups', rules: [{ whenContains: 'engineering', role: 'member' }] },
        attributes: { map: [{ claimPath: 'department', attributeKey: 'department' }] },
      },
    })
    expect(screen.getByText(/Roles are not applied/)).toBeInTheDocument()
    expect(screen.getByText(/Engineering/)).toBeInTheDocument()
  })

  it('placeholder preview never generates an address', () => {
    renderRail({
      draft: { profile: { allowMissingEmail: true } },
      capture: v2({
        replay: {
          sources: [
            { source: 'idToken', claims: { sub: 'person-123', name: 'Jane' } },
            { source: 'userinfo', claims: { sub: 'person-123' } },
          ],
        },
      }),
    })
    expect(screen.getByText('A placeholder address will be used.')).toBeInTheDocument()
    expect(screen.queryByText(/sso-/)).not.toBeInTheDocument()
  })

  it('metadata preview cannot claim existing values were kept', () => {
    renderRail({
      draft: {
        attributes: { map: [{ claimPath: 'department', attributeKey: 'department' }] },
      },
    })
    expect(screen.queryByText(/kept existing/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Assumes the person has no attributes yet/)).toBeInTheDocument()
  })

  it('shows Member (runtime default) when Accounts role is null', () => {
    renderRail({ draft: { role: { claimPath: 'groups', rules: [] } } })
    expect(screen.getByText(/Member \(runtime default\)/)).toBeInTheDocument()
  })
})
