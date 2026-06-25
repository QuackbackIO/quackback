/**
 * Unit test for the DEFERRED legacy-OIDC-config cleanup (expand/contract).
 *
 * Proves the contract step is:
 *   - guarded: a no-op while the migrated provider rows don't exist;
 *   - correct: nulls `authConfig.ssoOidc` and removes
 *     `portalConfig.oauth['custom-oidc']` once the rows exist, leaving every
 *     other config key intact;
 *   - credential-safe: the `auth_sso` / `auth_custom-oidc` credential rows are
 *     never touched (registration ids are preserved);
 *   - idempotent: a second run is a no-op.
 *
 * Runs inside a transaction that is rolled back so the shared test DB is clean.
 */

// Satisfy the config schema (secretKey/baseUrl/redisUrl) the encryption + db
// layers validate on first access (mirrors backfill-custom-oidc-provider.test).
process.env.SECRET_KEY = 'test-secret-key-that-is-at-least-32-characters-long'
process.env.BASE_URL = 'http://localhost:3000'
process.env.REDIS_URL = 'redis://localhost:6379'

import { describe, it, expect } from 'vitest'
import {
  db,
  eq,
  inArray,
  identityProvider,
  integrationPlatformCredentials,
  settings,
} from '@/lib/server/db'
import { encryptPlatformCredentials } from '@/lib/server/integrations/encryption'
import { cleanupLegacyOidcConfig } from '../cleanup-legacy-oidc-config'

describe('legacy oidc config cleanup', () => {
  it('is guarded, correct, credential-safe, and idempotent', async () => {
    await db
      .transaction(async (tx) => {
        // Establish a known legacy state: an ssoOidc blob on authConfig and a
        // custom-oidc portal toggle, plus unrelated keys that must survive the
        // cleanup. The migrated test DB has no settings row, so create one (id
        // + auth_config_version come from drizzle/column defaults).
        const authConfig = {
          oauth: { password: true },
          ssoOidc: {
            enabled: true,
            discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
            clientId: 'legacy-sso-client',
          },
        }
        const portalConfig = {
          oauth: { password: true, magicLink: false, 'custom-oidc': true },
          features: { allowAnonymous: false },
        }
        const [settingsRow] = await tx
          .insert(settings)
          .values({
            name: 'Cleanup Test Workspace',
            slug: `cleanup-test-${Date.now()}`,
            createdAt: new Date(),
            authConfig: JSON.stringify(authConfig),
            portalConfig: JSON.stringify(portalConfig),
          })
          .returning({ id: settings.id })

        // Seed the credentials the cleanup must NEVER touch.
        await tx.insert(integrationPlatformCredentials).values([
          {
            integrationType: 'auth_sso',
            secrets: encryptPlatformCredentials({ clientSecret: 'sso-secret' }),
          },
          {
            integrationType: 'auth_custom-oidc',
            secrets: encryptPlatformCredentials({ clientSecret: 'custom-secret' }),
          },
        ])

        // Clean slate: no migrated provider rows yet.
        await tx
          .delete(identityProvider)
          .where(inArray(identityProvider.registrationId, ['sso', 'custom-oidc']))

        // --- Guard: with no provider rows, cleanup must be a no-op. ---
        const guarded = await cleanupLegacyOidcConfig(tx)
        expect(guarded).toEqual({ clearedSsoOidc: false, removedCustomOidcButton: false })
        const stillThere = await readConfigs(tx, settingsRow.id)
        expect(stillThere.authConfig.ssoOidc).toBeDefined()
        expect(stillThere.portalOauth['custom-oidc']).toBe(true)

        // --- Insert the migrated provider rows, then run the cleanup. ---
        await tx.insert(identityProvider).values([
          {
            registrationId: 'sso',
            label: 'SSO',
            clientId: 'legacy-sso-client',
            enabled: true,
          },
          {
            registrationId: 'custom-oidc',
            label: 'Custom OIDC',
            clientId: 'legacy-custom-client',
            enabled: true,
            showButton: true,
          },
        ])

        const first = await cleanupLegacyOidcConfig(tx)
        expect(first).toEqual({ clearedSsoOidc: true, removedCustomOidcButton: true })

        const after = await readConfigs(tx, settingsRow.id)
        // ssoOidc gone; the unrelated oauth.password key on authConfig survives.
        expect(after.authConfig.ssoOidc).toBeUndefined()
        expect((after.authConfig.oauth as Record<string, unknown>).password).toBe(true)
        // custom-oidc portal toggle gone; the other portal keys survive.
        expect('custom-oidc' in after.portalOauth).toBe(false)
        expect(after.portalOauth.password).toBe(true)
        expect(after.portalOauth.magicLink).toBe(false)

        // Credentials are untouched — registration ids preserved.
        const creds = await tx
          .select({ type: integrationPlatformCredentials.integrationType })
          .from(integrationPlatformCredentials)
          .where(
            inArray(integrationPlatformCredentials.integrationType, [
              'auth_sso',
              'auth_custom-oidc',
            ])
          )
        expect(creds.map((c) => c.type).sort()).toEqual(['auth_custom-oidc', 'auth_sso'])

        // --- Idempotent: a second run changes nothing. ---
        const second = await cleanupLegacyOidcConfig(tx)
        expect(second).toEqual({ clearedSsoOidc: false, removedCustomOidcButton: false })

        throw new Error('__ROLLBACK__')
      })
      .catch((e) => {
        if ((e as Error).message !== '__ROLLBACK__') throw e
      })
  })
})

async function readConfigs(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  id: string
): Promise<{
  authConfig: Record<string, unknown>
  portalOauth: Record<string, unknown>
}> {
  const [row] = await tx
    .select({ authConfig: settings.authConfig, portalConfig: settings.portalConfig })
    .from(settings)
    .where(eq(settings.id, id as never))
    .limit(1)
  const authConfig = JSON.parse(row.authConfig ?? '{}') as Record<string, unknown>
  const portalConfig = JSON.parse(row.portalConfig ?? '{}') as Record<string, unknown>
  return {
    authConfig,
    portalOauth: (portalConfig.oauth ?? {}) as Record<string, unknown>,
  }
}
