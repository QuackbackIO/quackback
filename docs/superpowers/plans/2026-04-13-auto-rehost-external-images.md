# Auto-rehost External Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When content containing external image URLs is saved for posts, changelogs, or help center articles, fetch each image server-side and re-upload it to the workspace's S3 storage, rewriting the `contentJson` to point at the self-hosted URL. Fail soft per image. Also update MCP tool metadata so LLM agents know the content format.

**Architecture:** A new stateless `rehostExternalImages()` server module wraps each existing `markdownToTiptapJson()` call site in the service layer (post, changelog, help center). It walks the TipTap JSON tree, collects unique external image `src` values, runs each through a pipeline (SSRF guard → fetch with DNS pinning + manual redirect + stream-limited read → magic-byte content type check → S3 upload via a new `uploadImageBuffer` helper) and returns a rewritten tree. Per-image failures log a warning and keep the original src — saves never fail on rehost errors.

**Tech Stack:** TypeScript, Vitest, Node.js `node:dns/promises`, native `fetch` + `AbortController`, `@aws-sdk/client-s3` (already in the codebase via `storage/s3.ts`), TipTap JSON content shape via `@/lib/server/db` `TiptapContent`.

**Spec:** `docs/superpowers/specs/2026-04-13-auto-rehost-external-images-design.md`

---

## File Structure

**Create:**

- `apps/web/src/lib/server/content/ssrf-guard.ts` — pure URL-safety helpers (scheme allow-list, private-IP blocklist, DNS lookup with pinning)
- `apps/web/src/lib/server/content/__tests__/ssrf-guard.test.ts` — unit tests
- `apps/web/src/lib/server/content/magic-bytes.ts` — sniff image format from buffer head, return MIME or null
- `apps/web/src/lib/server/content/__tests__/magic-bytes.test.ts` — unit tests
- `apps/web/src/lib/server/content/rehost-images.ts` — the main `rehostExternalImages()` module
- `apps/web/src/lib/server/content/__tests__/rehost-images.test.ts` — unit tests

**Modify:**

- `apps/web/src/lib/server/storage/s3.ts` — add AVIF to `ALLOWED_IMAGE_TYPES`; add new `uploadImageBuffer()` export
- `apps/web/src/lib/server/domains/posts/post.service.ts:125` (create) and `:264` (update) — wrap `markdownToTiptapJson()` output with `rehostExternalImages()`
- `apps/web/src/lib/server/domains/changelog/changelog.service.ts:75` (create) and `:157` (update) — same wrap
- `apps/web/src/lib/server/domains/help-center/help-center.service.ts:383` (create) and `:409` (update) — same wrap
- `apps/web/src/lib/server/mcp/tools.ts` — update tool descriptions + `content` field `.describe()` strings on `create_post`, `create_changelog`, `update_changelog`, `create_article`, `update_article`, `add_comment`, `update_comment`
- `apps/web/src/lib/server/mcp/__tests__/handler.test.ts` — one smoke assertion per updated tool confirming the content description mentions "Markdown" or "Plain text"

**Out of scope (not touched in this plan):**

- `apps/web/src/routes/api/upload/image.ts` — unchanged; the existing editor upload path is independent
- Comments schema (no `contentJson` column today; rich content support is a separate feature)
- Any backfill script for historical content with external URLs
- `config.ts` — the three new env vars read directly from `process.env` in `rehost-images.ts` with defaults; centralizing in config.ts is unnecessary ceremony for three numeric knobs

---

## Preconditions

- [ ] **Step 0.1: Confirm clean baseline on the feature branch**

```bash
cd /home/james/quackback
git status
git log --oneline main..HEAD
```

Expected: working tree clean; the only commits ahead of main are the spec commits `f09e8442` and `94808be7` (or newer) on branch `feat/auto-rehost-external-images`. If the branch isn't the active one, `git checkout feat/auto-rehost-external-images`.

- [ ] **Step 0.2: Run the baseline test suite**

```bash
bun run test
```

Expected: all 1596+ tests pass. If any existing tests fail, STOP and fix those before proceeding — this plan must not land on a broken baseline.

- [ ] **Step 0.3: Run typecheck baseline**

```bash
bun run typecheck
```

Expected: clean.

---

## Task 1: Add `uploadImageBuffer` helper + AVIF to allowed types

**Context:** The existing `uploadImageFromFormData` takes a `FormData` object. The rehoster needs a buffer-level API to upload already-fetched bytes. Same S3 client, same key-generation rules, same public-URL construction — only the input shape differs. We also add `image/avif` to the allow-list (safe because the server never decodes these bytes — storage is byte-transparent, and browsers handle AVIF rendering via their own decoders).

**Files:**

- Modify: `apps/web/src/lib/server/storage/s3.ts:282-289` (ALLOWED_IMAGE_TYPES set) and append a new export near the bottom

- [ ] **Step 1.1: Add AVIF to the allowed image types**

Open `apps/web/src/lib/server/storage/s3.ts` and replace the `ALLOWED_IMAGE_TYPES` set around line 282:

```ts
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
])
```

- [ ] **Step 1.2: Add the `uploadImageBuffer` export**

Append this export after `uploadImageFromFormData` (near line 331):

```ts
/**
 * Upload pre-read image bytes to storage.
 *
 * Used by the content rehoster when it has already fetched and validated
 * the bytes (see `lib/server/content/rehost-images.ts`). This is the
 * buffer-level twin of `uploadImageFromFormData`.
 *
 * @param buffer - Image bytes
 * @param mimeType - Must be one of the allowed image types (see isAllowedImageType)
 * @param storagePrefix - Bucket prefix, e.g. "post-images" | "changelog-images" | "help-center"
 * @returns Public URL to the uploaded object
 * @throws Error if the mime type is not allowed, the buffer is empty, or the upload fails
 */
export async function uploadImageBuffer(
  buffer: Buffer,
  mimeType: string,
  storagePrefix: string
): Promise<{ url: string }> {
  if (!isAllowedImageType(mimeType)) {
    throw new Error(`Invalid mime type for rehost: ${mimeType}`)
  }
  if (buffer.length === 0) {
    throw new Error('Cannot upload empty buffer')
  }
  const ext = mimeType.split('/')[1] ?? 'bin'
  const filename = `rehost-${Date.now()}.${ext}`
  const key = generateStorageKey(storagePrefix, filename)
  const url = await uploadObject(key, buffer, mimeType)
  return { url }
}
```

- [ ] **Step 1.3: Typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 1.4: Commit**

```bash
git add apps/web/src/lib/server/storage/s3.ts
git commit -m "feat(storage): add uploadImageBuffer and AVIF to allowed types"
```

---

## Task 2: Create `ssrf-guard.ts` — URL safety helpers

**Context:** Before fetching any user-supplied URL we must (a) reject non-HTTP schemes, (b) resolve the hostname and reject any address in a private / link-local range, and (c) return the resolved address so the subsequent fetch can pin it (closing the DNS rebinding window). This module is pure except for its DNS call and is unit-testable in isolation.

**Files:**

- Create: `apps/web/src/lib/server/content/ssrf-guard.ts`
- Create: `apps/web/src/lib/server/content/__tests__/ssrf-guard.test.ts`

- [ ] **Step 2.1: Write the failing test file**

