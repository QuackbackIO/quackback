import { describe, it, expect } from 'vitest'
import { parseQuackbackConfig, quackbackConfigSchema } from '../schema'

describe('parseQuackbackConfig', () => {
  it('accepts a fully-populated valid config', () => {
    const result = parseQuackbackConfig({
      apiVersion: 'quackback.io/v1',
      kind: 'QuackbackConfig',
      metadata: { source: 'test' },
      spec: {
        workspace: { name: 'Acme', slug: 'acme', useCase: 'saas' },
        tierLimits: {
          maxBoards: 10,
          maxPosts: null,
          aiTokensPerMonth: 100000,
          features: { customDomain: true, integrations: false },
        },
        features: { helpCenter: true, experimentalRichEditor: false },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.spec.workspace?.name).toBe('Acme')
      expect(result.data.spec.tierLimits?.maxBoards).toBe(10)
      expect(result.data.spec.tierLimits?.features?.customDomain).toBe(true)
      expect(result.data.spec.features?.helpCenter).toBe(true)
    }
  })

  it('accepts an empty spec', () => {
    const result = parseQuackbackConfig({
      apiVersion: 'quackback.io/v1',
      kind: 'QuackbackConfig',
      spec: {},
    })
    expect(result.success).toBe(true)
  })

  it('rejects a missing apiVersion', () => {
    const result = parseQuackbackConfig({ kind: 'QuackbackConfig', spec: {} })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown apiVersion', () => {
    const result = parseQuackbackConfig({
      apiVersion: 'quackback.io/v2',
      kind: 'QuackbackConfig',
      spec: {},
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid useCase', () => {
    const result = parseQuackbackConfig({
      apiVersion: 'quackback.io/v1',
      kind: 'QuackbackConfig',
      spec: { workspace: { useCase: 'bogus' } },
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown top-level spec keys (no boards/posts here)', () => {
    const result = parseQuackbackConfig({
      apiVersion: 'quackback.io/v1',
      kind: 'QuackbackConfig',
      spec: { boards: [{ name: 'x' }] } as unknown,
    })
    expect(result.success).toBe(false)
  })

  it('accepts an auth block', () => {
    const result = parseQuackbackConfig({
      apiVersion: 'quackback.io/v1',
      kind: 'QuackbackConfig',
      spec: { auth: { oauth: { google: true }, openSignup: false } },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.spec.auth?.oauth?.google).toBe(true)
      expect(result.data.spec.auth?.openSignup).toBe(false)
    }
  })

  it('rejects unknown OAuth provider keys in auth.oauth (v1 is google+github only)', () => {
    const result = parseQuackbackConfig({
      apiVersion: 'quackback.io/v1',
      kind: 'QuackbackConfig',
      spec: { auth: { oauth: { discord: true } } },
    })
    expect(result.success).toBe(false)
  })

  it('accepts an auth.ssoOidc block', () => {
    const result = parseQuackbackConfig({
      apiVersion: 'quackback.io/v1',
      kind: 'QuackbackConfig',
      spec: {
        auth: {
          ssoOidc: {
            enabled: true,
            discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
            clientId: 'workspace-x',
            autoCreateUsers: true,
          },
        },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.spec.auth?.ssoOidc?.enabled).toBe(true)
      expect(result.data.spec.auth?.ssoOidc?.clientId).toBe('workspace-x')
      expect(result.data.spec.auth?.ssoOidc?.autoCreateUsers).toBe(true)
    }
  })

  it('rejects unknown keys inside auth.ssoOidc', () => {
    const result = parseQuackbackConfig({
      apiVersion: 'quackback.io/v1',
      kind: 'QuackbackConfig',
      spec: {
        auth: {
          ssoOidc: {
            enabled: true,
            discoveryUrl: 'https://example.com/.well-known/openid-configuration',
            clientId: 'x',
            // Secrets must never be declared in the file — strict mode
            // rejects an attempted clientSecret leak.
            clientSecret: 'leak',
          },
        },
      } as unknown as Record<string, unknown>,
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid discoveryUrl', () => {
    const result = parseQuackbackConfig({
      apiVersion: 'quackback.io/v1',
      kind: 'QuackbackConfig',
      spec: {
        auth: {
          ssoOidc: {
            enabled: true,
            discoveryUrl: 'not-a-url',
            clientId: 'x',
          },
        },
      },
    })
    expect(result.success).toBe(false)
  })
})

const baseConfig = {
  apiVersion: 'quackback.io/v1' as const,
  kind: 'QuackbackConfig' as const,
  spec: {},
}

describe('tierLimits.notice', () => {
  it('accepts a full notice', () => {
    const r = quackbackConfigSchema.safeParse({
      ...baseConfig,
      spec: {
        tierLimits: {
          maxBoards: null,
          notice: {
            label: 'Free trial',
            expiresAt: '2026-06-24T00:00:00.000Z',
            actionUrl: 'https://billing.example.com/plan',
            actionLabel: 'Choose your plan',
          },
        },
      },
    })
    expect(r.success).toBe(true)
  })

  it('accepts a label-only notice', () => {
    const r = quackbackConfigSchema.safeParse({
      ...baseConfig,
      spec: { tierLimits: { notice: { label: 'Maintenance window' } } },
    })
    expect(r.success).toBe(true)
  })

  it('still rejects unknown keys inside tierLimits and notice', () => {
    expect(
      quackbackConfigSchema.safeParse({
        ...baseConfig,
        spec: { tierLimits: { notice: { label: 'x', bogus: true } } },
      }).success
    ).toBe(false)
    expect(
      quackbackConfigSchema.safeParse({
        ...baseConfig,
        spec: { tierLimits: { bogus: true } },
      }).success
    ).toBe(false)
  })
})
