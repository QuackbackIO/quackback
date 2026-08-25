/**
 * What the SECRET_KEY canary actually proves, versus what it is relied on to prove.
 *
 * `fleet-secrets.ts` and `fingerprint.ts` both state the canary's purpose in the
 * same words: it verifies that "the key this process is about to encrypt with is
 * the key this database's existing ciphertext was written under". `pool-cache.ts`
 * runs it once per pool on that basis, and `request-scope.ts` routes its failure
 * codes through `isKeyCustodyFailureCode` so a key problem never pulls the
 * cross-workspace alarm.
 *
 * The canary cannot answer that question. It is a constant, sealed by whichever
 * party most recently took custody, and it says only "this process holds the key
 * the canary was sealed with". Nothing ties it to the ciphertext already sitting
 * in the database, so a custody change that stamps a fresh canary certifies the
 * new key over stored data the new key cannot open.
 *
 * That is not hypothetical. It is the state `inst_cloud_ws_t2` was in on
 * 2026-08-09:
 *
 * | 12:21 | registry row created, no canary, no custody established |
 * | 14:20 | better-auth mints the workspace's JWKS, encrypted under the key then in force |
 * | 14:32 | custody moves to a per-workspace key; a fresh canary is stamped under it |
 * | after | pool checkout passes the canary, the workspace serves, and every |
 * |       | authenticated request 500s on a JWKS the resolved key cannot decrypt |
 *
 * The canary was absent at 14:32, and an absent canary is treated as greenfield
 * by the writer (`quackback-cp` `stampSecretKeyCanary` only refuses a canary that
 * is *present* and unopenable). But absent does not mean "nothing to protect", it
 * means "no record of which key this database's ciphertext was written under",
 * and the database held an obvious sample either way.
 *
 * These tests pin the gap. The first two describe what the canary does do and
 * pass today. The third asserts the property the callers rely on and is RED: the
 * verdict says `ok` for a key that cannot open the workspace's own stored ciphertext.
 *
 * Closing it needs the verdict to see a real sample rather than a minted
 * constant, which is a change to what `observeWorkspaceIdentity` reads and to the
 * `IdentityFailure` union, not a tweak to this predicate. Left red deliberately
 * so the gap is a failing test rather than a paragraph.
 *
 * ## Closed
 *
 * `observeWorkspaceIdentity` now samples `jwks.private_key` — real ciphertext the
 * workspace already holds, sealed under the master secret directly — and hands the
 * result to the verdict as a second, independent fact. The canary alone no
 * longer certifies anything: with nothing sampled the verdict refuses
 * (`secret_key_custody_unproven`), which is what turns the third test above
 * green, and with a sample the resolved key cannot open it refuses with
 * `secret_key_stored_ciphertext_mismatch`. The tests below cover the four states
 * that matter and the routing that follows from them.
 */
import { describe, expect, it } from 'vitest'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { symmetricEncrypt } from 'better-auth/crypto'
import {
  evaluateSecretKeyCanary,
  isIdentityFailureCode,
  isKeyCustodyFailureCode,
  KEY_CUSTODY_FAILURE_CODES,
  observeWorkspaceIdentity,
} from '../fingerprint'
import {
  PLATFORM_CREDENTIALS_PURPOSE,
  PLATFORM_CREDENTIALS_SOURCE,
  probeHkdfCiphertext,
  probeStoredCiphertext,
} from '../stored-ciphertext'
import { sealSecretKeyCanary } from '../vendor/fleet-secrets'

const WORKSPACE = 'inst_cloud_ws_t2'

/**
 * The key in force when the workspace's stored ciphertext was written, and the key
 * the fleet resolves for it now. Two independent 32-byte values, exactly as a
 * move from a fleet-wide `SECRET_KEY` to a per-workspace one produces.
 */
const KEY_AT_WRITE_TIME = 'a'.repeat(64)
const KEY_AFTER_CUSTODY_CHANGE = 'b'.repeat(64)

/**
 * `encryption.ts`'s scheme, reproduced at its own boundary: HKDF-SHA256 from the
 * master secret, then AES-256-GCM. Reproduced rather than imported because the
 * point here is the key, not the module, and importing it would drag in
 * `config` and the workspace-keyed cache for no gain.
 */
function sealStoredValue(masterSecret: string, plaintext: string): string {
  const key = Buffer.from(
    hkdfSync('sha256', masterSecret, 'quackback-encryption-salt-v1', 'quackback:v1:probe', 32)
  )
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.')
}