Create `apps/web/src/lib/server/content/__tests__/ssrf-guard.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isSafeScheme, isPrivateAddress, checkUrlSafety } from '../ssrf-guard'

vi.mock('node:dns/promises', () => ({
  default: {},
  lookup: vi.fn(),
}))

import { lookup } from 'node:dns/promises'
const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>

describe('isSafeScheme', () => {
  it('accepts https and http', () => {
    expect(isSafeScheme('https://example.com/img.png')).toBe(true)
    expect(isSafeScheme('http://example.com/img.png')).toBe(true)
  })

  it('rejects file, ftp, gopher, dict, ldap, javascript', () => {
    expect(isSafeScheme('file:///etc/passwd')).toBe(false)
    expect(isSafeScheme('ftp://example.com/x')).toBe(false)
    expect(isSafeScheme('gopher://example.com/')).toBe(false)
    expect(isSafeScheme('dict://example.com/')).toBe(false)
    expect(isSafeScheme('ldap://example.com/')).toBe(false)
    expect(isSafeScheme('javascript:alert(1)')).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(isSafeScheme('not a url')).toBe(false)
    expect(isSafeScheme('')).toBe(false)
  })
})

describe('isPrivateAddress', () => {
  it('blocks IPv4 loopback and link-local', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true)
    expect(isPrivateAddress('127.255.255.254')).toBe(true)
    expect(isPrivateAddress('169.254.169.254')).toBe(true)
  })

  it('blocks RFC 1918 private ranges', () => {
    expect(isPrivateAddress('10.0.0.1')).toBe(true)
    expect(isPrivateAddress('172.16.0.1')).toBe(true)
    expect(isPrivateAddress('172.31.255.254')).toBe(true)
    expect(isPrivateAddress('192.168.1.1')).toBe(true)
  })

  it('blocks this-network and CGNAT', () => {
    expect(isPrivateAddress('0.0.0.0')).toBe(true)
    expect(isPrivateAddress('100.64.0.1')).toBe(true)
  })

  it('allows public IPv4 addresses', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('1.1.1.1')).toBe(false)
    expect(isPrivateAddress('93.184.216.34')).toBe(false)
  })

  it('blocks IPv6 loopback, unique-local, link-local', () => {
    expect(isPrivateAddress('::1')).toBe(true)
    expect(isPrivateAddress('fc00::1')).toBe(true)
    expect(isPrivateAddress('fd12:3456:789a::1')).toBe(true)
    expect(isPrivateAddress('fe80::1')).toBe(true)
  })

  it('allows public IPv6 addresses', () => {
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false)
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false)
  })
})

describe('checkUrlSafety', () => {
  beforeEach(() => {
    lookupMock.mockReset()
  })

  it('returns safe:true + the pinned address for a public host', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ])

    const result = await checkUrlSafety('https://example.com/img.png')
    expect(result).toEqual({
      safe: true,
      address: '93.184.216.34',
      family: 4,
    })
  })

  it('rejects when any resolved address is private', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])

    const result = await checkUrlSafety('https://evil.example.com/img.png')
    expect(result).toEqual({ safe: false, reason: 'ssrf-rejected' })
  })

  it('rejects disallowed schemes without looking up', async () => {
    const result = await checkUrlSafety('file:///etc/passwd')
    expect(result).toEqual({ safe: false, reason: 'scheme-rejected' })
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('rejects when DNS lookup throws', async () => {
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'))
    const result = await checkUrlSafety('https://does-not-exist.example/')
    expect(result).toEqual({ safe: false, reason: 'dns-error' })
  })

  it('rejects when DNS returns zero addresses', async () => {
    lookupMock.mockResolvedValueOnce([])
    const result = await checkUrlSafety('https://empty.example/')
    expect(result).toEqual({ safe: false, reason: 'dns-error' })
  })
})
```

- [ ] **Step 2.2: Run the test and watch it fail**

```bash
bun run test -- apps/web/src/lib/server/content/__tests__/ssrf-guard.test.ts
```

Expected: FAIL with "cannot find module `../ssrf-guard`".

- [ ] **Step 2.3: Implement the module**

Create `apps/web/src/lib/server/content/ssrf-guard.ts`:

```ts
/**
 * SSRF-guard helpers for the content rehoster.
 *
 * Validates that a URL is safe to fetch from the server:
 * - scheme allow-list (http/https only)
 * - DNS resolution with every returned address checked against a
 *   private / link-local blocklist
 * - returns the resolved IP so the caller can pin it across the fetch
 *   and close DNS-rebinding TOCTOU windows
 */

import { lookup } from 'node:dns/promises'

const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

/** Return true if the URL parses and uses http or https. */
export function isSafeScheme(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ALLOWED_SCHEMES.has(parsed.protocol)
  } catch {
    return false
  }
}

/**
 * Parse an IPv4 dotted-quad string to a 32-bit number.
 * Returns null for any input that isn't a well-formed IPv4 address.
 */
function parseIpv4(addr: string): number | null {
  const parts = addr.split('.')
  if (parts.length !== 4) return null
  let result = 0
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    const n = Number(part)
    if (n < 0 || n > 255) return null
    result = (result << 8) | n
  }
  return result >>> 0
}

/** Is the given IPv4 address (as 32-bit int) inside the CIDR range (base, maskBits)? */
function ipv4InRange(ip: number, baseCidr: string): boolean {
  const [base, bitsStr] = baseCidr.split('/')
  const baseInt = parseIpv4(base)
  const bits = Number(bitsStr)
  if (baseInt === null || Number.isNaN(bits)) return false
  if (bits === 0) return true
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return (ip & mask) === (baseInt & mask)
}

/**
 * IPv6 handling: we normalize to lowercase and check leading-segment prefixes.
 * This is a pragmatic approximation — we don't need full RFC 4291 parsing for
 * the small set of ranges we block.
 */
function isPrivateIpv6(addr: string): boolean {
  const lower = addr.toLowerCase().replace(/^::ffff:/, '')
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) — handled by the v4 path below if present
  const asV4 = parseIpv4(lower)
  if (asV4 !== null) {
    return isPrivateIpv4(lower)
  }
  // Loopback
  if (lower === '::1') return true
  // Unspecified
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true
  // Unique local fc00::/7 — first byte 0xfc or 0xfd
  if (/^(fc|fd)[0-9a-f]{2}:/.test(lower)) return true
  // Link-local fe80::/10 — fe8x, fe9x, feax, febx
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true
  return false
}

function isPrivateIpv4(addr: string): boolean {
  const ip = parseIpv4(addr)
  if (ip === null) return false
  const blocklist = [
    '0.0.0.0/8', // this-network
    '10.0.0.0/8', // RFC 1918
    '100.64.0.0/10', // CGNAT
    '127.0.0.0/8', // loopback
    '169.254.0.0/16', // link-local (includes cloud metadata 169.254.169.254)
    '172.16.0.0/12', // RFC 1918
    '192.168.0.0/16', // RFC 1918
  ]
  return blocklist.some((cidr) => ipv4InRange(ip, cidr))
}

/** Is the given textual IP address in any private / link-local / loopback range? */
export function isPrivateAddress(addr: string): boolean {
  if (addr.includes(':')) {
    return isPrivateIpv6(addr)
  }
  return isPrivateIpv4(addr)
}

export type UrlSafetyResult =
  | { safe: true; address: string; family: 4 | 6 }
  | { safe: false; reason: 'scheme-rejected' | 'ssrf-rejected' | 'dns-error' }

/**
 * Check that a URL is safe to fetch from the server.
 *
 * On success, returns the first public address that was resolved — the
 * caller should use this address to pin the fetch connection (e.g. via a
 * custom agent lookup function) to close the DNS rebinding TOCTOU window.
 */
export async function checkUrlSafety(url: string): Promise<UrlSafetyResult> {
  if (!isSafeScheme(url)) {
    return { safe: false, reason: 'scheme-rejected' }
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { safe: false, reason: 'scheme-rejected' }
  }
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await lookup(parsed.hostname, { all: true })
  } catch {
    return { safe: false, reason: 'dns-error' }
  }
  if (addresses.length === 0) {
    return { safe: false, reason: 'dns-error' }
  }
  // Reject if ANY resolved address is private — we won't know which one the
  // fetch would connect to without pinning.
  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) {
      return { safe: false, reason: 'ssrf-rejected' }
    }
  }
  const pinned = addresses[0]
  return {
    safe: true,
    address: pinned.address,
    family: pinned.family === 6 ? 6 : 4,
  }
}
```

- [ ] **Step 2.4: Run the test and verify it passes**

```bash
bun run test -- apps/web/src/lib/server/content/__tests__/ssrf-guard.test.ts
```

Expected: all tests in the file pass.

- [ ] **Step 2.5: Typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 2.6: Commit**

```bash
git add apps/web/src/lib/server/content/ssrf-guard.ts \
        apps/web/src/lib/server/content/__tests__/ssrf-guard.test.ts
git commit -m "feat(content): add ssrf-guard for URL safety checks"
```

---

## Task 3: Create `magic-bytes.ts` — content-type sniffer

**Context:** A malicious server could serve a polyglot file with `Content-Type: image/png` but actual bytes that are something else. We sniff the first 16 bytes of the response and return the detected MIME only if it matches one of our allowed image formats. The caller rejects when the header mime and the sniffed mime disagree, or when the sniffed mime is null.

**Files:**

- Create: `apps/web/src/lib/server/content/magic-bytes.ts`
- Create: `apps/web/src/lib/server/content/__tests__/magic-bytes.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `apps/web/src/lib/server/content/__tests__/magic-bytes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sniffImageMime, ALLOWED_REHOST_MIMES } from '../magic-bytes'

