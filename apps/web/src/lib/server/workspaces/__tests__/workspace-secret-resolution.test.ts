/**
 * A record's refs → the workspace's actual secrets, and what happens when they do
 * not resolve.
 *
 * Two properties carry the piece, and they pull in opposite directions:
 *
 * 1. **A missing or wrong `SECRET_KEY` refuses**, and never substitutes the
 *    fleet-wide one. That fallback is the state this replaces, and it is not a
 *    read-only mistake — the fleet would go on WRITING ciphertext under the
 *    wrong key.
 * 2. **A missing storage credential degrades storage only.** Refusing an entire
 *    workspace because one bucket credential is unreadable turns a broken
 *    integration into an outage.
 */
import { describe, expect, it } from 'vitest'
import { deriveWorkspaceSecret, sealWorkspaceSecret } from '../vendor/fleet-secrets'
import {
  encodeStorageCredentials,
  resolveWorkspaceSecretsFromRefs,
  workspaceAppSecretVariable,
  WorkspaceSecretResolutionError,
} from '../vendor/workspace-secret-resolution'

const ROOT = 'resolution-test-fleet-root-key-0123456789'
const WORKSPACE = 'inst_alpha'

const CREDS = { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'sk-0123456789abcdef' }

function sealedStorageRef(workspaceKey = WORKSPACE, generation = 1, root = ROOT): string {
  const blob = sealWorkspaceSecret(
    root,
    { generation, workspaceKey, purpose: 'storage' },
    encodeStorageCredentials(CREDS)
  )
  return `sealed+aead://v${generation}/${workspaceKey}/storage/${blob}`
}

function resolve(over: Partial<Parameters<typeof resolveWorkspaceSecretsFromRefs>[0]> = {}) {
  return resolveWorkspaceSecretsFromRefs({
    workspaceKey: WORKSPACE,
    appSecretsRef: `derived+hkdf://v1/${WORKSPACE}/app-secrets`,
    storageCredentialRef: sealedStorageRef(),
    rootKey: ROOT,
    env: {},
    ...over,
  })
}

describe('the happy path', () => {
  it('derives the workspace’s SECRET_KEY and opens its storage credentials', () => {
    const resolved = resolve()
    expect(resolved.secretKey).toBe(
      deriveWorkspaceSecret(ROOT, {
        generation: 1,
        workspaceKey: WORKSPACE,
        purpose: 'app-secrets',
      })
    )
    expect(resolved.storage).toEqual(CREDS)
    expect(resolved.storageProblem).toBeNull()
  })

  it('gives two workspaces different keys and different storage credentials', () => {
    const alpha = resolve()
    const bravo = resolveWorkspaceSecretsFromRefs({
      workspaceKey: 'inst_bravo',
      appSecretsRef: 'derived+hkdf://v1/inst_bravo/app-secrets',
      storageCredentialRef: (() => {
        const blob = sealWorkspaceSecret(
          ROOT,
          { generation: 1, workspaceKey: 'inst_bravo', purpose: 'storage' },
          encodeStorageCredentials({ accessKeyId: 'AKB', secretAccessKey: 'sk-bravo-000000' })
        )
        return `sealed+aead://v1/inst_bravo/storage/${blob}`
      })(),
      rootKey: ROOT,
      env: {},
    })

    expect(alpha.secretKey).not.toBe(bravo.secretKey)
    expect(alpha.storage!.secretAccessKey).not.toBe(bravo.storage!.secretAccessKey)
  })
})

describe('a ref must name the workspace whose record carries it', () => {
  it('refuses an app-secrets ref naming another workspace', () => {
    // Without this, a row that named another workspace would derive that workspace's
    // key — the §3 wrong-pool failure moved to the secret, and just as quiet.
    expect(() => resolve({ appSecretsRef: 'derived+hkdf://v1/inst_bravo/app-secrets' })).toThrow(
      /names workspace inst_bravo but sits on the record for inst_alpha/
    )
  })

  it('reports a storage ref naming another workspace as a storage problem', () => {
    const resolved = resolve({ storageCredentialRef: sealedStorageRef('inst_bravo') })
    expect(resolved.storage).toBeNull()
    expect(resolved.storageProblem).toMatch(/names workspace inst_bravo/)
    // …and the app-secret half is unaffected, which is the asymmetry.
    expect(resolved.secretKey).toBeTruthy()
  })
})

