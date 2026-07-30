/**
 * Guards `platform-schema.generated.json`, the committed description of the
 * integration platform-credential fields and the AI configuration keys.
 *
 * Two guards, because the artifact has two distinct ways to go wrong.
 *
 * Parity catches the artifact falling behind the code. Adding an integration,
 * renaming a credential field or adding an AI key changes the derivation, so the
 * committed file stops matching and this suite fails in the change that caused
 * it. That is the whole enforcement mechanism: it lives where the edit happens.
 *
 * Round trip catches the artifact being confidently wrong. Every `envKey` is
 * produced by the forward transform in `platform-schema.ts` and consumed by
 * `fieldFromEnvKey` inside `EnvCredentialSource`. If those two ever disagree, a
 * misnamed variable is still a valid variable that nothing reads, so the
 * provider stays unconfigured and no error is raised anywhere. The only way to
 * see it is to run the real reader over the generated names.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ARTIFACT_PATH,
  derivePlatformSchema,
  envKeyFor,
  envPrefixFor,
  envSuffixFor,
  serializePlatformSchema,
  type PlatformSchema,
} from '@/lib/server/domains/platform-credentials/platform-schema'
import { EnvCredentialSource } from '@/lib/server/domains/platform-credentials/credential-source'
import artifact from '../platform-schema.generated.json'

const committed = artifact as PlatformSchema

/** Distinct per field, so a value arriving under the wrong key is visible. */
const sentinel = (id: string, fieldKey: string) => `${id}:${fieldKey}`

/** Every generated variable name at once: what a fully populated environment looks like. */
function fullEnv(schema: PlatformSchema): Record<string, string> {
  const env: Record<string, string> = {}
  for (const provider of schema.providers) {
    for (const field of provider.fields) {
      env[field.envKey] = sentinel(provider.id, field.key)
    }
  }
  return env
}

describe('platform-schema.generated.json parity', () => {
  it('deep-equals a fresh derivation from the registry and the config env mapping', () => {
    expect(committed).toEqual(derivePlatformSchema())
  })

  it('is byte-identical to what the generator writes, so key order is pinned too', () => {
    expect(readFileSync(ARTIFACT_PATH, 'utf8')).toBe(
      serializePlatformSchema(derivePlatformSchema())
    )
  })

  it('is internally consistent: unique ids, prefixed env keys, fields iff configurable', () => {
    const ids = committed.providers.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)

    for (const provider of committed.providers) {
      expect(provider.envPrefix).toBe(envPrefixFor(provider.id))
      expect(provider.configurable).toBe(provider.fields.length > 0)
      for (const field of provider.fields) {
        expect(field.envKey.startsWith(provider.envPrefix)).toBe(true)
        expect(field.envKey.length).toBeGreaterThan(provider.envPrefix.length)
      }
    }

    const envKeys = committed.providers.flatMap((p) => p.fields.map((f) => f.envKey))
    expect(new Set(envKeys).size).toBe(envKeys.length)

    const aiKeys = committed.ai.keys.map((k) => k.key)
    expect(new Set(aiKeys).size).toBe(aiKeys.length)
    expect(aiKeys.every((k) => /^(?:AI|OPENAI)_/.test(k))).toBe(true)
  })

  it('marks a key sensitive if and only if it is a secret', () => {
    for (const key of committed.ai.keys) {
      expect(key.sensitive).toBe(key.kind === 'secret')
    }
  })
})

describe('platform-schema.generated.json env-var round trip', () => {
  it('decodes every generated env key back to the field key that produced it', async () => {
    const env = fullEnv(committed)
    for (const provider of committed.providers.filter((p) => p.configurable)) {
      const source = new EnvCredentialSource(
        env,
        async () => committed.providers.map((p) => p.id),
        async (id) => committed.providers.find((p) => p.id === id)?.fields.map((f) => f.key) ?? []
      )
      const expected = Object.fromEntries(
        provider.fields.map((f) => [f.key, sentinel(provider.id, f.key)])
      )
      // Exact match, not a subset: an extra key means the reader decoded a name
      // the generator did not intend, and a missing key means it failed to decode
      // one the generator emitted (which reads as "not configured", silently).
      expect(await source.get(provider.id)).toEqual(expected)
    }
  })

  it('reports every configurable provider as configured off the generated names alone', async () => {
    const source = new EnvCredentialSource(
      fullEnv(committed),
      async () => committed.providers.map((p) => p.id),
      async (id) => committed.providers.find((p) => p.id === id)?.fields.map((f) => f.key) ?? []
    )
    expect([...(await source.listConfigured())].sort()).toEqual(
      committed.providers
        .filter((p) => p.configurable)
        .map((p) => p.id)
        .sort()
    )
  })

  it('splits a multi-word id from its field correctly', async () => {
    // INTEGRATION_AZURE_DEVOPS_CLIENT_ID is ambiguous on its own: the underscores
    // separating the id from the field look exactly like the ones inside each.
    // Only the registry id resolves it, which is why the prefix is generated from
    // the id rather than guessed from the variable name.
    expect(envPrefixFor('azure_devops')).toBe('INTEGRATION_AZURE_DEVOPS_')
    expect(envKeyFor('azure_devops', 'clientId')).toBe('INTEGRATION_AZURE_DEVOPS_CLIENT_ID')
    expect(committed.providers.find((p) => p.id === 'azure_devops')?.envPrefix).toBe(
      'INTEGRATION_AZURE_DEVOPS_'
    )

    const source = new EnvCredentialSource(
      { INTEGRATION_AZURE_DEVOPS_CLIENT_ID: 'id', INTEGRATION_AZURE_DEVOPS_CLIENT_SECRET: 'sec' },
      async () => ['azure_devops'],
      async () => ['clientId', 'clientSecret']
    )
    expect(await source.get('azure_devops')).toEqual({ clientId: 'id', clientSecret: 'sec' })

    // A hyphenated id normalizes to the same prefix, so both spellings read the
    // same variables and neither can shadow the other with a different name.
    expect(envPrefixFor('azure-devops')).toBe(envPrefixFor('azure_devops'))
  })

  it('declares only field keys the transform pair can carry losslessly', () => {
    // The pair is lossless for camelCase and nothing else. A declared key holding
    // an underscore ('client_id') encodes to the same variable name as its
    // camelCase spelling and decodes back to the other one, so the reader would
    // store the value under a key no provider module ever asks for.
    for (const provider of committed.providers) {
      for (const field of provider.fields) {
        expect(field.key).toMatch(/^[a-z][A-Za-z0-9]*$/)
      }
    }
  })

  it('keeps digits attached to the run they follow, in both directions', async () => {
    expect(envSuffixFor('client2Id')).toBe('CLIENT2_ID')
    const source = new EnvCredentialSource(
      { INTEGRATION_ACME_CLIENT2_ID: 'v' },
      async () => ['acme'],
      async () => ['client2Id']
    )
    expect(await source.get('acme')).toEqual({ client2Id: 'v' })
  })

  it('has no provider prefix that is a prefix of another provider prefix', () => {
    // EnvCredentialSource matches with key.startsWith(prefix). If one prefix
    // contained another, the shorter provider would absorb the longer one's
    // variables under mangled field names.
    const prefixes = committed.providers.map((p) => p.envPrefix)
    for (const a of prefixes) {
      for (const b of prefixes) {
        if (a === b) continue
        expect(b.startsWith(a)).toBe(false)
      }
    }
  })
})