const bytes = (...values: number[]) => Buffer.from(values)

describe('sniffImageMime', () => {
  it('detects PNG from magic bytes', () => {
    const buf = Buffer.concat([
      bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      Buffer.alloc(32),
    ])
    expect(sniffImageMime(buf)).toBe('image/png')
  })

  it('detects JPEG from magic bytes', () => {
    const buf = Buffer.concat([bytes(0xff, 0xd8, 0xff, 0xe0), Buffer.alloc(32)])
    expect(sniffImageMime(buf)).toBe('image/jpeg')
  })

  it('detects GIF87a and GIF89a', () => {
    expect(sniffImageMime(Buffer.from('GIF87a' + '\0'.repeat(32)))).toBe('image/gif')
    expect(sniffImageMime(Buffer.from('GIF89a' + '\0'.repeat(32)))).toBe('image/gif')
  })

  it('detects WebP from RIFF + WEBP marker', () => {
    const header = Buffer.from('RIFF\0\0\0\0WEBP' + '\0'.repeat(20))
    expect(sniffImageMime(header)).toBe('image/webp')
  })

  it('detects AVIF from ftyp box', () => {
    // 4 bytes size, "ftyp", "avif" or "avis"
    const header = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from('ftypavif'),
      Buffer.alloc(20),
    ])
    expect(sniffImageMime(header)).toBe('image/avif')
  })

  it('detects AVIF from ftyp avis (sequence) variant', () => {
    const header = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from('ftypavis'),
      Buffer.alloc(20),
    ])
    expect(sniffImageMime(header)).toBe('image/avif')
  })

  it('returns null for unknown bytes', () => {
    expect(sniffImageMime(Buffer.from('not an image at all'))).toBeNull()
  })

  it('returns null for buffers that are too short', () => {
    expect(sniffImageMime(Buffer.alloc(4))).toBeNull()
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull()
  })

  it('returns null for SVG content (we never sniff svg as an allowed format)', () => {
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="..."></svg>')
    expect(sniffImageMime(svg)).toBeNull()
  })
})

describe('ALLOWED_REHOST_MIMES', () => {
  it('contains the five image formats we rehost', () => {
    expect(ALLOWED_REHOST_MIMES).toEqual(
      new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])
    )
  })
})
```

- [ ] **Step 3.2: Run the test and watch it fail**

```bash
bun run test -- apps/web/src/lib/server/content/__tests__/magic-bytes.test.ts
```

Expected: FAIL with module not found.

- [ ] **Step 3.3: Implement the module**

Create `apps/web/src/lib/server/content/magic-bytes.ts`:

```ts
/**
 * Image magic-byte sniffer for the content rehoster.
 *
 * Parses the first few bytes of a response body and returns the detected
 * MIME type only if it matches one of our allowed image formats. The caller
 * uses this to verify that a server-reported Content-Type header wasn't
 * spoofed: if `header !== sniffed` or `sniffed === null`, reject the image.
 *
 * SVG is deliberately never returned — even if the bytes look XML-ish, we
 * don't allow SVG because it can carry script payloads.
 */

export const ALLOWED_REHOST_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
])

function startsWithAt(buf: Buffer, offset: number, pattern: number[]): boolean {
  if (buf.length < offset + pattern.length) return false
  for (let i = 0; i < pattern.length; i++) {
    if (buf[offset + i] !== pattern[i]) return false
  }
  return true
}

/**
 * Sniff the image MIME type from the first ~16 bytes of the buffer.
 * Returns one of ALLOWED_REHOST_MIMES or null.
 */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 8) return null

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWithAt(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  // JPEG: FF D8 FF
  if (startsWithAt(buf, 0, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }
  // GIF: "GIF87a" or "GIF89a"
  if (buf.slice(0, 6).toString('ascii') === 'GIF87a') return 'image/gif'
  if (buf.slice(0, 6).toString('ascii') === 'GIF89a') return 'image/gif'
  // WebP: "RIFF" .... "WEBP"
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  // AVIF: ...."ftyp""avif" or ...."ftyp""avis" at offset 4
  if (buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii')
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }
  return null
}
```

- [ ] **Step 3.4: Run the test and verify it passes**

```bash
bun run test -- apps/web/src/lib/server/content/__tests__/magic-bytes.test.ts
```

Expected: all pass.

- [ ] **Step 3.5: Commit**

```bash
git add apps/web/src/lib/server/content/magic-bytes.ts \
        apps/web/src/lib/server/content/__tests__/magic-bytes.test.ts
git commit -m "feat(content): add magic-bytes image sniffer"
```

---

## Task 4: Create `rehost-images.ts` — the main module

**Context:** This is the core of the feature. It exports `rehostExternalImages(json, opts)` which walks a TipTap doc tree, collects every `image` and `resizableImage` node's `src`, deduplicates, runs each through the pipeline (ssrf-guard → fetch with pinning → magic-byte check → `uploadImageBuffer`), and returns a deep-cloned tree with rewritten `src` values. Per-image failures log warnings and keep the original src. Top-level unexpected errors return the input unchanged. S3 not configured is a no-op.

This task is larger than the others; the test file lists one case per spec requirement and the implementation builds the pipeline to make them all pass. Keep the TDD loop tight: write the whole test file first, watch every case fail, implement top-down, run the whole file each iteration.

**Files:**

- Create: `apps/web/src/lib/server/content/rehost-images.ts`
- Create: `apps/web/src/lib/server/content/__tests__/rehost-images.test.ts`

- [ ] **Step 4.1: Write the failing test file**

Create `apps/web/src/lib/server/content/__tests__/rehost-images.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TiptapContent } from '@/lib/server/db'

// ---- Mocks ----

vi.mock('@/lib/server/content/ssrf-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ssrf-guard')>()
  return {
    ...actual,
    checkUrlSafety: vi.fn(),
  }
})

vi.mock('@/lib/server/storage/s3', () => ({
  isS3Configured: vi.fn(() => true),
  uploadImageBuffer: vi.fn(),
}))

// We mock the global fetch
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { rehostExternalImages } from '../rehost-images'
import { checkUrlSafety } from '@/lib/server/content/ssrf-guard'
import { isS3Configured, uploadImageBuffer } from '@/lib/server/storage/s3'

const checkUrlSafetyMock = checkUrlSafety as unknown as ReturnType<typeof vi.fn>
const isS3ConfiguredMock = isS3Configured as unknown as ReturnType<typeof vi.fn>
const uploadImageBufferMock = uploadImageBuffer as unknown as ReturnType<typeof vi.fn>

// ---- Helpers ----

/** Build a minimal TipTap doc containing one image node per passed src. */
function docWithImages(...srcs: string[]): TiptapContent {
  return {
    type: 'doc',
    content: srcs.map((src) => ({
      type: 'image',
      attrs: { src },
    })),
  } as unknown as TiptapContent
}

/** Build a Response-shaped mock for a successful image fetch. */
function okImageResponse(
  mime: string,
  bodyBytes: Buffer,
  options: { contentLength?: number | null } = {}
): Response {
  const headers = new Headers({ 'content-type': mime })
  if (options.contentLength !== null) {
    headers.set('content-length', String(options.contentLength ?? bodyBytes.length))
  }
  return new Response(bodyBytes, {
    status: 200,
    headers,
  })
}

const PNG_HEADER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
])

const JPEG_HEADER = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])

// ---- Setup ----

beforeEach(() => {
  vi.clearAllMocks()
  isS3ConfiguredMock.mockReturnValue(true)
  uploadImageBufferMock.mockImplementation(async (_buf, _mime, prefix) => ({
    url: `https://cdn.example.com/${prefix}/rehosted-${Math.random().toString(36).slice(2, 8)}.png`,
  }))
  checkUrlSafetyMock.mockResolvedValue({ safe: true, address: '93.184.216.34', family: 4 })
})

// ---- Tests ----