function opensStoredValue(masterSecret: string, ciphertext: string): boolean {
  const [ivB64, tagB64, bodyB64] = ciphertext.split('.')
  const key = Buffer.from(
    hkdfSync('sha256', masterSecret, 'quackback-encryption-salt-v1', 'quackback:v1:probe', 32)
  )
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64!, 'base64url'), {
      authTagLength: 16,
    })
    decipher.setAuthTag(Buffer.from(tagB64!, 'base64url'))
    Buffer.concat([decipher.update(Buffer.from(bodyB64!, 'base64url')), decipher.final()])
    return true
  } catch {
    return false
  }
}

describe('the SECRET_KEY canary, on its own terms', () => {
  it('refuses a key that does not open the stamped canary', () => {
    const canary = sealSecretKeyCanary(KEY_AT_WRITE_TIME, WORKSPACE)
    const verdict = evaluateSecretKeyCanary(WORKSPACE, KEY_AFTER_CUSTODY_CHANGE, canary)
    expect(verdict.ok).toBe(false)
    expect(verdict).toMatchObject({ code: 'secret_key_canary_mismatch' })
  })

  it('refuses when no canary was ever stamped, rather than passing on no evidence', () => {
    const verdict = evaluateSecretKeyCanary(WORKSPACE, KEY_AFTER_CUSTODY_CHANGE, null)
    expect(verdict.ok).toBe(false)
    expect(verdict).toMatchObject({ code: 'secret_key_canary_missing' })
  })
})

describe('the SECRET_KEY canary, on the terms its callers rely on', () => {
  it('refuses a key that opens the canary but not the workspace’s stored ciphertext', () => {
    // 14:20 — better-auth writes the workspace's JWKS under the key then in force.
    const storedCiphertext = sealStoredValue(KEY_AT_WRITE_TIME, '{"kty":"OKP","crv":"Ed25519"}')

    // 14:32 — custody moves. A fresh canary is stamped under the new key over a
    // database whose ciphertext nobody re-encrypted.
    const canary = sealSecretKeyCanary(KEY_AFTER_CUSTODY_CHANGE, WORKSPACE)

    // The database is genuinely stale: this is the fact the verdict is supposed
    // to be reporting, established independently so the assertion below cannot
    // pass for the wrong reason.
    expect(opensStoredValue(KEY_AFTER_CUSTODY_CHANGE, storedCiphertext)).toBe(false)
    expect(opensStoredValue(KEY_AT_WRITE_TIME, storedCiphertext)).toBe(true)

    // RED. Serving this workspace writes new ciphertext under a key that cannot
    // read the old, which is the exact outcome the canary is documented to
    // prevent, and every authenticated request 500s on the stale value.
    const verdict = evaluateSecretKeyCanary(WORKSPACE, KEY_AFTER_CUSTODY_CHANGE, canary)
    expect(verdict.ok).toBe(false)
  })
})

/**
 * The auth signing key, sealed the way the `jwt()` plugin seals it: the library's
 * own `symmetricEncrypt` under the master secret **directly**, then
 * JSON-encoded into the column. Written with the library's writer rather than a
 * local imitation, so a change to the format fails these tests instead of
 * letting them agree with a stale copy of it.
 */
async function sealAuthSigningKey(secretKey: string, jwk: string): Promise<string> {
  return JSON.stringify(await symmetricEncrypt({ key: secretKey, data: jwk }))
}

const JWK = '{"kty":"OKP","crv":"Ed25519","d":"not-a-real-key"}'

describe('sampling the workspace’s own stored ciphertext', () => {
  it('opens a sample written under the same key, and refuses one written under another', async () => {
    // Both directions from one fixture, so neither can pass by the probe
    // answering the same way regardless of the key it is handed.
    const stored = await sealAuthSigningKey(KEY_AT_WRITE_TIME, JWK)

    await expect(probeStoredCiphertext(KEY_AT_WRITE_TIME, stored)).resolves.toMatchObject({
      kind: 'opened',
      source: 'jwks.private_key',
    })
    await expect(probeStoredCiphertext(KEY_AFTER_CUSTODY_CHANGE, stored)).resolves.toMatchObject({
      kind: 'unopenable',
      source: 'jwks.private_key',
    })
  })

  it('tells the empty states apart from each other and from a successful open', async () => {
    // `null`, empty and unsealed all mean "nothing here a wrong key could fail
    // to open" — but they are different facts about the database, and the one
    // thing none of them may be is indistinguishable from `opened`. Collapsing
    // absence into success is the shape of the original bug.
    const reasons = await Promise.all([
      probeStoredCiphertext(KEY_AT_WRITE_TIME, null),
      probeStoredCiphertext(KEY_AT_WRITE_TIME, '   '),
      probeStoredCiphertext(KEY_AT_WRITE_TIME, JWK),
      probeStoredCiphertext(KEY_AT_WRITE_TIME, 'not json at all'),
    ])
    expect(reasons.map((r) => (r.kind === 'absent' ? r.reason : r.kind))).toEqual([
      'no-row',
      'empty',
      'not-sealed',
      'unrecognised',
    ])
    expect(reasons.every((r) => r.kind === 'absent')).toBe(true)
  })
})

