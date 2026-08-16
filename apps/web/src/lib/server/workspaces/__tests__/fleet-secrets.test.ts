/**
 * Derivation and sealing, pinned.
 *
 * The control plane seals a value and a fleet replica opens it, in two
 * different repositories. A drift between them does not produce a wrong answer
 * — it produces ciphertext nobody can open, and for `SECRET_KEY` that means
 * integration OAuth tokens, webhook signing secrets and connector secrets
 * are gone rather than unreadable.
 *
 * The byte-for-byte vendoring check in `vendor-parity.test.ts` catches the two
 * copies diverging. It cannot catch them being changed TOGETHER, which is what
 * a well-meaning refactor across both repos looks like. So the derivation is
 * additionally pinned here to hardcoded vectors: values computed once, written
 * down, and never recomputed from the source's own constants — a test that
 * derives its expectation the way the code does follows the code wherever it
 * goes.
 */
import { createDecipheriv, hkdfSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  deriveWorkspaceSecret,
  FleetSecretError,
  openWorkspaceSecret,
  sealSecretKeyCanary,
  sealWorkspaceSecret,
  verifySecretKeyCanary,
  FLEET_ROOT_KEY_MIN_LENGTH,
} from '../vendor/fleet-secrets'

const ROOT = 'fleet-root-key-for-tests-0123456789abcdef'
const OTHER_ROOT = 'a-completely-different-fleet-root-key-000'

describe('deriveWorkspaceSecret', () => {
  it('matches its pinned vector', () => {
    // base64url(hkdf-sha256(ikm=ROOT, salt='quackback-fleet-root-v1',
    //   info='quackback:fleet:derive:v1:inst_alpha:app-secrets', 32))
    expect(
      deriveWorkspaceSecret(ROOT, {
        generation: 1,
        workspaceKey: 'inst_alpha',
        purpose: 'app-secrets',
      })
    ).toBe('iUPXg6l7NqiwxuiTBPtKxvJnhOPsbqW-ttMXtxvnlUg')
  })

  it('gives two workspaces different keys from one root', () => {
    const alpha = deriveWorkspaceSecret(ROOT, {
      generation: 1,
      workspaceKey: 'inst_alpha',
      purpose: 'app-secrets',
    })
    const bravo = deriveWorkspaceSecret(ROOT, {
      generation: 1,
      workspaceKey: 'inst_bravo',
      purpose: 'app-secrets',
    })
    expect(alpha).not.toBe(bravo)
  })

  it('gives one workspace different keys per generation, so rotation is expressible', () => {
    const g1 = deriveWorkspaceSecret(ROOT, {
      generation: 1,
      workspaceKey: 'inst_alpha',
      purpose: 'app-secrets',
    })
    const g2 = deriveWorkspaceSecret(ROOT, {
      generation: 2,
      workspaceKey: 'inst_alpha',
      purpose: 'app-secrets',
    })
    expect(g1).not.toBe(g2)
    // …and generation 1 stays derivable, which is what makes a re-encrypt a
    // migration rather than a flag day.
    expect(
      deriveWorkspaceSecret(ROOT, {
        generation: 1,
        workspaceKey: 'inst_alpha',
        purpose: 'app-secrets',
      })
    ).toBe(g1)
  })

  it('refuses a root shorter than the floor', () => {
    // HKDF will happily stretch eight characters into something that looks
    // exactly like a 256-bit key, so nothing downstream can tell. The check has
    // to live where the value enters.
    expect(() =>
      deriveWorkspaceSecret('short', { generation: 1, workspaceKey: 't', purpose: 'app-secrets' })
    ).toThrow(FleetSecretError)
    expect(FLEET_ROOT_KEY_MIN_LENGTH).toBe(32)
  })
})

describe('sealWorkspaceSecret / openWorkspaceSecret', () => {
  const target = { generation: 1, workspaceKey: 'inst_alpha', purpose: 'storage' } as const

  it('round-trips', () => {
    const blob = sealWorkspaceSecret(ROOT, target, '{"accessKeyId":"AK","secretAccessKey":"SK"}')
    expect(openWorkspaceSecret(ROOT, target, blob)).toBe(
      '{"accessKeyId":"AK","secretAccessKey":"SK"}'
    )
  })

  it('produces a different blob every time, so a ref is not a fingerprint', () => {
    const a = sealWorkspaceSecret(ROOT, target, 'x')
    const b = sealWorkspaceSecret(ROOT, target, 'x')
    expect(a).not.toBe(b)
    expect(openWorkspaceSecret(ROOT, target, a)).toBe('x')
  })

  it('refuses a blob moved to another workspace', () => {
    // The gate that makes a sealed ref safe to carry in a row: a record that
    // named another workspace's blob would otherwise hand this process that
    // workspace's bucket credentials.
    const blob = sealWorkspaceSecret(ROOT, target, 'secret')
    expect(() =>
      openWorkspaceSecret(ROOT, { ...target, workspaceKey: 'inst_bravo' }, blob)
    ).toThrow(/did not open/)
  })

  it('refuses a blob from another generation', () => {
    const blob = sealWorkspaceSecret(ROOT, target, 'secret')
    expect(() => openWorkspaceSecret(ROOT, { ...target, generation: 2 }, blob)).toThrow(
      /did not open/
    )
  })

  it('refuses a blob under a different root', () => {
    const blob = sealWorkspaceSecret(ROOT, target, 'secret')
    expect(() => openWorkspaceSecret(OTHER_ROOT, target, blob)).toThrow(/did not open/)
  })

  it('refuses a truncated blob rather than returning a prefix', () => {
    const blob = sealWorkspaceSecret(ROOT, target, 'secret')
    expect(() => openWorkspaceSecret(ROOT, target, blob.slice(0, blob.length - 4))).toThrow(
      FleetSecretError
    )
  })
})