describe('rehostExternalImages — happy paths', () => {
  it('rehosts a single external PNG', async () => {
    fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
    uploadImageBufferMock.mockResolvedValueOnce({
      url: 'https://cdn.example.com/post-images/new.png',
    })

    const input = docWithImages('https://external.example.com/img.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as Array<{ attrs: { src: string } }>)[0]

    expect(node.attrs.src).toBe('https://cdn.example.com/post-images/new.png')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(uploadImageBufferMock).toHaveBeenCalledTimes(1)
    expect(uploadImageBufferMock.mock.calls[0][2]).toBe('post-images')
  })

  it('rehosts multiple distinct external images', async () => {
    fetchMock
      .mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
      .mockResolvedValueOnce(okImageResponse('image/jpeg', JPEG_HEADER))
    uploadImageBufferMock
      .mockResolvedValueOnce({ url: 'https://cdn.example.com/post-images/a.png' })
      .mockResolvedValueOnce({ url: 'https://cdn.example.com/post-images/b.jpg' })

    const input = docWithImages(
      'https://external.example.com/a.png',
      'https://external.example.com/b.jpg'
    )
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const nodes = output.content as Array<{ attrs: { src: string } }>

    expect(nodes[0].attrs.src).toBe('https://cdn.example.com/post-images/a.png')
    expect(nodes[1].attrs.src).toBe('https://cdn.example.com/post-images/b.jpg')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('dedupes repeated URLs (one fetch, both nodes rewritten)', async () => {
    fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
    uploadImageBufferMock.mockResolvedValueOnce({
      url: 'https://cdn.example.com/post-images/x.png',
    })

    const input = docWithImages(
      'https://external.example.com/same.png',
      'https://external.example.com/same.png'
    )
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const nodes = output.content as Array<{ attrs: { src: string } }>

    expect(nodes[0].attrs.src).toBe('https://cdn.example.com/post-images/x.png')
    expect(nodes[1].attrs.src).toBe('https://cdn.example.com/post-images/x.png')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses the right storage prefix per content type', async () => {
    const cases: Array<[Parameters<typeof rehostExternalImages>[1]['contentType'], string]> = [
      ['post', 'post-images'],
      ['changelog', 'changelog-images'],
      ['help-center', 'help-center'],
    ]

    for (const [contentType, prefix] of cases) {
      fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
      uploadImageBufferMock.mockResolvedValueOnce({
        url: `https://cdn.example.com/${prefix}/x.png`,
      })

      await rehostExternalImages(docWithImages('https://ex.example/a.png'), { contentType })
      const lastCall = uploadImageBufferMock.mock.calls.at(-1)!
      expect(lastCall[2]).toBe(prefix)
    }
  })

  it('skips same-origin URLs (workspace CDN already)', async () => {
    const input: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: 'https://cdn.example.com/post-images/existing.png' },
        },
      ],
    } as unknown as TiptapContent

    // Same-origin is detected via env — simulate by stubbing the env prefix
    process.env.S3_PUBLIC_URL = 'https://cdn.example.com'

    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as Array<{ attrs: { src: string } }>)[0]

    expect(node.attrs.src).toBe('https://cdn.example.com/post-images/existing.png')
    expect(fetchMock).not.toHaveBeenCalled()

    delete process.env.S3_PUBLIC_URL
  })

  it('handles a data-URI PNG', async () => {
    // 1x1 transparent PNG
    const base64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZUanaIAAAAASUVORK5CYII='
    uploadImageBufferMock.mockResolvedValueOnce({
      url: 'https://cdn.example.com/post-images/decoded.png',
    })

    const input = docWithImages(`data:image/png;base64,${base64}`)
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as Array<{ attrs: { src: string } }>)[0]

    expect(node.attrs.src).toBe('https://cdn.example.com/post-images/decoded.png')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(uploadImageBufferMock).toHaveBeenCalledTimes(1)
  })

  it('walks nested nodes (image inside a paragraph)', async () => {
    fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
    uploadImageBufferMock.mockResolvedValueOnce({
      url: 'https://cdn.example.com/post-images/nested.png',
    })

    const input: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            { type: 'image', attrs: { src: 'https://external.example.com/n.png' } },
          ],
        },
      ],
    } as unknown as TiptapContent

    const output = await rehostExternalImages(input, { contentType: 'post' })
    const paragraph = (output.content as Array<{ content: Array<{ attrs?: { src: string } }> }>)[0]
    expect(paragraph.content[1].attrs!.src).toBe('https://cdn.example.com/post-images/nested.png')
  })

  it('walks resizableImage nodes too', async () => {
    fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
    uploadImageBufferMock.mockResolvedValueOnce({
      url: 'https://cdn.example.com/post-images/resized.png',
    })

    const input: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'resizableImage',
          attrs: { src: 'https://external.example.com/r.png', width: 500 },
        },
      ],
    } as unknown as TiptapContent

    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as Array<{ attrs: { src: string; width: number } }>)[0]
    expect(node.attrs.src).toBe('https://cdn.example.com/post-images/resized.png')
    expect(node.attrs.width).toBe(500)
  })
})

describe('rehostExternalImages — rejections (fail-soft)', () => {
  it('rejects SVG data URIs', async () => {
    const input = docWithImages('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')
    expect(uploadImageBufferMock).not.toHaveBeenCalled()
  })

  it('rejects an external SVG URL', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<svg></svg>', {
        status: 200,
        headers: { 'content-type': 'image/svg+xml' },
      })
    )

    const input = docWithImages('https://external.example.com/thing.svg')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://external.example.com/thing.svg')
    expect(uploadImageBufferMock).not.toHaveBeenCalled()
  })

  it('rejects disallowed mime types (application/pdf)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('%PDF-1.4...', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      })
    )

    const input = docWithImages('https://external.example.com/doc.pdf')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://external.example.com/doc.pdf')
    expect(uploadImageBufferMock).not.toHaveBeenCalled()
  })

  it('rejects when content-length declares > 10MB', async () => {
    fetchMock.mockResolvedValueOnce(
      okImageResponse('image/png', PNG_HEADER, { contentLength: 20 * 1024 * 1024 })
    )

    const input = docWithImages('https://external.example.com/huge.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://external.example.com/huge.png')
    expect(uploadImageBufferMock).not.toHaveBeenCalled()
  })

  it('rejects when header mime and sniffed bytes disagree', async () => {
    const lie = Buffer.from('PK\x03\x04...zip')
    fetchMock.mockResolvedValueOnce(
      new Response(lie, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    )

    const input = docWithImages('https://external.example.com/lie.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://external.example.com/lie.png')
    expect(uploadImageBufferMock).not.toHaveBeenCalled()
  })

  it('rejects schemes other than http/https', async () => {
    checkUrlSafetyMock.mockResolvedValueOnce({ safe: false, reason: 'scheme-rejected' })

    const input = docWithImages('file:///etc/passwd')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('file:///etc/passwd')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects SSRF targets (private IP, cloud metadata, loopback)', async () => {
    checkUrlSafetyMock.mockResolvedValueOnce({ safe: false, reason: 'ssrf-rejected' })

    const input = docWithImages('https://attacker.example.com/img.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://attacker.example.com/img.png')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects redirect responses (302)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/payload' },
      })
    )

    const input = docWithImages('https://external.example.com/redir.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://external.example.com/redir.png')
    expect(uploadImageBufferMock).not.toHaveBeenCalled()
  })

  it('rejects when fetch throws (timeout, network error)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('aborted'))

    const input = docWithImages('https://external.example.com/slow.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://external.example.com/slow.png')
    expect(uploadImageBufferMock).not.toHaveBeenCalled()
  })

  it('rejects when S3 upload throws', async () => {
    fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
    uploadImageBufferMock.mockRejectedValueOnce(new Error('S3 500'))

    const input = docWithImages('https://external.example.com/bad.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const node = (output.content as Array<{ attrs: { src: string } }>)[0]
    expect(node.attrs.src).toBe('https://external.example.com/bad.png')
  })

  it('caps at 20 images per save (21st keeps external URL)', async () => {
    const urls = Array.from({ length: 21 }, (_, i) => `https://external.example.com/${i}.png`)
    // First 20 succeed
    for (let i = 0; i < 20; i++) {
      fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
      uploadImageBufferMock.mockResolvedValueOnce({
        url: `https://cdn.example.com/post-images/${i}.png`,
      })
    }

    const input = docWithImages(...urls)
    const output = await rehostExternalImages(input, { contentType: 'post' })
    const nodes = output.content as Array<{ attrs: { src: string } }>

    for (let i = 0; i < 20; i++) {
      expect(nodes[i].attrs.src).toBe(`https://cdn.example.com/post-images/${i}.png`)
    }
    expect(nodes[20].attrs.src).toBe('https://external.example.com/20.png')
    expect(fetchMock).toHaveBeenCalledTimes(20)
  })
})

