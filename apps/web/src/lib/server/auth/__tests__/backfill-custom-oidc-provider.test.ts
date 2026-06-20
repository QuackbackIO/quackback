/**
 * Regression pin for the in-place custom-oidc → identity_provider backfill.
 *
 * Given an `auth_custom-oidc` platform credential, the backfill creates exactly
 * one provider row with `registration_id='custom-oidc'` and `show_button=true`,
 * leaves the credential key untouched (so `account.provider_id` still matches),
 * and is idempotent. Runs inside a transaction that is rolled back so the shared
 * test DB is left clean.
 */

// Satisfy the config schema (secretKey/baseUrl/redisUrl) the encryption + db
// layers validate on first access. Config loads lazily inside the test body, so
// setting these at module-eval time — after the hoisted imports but before any
// test runs — is in time. Only DATABASE_URL is injected by the vitest config;
// BASE_URL arrives as "/" under the test runner, which fails the URL check, so
// force-set a valid value rather than conditionally defaulting it.
process.env.SECRET_KEY = 'test-secret-key-that-is-at-least-32-characters-long'
process.env.BASE_URL = 'http://localhost:3000'
process.env.REDIS_URL = 'redis://localhost:6379'

import { describe, it, expect } from 'vitest'
import { db, eq, identityProvider, integrationPlatformCredentials, account } from '@/lib/server/db'
import { encryptPlatformCredentials } from '@/lib/server/integrations/encryption'
import { backfillCustomOidcProvider } from '../backfill-custom-oidc-provider'

describe('custom-oidc backfill', () => {
  it('migrates the custom-oidc credential into a provider and is idempotent', async () => {
    await db
      .transaction(async (tx) => {
        // Seed the encrypted custom-oidc credential blob the connect flow stores.
        await tx.insert(integrationPlatformCredentials).values({
          integrationType: 'auth_custom-oidc',
          secrets: encryptPlatformCredentials({
            displayName: 'Okta',
            clientId: 'client-123',
            clientSecret: 'shh',
            discoveryUrl: 'https://okta.example.com/.well-known/openid-configuration',
            scopes: 'openid email profile',
          }),
        })

        const accountsBefore = await tx.select({ id: account.id }).from(account)

        const first = await backfillCustomOidcProvider(tx)
        expect(first.created).toBe(1)

        const providers = await tx
          .select()
          .from(identityProvider)
          .where(eq(identityProvider.registrationId, 'custom-oidc'))
        expect(providers).toHaveLength(1)
        expect(providers[0].showButton).toBe(true)
        expect(providers[0].clientId).toBe('client-123')
        expect(providers[0].label).toBe('Okta')
        expect(providers[0].discoveryUrl).toBe(
          'https://okta.example.com/.well-known/openid-configuration'
        )

        // Credential key is unchanged — registration_id stays 'custom-oidc', so
        // account.provider_id rows still resolve. No re-key, no delete.
        const creds = await tx
          .select({ type: integrationPlatformCredentials.integrationType })
          .from(integrationPlatformCredentials)
          .where(eq(integrationPlatformCredentials.integrationType, 'auth_custom-oidc'))
        expect(creds).toHaveLength(1)

        // account rows are never touched by the backfill.
        const accountsAfter = await tx.select({ id: account.id }).from(account)
        expect(accountsAfter.length).toBe(accountsBefore.length)

        // Idempotent: a second run is a no-op now the provider exists.
        const second = await backfillCustomOidcProvider(tx)
        expect(second.created).toBe(0)

        throw new Error('__ROLLBACK__')
      })
      .catch((e) => {
        if (e.message !== '__ROLLBACK__') throw e
      })
  })
})
