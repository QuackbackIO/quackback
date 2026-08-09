/**
 * What a tenant record is allowed to make this fleet go and fetch.
 *
 * A ref comes out of a database, so it is input. The rules about which secret a
 * ref may name have to hold at parse time, not only at resolve time, and they
 * have to hold per FIELD — a scheme being implementable is not the same as it
 * being appropriate in a given column.
 *
 * The case this suite exists for is the first one below. Before the resolvers
 * landed, `openbao+kv://` was checked for traversal and nothing else, so
 * `openbao+kv://secret/platform/ai` — the fleet's shared AI credential — was in
 * policy by the artifact's own rules. It was assessed as inert, correctly, for
 * exactly one reason: nothing could dereference the scheme. Shipping a resolver
 * is what would have made it reachable.
 */
import { describe, expect, it } from 'vitest'
import {
  allowedSchemesFor,
  isSecretRefAllowedFor,
  isValidSecretRef,
  parseSecretRef,
  type SecretRefField,
} from '../vendor/secret-ref'

describe('openbao+kv is confined to apps/<tenant>', () => {
  it('refuses the fleet-wide platform tree', () => {
    expect(isValidSecretRef('openbao+kv://secret/platform/ai')).toBe(false)
    expect(isValidSecretRef('openbao+kv://secret/platform/integrations')).toBe(false)
    expect(() => parseSecretRef('openbao+kv://secret/platform/ai')).toThrow(/confined/)
  })

  it('refuses anything outside the apps/ prefix, and any extra segment', () => {
    for (const ref of [
      'openbao+kv://apps',
      'openbao+kv://apps/',
      'openbao+kv://apps/tenant/extra',
      'openbao+kv://appsfoo/tenant',
      'openbao+kv://../secret/platform/ai',
      'openbao+kv://apps/../../secret/platform/ai',
      'openbao+kv://APPS/tenant',
    ]) {
      expect(isValidSecretRef(ref), ref).toBe(false)
    }
  })

  it('still accepts the shape the control plane has always written', () => {
    // The positive control. Without it a confinement that rejected everything
    // would look identical to a confinement that works, and it would take a
    // fleet-wide outage to tell them apart.
    expect(parseSecretRef('openbao+kv://apps/neon-t1')).toMatchObject({
      scheme: 'openbao+kv',
      path: 'apps/neon-t1',
      tenantSegment: 'neon-t1',
    })
    expect(isValidSecretRef('openbao+kv://apps/inst_gauntlet_alpha')).toBe(true)
  })
})

describe('env refs stay inside the reserved namespace', () => {
  it('refuses a control-plane credential', () => {
    expect(isValidSecretRef('env://STRIPE_SECRET_KEY')).toBe(false)
    expect(isValidSecretRef('env://NEON_API_KEY')).toBe(false)
  })
  it('accepts the reserved namespace', () => {
    expect(isValidSecretRef('env://QUACKBACK_TENANT_SECRET_X')).toBe(true)
  })
})

describe('derived+hkdf and sealed+aead grammar', () => {
  it('parses a well-formed derived ref', () => {
    expect(parseSecretRef('derived+hkdf://v1/inst_alpha/app-secrets')).toEqual({
      scheme: 'derived+hkdf',
      generation: 1,
      tenantId: 'inst_alpha',
      purpose: 'app-secrets',
    })
  })

  it('refuses a derived ref with no generation, a zero generation, or a path escape', () => {
    for (const ref of [
      'derived+hkdf://inst_alpha/app-secrets',
      'derived+hkdf://v0/inst_alpha/app-secrets',
      'derived+hkdf://v1/inst_alpha/app-secrets/extra',
      'derived+hkdf://v1//app-secrets',
      'derived+hkdf://v1/../app-secrets',
    ]) {
      expect(isValidSecretRef(ref), ref).toBe(false)
    }
  })

  it('parses a sealed ref and keeps the blob out of the parsed path fields', () => {
    const parsed = parseSecretRef('sealed+aead://v2/inst_alpha/storage/' + 'A'.repeat(40))
    expect(parsed).toMatchObject({
      scheme: 'sealed+aead',
      generation: 2,
      tenantId: 'inst_alpha',
      purpose: 'storage',
    })
  })

  it('refuses a sealed blob outside the base64url alphabet', () => {
    // `+` and `/` would collide with the scheme separator and the path
    // separator, so the alphabet is load-bearing rather than a preference.
    expect(isValidSecretRef('sealed+aead://v1/t/storage/' + 'A'.repeat(20) + '+')).toBe(false)
    expect(isValidSecretRef('sealed+aead://v1/t/storage/' + 'A'.repeat(20) + '/x')).toBe(false)
  })
})

describe('per-field policy', () => {
  const cases: Array<[SecretRefField, string, boolean]> = [
    // A database credential is issued by a provider or a vault. It is never a
    // value this system chooses, so nothing derivable belongs here.
    ['database', 'neon+role://proj-1/br-abc/qb_role', true],
    ['database', 'openbao+static-role://qb_role', true],
    ['database', 'env://QUACKBACK_TENANT_SECRET_DB', true],
    ['database', 'openbao+kv://apps/tenant', false],
    ['database', 'derived+hkdf://v1/t/app-secrets', false],
    ['database', 'sealed+aead://v1/t/storage/' + 'A'.repeat(20), false],

    ['appSecrets', 'derived+hkdf://v1/t/app-secrets', true],
    ['appSecrets', 'openbao+kv://apps/tenant', true],
    ['appSecrets', 'env://QUACKBACK_TENANT_SECRET_APP', true],
    // Names a Postgres role, which is not an app-secret bundle.
    ['appSecrets', 'openbao+static-role://qb_role', false],
    ['appSecrets', 'neon+role://proj-1/br-abc/qb_role', false],

    ['storage', 'sealed+aead://v1/t/storage/' + 'A'.repeat(20), true],
    ['storage', 'openbao+kv://apps/tenant', true],
    ['storage', 'env://QUACKBACK_TENANT_SECRET_STORAGE', true],
    // A scheme that would silently invent a plausible-looking key pair for a
    // real bucket is worse than one that refuses.
    ['storage', 'derived+hkdf://v1/t/storage', false],
    ['storage', 'neon+role://proj-1/br-abc/qb_role', false],
  ]

  it.each(cases)('%s may name %s → %s', (field, ref, allowed) => {
    expect(isSecretRefAllowedFor(field, ref)).toBe(allowed)
  })

  it('never allows an out-of-policy target even on an allowed scheme', () => {
    expect(isSecretRefAllowedFor('appSecrets', 'openbao+kv://secret/platform/ai')).toBe(false)
    expect(isSecretRefAllowedFor('storage', 'env://STRIPE_SECRET_KEY')).toBe(false)
  })

  it('states the policy as data, so the three enforcement points cannot drift', () => {
    expect(allowedSchemesFor('database')).toEqual([
      'openbao+static-role',
      'neon+role',
      'env',
    ])
    expect(allowedSchemesFor('appSecrets')).toEqual(['derived+hkdf', 'openbao+kv', 'env'])
    expect(allowedSchemesFor('storage')).toEqual(['sealed+aead', 'openbao+kv', 'env'])
  })
})