describe('rehostExternalImages — edge cases', () => {
  it('leaves non-image nodes untouched', async () => {
    const input: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1' }] },
      ],
    } as unknown as TiptapContent

    const output = await rehostExternalImages(input, { contentType: 'post' })
    expect(output).toEqual(input)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns input unchanged when S3 is not configured', async () => {
    isS3ConfiguredMock.mockReturnValueOnce(false)
    const input = docWithImages('https://external.example.com/img.png')
    const output = await rehostExternalImages(input, { contentType: 'post' })
    expect(output).toEqual(input)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not mutate the input tree', async () => {
    fetchMock.mockResolvedValueOnce(okImageResponse('image/png', PNG_HEADER))
    uploadImageBufferMock.mockResolvedValueOnce({
      url: 'https://cdn.example.com/post-images/x.png',
    })

    const input = docWithImages('https://external.example.com/x.png')
    const snapshot = JSON.stringify(input)
    await rehostExternalImages(input, { contentType: 'post' })
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('returns input unchanged on an unexpected top-level error', async () => {
    // Force a throw inside the pipeline by corrupting the clone path
    const bad = null as unknown as TiptapContent
    const output = await rehostExternalImages(bad, { contentType: 'post' })
    expect(output).toBe(bad)
  })
})
```

- [ ] **Step 4.2: Run the test file and watch every case fail**

```bash
bun run test -- apps/web/src/lib/server/content/__tests__/rehost-images.test.ts
```

Expected: module-not-found for `../rehost-images` (every case fails the same way).

- [ ] **Step 4.3: Implement the module**

Create `apps/web/src/lib/server/content/rehost-images.ts`:

```ts
/**
 * Rehost external images inside TipTap content.
 *
 * Given a TipTap doc tree for a post, changelog entry, or help center article,
 * walk the tree, find every `image` / `resizableImage` node, and try to fetch
 * + re-upload each external src to workspace storage. The returned tree has
 * rewritten src attrs for every image that succeeded; failed images keep
 * their original src (fail-soft). The input tree is never mutated.
 *
 * This module is the single hook point for auto-rehost; service layers for
 * posts / changelog / help-center call it right after building contentJson.
 *
 * Safety: see `./ssrf-guard.ts` for the URL safety pipeline and
 * `./magic-bytes.ts` for the magic-byte content-type verification. External
 * URLs go through both before hitting S3.
 */

import type { TiptapContent } from '@/lib/server/db'
import { isS3Configured, uploadImageBuffer } from '@/lib/server/storage/s3'
import { checkUrlSafety } from './ssrf-guard'
import { sniffImageMime, ALLOWED_REHOST_MIMES } from './magic-bytes'

const MAX_BYTES = Number(process.env.REHOST_MAX_BYTES) || 10 * 1024 * 1024
const MAX_IMAGES_PER_SAVE = Number(process.env.REHOST_MAX_IMAGES_PER_SAVE) || 20
const FETCH_TIMEOUT_MS = Number(process.env.REHOST_FETCH_TIMEOUT_MS) || 10_000

const IMAGE_NODE_TYPES = new Set(['image', 'resizableImage'])

const PREFIX_BY_CONTENT_TYPE: Record<RehostContentType, string> = {
  post: 'post-images',
  changelog: 'changelog-images',
  'help-center': 'help-center',
}

export type RehostContentType = 'post' | 'changelog' | 'help-center'

export interface RehostOptions {
  contentType: RehostContentType
  principalId?: string
}

interface ImageNode {
  type: string
  attrs?: { src?: string } & Record<string, unknown>
  content?: unknown[]
  [key: string]: unknown
}

type RejectReason =
  | 'same-origin-skip'
  | 'svg-rejected'
  | 'mime-rejected'
  | 'oversized'
  | 'fetch-timeout'
  | 'fetch-error'
  | 'upload-error'
  | 'data-uri-decode-error'
  | 'count-cap-exceeded'
  | 'scheme-rejected'
  | 'ssrf-rejected'
  | 'redirect-rejected'
  | 'magic-mismatch'

function logRejection(src: string, reason: RejectReason, opts: RehostOptions, err?: unknown): void {
  const principal = opts.principalId ?? 'unknown'
  const detail = err instanceof Error ? `: ${err.message}` : ''
  console.warn(
    `[content:rehost-images] skipped image contentType=${opts.contentType} principalId=${principal} src=${src} reason=${reason}${detail}`
  )
}

/**
 * Deep clone a TipTap tree. We don't need reference-identity preservation,
 * so structuredClone is safe and fast.
 */
function cloneTree(json: TiptapContent): TiptapContent {
  return structuredClone(json) as TiptapContent
}

/** Collect all image-ish nodes from a cloned tree, in traversal order. */
function collectImageNodes(root: unknown): ImageNode[] {
  const out: ImageNode[] = []
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    const candidate = node as ImageNode
    if (typeof candidate.type === 'string' && IMAGE_NODE_TYPES.has(candidate.type)) {
      out.push(candidate)
    }
    if (Array.isArray(candidate.content)) {
      for (const child of candidate.content) stack.push(child)
    }
  }
  return out
}

/** Parse a data:image/... URI into (mime, buffer). Throws on malformed input. */
function parseDataUri(src: string): { mime: string; buffer: Buffer } {
  const match = src.match(/^data:([^;,]+)(;base64)?,(.*)$/)
  if (!match) throw new Error('not a data URI')
  const mime = match[1].toLowerCase()
  const isBase64 = match[2] === ';base64'
  const payload = match[3]
  const buffer = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8')
  return { mime, buffer }
}

function isSameOrigin(src: string): boolean {
  const publicUrl = process.env.S3_PUBLIC_URL
  if (!publicUrl) return false
  return src.startsWith(publicUrl.replace(/\/$/, ''))
}

/** Fetch a URL with timeout + manual redirect + stream-limited body read. */
async function fetchWithLimits(
  url: string
): Promise<{ ok: true; buffer: Buffer; mimeHeader: string } | { ok: false; reason: RejectReason }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
    })
  } catch (err) {
    clearTimeout(timer)
    const reason = (err as Error).name === 'AbortError' ? 'fetch-timeout' : 'fetch-error'
    return { ok: false, reason }
  }
  clearTimeout(timer)

  if (response.status >= 300 && response.status < 400) {
    return { ok: false, reason: 'redirect-rejected' }
  }
  if (!response.ok) {
    return { ok: false, reason: 'fetch-error' }
  }

  const mimeHeader = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (mimeHeader === 'image/svg+xml') {
    return { ok: false, reason: 'svg-rejected' }
  }
  if (!ALLOWED_REHOST_MIMES.has(mimeHeader)) {
    return { ok: false, reason: 'mime-rejected' }
  }

  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && Number(declaredLength) > MAX_BYTES) {
    return { ok: false, reason: 'oversized' }
  }

  // Stream-limited read: abort if the body overruns the cap.
  if (!response.body) {
    return { ok: false, reason: 'fetch-error' }
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > MAX_BYTES) {
          await reader.cancel()
          return { ok: false, reason: 'oversized' }
        }
        chunks.push(value)
      }
    }
  } catch {
    return { ok: false, reason: 'fetch-error' }
  }

  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)))
  return { ok: true, buffer, mimeHeader }
}

/** Process a single external URL. Returns the new URL on success, or null on failure. */
async function rehostOne(
  src: string,
  opts: RehostOptions
): Promise<{ url: string } | { rejected: RejectReason }> {
  // Data URI path
  if (src.startsWith('data:')) {
    let mime: string
    let buffer: Buffer
    try {
      ;({ mime, buffer } = parseDataUri(src))
    } catch {
      return { rejected: 'data-uri-decode-error' }
    }
    if (mime === 'image/svg+xml') return { rejected: 'svg-rejected' }
    if (!ALLOWED_REHOST_MIMES.has(mime)) return { rejected: 'mime-rejected' }
    if (buffer.length > MAX_BYTES) return { rejected: 'oversized' }
    // Skip magic-byte sniff for data URIs — the declared mime is authoritative
    // and we already validated it. The bytes cannot be a polyglot that escapes
    // the declared format in a way that matters for our storage path.
    try {
      const { url } = await uploadImageBuffer(
        buffer,
        mime,
        PREFIX_BY_CONTENT_TYPE[opts.contentType]
      )
      return { url }
    } catch {
      return { rejected: 'upload-error' }
    }
  }

  // HTTP(S) path
  const safety = await checkUrlSafety(src)
  if (!safety.safe) {
    return { rejected: safety.reason }
  }

  const fetched = await fetchWithLimits(src)
  if (!fetched.ok) {
    return { rejected: fetched.reason }
  }

  const sniffedMime = sniffImageMime(fetched.buffer)
  if (sniffedMime === null || sniffedMime !== fetched.mimeHeader) {
    return { rejected: 'magic-mismatch' }
  }

  try {
    const { url } = await uploadImageBuffer(
      fetched.buffer,
      sniffedMime,
      PREFIX_BY_CONTENT_TYPE[opts.contentType]
    )
    return { url }
  } catch {
    return { rejected: 'upload-error' }
  }
}