/**
 * A `postgres.js` stand-in that records every statement it is asked to run and
 * answers each one from `answers`, in order. Enough to assert what the observer
 * reads and how many trips it takes to read it, which is the part no other test
 * in this tree can see.
 */
function fakeSql(answers: Array<unknown[] | (() => never)>) {
  const statements: string[] = []
  const sql = (strings: TemplateStringsArray) => {
    statements.push(strings.join('?'))
    const answer = answers[statements.length - 1]
    if (typeof answer === 'function') return Promise.reject(answer())
    return Promise.resolve(answer ?? [])
  }
  return { sql, statements }
}

const SETTINGS_ROW = {
  id: '019fe1ca-596e-7ff7-9edf-feecc2ce41b8',
  metadata: null,
  cloud_workspace_key: WORKSPACE,
  cloud_secret_canary: null,
}

describe('what observeWorkspaceIdentity reads', () => {
  it('samples the workspace’s ciphertext in the SAME statement as the settings row', async () => {
    // Cost, asserted rather than asserted-about. This runs on pool checkout, and
    // the sample has to ride along with a read that was already happening —
    // otherwise every pool build pays a round trip for it.
    const stored = await sealAuthSigningKey(KEY_AT_WRITE_TIME, JWK)
    const { sql, statements } = fakeSql([
      [{ ...SETTINGS_ROW, stored_ciphertext: stored }],
      [{ catalog_name: null, catalog_oid: null }],
    ])

    const observed = await observeWorkspaceIdentity(sql as never, KEY_AT_WRITE_TIME)

    expect(observed.storedCiphertext).toMatchObject({ kind: 'opened' })
    expect(statements[0]).toContain('jwks')
    expect(statements[0]).toContain('FROM settings')
    // The OLDEST row, and that is load-bearing. A rotation writes a new key
    // under whatever key is in force, so a fleet holding the wrong one would
    // mint a fresh row it can open and the check would congratulate itself.
    expect(statements[0]).toMatch(/ORDER BY\s+j\.created_at ASC/)
    // Two: the settings read and the catalog identity read, exactly as before.
    expect(statements).toHaveLength(2)
  })

  it('reports a stale sample as unopenable rather than as an absent one', async () => {
    const stored = await sealAuthSigningKey(KEY_AT_WRITE_TIME, JWK)
    const { sql } = fakeSql([
      [{ ...SETTINGS_ROW, stored_ciphertext: stored }],
      [{ catalog_name: null, catalog_oid: null }],
    ])

    const observed = await observeWorkspaceIdentity(sql as never, KEY_AFTER_CUSTODY_CHANGE)
    expect(observed.storedCiphertext).toMatchObject({ kind: 'unopenable' })
  })

  it('falls back to the settings-only read when the sampled table does not exist', async () => {
    // `jwks` arrives one migration after `settings`. A database between the two
    // has never finished provisioning, but this is the FIRST thing a pooled
    // process does with a workspace database, and turning a table that arrived a
    // migration later into a hard failure is how an ordering problem becomes an
    // outage. Undefined-table degrades to "nothing sampled"; nothing else does.
    const undefinedTable = () =>
      Object.assign(new Error('relation "jwks" does not exist'), {
        code: '42P01',
      })
    const { sql, statements } = fakeSql([
      () => {
        throw undefinedTable()
      },
      [{ ...SETTINGS_ROW }],
      [{ catalog_name: null, catalog_oid: null }],
    ])

    const observed = await observeWorkspaceIdentity(sql as never, KEY_AT_WRITE_TIME)

    expect(observed.selfReportedWorkspaceId).toBe(SETTINGS_ROW.id)
    expect(observed.storedCiphertext).toMatchObject({ kind: 'absent', reason: 'no-row' })
    expect(statements[1]).not.toContain('jwks')
  })

  it('does NOT swallow any other database error behind the fallback', async () => {
    // The fallback is scoped to one error code on purpose. A permission failure
    // or a dead connection reported as "nothing sampled" would serve a workspace on
    // evidence nobody actually gathered.
    const { sql } = fakeSql([
      () => {
        throw Object.assign(new Error('permission denied for table settings'), { code: '42501' })
      },
    ])

    await expect(observeWorkspaceIdentity(sql as never, KEY_AT_WRITE_TIME)).rejects.toThrow(
      /permission denied/
    )
  })
})

