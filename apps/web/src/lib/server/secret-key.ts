/**
 * The master secret in force right now.
 *
 * One accessor rather than a dozen `config.secretKey` reads, because "the app
 * uses a per-tenant `SECRET_KEY`" is only true if *every* consumer does. A
 * resolver that produces a per-tenant key which half the codebase then ignores
 * is worse than no resolver at all: it reads as solved.
 *
 * Under a pooled tenant scope this is the tenant's own key, resolved from the
 * registry record's `appSecretsRef` on pool checkout. With no scope — every
 * self-hosted install, and every pooled code path that runs outside a request —
 * it is `config.secretKey`, unchanged byte for byte.
 *
 * `getWorkspaceSecretKey()` returns exactly this one string and nothing else on
 * the scope, so the signing key and the storage credential no longer come out
 * of one call. A scope whose secrets never resolved throws there rather than
 * answering null, because the null branch below is the fleet-wide key.
 *
 * ## Why this is safe to swap under the session and token signers
 *
 * A wrong key here fails closed:
 * AES-GCM's auth tag does not verify, an HMAC does not match, and a session,
 * OAuth-CSRF, CSAT or stream token minted under one key is simply rejected under
 * another. Nothing is forged and nothing is corrupted. The cost of a key change
 * is invalidation, not damage — so the pooled fleet, which has never served real
 * traffic, pays nothing, and the single-tenant path does not change at all.
 *
 * The one place where a wrong key is *not* merely inconvenient is `encryption.ts`,
 * whose ciphertext is stored rather than presented. That is why the canary in
 * `tenancy/fingerprint.ts` refuses to serve a tenant whose key does not open it,
 * instead of letting the fleet discover the problem one integration at a time.
 */
import { config } from './config'
import { getWorkspaceSecretKey } from './tenancy/tenant-context'

export function activeSecretKey(): string {
  return getWorkspaceSecretKey() ?? config.secretKey
}