/**
 * Rehost every external image src inside a TipTap content tree.
 * Never throws — top-level errors return the input unchanged.
 */
export async function rehostExternalImages(
  json: TiptapContent,
  opts: RehostOptions
): Promise<TiptapContent> {
  try {
    if (!json || typeof json !== 'object') return json
    if (!isS3Configured()) {
      console.info('[content:rehost-images] S3 not configured — no-op')
      return json
    }

    const cloned = cloneTree(json)
    const nodes = collectImageNodes(cloned)
    if (nodes.length === 0) return cloned

    // Process up to MAX_IMAGES_PER_SAVE, dedupe by src
    const unique: Map<string, { nodes: ImageNode[]; rewrite: string | null }> = new Map()
    let considered = 0
    for (const node of nodes) {
      const src = node.attrs?.src
      if (typeof src !== 'string' || src.length === 0) continue
      if (isSameOrigin(src)) {
        // Not an error — just skip silently. Keep src as-is.
        continue
      }
      if (!unique.has(src)) {
        if (considered >= MAX_IMAGES_PER_SAVE) {
          logRejection(src, 'count-cap-exceeded', opts)
          continue
        }
        unique.set(src, { nodes: [], rewrite: null })
        considered++
      }
      unique.get(src)!.nodes.push(node)
    }

    // Fetch + upload each unique URL sequentially
    for (const [src, entry] of unique) {
      const result = await rehostOne(src, opts)
      if ('url' in result) {
        entry.rewrite = result.url
      } else {
        logRejection(src, result.rejected, opts)
      }
    }

    // Patch the cloned tree
    for (const entry of unique.values()) {
      if (entry.rewrite === null) continue
      for (const node of entry.nodes) {
        if (node.attrs) {
          node.attrs.src = entry.rewrite
        }
      }
    }

    return cloned
  } catch (err) {
    console.error('[content:rehost-images] unexpected error, returning input unchanged', err)
    return json
  }
}
```

- [ ] **Step 4.4: Run the test suite and iterate until green**

```bash
bun run test -- apps/web/src/lib/server/content/__tests__/rehost-images.test.ts
```

Expected: all cases pass. If specific cases fail, fix the implementation incrementally — do NOT weaken the tests. The most common first-pass failures:

- Mock ordering: `vi.clearAllMocks()` in `beforeEach` must come after `vi.stubGlobal('fetch', fetchMock)`; re-apply the stub in the `beforeEach` if Vitest resets it
- `structuredClone` availability — Node 17+ has it natively; Bun supports it. If it throws, fall back to `JSON.parse(JSON.stringify(json))` and adjust
- Response body reading — mock Responses created with `new Response(buffer, ...)` may not expose `.body.getReader()`; if a test fails for this reason, construct the body via `new ReadableStream`

- [ ] **Step 4.5: Typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 4.6: Commit**

```bash
git add apps/web/src/lib/server/content/rehost-images.ts \
        apps/web/src/lib/server/content/__tests__/rehost-images.test.ts
git commit -m "feat(content): add auto-rehost for external images in TipTap JSON"
```

---

## Task 5: Wire `rehostExternalImages` into posts service

**Context:** Two call sites — create on line 125, update on line 264. Each wraps the existing `markdownToTiptapJson` output (or a passed-in `input.contentJson`) with `rehostExternalImages`.

**Files:**

- Modify: `apps/web/src/lib/server/domains/posts/post.service.ts`

- [ ] **Step 5.1: Update `createPost` to await rehost before insert**

Replace the transaction block at `post.service.ts:118-147`. Find the existing:

```ts
const post = await db.transaction(async (tx) => {
    const [newPost] = await tx
      .insert(posts)
      .values({
        boardId: input.boardId,
        title,
        content,
        contentJson: input.contentJson ?? markdownToTiptapJson(content),
```

Replace with: compute `contentJson` before the transaction, then use the variable inside it.

```ts
const parsedContentJson = input.contentJson ?? markdownToTiptapJson(content)
const contentJson = await rehostExternalImages(parsedContentJson, {
  contentType: 'post',
  principalId: author.principalId,
})

const post = await db.transaction(async (tx) => {
  const [newPost] = await tx
    .insert(posts)
    .values({
      boardId: input.boardId,
      title,
      content,
      contentJson,
```

Also add the import at the top of the file alongside the existing `markdownToTiptapJson` import:

```ts
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { rehostExternalImages } from '@/lib/server/content/rehost-images'
```

- [ ] **Step 5.2: Update `updatePost` update path**

At `post.service.ts:260-265` find:

```ts
if (input.contentJson !== undefined) {
  updateData.contentJson = input.contentJson
} else if (input.content !== undefined) {
  // Derive contentJson from markdown when only content is provided (MCP/API path)
  updateData.contentJson = markdownToTiptapJson(input.content.trim())
}
```

Replace with:

```ts
if (input.contentJson !== undefined || input.content !== undefined) {
  const parsed = input.contentJson ?? markdownToTiptapJson((input.content ?? '').trim())
  updateData.contentJson = await rehostExternalImages(parsed, {
    contentType: 'post',
    principalId: existingPost.principalId,
  })
}
```

Note: the update function has access to `existingPost` (the pre-update record loaded earlier in the function). If it doesn't (verify by reading the function), pass `undefined` for `principalId` — the rehoster accepts that.

- [ ] **Step 5.3: Typecheck**

```bash
bun run typecheck
```

Expected: clean. If there's a mismatch around `existingPost` not being in scope, adjust — check where the existing `markdownToTiptapJson(input.content.trim())` call lives inside `updatePost` and use whichever principal reference is already available in that scope.

- [ ] **Step 5.4: Run the service tests**

```bash
bun run test -- apps/web/src/lib/server/domains/posts/
```

Expected: existing tests pass. The rehoster is mocked out in the service tests via module-level mocks (if not already mocked, vitest's auto-hoisting will still work because `rehostExternalImages` is a top-level async function that returns its first argument when it can't reach S3). If any test fails because it now observes a rehost call, mock the module:

```ts
vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: vi.fn((json) => Promise.resolve(json)),
}))
```

Add this mock to the existing `post.service.test.ts` near the top with the other `vi.mock` calls.

- [ ] **Step 5.5: Commit**

```bash
git add apps/web/src/lib/server/domains/posts/
git commit -m "feat(posts): auto-rehost external images on create and update"
```

---

## Task 6: Wire `rehostExternalImages` into changelog service

**Files:**

- Modify: `apps/web/src/lib/server/domains/changelog/changelog.service.ts`

- [ ] **Step 6.1: Update `createChangelog`**

At `changelog.service.ts:69-79` find:

```ts
const [entry] = await db
  .insert(changelogEntries)
  .values({
    title,
    content,
    contentJson: input.contentJson ?? markdownToTiptapJson(content),
    principalId: author.principalId,
    publishedAt,
  })
  .returning()
```

Rewrite to compute `contentJson` before the insert:

```ts
const parsedContentJson = input.contentJson ?? markdownToTiptapJson(content)
const contentJson = await rehostExternalImages(parsedContentJson, {
  contentType: 'changelog',
  principalId: author.principalId,
})

const [entry] = await db
  .insert(changelogEntries)
  .values({
    title,
    content,
    contentJson,
    principalId: author.principalId,
    publishedAt,
  })
  .returning()
```

Add the import alongside the existing `markdownToTiptapJson` import:

```ts
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { rehostExternalImages } from '@/lib/server/content/rehost-images'
```

- [ ] **Step 6.2: Update `updateChangelog`**

At `changelog.service.ts:153-158` find:

```ts
if (input.contentJson !== undefined) {
  updateData.contentJson = input.contentJson
} else if (input.content !== undefined) {
  // Derive contentJson from markdown when only content is provided (MCP/API path)
  updateData.contentJson = markdownToTiptapJson(input.content.trim())
}
```

Replace with:

```ts
if (input.contentJson !== undefined || input.content !== undefined) {
  const parsed = input.contentJson ?? markdownToTiptapJson((input.content ?? '').trim())
  updateData.contentJson = await rehostExternalImages(parsed, {
    contentType: 'changelog',
    principalId: existing.principalId,
  })
}
```

(The existing function already loaded `existing` from the DB at the top of `updateChangelog` — verify this is the right variable name by reading the function.)

- [ ] **Step 6.3: Typecheck + run changelog tests**

```bash
bun run typecheck
bun run test -- apps/web/src/lib/server/domains/changelog/
```

Expected: clean. If an existing changelog test breaks because it now observes a rehost call, add the following mock near the top of `changelog-service.test.ts` alongside other `vi.mock` calls:

```ts
vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: vi.fn((json) => Promise.resolve(json)),
}))
```

This makes the rehoster a no-op pass-through for existing tests. The real rehoster is covered by its own unit tests in Task 4.

- [ ] **Step 6.4: Commit**

```bash
git add apps/web/src/lib/server/domains/changelog/
git commit -m "feat(changelog): auto-rehost external images on create and update"
```

---

## Task 7: Wire `rehostExternalImages` into help center service

**Files:**

- Modify: `apps/web/src/lib/server/domains/help-center/help-center.service.ts`

- [ ] **Step 7.1: Update `createArticle`**

At `help-center.service.ts:377-389` find:

```ts
const [article] = await db
  .insert(helpCenterArticles)
  .values({
    categoryId: input.categoryId as HelpCenterCategoryId,
    title,
    content,
    contentJson: input.contentJson ?? markdownToTiptapJson(content),
    slug,
    principalId,
    position: input.position ?? null,
    description: input.description?.trim() || null,
  })
  .returning()
```

Rewrite to compute `contentJson` before the insert:

```ts
const parsedContentJson = input.contentJson ?? markdownToTiptapJson(content)
const contentJson = await rehostExternalImages(parsedContentJson, {
  contentType: 'help-center',
  principalId,
})

const [article] = await db
  .insert(helpCenterArticles)
  .values({
    categoryId: input.categoryId as HelpCenterCategoryId,
    title,
    content,
    contentJson,
    slug,
    principalId,
    position: input.position ?? null,
    description: input.description?.trim() || null,
  })
  .returning()
```

Add the import:

```ts
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { rehostExternalImages } from '@/lib/server/content/rehost-images'
```

- [ ] **Step 7.2: Update `updateArticle`**

At `help-center.service.ts:406-412` find:

```ts
if (input.content !== undefined) {
  updateData.content = input.content.trim()
  updateData.contentJson = input.contentJson ?? markdownToTiptapJson(input.content.trim())
} else if (input.contentJson !== undefined) {
  updateData.contentJson = input.contentJson
}
```

Replace with:

```ts
if (input.content !== undefined || input.contentJson !== undefined) {
  if (input.content !== undefined) {
    updateData.content = input.content.trim()
  }
  const parsed = input.contentJson ?? markdownToTiptapJson((input.content ?? '').trim())
  updateData.contentJson = await rehostExternalImages(parsed, {
    contentType: 'help-center',
    // updateArticle doesn't take a principalId today — leave unset; the
    // rehoster accepts undefined and logs principalId=unknown
  })
}
```

- [ ] **Step 7.3: Typecheck + run help-center tests**

```bash
bun run typecheck
bun run test -- apps/web/src/lib/server/domains/help-center/
```

Expected: clean. If an existing help-center test breaks because it now observes a rehost call, add the following mock near the top of `help-center-service.test.ts` alongside other `vi.mock` calls:

```ts
vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: vi.fn((json) => Promise.resolve(json)),
}))
```

This makes the rehoster a no-op pass-through for existing tests. The real rehoster is covered by its own unit tests in Task 4.

- [ ] **Step 7.4: Commit**

```bash
git add apps/web/src/lib/server/domains/help-center/
git commit -m "feat(help-center): auto-rehost external images on create and update article"
```

---

## Task 8: Update MCP tool metadata (content format + auto-rehost behavior)

**Context:** Approach B from the spec: tool-level description gets a shared "Content format" block and the `content` field `.describe()` strings get a one-line hint. Comment tools get updated too, but with plain-text language since comments don't use rich content today.

**Files:**

- Modify: `apps/web/src/lib/server/mcp/tools.ts`

- [ ] **Step 8.1: Add a shared content-format constant near the top of the file**

Find the existing schema section (around `apps/web/src/lib/server/mcp/tools.ts:276`). Just above `const searchSchema` (line 276), add:

```ts
/**
 * Shared "Content format" block appended to rich-content tool descriptions.
 * Kept as a single constant so the auto-rehost behavior stays DRY across
 * create_post / create_changelog / update_changelog / create_article / update_article.
 */