describe('the verdict, once it can see a real sample', () => {
  it('serves a workspace whose key opens both the canary and its stored ciphertext', async () => {
    // The control. Without it, every refusal below could be a check that never
    // says yes to anything.
    const canary = sealSecretKeyCanary(KEY_AT_WRITE_TIME, WORKSPACE)
    const stored = await probeStoredCiphertext(
      KEY_AT_WRITE_TIME,
      await sealAuthSigningKey(KEY_AT_WRITE_TIME, JWK)
    )

    expect(stored.kind).toBe('opened')
    expect(evaluateSecretKeyCanary(WORKSPACE, KEY_AT_WRITE_TIME, canary, stored)).toEqual({
      ok: true,
    })
  })

  it('refuses the measured case: canary re-stamped under a key the data predates', async () => {
    // 14:20 — the signing key is sealed under the key then in force.
    const storedColumn = await sealAuthSigningKey(KEY_AT_WRITE_TIME, JWK)
    // 14:32 — custody moves and a fresh canary is stamped under the new key.
    const canary = sealSecretKeyCanary(KEY_AFTER_CUSTODY_CHANGE, WORKSPACE)

    // Established independently, so the refusal below cannot be the right answer
    // to a question the fixture never actually posed.
    expect((await probeStoredCiphertext(KEY_AT_WRITE_TIME, storedColumn)).kind).toBe('opened')
    const stored = await probeStoredCiphertext(KEY_AFTER_CUSTODY_CHANGE, storedColumn)
    expect(stored.kind).toBe('unopenable')

    const verdict = evaluateSecretKeyCanary(WORKSPACE, KEY_AFTER_CUSTODY_CHANGE, canary, stored)
    expect(verdict).toMatchObject({ ok: false, code: 'secret_key_stored_ciphertext_mismatch' })
    // The advice has to point away from re-stamping, because re-stamping is what
    // produced this state.
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.detail).toContain('re-encrypt')
  })

  it('serves a workspace holding no ciphertext at all — absence is not a refusal', async () => {
    // Nothing is sealed yet, so nothing a wrong key could fail to open and
    // nothing serving can damage. This is the honest answer rather than a
    // loophole: the risk the check guards has no subject here.
    const canary = sealSecretKeyCanary(KEY_AFTER_CUSTODY_CHANGE, WORKSPACE)
    const stored = await probeStoredCiphertext(KEY_AFTER_CUSTODY_CHANGE, null)

    expect(stored).toMatchObject({ kind: 'absent', reason: 'no-row' })
    expect(evaluateSecretKeyCanary(WORKSPACE, KEY_AFTER_CUSTODY_CHANGE, canary, stored)).toEqual({
      ok: true,
    })
  })

  it('routes the new code to the key-custody branch, not the cross-workspace alarm', async () => {
    // `request-scope.ts` picks its refusal message with these two predicates, in
    // this order. A code that answered true to the first would pull the alarm an
    // operator reads as a tenancy breach and send them to the registry; a code
    // that answered false to both would fall through to the catch-all and say
    // nothing about the key at all.
    const stored = await probeStoredCiphertext(
      KEY_AFTER_CUSTODY_CHANGE,
      await sealAuthSigningKey(KEY_AT_WRITE_TIME, JWK)
    )
    const verdict = evaluateSecretKeyCanary(
      WORKSPACE,
      KEY_AFTER_CUSTODY_CHANGE,
      sealSecretKeyCanary(KEY_AFTER_CUSTODY_CHANGE, WORKSPACE),
      stored
    )

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(isKeyCustodyFailureCode(verdict.code)).toBe(true)
    expect(isIdentityFailureCode(verdict.code)).toBe(false)
    // And the derived list request-scope's own suite iterates carries it, so the
    // end-to-end assertion there covers this code rather than skipping it.
    expect(KEY_CUSTODY_FAILURE_CODES).toContain(verdict.code)
  })
})

function sealPlatformCreds(masterSecret: string, workspaceKey: string, plaintext: string): string {
  const info = `quackback:v1:t:${workspaceKey}:${PLATFORM_CREDENTIALS_PURPOSE}`
  const key = Buffer.from(
    hkdfSync('sha256', masterSecret, 'quackback-encryption-salt-v1', info, 32)
  )
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.')
}

