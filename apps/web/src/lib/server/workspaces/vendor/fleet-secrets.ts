/**
 * Per-workspace application secrets, derived or sealed under one fleet root.
 *
 * This module is **vendored byte-for-byte into the app** (`apps/web/src/lib/server/
 * tenancy/vendor/fleet-secrets.ts`) and guarded by a digest test there, for the
 * same reason `contract.ts` is: the control plane seals a value and a fleet
 * replica opens it. If the two sides ever compute a different key, the control
 * plane does not get an error — it gets ciphertext nobody can open, which for
 * `SECRET_KEY` means integration OAuth tokens, webhook signing secrets and
 * custom-action headers are permanently unrecoverable. A drift here is not a bug
 * report, it is data loss, so the copy is pinned rather than trusted.
 *
 * ## Two schemes, because the two halves are not the same problem
 *
 * `SECRET_KEY` is a value **we choose**. Nothing outside this system needs to
 * agree with it, so it does not have to be stored at all: derive it from one
 * fleet root with the workspace id as domain separation and every replica computes
 * the same answer with no network hop, no store and no handoff. Custody stops
 * being a delivery problem, which is exactly the failure mode that shipped once
 * already on the database credential.
 *
 * S3 credentials are a value **a provider chose**. Cloudflare mints the key pair
 * for a bucket; no amount of HKDF produces it. So it has to be carried, and the
 * only question is how. It is sealed under a key derived from the same root and
 * bound to the workspace, and the sealed blob rides in the reference itself — which
 * means it is read in the same row, in the same query, as the DSN. That is
 * `SAAS-HOSTING-STACK.md` §4.3's "atomically with `databaseUrl`" satisfied
 * literally rather than by convention.
 *
 * ## On blast radius, stated honestly
 *
 * One root key opens every workspace. That is worth saying plainly rather than
 * burying — but it is not a regression: **today every pooled workspace shares one
 * literal `SECRET_KEY`**, so a root that yields a *different* key per workspace is
 * strictly better than the state it replaces, not worse. It is also weaker than
 * an external custodian holding N independent secrets, and that remains the
 * destination. The scheme is designed so that move is possible without a
 * re-encrypt: a workspace whose ref stops saying `derived+hkdf://` and starts
 * saying something else is a per-workspace decision, one record at a time.
 *
 * ## Rotation
 *
 * Every ref carries a **generation**. A new root is installed alongside the old
 * one; refs are rewritten to the new generation workspace by workspace; the old
 * generation stays derivable throughout, so re-encrypting a workspace's ciphertext
 * is an ordinary migration rather than a flag day. Nothing here implements the
 * rewrite — but nothing here forecloses it, which is the property a scheme has
 * to have *before* it holds anything.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * The lowest root-key length this will accept.
 *
 * HKDF does not require a minimum, and that is the trap: it will happily stretch
 * eight characters into a 256-bit key that looks exactly as good as a real one.
 * The floor has to be enforced where the root enters the system, because
 * nothing downstream can tell the difference.
 */
export const FLEET_ROOT_KEY_MIN_LENGTH = 32

/** HKDF salt. Fixed and versioned; changing it changes every derived key. */
const HKDF_SALT = 'quackback-fleet-root-v1'

const KEY_LENGTH = 32
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const ALGORITHM = 'aes-256-gcm' as const

export class FleetSecretError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'FleetSecretError'
    this.code = code
  }
}

/**
 * What a derived or sealed secret is *for*.
 *
 * Kept as a closed list rather than a free string: the purpose is part of the
 * key-derivation info, so a typo would silently mint a different key rather than
 * fail, and "silently a different key" is the one outcome this whole module
 * exists to prevent.
 */
export const FLEET_SECRET_PURPOSES = ['app-secrets', 'storage', 'db'] as const
export type FleetSecretPurpose = (typeof FLEET_SECRET_PURPOSES)[number]

export interface FleetSecretTarget {
  /** Root-key generation. Bumped to rotate; old generations stay derivable. */
  generation: number
  /** The workspace this secret belongs to. Bound into the key, not just the path. */
  workspaceKey: string
  purpose: FleetSecretPurpose
}

function assertRootKey(rootKey: string): void {
  if (typeof rootKey !== 'string' || rootKey.length < FLEET_ROOT_KEY_MIN_LENGTH) {
    throw new FleetSecretError(
      'root_key_unusable',
      `the fleet root key must be at least ${FLEET_ROOT_KEY_MIN_LENGTH} characters; ` +
        'a short root is stretched by HKDF into something that looks like a real key',
    )
  }
}

function assertTarget(target: FleetSecretTarget): void {
  if (!Number.isInteger(target.generation) || target.generation < 1) {
    throw new FleetSecretError('bad_generation', `generation must be a positive integer`)
  }
  if (typeof target.workspaceKey !== 'string' || target.workspaceKey === '') {
    throw new FleetSecretError('bad_workspace', 'a fleet secret target needs a workspace id')
  }
  if (!(FLEET_SECRET_PURPOSES as readonly string[]).includes(target.purpose)) {
    throw new FleetSecretError('bad_purpose', `unknown fleet secret purpose: ${target.purpose}`)
  }
}