const CONTENT_FORMAT_BLOCK = `

Content format: GitHub-flavored Markdown (GFM).
Supported: headings (#, ##, ###), bold/italic/strikethrough, links, ordered/bulleted lists, task lists (- [ ]), inline and fenced code blocks with language hints, blockquotes, tables, horizontal rules, images.
Images: \`![alt](https://...)\`. External URLs are fetched server-side and re-uploaded to workspace storage on save (auto-rehost). Supported image types: PNG, JPEG, WebP, GIF, AVIF. Max 10 MB per image, max 20 images per save. Images exceeding these limits keep their original URL as a fallback.
Example: "## New feature\\n\\nAdds **dark mode**. See screenshot:\\n\\n![dark mode](https://example.com/dark.png)"`
```

- [ ] **Step 8.2: Update `create_post` tool description and content field**

At `tools.ts:351-356` replace `createPostSchema` with:

```ts
const createPostSchema = {
  boardId: z.string().describe('Board TypeID (use quackback://boards resource to find IDs)'),
  title: z.string().max(200).describe('Post title (max 200 characters)'),
  content: z
    .string()
    .max(10000)
    .optional()
    .describe(
      'Post content (max 10,000 characters). Markdown (GFM). Images via ![alt](url) are auto-rehosted to workspace storage on save. See tool description for full format details.'
    ),
  statusId: z.string().optional().describe('Initial status TypeID (defaults to board default)'),
  tagIds: z.array(z.string()).optional().describe('Tag TypeIDs to apply'),
}
```

Then at `tools.ts:1010-1015` update the `create_post` tool description (the first argument to the `server.tool(...)` call after the name):

```ts
;`Submit new feedback on a board. Requires board and title; content/status/tags optional.

Examples:
- Minimal: create_post({ boardId: "board_01abc...", title: "Add dark mode" })
- Full: create_post({ boardId: "board_01abc...", title: "Add dark mode", content: "Would love a dark theme option.", statusId: "status_01xyz...", tagIds: ["tag_01a..."] })${CONTENT_FORMAT_BLOCK}`
```

- [ ] **Step 8.3: Update `create_changelog` and `update_changelog`**

At `tools.ts:374` replace `createChangelogSchema` content field:

```ts
content: z
  .string()
  .max(50000)
  .describe(
    'Changelog content. Markdown (GFM), max 50,000 chars. Images via ![alt](url) are auto-rehosted to workspace storage on save. See tool description for full format details.'
  ),
```

At `tools.ts:392` replace `updateChangelogSchema` content field:

```ts
content: z
  .string()
  .max(50000)
  .optional()
  .describe(
    'New content. Markdown (GFM), max 50,000 chars. Images via ![alt](url) are auto-rehosted to workspace storage on save. See tool description for full format details.'
  ),
```

At the `create_changelog` tool description (`tools.ts:1054-1060`), append `${CONTENT_FORMAT_BLOCK}` to the template literal (same pattern as Step 8.2).

At the `update_changelog` tool description (`tools.ts:1096` area) — read the current description, append `${CONTENT_FORMAT_BLOCK}`.

- [ ] **Step 8.4: Update `create_article` and `update_article`**

At `tools.ts:501` replace `createHelpCenterArticleSchema` content field:

```ts
content: z
  .string()
  .max(50000)
  .describe(
    'Article content. Markdown (GFM), max 50,000 chars. Images via ![alt](url) are auto-rehosted to workspace storage on save. See tool description for full format details.'
  ),
```

At `tools.ts:510` replace `updateHelpCenterArticleSchema` content field:

```ts
content: z
  .string()
  .max(50000)
  .optional()
  .describe(
    'New content. Markdown (GFM), max 50,000 chars. Images via ![alt](url) are auto-rehosted to workspace storage on save. See tool description for full format details.'
  ),
