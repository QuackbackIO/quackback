/**
 * The namespace algebra: compose, then verify.
 *
 * This is the isolation boundary in a shared bucket. `w/<workspaceId>/` is the
 * only thing separating one customer's objects from another's, so the interesting
 * assertions here are not "the happy path works" but "every way of arriving
 * outside the namespace is refused, and refused by throwing rather than by
 * quietly addressing something else."
 */
import { describe, expect, it } from 'vitest'
import { fromUuid } from '@quackback/ids'
import {
  composeNamespacedKey,
  StorageNamespaceViolation,
  workspaceNamespace,
  WORKSPACE_NAMESPACE_ROOT,
} from '../namespace'

const ALPHA = fromUuid('workspace', '019fde94-1111-7222-8333-444455556666')
const BRAVO = fromUuid('workspace', '019fdf00-2222-7333-8444-555566667777')

const STORED_KEY = 'uploads/2026/08/2f1a0b7c-9e3d-4a5b-8c6d-7e8f90a1b2c3-report.pdf'

describe('composing', () => {
  it('lands the stored key inside the workspace namespace', () => {
    const name = composeNamespacedKey(ALPHA, STORED_KEY)

    expect(name).toBe(`${WORKSPACE_NAMESPACE_ROOT}/${ALPHA}/${STORED_KEY}`)
    expect(name.startsWith(workspaceNamespace(ALPHA))).toBe(true)
  })

  it('leaves the stored key itself untouched at the tail', () => {
    // The database keeps storing `uploads/2026/08/…` and every absolute URL in
    // contentJson is built from it, so the namespace must be a pure prefix —
    // not a rewrite of the key, and not a segment inserted anywhere else.
    const name = composeNamespacedKey(ALPHA, STORED_KEY)

    expect(name.slice(workspaceNamespace(ALPHA).length)).toBe(STORED_KEY)
    expect(name.split('/', 1)[0]).toBe(WORKSPACE_NAMESPACE_ROOT)
  })

  it('gives two workspaces different objects for the same stored key', () => {
    // The property the whole design exists for. In one fleet bucket these two
    // names are the entire difference between two customers' files.
    const alpha = composeNamespacedKey(ALPHA, STORED_KEY)
    const bravo = composeNamespacedKey(BRAVO, STORED_KEY)

    expect(alpha).not.toBe(bravo)
    expect(alpha.startsWith(workspaceNamespace(BRAVO))).toBe(false)
    expect(bravo.startsWith(workspaceNamespace(ALPHA))).toBe(false)
  })

  it('cannot be made to collide by a key that starts with the other namespace', () => {
    // A key that spells out another workspace's prefix is still only a key: it
    // composes UNDER this workspace, it does not become that workspace.
    const name = composeNamespacedKey(ALPHA, `${WORKSPACE_NAMESPACE_ROOT}/${BRAVO}/secret.pdf`)

    expect(name.startsWith(workspaceNamespace(ALPHA))).toBe(true)
    expect(name).not.toBe(composeNamespacedKey(BRAVO, 'secret.pdf'))
  })
})

describe('refusing', () => {
  const refuses = (key: string, because: RegExp) => {
    expect(() => composeNamespacedKey(ALPHA, key)).toThrow(StorageNamespaceViolation)
    expect(() => composeNamespacedKey(ALPHA, key)).toThrow(because)
  }

  it('refuses a traversal out of the namespace', () => {
    refuses('../019fdf00/uploads/x.png', /relative path segment/)
    refuses('uploads/../../../etc/passwd', /relative path segment/)
    refuses('..', /relative path segment/)
  })

  it('refuses a single-dot segment', () => {
    // On its own it addresses the same object, but only after something
    // normalises — and whether the provider, the proxy or the signer does that
    // first is not a thing to depend on.
    refuses('uploads/./x.png', /relative path segment/)
  })

  it('refuses an absolute key', () => {
    refuses('/uploads/x.png', /empty path segment/)
    refuses('//other-host/x.png', /empty path segment/)
  })

  it('refuses an empty key, which would name the namespace itself', () => {
    refuses('', /the key is empty/)
  })

  it('refuses a doubled or trailing slash', () => {
    refuses('uploads//x.png', /empty path segment/)
    refuses('uploads/', /empty path segment/)
  })

  it('refuses percent-encoded traversal', () => {
    // The app's own /api/storage route decodeURIComponent()s the path before it
    // ever reaches here, but the next caller may not, and to a provider or a
    // proxy that decodes, this is `../`.
    refuses('%2e%2e%2f%2e%2e%2fetc/passwd', /relative path segment/)
    refuses('uploads%2f..%2f..%2fetc', /relative path segment/)
    refuses('..%2fother', /relative path segment/)
  })

  it('refuses malformed percent-encoding rather than guessing', () => {
    refuses('uploads/%zz/x.png', /malformed percent-encoding/)
  })

  it('refuses a backslash', () => {
    refuses('uploads\\..\\x.png', /backslash/)
  })

  it('refuses control characters, including a NUL truncation attempt', () => {
    refuses('uploads/x.png\u0000.txt', /control character/)
    refuses('uploads/x.png\u007f', /control character/)
  })

  it('refuses a composed name past the provider key limit', () => {
    refuses(`uploads/${'a'.repeat(1024)}.png`, /exceeds 1024 bytes/)
  })

  it('names the workspace and the key it refused', () => {
    // The refusal is read during an incident. It has to say whose namespace was
    // being composed and what was handed to it.
    try {
      composeNamespacedKey(ALPHA, '../escape')
      expect.unreachable('expected a violation')
    } catch (err) {
      expect(err).toBeInstanceOf(StorageNamespaceViolation)
      const violation = err as StorageNamespaceViolation
      expect(violation.workspaceId).toBe(ALPHA)
      expect(violation.key).toBe('../escape')
      expect(violation.message).toContain(ALPHA)
    }
  })

  it('accepts the keys this application actually produces', () => {
    // The positive control. Without it every assertion above would still pass
    // against a function that refused everything.
    for (const key of [
      'uploads/2026/08/abc-file.pdf',
      'logos/2026/02/abc123-logo.png',
      'exports/export_run_01h455vb4pex5vsknk084sn02q.zip',
      'favicons/3b1f8c2d4e5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e.png',
      'assistant-documents/2026/08/uuid-notes.txt',
    ]) {
      expect(() => composeNamespacedKey(ALPHA, key)).not.toThrow()
    }
  })
})
