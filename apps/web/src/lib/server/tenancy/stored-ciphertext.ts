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
 * Measured, 2026-08-09: a tenant's auth signing key was sealed under the
 * fleet-wide secret at 14:20; custody moved to a per-tenant key at 14:32 and a
 * fresh canary was stamped under it; pool checkout passed and every
 * authenticated request 500'd on the stale value for eighteen hours. Nothing in
 * the check was wrong — it was answering a question nobody was asking.
 *
 * So the check gets a second, independent fact: a real sample of the tenant's
 * own ciphertext, opened with the key that is about to be put into service.
 *
 * ## Why `jwks.private_key` and nothing else
 *
 * Several things are encrypted at rest — integration OAuth bundles, webhook
 * signing secrets, assistant custom-action headers, app signing secrets — and
 * every one of them goes through `encryption.ts`, which derives its key with
 * HKDF over *the active tenant namespace and a purpose string*. Reproducing that
 * derivation here would mean this module reconstructing, before the tenant scope
 * exists, the exact namespace and purpose each row was written under. Get it
 * wrong and the sample fails to open under the correct key: a false refusal, an
 * outage, and a worse failure than the silent one being fixed.
 *
 * The auth signing key is the exception. The `jwt()` plugin seals it with the
 * master secret **directly** (`secret: activeSecretKey()`), through the auth
 * library's own `symmetricEncrypt`, with no derivation in between. Opening it
 * therefore requires no assumption at all: the key either opens it or it does
 * not. It is also the value that actually broke, the only encrypted value the
 * broken tenant held, and the first ciphertext most tenants ever write — a
 * workspace mints it on the first request that signs anything, long before it
 * connects an integration.
 *
 * The row is read with the library's own opener rather than a local
 * reimplementation, for the same reason `vendor/fleet-secrets.ts` is pinned
 * byte-for-byte: a second copy of a decrypt is a second copy that can drift, and
 * the drift shows up as a refusal on a healthy tenant.
 *
 * ## What this deliberately does NOT do
 *
 * It does not decide anything. `absent` is not "pass" and `unopenable` is not
 * "refuse" — those are the verdict's to make, in one place, in `fingerprint.ts`.
 */
import { symmetricDecrypt } from 'better-auth/crypto'

/**
 * The one column sampled, named so the refusal can say where the evidence came
 * from. Not key material: a column name.
 */
export const STORED_CIPHERTEXT_SOURCE = 'jwks.private_key'

/**
 * Why a sample carried nothing to open.
 *
 * Four distinguishable states rather than one falsy one, because "this database
 * has nothing sealed under the key" and "this database has something sealed the
 * key could not open" must never reduce to the same value — that reduction is
 * the whole shape of the bug this check exists to close.
 */
export type StoredCiphertextAbsence =
  /** No row at the source at all. This tenant has never signed anything. */
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
 * distinct from `absent` because "nobody looked" and "we looked and this tenant
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
    // into a fleet-wide outage. Report it and let the tenant serve.
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