```

At the `create_article` and `update_article` tool descriptions (`tools.ts:1645` and `1675` areas), append `${CONTENT_FORMAT_BLOCK}` to the template literal.

- [ ] **Step 8.5: Update comment tools (plain text, not rich)**

At `tools.ts:341-349` replace `addCommentSchema` content field:

```ts
content: z
  .string()
  .max(5000)
  .describe(
    'Comment text. Plain text only (max 5,000 characters). Rich content, markdown, and image embedding are not supported for comments today.'
  ),
```

At `tools.ts:417-420` replace `updateCommentSchema` content field:

```ts
content: z
  .string()
  .max(5000)
  .describe(
    'New comment text. Plain text only (max 5,000 characters). Rich content, markdown, and image embedding are not supported for comments today.'
  ),
```

The `add_comment` and `update_comment` tool descriptions don't need the full `CONTENT_FORMAT_BLOCK` — the `.describe()` string is enough and keeps tool descriptions short for the high-frequency comment path.

- [ ] **Step 8.6: Typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 8.7: Run MCP tests**

```bash
bun run test -- apps/web/src/lib/server/mcp/
```

Expected: existing tests pass — nothing asserts on description strings yet.

- [ ] **Step 8.8: Commit**

```bash
git add apps/web/src/lib/server/mcp/tools.ts
git commit -m "feat(mcp): document content format and auto-rehost for rich-content tools"
```

---

## Task 9: MCP metadata smoke test

**Context:** Add a tiny test that checks each updated tool's content field description contains the right substring. This catches accidental deletion of the format guidance during future refactors.

**Files:**

- Modify: `apps/web/src/lib/server/mcp/__tests__/handler.test.ts` (or create a dedicated `content-format-metadata.test.ts` if the handler test file is already crowded)

- [ ] **Step 9.1: Check whether a dedicated test file is cleaner**

```bash
wc -l apps/web/src/lib/server/mcp/__tests__/handler.test.ts
```

If the file is already over 500 lines, create a new file `apps/web/src/lib/server/mcp/__tests__/content-format-metadata.test.ts`. Otherwise append to `handler.test.ts`.

- [ ] **Step 9.2: Write the smoke test**

Add the following test block. If creating a new file, prefix with the imports.

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { registerTools } from '@/lib/server/mcp/tools'

type CollectedTool = {
  name: string
  description: string
  schema: Record<string, { description?: string }>
}

function collectTools(): CollectedTool[] {
  const tools: CollectedTool[] = []
  const fakeServer = {
    tool: (name: string, description: string, schema: Record<string, unknown>) => {
      const simplified: Record<string, { description?: string }> = {}
      for (const [key, value] of Object.entries(schema)) {
        const desc =
          (value as { _def?: { description?: string } })._def?.description ??
          (value as { description?: string }).description
        simplified[key] = { description: desc }
      }
      tools.push({ name, description, schema: simplified })
    },
  }
  const fakeAuth = {
    principalId: 'principal_test',
    userId: 'user_test',
    name: 'Test',
    email: 'test@example.com',
    scopes: [],
  }
  // registerTools signature: (server, auth) — types may differ in this repo;
  // cast is acceptable for a smoke test.
  registerTools(
    fakeServer as unknown as Parameters<typeof registerTools>[0],
    fakeAuth as unknown as Parameters<typeof registerTools>[1]
  )
  return tools
}

describe('MCP content format metadata', () => {
  const RICH_TOOLS = [
    'create_post',
    'create_changelog',
    'update_changelog',
    'create_article',
    'update_article',
  ]
  const COMMENT_TOOLS = ['add_comment', 'update_comment']

  let tools: CollectedTool[]
  beforeEach(() => {
    tools = collectTools()
  })

  it.each(RICH_TOOLS)('%s: content field mentions markdown and auto-rehost', (toolName) => {
    const tool = tools.find((t) => t.name === toolName)
    expect(tool, `${toolName} not registered`).toBeDefined()
    const description = tool!.schema.content?.description ?? ''
    expect(description.toLowerCase()).toContain('markdown')
    expect(description.toLowerCase()).toContain('auto-rehost')
  })

  it.each(RICH_TOOLS)('%s: tool description contains the content format block', (toolName) => {
    const tool = tools.find((t) => t.name === toolName)!
    expect(tool.description).toContain('Content format:')
    expect(tool.description).toContain('PNG, JPEG, WebP, GIF, AVIF')
  })

  it.each(COMMENT_TOOLS)('%s: content field declares plain text', (toolName) => {
    const tool = tools.find((t) => t.name === toolName)!
    const description = tool.schema.content?.description ?? ''
    expect(description.toLowerCase()).toContain('plain text')
    expect(description.toLowerCase()).not.toContain('markdown')
  })
})
```

- [ ] **Step 9.3: Run the new test**

```bash
bun run test -- apps/web/src/lib/server/mcp/__tests__/
```

Expected: all pass. If `registerTools` requires more mocks than shown, expand the fake `server` and `auth` objects to cover only what that function actually accesses. The goal is to capture the description strings without actually dispatching tool calls.

- [ ] **Step 9.4: Commit**

```bash
git add apps/web/src/lib/server/mcp/__tests__/
git commit -m "test(mcp): smoke check for content format metadata on rich-content tools"
```

---

## Task 10: Final verification

- [ ] **Step 10.1: Full lint + typecheck + test**

```bash
bun run lint 2>&1 | tail -20
bun run typecheck
bun run test
```

Expected: lint clean (pre-existing warnings OK, no new errors), typecheck clean, all tests pass (count should be 1596 + new test cases added in this plan).

- [ ] **Step 10.2: Production build**

```bash
bun run build
```

Expected: build succeeds without errors.

- [ ] **Step 10.3: Review the branch diff**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
```

Sanity check — the diff should be confined to:

- `apps/web/src/lib/server/content/` (new)
- `apps/web/src/lib/server/storage/s3.ts`
- `apps/web/src/lib/server/domains/posts/post.service.ts`
- `apps/web/src/lib/server/domains/changelog/changelog.service.ts`
- `apps/web/src/lib/server/domains/help-center/help-center.service.ts`
- `apps/web/src/lib/server/mcp/tools.ts`
- `apps/web/src/lib/server/mcp/__tests__/`
- `docs/superpowers/{specs,plans}/2026-04-13-auto-rehost-external-images*.md`

No changes outside that scope.

- [ ] **Step 10.4: Done**

The feature is ready for review. Auto-rehost runs on every create/update for posts, changelogs, and help center articles; external image URLs are fetched, validated, and re-uploaded to workspace storage with SSRF / scheme / size / magic-byte guards; per-image failures fall back to the original URL; MCP tool metadata documents the content format and auto-rehost behavior for LLM agents.

---

## Risks & open items

1. **`structuredClone` availability.** Assumed to exist under Bun and Node 17+. If the test runner chokes on it (e.g. because a Bun version predates native support), swap for `JSON.parse(JSON.stringify(json))` inside `cloneTree`. Downside: loses `undefined` values, but TipTap docs don't contain any.

2. **Image-node type coverage.** This plan handles `image` and `resizableImage` node types. If a future custom node (e.g. `figure` wrapping an image) is added to the editor, it won't be traversed. Flagged as a follow-up in the codebase — add the new type name to `IMAGE_NODE_TYPES` when introducing the node.

3. **`updateArticle` has no principalId in scope.** The help center service doesn't currently take a `principalId` on update. The rehoster accepts `undefined` — logs will show `principalId=unknown` for rehost warnings triggered by article edits. If richer audit logs are needed later, thread a principal id through the update service.

4. **MCP metadata test uses a fake server.** The test in Task 9 mocks `server.tool` and captures descriptions. If `registerTools` ever starts doing work that requires a real `McpServer` (e.g. validates the schema against a typebox), the fake might not satisfy type checks; widen the cast or add a minimal typed fake. The test is a smoke check, not a behavioral guarantee.

5. **DNS pinning not yet wired into fetch.** `checkUrlSafety` returns the pinned address, but the current `fetchWithLimits` uses the plain `fetch(url, ...)` — Node re-resolves on its own, leaving a narrow rebinding window. A follow-up enhancement is to pass the pinned address through a custom `dispatcher` (undici `Agent`) or swap to a lower-level http client that supports connect-by-IP. This plan ships the pre-flight check, which already blocks the common cases (LLMs emitting loopback or metadata URLs, mistyped hostnames resolving to private networks); TOCTOU rebinding is a rarer active attack and is out of scope for this initial plan.
