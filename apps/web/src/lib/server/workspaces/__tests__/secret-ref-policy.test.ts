/**
 * What a workspace record is allowed to make this fleet go and fetch.
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

describe('the openbao schemes are gone, not merely confined', () => {
  /**
   * This suite used to assert that `openbao+kv://` was CONFINED to
   * `apps/<workspace>`, because `openbao+kv://secret/platform/ai` — the fleet's
   * shared AI credential — had been in policy by the artifact's own rules, and
   * was inert only because nothing could dereference the scheme.
   *
   * Migration 0051 removed the openbao schemes from the vocabulary entirely, so
   * the original hazard is now unreachable for a stronger reason: the ref does
   * not parse at all. The assertions are kept rather than deleted, because
   * "cannot be spelled" is the guarantee that replaced "must be confined", and
   * a suite that simply lost its subject would not notice the scheme coming
   * back.
   */
  it('refuses the fleet-wide platform tree it was written for', () => {
    expect(isValidSecretRef('openbao+kv://secret/platform/ai')).toBe(false)
    expect(isValidSecretRef('openbao+kv://secret/platform/integrations')).toBe(false)
  })

  it('refuses even the shape that used to be in policy', () => {
    expect(isValidSecretRef('openbao+kv://apps/ws-t1')).toBe(false)
    expect(isValidSecretRef('openbao+kv://apps/inst_cloud_alpha')).toBe(false)
    expect(isValidSecretRef('openbao+static-role://qb_role')).toBe(false)
    expect(() => parseSecretRef('openbao+kv://apps/ws-t1')).toThrow()
  })

  it('allows no field to name one', () => {
    for (const field of ['database', 'appSecrets', 'storage'] as SecretRefField[]) {
      expect(allowedSchemesFor(field)).not.toContain('openbao+kv')
      expect(allowedSchemesFor(field)).not.toContain('openbao+static-role')
    }
  })
})

describe('env refs stay inside the reserved namespace', () => {
  it('refuses a control-plane credential', () => {
    expect(isValidSecretRef('env://STRIPE_SECRET_KEY')).toBe(false)
    expect(isValidSecretRef('env://AWS_SECRET_ACCESS_KEY')).toBe(false)
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
      workspaceKey: 'inst_alpha',
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
      workspaceKey: 'inst_alpha',
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
    ['database', 'openbao+static-role://qb_role', false],
    ['database', 'env://QUACKBACK_TENANT_SECRET_DB', true],
    ['database', 'openbao+kv://apps/workspace', false],
    ['database', 'derived+hkdf://v1/t/app-secrets', false],
    ['database', 'sealed+aead://v1/t/db/' + 'A'.repeat(20), true],
    ['database', 'sealed+aead://v1/t/storage/' + 'A'.repeat(20), false],

    ['appSecrets', 'derived+hkdf://v1/t/app-secrets', true],
    ['appSecrets', 'openbao+kv://apps/workspace', false],
    ['appSecrets', 'env://QUACKBACK_TENANT_SECRET_APP', true],
    // Names a Postgres role, which is not an app-secret bundle.
    ['appSecrets', 'openbao+static-role://qb_role', false],
    ['appSecrets', 'sealed+aead://v1/t/db/' + 'A'.repeat(20), false],

    ['storage', 'sealed+aead://v1/t/storage/' + 'A'.repeat(20), true],
    ['storage', 'openbao+kv://apps/workspace', false],
    ['storage', 'env://QUACKBACK_TENANT_SECRET_STORAGE', true],
    // A scheme that would silently invent a plausible-looking key pair for a
    // real bucket is worse than one that refuses.
    ['storage', 'derived+hkdf://v1/t/storage', false],
    ['storage', 'derived+hkdf://v1/t/app-secrets', false],
  ]

  it.each(cases)('%s may name %s → %s', (field, ref, allowed) => {
    expect(isSecretRefAllowedFor(field, ref)).toBe(allowed)
  })

  it('never allows an out-of-policy target even on an allowed scheme', () => {
    expect(isSecretRefAllowedFor('appSecrets', 'openbao+kv://secret/platform/ai')).toBe(false)
    expect(isSecretRefAllowedFor('storage', 'env://STRIPE_SECRET_KEY')).toBe(false)
  })

  it('states the policy as data, so the three enforcement points cannot drift', () => {
    expect(allowedSchemesFor('database')).toEqual(['sealed+aead', 'env'])
    expect(allowedSchemesFor('appSecrets')).toEqual(['derived+hkdf', 'env'])
    expect(allowedSchemesFor('storage')).toEqual(['sealed+aead', 'env'])
  })
})