/** `quackback:fleet:<kind>:v<gen>:<workspaceKey>:<purpose>` — the HKDF info string. */
function info(kind: 'derive' | 'seal', target: FleetSecretTarget): string {
  return `quackback:fleet:${kind}:v${target.generation}:${target.workspaceKey}:${target.purpose}`
}

function subKey(rootKey: string, kind: 'derive' | 'seal', target: FleetSecretTarget): Buffer {
  return Buffer.from(hkdfSync('sha256', rootKey, HKDF_SALT, info(kind, target), KEY_LENGTH))
}

/**
 * The per-workspace secret for `target`, as URL-safe base64.
 *
 * Returned as text rather than bytes because its consumer is `SECRET_KEY`, which
 * the application treats as a string throughout (`config.secretKey` feeds
 * `hkdfSync` as input keying material). 32 bytes of HKDF output, so a full
 * 256 bits of entropy regardless of how the root was written down.
 */
export function deriveWorkspaceSecret(rootKey: string, target: FleetSecretTarget): string {
  assertRootKey(rootKey)
  assertTarget(target)
  return subKey(rootKey, 'derive', target).toString('base64url')
}

/**
 * Seal `plaintext` for one workspace and purpose.
 *
 * The workspace and purpose are bound twice — once through the key's HKDF info, and
 * again as AEAD additional data. The second is redundant while every purpose has
 * its own key, and it is kept deliberately: the binding then survives any later
 * change that reuses one key across purposes, which is precisely the kind of
 * refactor that looks safe and is not.
 */
export function sealWorkspaceSecret(
  rootKey: string,
  target: FleetSecretTarget,
  plaintext: string,
): string {
  assertRootKey(rootKey)
  assertTarget(target)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, subKey(rootKey, 'seal', target), iv, {
    authTagLength: AUTH_TAG_LENGTH,
  })
  cipher.setAAD(Buffer.from(aad(target), 'utf8'))
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url')
}

/**
 * Open a sealed blob.
 *
 * Every failure is one error with one code. A blob sealed for another workspace, a
 * blob from another generation, a truncated blob and a wrong root key are
 * indistinguishable to an attacker and identical to the caller: all of them mean
 * "this process cannot open this", and none of them may fall back to anything.
 */
export function openWorkspaceSecret(
  rootKey: string,
  target: FleetSecretTarget,
  blob: string,
): string {
  assertRootKey(rootKey)
  assertTarget(target)
  let raw: Buffer
  try {
    raw = Buffer.from(blob, 'base64url')
  } catch {
    throw new FleetSecretError('sealed_unreadable', 'sealed secret is not valid base64url')
  }
  if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new FleetSecretError('sealed_unreadable', 'sealed secret is too short to be a sealed value')
  }
  const iv = raw.subarray(0, IV_LENGTH)
  const tag = raw.subarray(raw.length - AUTH_TAG_LENGTH)
  const body = raw.subarray(IV_LENGTH, raw.length - AUTH_TAG_LENGTH)
  try {
    const decipher = createDecipheriv(ALGORITHM, subKey(rootKey, 'seal', target), iv, {
      authTagLength: AUTH_TAG_LENGTH,
    })
    decipher.setAAD(Buffer.from(aad(target), 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    throw new FleetSecretError(
      'sealed_unopenable',
      `sealed secret for ${target.workspaceKey}/${target.purpose} (generation ${target.generation}) ` +
        'did not open: wrong root key, wrong generation, or a blob sealed for another workspace',
    )
  }
}

function aad(target: FleetSecretTarget): string {
  return `v${target.generation}|${target.workspaceKey}|${target.purpose}`
}

// =============================================================================
// The SECRET_KEY canary
// =============================================================================

/**
 * A wrong `SECRET_KEY` does not announce itself.
 *
 * AES-GCM fails closed, so nothing is forged and nothing is corrupted — but a
 * fleet holding the wrong key for a workspace writes *new* ciphertext under it
 * while the old ciphertext stops opening, and the only symptom is scattered
 * per-call errors. `SAAS-HOSTING-STACK.md` §4.3 is explicit that this makes an
 * entire class of stored data permanently unrecoverable.
 *
 * So the key gets the same treatment §3 gives the database: **the workspace
 * database carries a fact only the right key can verify**, checked once per pool
 * on the same pass as the fingerprint. A replica that cannot open the canary
 * refuses to serve the workspace instead of writing under a key that will not open
 * tomorrow.
 *
 * The canary is a sealed constant rather than a hash: a hash of the key would
 * be an offline-guessable verifier sitting in a database, while a sealed
 * constant proves possession without publishing anything about the key.
 */
export const SECRET_KEY_CANARY_PLAINTEXT = 'quackback-secret-key-canary-v1'

/**
 * Seal the canary under `secretKey` itself — NOT under the fleet root.
 *
 * That distinction is the whole value of the check. Sealing under the root would
 * verify "this process has the root", which the process just used to derive the
 * key and therefore always has. Sealing under the *derived key* verifies "the
 * key this process is about to encrypt with is the key this database's existing
 * ciphertext was written under", which is the actual question.
 */
export function sealSecretKeyCanary(secretKey: string, workspaceKey: string): string {
  if (typeof secretKey !== 'string' || secretKey === '') {
    throw new FleetSecretError('bad_secret_key', 'cannot seal a canary without a secret key')
  }
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, canaryKey(secretKey), iv, {
    authTagLength: AUTH_TAG_LENGTH,
  })
  cipher.setAAD(Buffer.from(`canary|${workspaceKey}`, 'utf8'))
  const body = Buffer.concat([
    cipher.update(SECRET_KEY_CANARY_PLAINTEXT, 'utf8'),
    cipher.final(),
  ])
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url')
}

