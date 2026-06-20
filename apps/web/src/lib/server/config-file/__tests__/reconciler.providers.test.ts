import { describe, it, expect, vi } from 'vitest'
import { reconcileFileIntoDb, type ReconcileDeps, type IdentityProviderSpec } from '../reconciler'
import { computeManagedPaths, isPathManaged, providerPathKey } from '../managed-paths'

const baseDeps = (): ReconcileDeps => ({
  readSettings: vi.fn(async () => ({
    id: 'ws_1',
    name: 'Acme',
    slug: 'acme',
    setupState: null,
    tierLimits: null,
    featureFlags: null,
    authConfig: null,
    managedFieldPaths: [],
  })),
  updateSettings: vi.fn(async () => {}),
  createSettings: vi.fn(async () => {}),
  invalidateSettingsCache: vi.fn(async () => {}),
  invalidateTierLimitsCache: vi.fn(async () => {}),
  resetAuth: vi.fn(async () => {}),
})

describe('reconcileFileIntoDb — identity providers', () => {
  it('passes each config identityProviders entry to upsertIdentityProviders (with domains)', async () => {
    const deps = baseDeps()
    const upsert = vi.fn(async (_specs: IdentityProviderSpec[]) => {})
    deps.upsertIdentityProviders = upsert
    await reconcileFileIntoDb(
      {
        auth: {
          identityProviders: [
            {
              label: 'Acme SSO',
              discoveryUrl: 'https://idp.acme.com/.well-known/openid-configuration',
              clientId: 'acme-client',
              enabled: true,
              autoCreateUsers: true,
              autoProvisionRole: 'member',
              scopes: 'openid email profile',
              domains: [{ name: 'acme.com', enforced: true }, { name: 'acme.io' }],
            },
          ],
        },
      },
      deps
    )
    expect(upsert).toHaveBeenCalledTimes(1)
    const arg = (upsert.mock.calls[0]![0] as IdentityProviderSpec[])
    expect(arg).toEqual([
      {
        label: 'Acme SSO',
        discoveryUrl: 'https://idp.acme.com/.well-known/openid-configuration',
        clientId: 'acme-client',
        enabled: true,
        autoCreateUsers: true,
        autoProvisionRole: 'member',
        scopes: 'openid email profile',
        domains: [{ name: 'acme.com', enforced: true }, { name: 'acme.io' }],
      },
    ])
  })

  it('normalizes a provider with no domains to an empty domains array', async () => {
    const deps = baseDeps()
    const upsert = vi.fn(async (_specs: IdentityProviderSpec[]) => {})
    deps.upsertIdentityProviders = upsert
    await reconcileFileIntoDb(
      {
        auth: {
          identityProviders: [
            {
              label: 'Bare SSO',
              discoveryUrl: 'https://idp.bare.com/.well-known/openid-configuration',
              clientId: 'bare-client',
            },
          ],
        },
      },
      deps
    )
    const arg = upsert.mock.calls[0]![0] as IdentityProviderSpec[]
    expect(arg[0]!.domains).toEqual([])
  })

  it('does not call upsertIdentityProviders when the config declares none', async () => {
    const deps = baseDeps()
    const upsert = vi.fn(async (_specs: IdentityProviderSpec[]) => {})
    deps.upsertIdentityProviders = upsert
    await reconcileFileIntoDb({ auth: { oauth: { google: true } } }, deps)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('still reconciles providers on a fresh install (create path) after the settings row exists', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => null)
    const upsert = vi.fn(async (_specs: IdentityProviderSpec[]) => {})
    deps.upsertIdentityProviders = upsert
    await reconcileFileIntoDb(
      {
        workspace: { name: 'Acme', slug: 'acme' },
        auth: {
          identityProviders: [
            {
              label: 'Acme SSO',
              discoveryUrl: 'https://idp.acme.com/.well-known/openid-configuration',
              clientId: 'acme-client',
            },
          ],
        },
      },
      deps
    )
    expect(deps.createSettings).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledTimes(1)
  })
})

describe('computeManagedPaths — identity providers', () => {
  it('emits per-field managed paths for each declared provider', () => {
    const paths = computeManagedPaths({
      auth: {
        identityProviders: [
          {
            label: 'Acme SSO',
            discoveryUrl: 'https://idp.acme.com/.well-known/openid-configuration',
            clientId: 'acme-client',
            enabled: true,
            domains: [{ name: 'acme.com' }],
          },
        ],
      },
    })
    const key = providerPathKey('Acme SSO')
    expect(paths).toContain(`auth.identityProviders.${key}.discoveryUrl`)
    expect(paths).toContain(`auth.identityProviders.${key}.clientId`)
    expect(paths).toContain(`auth.identityProviders.${key}.enabled`)
    expect(paths).toContain(`auth.identityProviders.${key}.domains`)
    expect(isPathManaged(`auth.identityProviders.${key}.clientId`, paths)).toBe(true)
  })

  it('encodes dots in a label so isPathManaged produces no false segment match', () => {
    const paths = computeManagedPaths({
      auth: {
        identityProviders: [
          {
            label: 'Acme Inc. SSO',
            discoveryUrl: 'https://idp.acme.com/.well-known/openid-configuration',
            clientId: 'x',
          },
        ],
      },
    })
    const key = providerPathKey('Acme Inc. SSO')
    // The encoded segment must not contain a raw dot, or it would split
    // into multiple path segments and let an unrelated prefix match.
    expect(key).not.toContain('.')
    expect(isPathManaged(`auth.identityProviders.${key}.clientId`, paths)).toBe(true)
    // Had the dot been left raw ("...Acme Inc. SSO..."), this prefix query
    // would have falsely matched via the whole-block startsWith check.
    expect(isPathManaged('auth.identityProviders.Acme Inc', paths)).toBe(false)
  })
})
