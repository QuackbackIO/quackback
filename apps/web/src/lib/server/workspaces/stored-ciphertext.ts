/**
 * Trying the resolved `SECRET_KEY` against ciphertext this database already
 * holds.
 *
 * The canary in `fingerprint.ts` answers "does this process hold the key the
 * canary was sealed with". Every caller of it needs the stronger claim: "is this
 * the key this database's *existing* ciphertext was written under". Those two
 * questions have the same answer right up until custody changes over a database
 * nobody re-encrypted, at which point the canary is re-stamped under the new key
 * and certifies it over data the new key cannot open.
 *
 * Measured, 2026-08-09: a workspace's auth signing key was sealed under the
 * fleet-wide secret at 14:20; custody moved to a per-workspace key at 14:32 and a
 * fresh canary was stamped under it; pool checkout passed and every
 * authenticated request 500'd on the stale value for eighteen hours. Nothing in
 * the check was wrong — it was answering a question nobody was asking.
 *
 * So the check gets a second, independent fact: a real sample of the workspace's
 * own ciphertext, opened with the key that is about to be put into service.
 *
 * ## Why `jwks.private_key` is the always-on sample
 *
 * The `jwt()` plugin seals the auth signing key with the master secret
 * **directly** (`secret: activeSecretKey()`), through the auth library's own
 * `symmetricEncrypt`, with no HKDF in between. Opening it therefore requires no
 * assumption about namespace or purpose. It is also the first ciphertext most
 * workspaces ever write.
 *
 * Integration and platform-credential rows go through `encryption.ts` HKDF.
 * Those cannot use `decrypt()` at checkout — that reads ALS, and the scope does
 * not exist yet. When the observer has the workspace key, a second sample
 * (`integration_platform_credentials.secrets`) is opened with `decryptWithSecret`
 * using the same info string production uses. A wrong purpose string would
 * refuse a healthy workspace, so the purpose is the production constant
 * `integration-platform-credentials`. Absent rows stay `absent`; only an
 * auth-tag failure is `unopenable`.
 *
 * The row is read with the library's own opener rather than a local
 * reimplementation, for the same reason `vendor/fleet-secrets.ts` is pinned
 * byte-for-byte: a second copy of a decrypt is a second copy that can drift, and
 * the drift shows up as a refusal on a healthy workspace.
 *
 * ## What this deliberately does NOT do
 *
 * It does not decide anything. `absent` is not "pass" and `unopenable` is not
 * "refuse" — those are the verdict's to make, in one place, in `fingerprint.ts`.
 */
import { symmetricDecrypt } from 'better-auth/crypto'
import { decryptWithSecret } from '@/lib/server/encryption'

/**
 * The one column sampled, named so the refusal can say where the evidence came
 * from. Not key material: a column name.
 */
export const STORED_CIPHERTEXT_SOURCE = 'jwks.private_key'

/** Second sample: HKDF-sealed platform OAuth app credentials. */
export const PLATFORM_CREDENTIALS_SOURCE = 'integration_platform_credentials.secrets'
export const PLATFORM_CREDENTIALS_PURPOSE = 'integration-platform-credentials'

/**
 * Why a sample carried nothing to open.
 *
 * Four distinguishable states rather than one falsy one, because "this database
 * has nothing sealed under the key" and "this database has something sealed the
 * key could not open" must never reduce to the same value — that reduction is
 * the whole shape of the bug this check exists to close.
 */
export type StoredCiphertextAbsence =
  /** No row at the source at all. This workspace has never signed anything. */
  | 'no-row'
  /** A row exists and the column is empty. Nothing is sealed in it. */
  | 'empty'
  /** Stored in plaintext — private-key encryption is switched off. */
  | 'not-sealed'
  /** Not in any shape this knows how to open. Reported, never refused on. */
  | 'unrecognised'

/**
 * What trying the resolved key against real stored ciphertext produced.
 *
 * `unobserved` is not something the sampler returns. It is the fail-closed
 * default for a verdict asked to rule with no evidence gathered, and it is kept
 * distinct from `absent` because "nobody looked" and "we looked and this workspace
 * has nothing at risk" are opposite conclusions.
 */
export type StoredCiphertextProbe =
  | { kind: 'unobserved' }
  | { kind: 'absent'; source: string; reason: StoredCiphertextAbsence }
  | { kind: 'opened'; source: string }
  | { kind: 'unopenable'; source: string }

/**
 * Open `sample` with `secretKey`, and report which of the four things happened.
 *
 * `sample` is the raw column: the auth library stores the sealed value
 * JSON-encoded, so a sealed row parses to a string and an unsealed one parses to
 * the key object itself.
 *
 * Never throws and never returns the plaintext. A caller that could see the
 * opened value would be holding a private key it has no use for; all it needs is
 * whether the door moved.
 */
export async function probeStoredCiphertext(
  secretKey: string,
  sample: string | null
): Promise<StoredCiphertextProbe> {
  const source = STORED_CIPHERTEXT_SOURCE
  if (sample === null || sample === undefined) return { kind: 'absent', source, reason: 'no-row' }
  if (sample.trim() === '') return { kind: 'absent', source, reason: 'empty' }

  let sealed: unknown
  try {
    sealed = JSON.parse(sample)
  } catch {
    // A shape this does not recognise is not evidence of a wrong key, and
    // refusing on it would turn any future change to how the value is stored
    // into a fleet-wide outage. Report it and let the workspace serve.
    return { kind: 'absent', source, reason: 'unrecognised' }
  }
  if (typeof sealed !== 'string') {
    // Private-key encryption disabled: the row holds the key in the clear, so
    // there is nothing here that a wrong key would fail to open.
    return { kind: 'absent', source, reason: 'not-sealed' }
  }
  if (sealed.trim() === '') return { kind: 'absent', source, reason: 'empty' }

  try {
    await symmetricDecrypt({ key: secretKey, data: sealed })
    return { kind: 'opened', source }
  } catch {
    return { kind: 'unopenable', source }
  }
}

/**
 * Open an `encryption.ts` ciphertext with an explicit master secret and
 * workspace namespace — checkout has both, and no ALS scope yet.
 */
export function probeHkdfCiphertext(
  secretKey: string,
  workspaceKey: string,
  sample: string | null,
  source = PLATFORM_CREDENTIALS_SOURCE,
  purpose = PLATFORM_CREDENTIALS_PURPOSE
): StoredCiphertextProbe {
  if (sample === null || sample === undefined) return { kind: 'absent', source, reason: 'no-row' }
  if (sample.trim() === '') return { kind: 'absent', source, reason: 'empty' }
  const parts = sample.split('.')
  if (parts.length !== 3) return { kind: 'absent', source, reason: 'unrecognised' }
  try {
    decryptWithSecret(sample, secretKey, workspaceKey, purpose)
    return { kind: 'opened', source }
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid ciphertext format') {
      return { kind: 'absent', source, reason: 'unrecognised' }
    }
    return { kind: 'unopenable', source }
  }
}