describe('the AEAD additional data is actually applied', () => {
  /**
   * The workspace and purpose are bound twice — once through the key's HKDF info,
   * and again as AEAD additional data. The second is redundant *today*, because
   * every purpose already has its own key, which means no behavioural test
   * written against the module's own surface can see it: removing the AAD leaves
   * every other case in this file green.
   *
   * That is exactly the shape this run keeps catching — a defence pinned by
   * nothing. So it is pinned from outside: open a sealed blob by hand, once
   * supplying the AAD and once not. Only one of those can succeed, and which
   * one tells you whether the binding is really there.
   */
  const target = { generation: 1, workspaceKey: 'inst_alpha', purpose: 'storage' } as const
  const AAD = `v${target.generation}|${target.workspaceKey}|${target.purpose}`

  function openByHand(blob: string, aad: string | null): string {
    const raw = Buffer.from(blob, 'base64url')
    const key = Buffer.from(
      hkdfSync(
        'sha256',
        ROOT,
        'quackback-fleet-root-v1',
        `quackback:fleet:seal:v${target.generation}:${target.workspaceKey}:${target.purpose}`,
        32
      )
    )
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12), {
      authTagLength: 16,
    })
    if (aad !== null) decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(raw.subarray(raw.length - 16))
    return Buffer.concat([
      decipher.update(raw.subarray(12, raw.length - 16)),
      decipher.final(),
    ]).toString('utf8')
  }

  it('opens by hand only when the additional data is supplied', () => {
    const blob = sealWorkspaceSecret(ROOT, target, 'the-secret')

    expect(openByHand(blob, AAD)).toBe('the-secret')
    // Remove the AAD from the seal and this line starts passing, which is the
    // whole point of asserting it.
    expect(() => openByHand(blob, null)).toThrow()
  })

  it('rejects additional data for a different workspace', () => {
    const blob = sealWorkspaceSecret(ROOT, target, 'the-secret')
    expect(() => openByHand(blob, `v1|inst_bravo|storage`)).toThrow()
  })
})

describe('the SECRET_KEY canary', () => {
  it('opens under the key it was sealed with', () => {
    const key = deriveWorkspaceSecret(ROOT, {
      generation: 1,
      workspaceKey: 'inst_alpha',
      purpose: 'app-secrets',
    })
    expect(verifySecretKeyCanary(key, 'inst_alpha', sealSecretKeyCanary(key, 'inst_alpha'))).toBe(
      true
    )
  })

  it('does NOT open under another workspace’s key — the case it exists for', () => {
    const alphaKey = deriveWorkspaceSecret(ROOT, {
      generation: 1,
      workspaceKey: 'inst_alpha',
      purpose: 'app-secrets',
    })
    const bravoKey = deriveWorkspaceSecret(ROOT, {
      generation: 1,
      workspaceKey: 'inst_bravo',
      purpose: 'app-secrets',
    })
    const canary = sealSecretKeyCanary(alphaKey, 'inst_alpha')

    expect(verifySecretKeyCanary(bravoKey, 'inst_alpha', canary)).toBe(false)
  })

  it('does not open under a canary sealed for a different workspace id', () => {
    const key = deriveWorkspaceSecret(ROOT, {
      generation: 1,
      workspaceKey: 'inst_alpha',
      purpose: 'app-secrets',
    })
    expect(verifySecretKeyCanary(key, 'inst_bravo', sealSecretKeyCanary(key, 'inst_alpha'))).toBe(
      false
    )
  })

  it('does not open under a root rotation the record has not caught up with', () => {
    const oldKey = deriveWorkspaceSecret(ROOT, {
      generation: 1,
      workspaceKey: 'inst_alpha',
      purpose: 'app-secrets',
    })
    const newKey = deriveWorkspaceSecret(OTHER_ROOT, {
      generation: 1,
      workspaceKey: 'inst_alpha',
      purpose: 'app-secrets',
    })
    expect(
      verifySecretKeyCanary(newKey, 'inst_alpha', sealSecretKeyCanary(oldKey, 'inst_alpha'))
    ).toBe(false)
  })

  it('treats garbage and absence as failure rather than as an exception', () => {
    const key = deriveWorkspaceSecret(ROOT, {
      generation: 1,
      workspaceKey: 'inst_alpha',
      purpose: 'app-secrets',
    })
    expect(verifySecretKeyCanary(key, 'inst_alpha', '')).toBe(false)
    expect(verifySecretKeyCanary(key, 'inst_alpha', 'not-a-blob')).toBe(false)
    expect(verifySecretKeyCanary('', 'inst_alpha', sealSecretKeyCanary(key, 'inst_alpha'))).toBe(
      false
    )
  })
})