/** True when `secretKey` opens `canary` and finds the expected constant. */
export function verifySecretKeyCanary(
  secretKey: string,
  workspaceKey: string,
  canary: string,
): boolean {
  if (typeof secretKey !== 'string' || secretKey === '') return false
  if (typeof canary !== 'string' || canary === '') return false
  let raw: Buffer
  try {
    raw = Buffer.from(canary, 'base64url')
  } catch {
    return false
  }
  if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) return false
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      canaryKey(secretKey),
      raw.subarray(0, IV_LENGTH),
      { authTagLength: AUTH_TAG_LENGTH },
    )
    decipher.setAAD(Buffer.from(`canary|${workspaceKey}`, 'utf8'))
    decipher.setAuthTag(raw.subarray(raw.length - AUTH_TAG_LENGTH))
    const opened = Buffer.concat([
      decipher.update(raw.subarray(IV_LENGTH, raw.length - AUTH_TAG_LENGTH)),
      decipher.final(),
    ])
    const expected = Buffer.from(SECRET_KEY_CANARY_PLAINTEXT, 'utf8')
    return opened.length === expected.length && timingSafeEqual(opened, expected)
  } catch {
    return false
  }
}

function canaryKey(secretKey: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', secretKey, HKDF_SALT, 'quackback:fleet:canary:v1', KEY_LENGTH),
  )
}

// =============================================================================
// Stamp provenance
// =============================================================================

/**
 * What a canary was stamped with, recorded in plaintext beside it.
 *
 * The canary proves possession and publishes nothing — which is exactly right,
 * and exactly why a mismatch is undiagnosable. A sealed constant cannot tell you
 * which key sealed it, so "this key does not open it" is the whole of what a
 * replica can say. Recovering the answer meant sweeping every piece of secret
 * material on a machine against every generation, and concluding "the key is
 * lost" when that sweep came back empty — which was wrong, and one step from an
 * unnecessary re-key that would have destroyed another team's work.
 *
 * So the *provenance* is recorded next to the canary in the clear. None of it is
 * secret: a scheme name, an integer, an ISO timestamp, and a domain-separated
 * tag of the key material.
 */
export type SecretStampProvenance = {
  v: 1
  /** The ref scheme in force when this canary was written. */
  refScheme: string
  /** Root generation for a derived ref; 0 when the scheme carries no generation. */
  generation: number
  /**
   * A tag of the material the key came from — the fleet root for a derived ref,
   * the literal for an `env://` one.
   */
  materialFingerprint: string
  stampedAt: string
}

/**
 * A comparable, non-reversible tag for secret material.
 *
 * Deliberately NOT a bare `sha256(material)`. This run's logs, scratchpad files
 * and handover notes are full of `sha256sum` fingerprints of keys, and a bare
 * hash stored in a database would be directly comparable with all of them —
 * turning a diagnostic aid into a way to confirm a guessed key against material
 * fingerprinted somewhere else entirely. Domain separation removes that: the tag
 * is comparable only with other tags computed for this purpose.
 *
 * An operator compares theirs with `verify-workspace-secrets.ts`, which prints it.
 */
export function secretMaterialFingerprint(material: string): string {
  if (typeof material !== 'string' || material === '') return 'none'
  return Buffer.from(
    hkdfSync('sha256', material, HKDF_SALT, 'quackback:fleet:material-fingerprint:v1', 8),
  ).toString('hex')
}

/** Build the provenance for a stamp about to be written. */
export function buildStampProvenance(input: {
  refScheme: string
  generation: number
  material: string
  now?: Date
}): SecretStampProvenance {
  return {
    v: 1,
    refScheme: input.refScheme,
    generation: input.generation,
    materialFingerprint: secretMaterialFingerprint(input.material),
    stampedAt: (input.now ?? new Date()).toISOString(),
  }
}

/** Parse stored provenance. Never throws; unreadable is indistinguishable from absent. */
export function parseStampProvenance(raw: string | null | undefined): SecretStampProvenance | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const p = parsed as Partial<SecretStampProvenance>
  if (p?.v !== 1) return null
  if (typeof p.refScheme !== 'string' || p.refScheme === '') return null
  if (typeof p.materialFingerprint !== 'string') return null
  return {
    v: 1,
    refScheme: p.refScheme,
    generation: typeof p.generation === 'number' ? p.generation : 0,
    materialFingerprint: p.materialFingerprint,
    stampedAt: typeof p.stampedAt === 'string' ? p.stampedAt : '',
  }
}