describe('platform-credential corroboration at checkout', () => {
  it('does not query platform credentials when no workspace key is passed', async () => {
    const stored = await sealAuthSigningKey(KEY_AT_WRITE_TIME, JWK)
    const { sql, statements } = fakeSql([
      [{ ...SETTINGS_ROW, stored_ciphertext: stored }],
      [{ catalog_name: null, catalog_oid: null }],
    ])
    await observeWorkspaceIdentity(sql as never, KEY_AT_WRITE_TIME)
    expect(statements).toHaveLength(2)
    expect(statements.join('\n')).not.toContain('integration_platform_credentials')
  })

  it('keeps a JWKS-opened sample when platform credentials open under the pooled info', async () => {
    const stored = await sealAuthSigningKey(KEY_AT_WRITE_TIME, JWK)
    const creds = sealPlatformCreds(KEY_AT_WRITE_TIME, WORKSPACE, '{"clientId":"x"}')
    const { sql, statements } = fakeSql([
      [{ ...SETTINGS_ROW, stored_ciphertext: stored }],
      [{ catalog_name: null, catalog_oid: null }],
      [{ secrets: creds }],
    ])
    const observed = await observeWorkspaceIdentity(sql as never, KEY_AT_WRITE_TIME, WORKSPACE)
    expect(observed.storedCiphertext).toMatchObject({ kind: 'opened', source: 'jwks.private_key' })
    expect(statements[2]).toContain('integration_platform_credentials')
  })

  it('refuses when JWKS opens but platform credentials were sealed under historical info', async () => {
    const stored = await sealAuthSigningKey(KEY_AT_WRITE_TIME, JWK)
    const historicalInfo = `quackback:v1:${PLATFORM_CREDENTIALS_PURPOSE}`
    const key = Buffer.from(
      hkdfSync('sha256', KEY_AT_WRITE_TIME, 'quackback-encryption-salt-v1', historicalInfo, 32)
    )
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
    const body = Buffer.concat([cipher.update('{"clientId":"x"}', 'utf8'), cipher.final()])
    const stale = [
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      body.toString('base64url'),
    ].join('.')

    const { sql } = fakeSql([
      [{ ...SETTINGS_ROW, stored_ciphertext: stored }],
      [{ catalog_name: null, catalog_oid: null }],
      [{ secrets: stale }],
    ])
    const observed = await observeWorkspaceIdentity(sql as never, KEY_AT_WRITE_TIME, WORKSPACE)
    expect(observed.storedCiphertext).toMatchObject({
      kind: 'unopenable',
      source: PLATFORM_CREDENTIALS_SOURCE,
    })
    const verdict = evaluateSecretKeyCanary(
      WORKSPACE,
      KEY_AT_WRITE_TIME,
      sealSecretKeyCanary(KEY_AT_WRITE_TIME, WORKSPACE),
      observed.storedCiphertext
    )
    expect(verdict).toMatchObject({ ok: false, code: 'secret_key_stored_ciphertext_mismatch' })
  })

  it('treats a missing platform-credentials table as no extra sample', async () => {
    const stored = await sealAuthSigningKey(KEY_AT_WRITE_TIME, JWK)
    const { sql } = fakeSql([
      [{ ...SETTINGS_ROW, stored_ciphertext: stored }],
      [{ catalog_name: null, catalog_oid: null }],
      () => {
        throw Object.assign(
          new Error('relation "integration_platform_credentials" does not exist'),
          { code: '42P01' }
        )
      },
    ])
    const observed = await observeWorkspaceIdentity(sql as never, KEY_AT_WRITE_TIME, WORKSPACE)
    expect(observed.storedCiphertext).toMatchObject({ kind: 'opened', source: 'jwks.private_key' })
  })

  it('opens pooled-info ciphertext and refuses historical-info ciphertext as a unit', () => {
    const pooled = sealPlatformCreds(KEY_AT_WRITE_TIME, WORKSPACE, '{"clientId":"x"}')
    expect(probeHkdfCiphertext(KEY_AT_WRITE_TIME, WORKSPACE, pooled).kind).toBe('opened')
    const historical = (() => {
      const key = Buffer.from(
        hkdfSync(
          'sha256',
          KEY_AT_WRITE_TIME,
          'quackback-encryption-salt-v1',
          `quackback:v1:${PLATFORM_CREDENTIALS_PURPOSE}`,
          32
        )
      )
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
      const body = Buffer.concat([cipher.update('{"clientId":"x"}', 'utf8'), cipher.final()])
      return [
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        body.toString('base64url'),
      ].join('.')
    })()
    expect(probeHkdfCiphertext(KEY_AT_WRITE_TIME, WORKSPACE, historical).kind).toBe('unopenable')
  })
})