describe('SECRET_KEY failures refuse the workspace', () => {
  it('refuses a scheme this process cannot resolve, by name', () => {
    // A scheme that PARSES but has no app-secret resolver. It used to be
    // `openbao+kv://`, which 0051 removed from the vocabulary altogether — so
    // that ref now dies one layer earlier, in the parser, and would no longer
    // exercise this path at all. `sealed+aead://` is well-formed and legal in
    // the database column, which is exactly the mistake worth refusing by name.
    expect(() =>
      resolve({ appSecretsRef: 'sealed+aead://v1/inst_alpha/db/' + 'A'.repeat(20) })
    ).toThrow(WorkspaceSecretResolutionError)
    expect(() =>
      resolve({ appSecretsRef: 'sealed+aead://v1/inst_alpha/db/' + 'A'.repeat(20) })
    ).toThrow(/no resolver for 'sealed\+aead:\/\/' app secrets/)
  })

  it('refuses when the fleet root key is absent', () => {
    expect(() => resolve({ rootKey: null })).toThrow(/QUACKBACK_FLEET_ROOT_KEY is unset/)
  })

  it('refuses an env ref whose variable is unset, rather than returning empty', () => {
    expect(() =>
      resolve({ appSecretsRef: `env://${workspaceAppSecretVariable(WORKSPACE)}`, env: {} })
    ).toThrow(/which is unset/)
  })

  it('never returns the fleet-wide key as a substitute', () => {
    // The assertion that matters is the absence of a value, not the presence of
    // a throw: a resolver that quietly returned `config.secretKey` here would
    // satisfy every other test in this file.
    let resolved: unknown
    try {
      resolved = resolve({ appSecretsRef: 'openbao+kv://apps/alpha' })
    } catch {
      resolved = null
    }
    expect(resolved).toBeNull()
  })

  it('resolves an env-supplied SECRET_KEY when the variable IS set', () => {
    // Positive control for the two refusals above.
    const variable = workspaceAppSecretVariable(WORKSPACE)
    const resolved = resolve({
      appSecretsRef: `env://${variable}`,
      env: { [variable]: 'an-operator-supplied-secret-key-000' },
    })
    expect(resolved.secretKey).toBe('an-operator-supplied-secret-key-000')
  })

  it('refuses an env ref naming a variable that is not THIS workspace’s', () => {
    // An env ref carries no workspace, so the ref-names-workspace check has nothing to
    // read — and without this, two hand-edited records can name one variable and
    // silently share a SECRET_KEY. The canary cannot see that: both workspaces
    // derive the same key, so both canaries open, and nothing anywhere notices.
    const bravos = workspaceAppSecretVariable('inst_bravo')
    expect(() =>
      resolve({ appSecretsRef: `env://${bravos}`, env: { [bravos]: 'shared-key-000000000000000' } })
    ).toThrow(/must be held in QUACKBACK_TENANT_SECRET_INST_ALPHA_/)
  })

  it('gives two workspaces different variable names, so they cannot collide', () => {
    expect(workspaceAppSecretVariable('inst_alpha')).not.toBe(
      workspaceAppSecretVariable('inst_bravo')
    )
    // The normalisation is lossy, so the digest is what separates these two.
    expect(workspaceAppSecretVariable('inst_a-b')).not.toBe(workspaceAppSecretVariable('inst_a_b'))
  })
})

describe('storage failures degrade storage only', () => {
  it('reports a wrong root key as a problem, not as a throw', () => {
    const variable = workspaceAppSecretVariable(WORKSPACE)
    const resolved = resolveWorkspaceSecretsFromRefs({
      workspaceKey: WORKSPACE,
      appSecretsRef: `env://${variable}`,
      storageCredentialRef: sealedStorageRef(
        WORKSPACE,
        1,
        'a-different-fleet-root-key-000000000000'
      ),
      rootKey: ROOT,
      env: { [variable]: 'an-operator-supplied-secret-key-000' },
    })
    expect(resolved.secretKey).toBe('an-operator-supplied-secret-key-000')
    expect(resolved.storage).toBeNull()
    expect(resolved.storageProblem).toMatch(/did not open/)
  })

  it('reports a scheme with no resolver as a problem', () => {
    // Parses, but storage has no resolver for it: a derived key pair for a real
    // bucket would be a plausible-looking credential no provider accepts, which
    // is why the scheme is absent from the storage policy rather than merely
    // unimplemented. Degrades storage instead of refusing the workspace.
    const resolved = resolve({ storageCredentialRef: 'derived+hkdf://v1/alpha/storage' })
    expect(resolved.storage).toBeNull()
    expect(resolved.storageProblem).toMatch(/no resolver for 'derived\+hkdf:\/\/'/)
  })

  it('refuses a sealed payload that is not a credential pair', () => {
    const blob = sealWorkspaceSecret(
      ROOT,
      { generation: 1, workspaceKey: WORKSPACE, purpose: 'storage' },
      '{"accessKeyId":"AK"}'
    )
    const resolved = resolve({
      storageCredentialRef: `sealed+aead://v1/${WORKSPACE}/storage/${blob}`,
    })
    expect(resolved.storage).toBeNull()
    expect(resolved.storageProblem).toMatch(/no secretAccessKey/)
  })

  it('refuses an empty secret rather than building a client that fails at the provider', () => {
    const blob = sealWorkspaceSecret(
      ROOT,
      { generation: 1, workspaceKey: WORKSPACE, purpose: 'storage' },
      '{"accessKeyId":"AK","secretAccessKey":""}'
    )
    const resolved = resolve({
      storageCredentialRef: `sealed+aead://v1/${WORKSPACE}/storage/${blob}`,
    })
    expect(resolved.storage).toBeNull()
  })

  it('never falls back to another workspace’s or the fleet’s credentials', () => {
    const resolved = resolve({ storageCredentialRef: 'openbao+kv://apps/alpha' })
    expect(resolved.storage).toBeNull()
  })
})
