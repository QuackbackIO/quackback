/**
 * Read links for pipeline files (`files/`) expire; every other prefix keeps
 * the non-expiring token byte for byte, because those tokens are embedded in
 * stored content.
 *
 * A `files/` link is `?read=<hmac>&exp=<ms>`, where the HMAC binds
 * `read|<key>|<exp>` (workspace-bound like every other storage token) and
 * `exp` is the end of the current UTC day plus 30 days: the same URL all day,
 * valid for 30 to 31 days.
 */
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SECRET = 'fixture-secret'

vi.mock('@/lib/server/config', () => ({
  config: {
    s3Bucket: 'env-bucket',
    s3Region: 'env-region',
    s3AccessKeyId: 'env-access-key',
    s3SecretAccessKey: 'fixture-secret',
    s3ForcePathStyle: true,
    s3Proxy: false,
    baseUrl: 'https://app.example.com',
  },
}))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return { send: async () => ({}), destroy: vi.fn() }
  }),
  PutObjectCommand: vi.fn(function (input: unknown) {
    return { input }
  }),
}))

const {
  getPublicUrlOrNull,
  getEmailSafeUrl,
  resignStoredAssetUrl,
  verifyStorageReadToken,
  hasExpiringReadToken,
  fileReadTokenExpiry,
  uploadObject,
} = await import('../s3')
const { isTrustedAttachmentUrl } = await import('../trusted-url')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')
const { FILES_PREFIX } = await import('@/lib/server/domains/files/files.service')

const DAY = 86_400_000
const FILE_KEY = 'files/2026/10/0b5c3f43-8d0a-4c4e-9a59-2f1d1f6c1a11-report.pdf'
const LEGACY_KEY = 'attachments/2026/08/contract.pdf'

/** 2026-10-01T09:30:00Z, a fixed instant mid-day. */
const NOW = Date.UTC(2026, 9, 1, 9, 30)
/** End of 2026-10-01 UTC, plus 30 days. */
const EXP = Date.UTC(2026, 9, 2) + 30 * DAY

function params(url: string | null): URLSearchParams {
  return new URL(url!, 'https://placeholder.invalid').searchParams
}

/** The message as the spec states it, signed by hand in the single-workspace namespace. */
function handSigned(key: string, exp: number | string): string {
  return createHmac('sha256', SECRET).update(`read|${key}|${exp}`).digest('hex').slice(0, 32)
}

function legacySigned(key: string): string {
  return createHmac('sha256', SECRET).update(`read|${key}`).digest('hex').slice(0, 32)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('which keys carry an expiring token', () => {
  it('is exactly the file pipeline prefix', () => {
    expect(hasExpiringReadToken(`${FILES_PREFIX}/2026/10/x.pdf`)).toBe(true)
    expect(hasExpiringReadToken(FILE_KEY)).toBe(true)
    expect(hasExpiringReadToken(LEGACY_KEY)).toBe(false)
    expect(hasExpiringReadToken('chat-images/2026/10/a.png')).toBe(false)
    // A prefix match on the segment, not on the string.
    expect(hasExpiringReadToken('files-old/2026/10/x.pdf')).toBe(false)
    expect(hasExpiringReadToken('filesx')).toBe(false)
  })
})

describe('minting a files/ read link', () => {
  it('carries read and exp, where exp is the end of the UTC day plus 30 days', () => {
    const url = getPublicUrlOrNull(FILE_KEY)
    expect(url).toBe(`/api/storage/${FILE_KEY}?read=${handSigned(FILE_KEY, EXP)}&exp=${EXP}`)
    expect(fileReadTokenExpiry()).toBe(EXP)
  })

  it('is the same URL all day, and a new one the next day', () => {
    const morning = getPublicUrlOrNull(FILE_KEY)
    vi.setSystemTime(Date.UTC(2026, 9, 1, 23, 59, 59, 999))
    expect(getPublicUrlOrNull(FILE_KEY)).toBe(morning)
    vi.setSystemTime(Date.UTC(2026, 9, 2))
    const next = getPublicUrlOrNull(FILE_KEY)
    expect(next).not.toBe(morning)
    expect(Number(params(next).get('exp'))).toBe(EXP + DAY)
  })

  it('is valid for 30 to 31 days from the moment it is minted', () => {
    for (const at of [Date.UTC(2026, 9, 1), NOW, Date.UTC(2026, 9, 2) - 1]) {
      vi.setSystemTime(at)
      const left = Number(params(getPublicUrlOrNull(FILE_KEY)).get('exp')) - at
      expect(left).toBeGreaterThan(30 * DAY)
      expect(left).toBeLessThanOrEqual(31 * DAY)
    }
  })

  it('mints the same form on every path that hands out a URL', async () => {
    const expected = `/api/storage/${FILE_KEY}?read=${handSigned(FILE_KEY, EXP)}&exp=${EXP}`
    expect(resignStoredAssetUrl(`/api/storage/${FILE_KEY}?read=${legacySigned(FILE_KEY)}`)).toBe(
      expected
    )
    expect(resignStoredAssetUrl(`https://old.example.com/api/storage/${FILE_KEY}`)).toBe(expected)
    expect(getEmailSafeUrl(FILE_KEY)).toBe(`https://app.example.com${expected}&email=1`)
  })

  it('round-trips through the verifier', () => {
    const p = params(getPublicUrlOrNull(FILE_KEY))
    expect(verifyStorageReadToken(SECRET, FILE_KEY, p.get('read'), p.get('exp'))).toBe(true)
  })
})

describe('verifying a files/ read link', () => {
  const valid = () => params(getPublicUrlOrNull(FILE_KEY))

  it('refuses it once exp has passed', () => {
    const p = valid()
    vi.setSystemTime(EXP - 1)
    expect(verifyStorageReadToken(SECRET, FILE_KEY, p.get('read'), p.get('exp'))).toBe(true)
    vi.setSystemTime(EXP)
    expect(verifyStorageReadToken(SECRET, FILE_KEY, p.get('read'), p.get('exp'))).toBe(false)
    vi.setSystemTime(EXP + DAY)
    expect(verifyStorageReadToken(SECRET, FILE_KEY, p.get('read'), p.get('exp'))).toBe(false)
  })

  it('refuses the non-expiring token, with or without an exp', () => {
    const legacy = legacySigned(FILE_KEY)
    expect(verifyStorageReadToken(SECRET, FILE_KEY, legacy, null)).toBe(false)
    expect(verifyStorageReadToken(SECRET, FILE_KEY, legacy, String(EXP))).toBe(false)
    expect(verifyStorageReadToken(SECRET, FILE_KEY, legacy)).toBe(false)
  })

  it('refuses a valid signature with no exp at all', () => {
    expect(verifyStorageReadToken(SECRET, FILE_KEY, valid().get('read'), null)).toBe(false)
  })

  it('refuses a tampered exp', () => {
    const sig = valid().get('read')
    for (const exp of [
      String(EXP + 1),
      String(EXP + 365 * DAY),
      `0${EXP}`,
      `${EXP}.0`,
      ` ${EXP}`,
      `+${EXP}`,
      '1e13',
      '-1',
      '',
      'Infinity',
    ]) {
      expect(verifyStorageReadToken(SECRET, FILE_KEY, sig, exp), exp).toBe(false)
    }
  })

  it('refuses an exp further out than any minted link, even when correctly signed', () => {
    const far = Date.UTC(2026, 9, 2) + 40 * DAY
    expect(verifyStorageReadToken(SECRET, FILE_KEY, handSigned(FILE_KEY, far), String(far))).toBe(
      false
    )
    // The control: the same hand-signed form at a legal exp verifies.
    expect(verifyStorageReadToken(SECRET, FILE_KEY, handSigned(FILE_KEY, EXP), String(EXP))).toBe(
      true
    )
  })

  it('refuses a token minted for another key', () => {
    const other = 'files/2026/10/1d6f3a3e-0000-4000-8000-000000000000-other.pdf'
    const p = valid()
    expect(verifyStorageReadToken(SECRET, other, p.get('read'), p.get('exp'))).toBe(false)
  })

  it('refuses a token minted under another secret', () => {
    const p = valid()
    expect(verifyStorageReadToken('another-secret', FILE_KEY, p.get('read'), p.get('exp'))).toBe(
      false
    )
  })
})

describe('workspace binding', () => {
  const SHARED_SECRET = {
    storage: { accessKeyId: 'shared-key', secretAccessKey: SECRET },
  } as const

  it('signs a files/ key differently per workspace on one shared secret', () => {
    const alpha = withWorkspace('workspace-alpha', () => getPublicUrlOrNull(FILE_KEY), {
      secrets: SHARED_SECRET,
    })
    const bravo = withWorkspace('workspace-bravo', () => getPublicUrlOrNull(FILE_KEY), {
      secrets: SHARED_SECRET,
    })
    expect(params(alpha).get('exp')).toBe(params(bravo).get('exp'))
    expect(params(alpha).get('read')).not.toBe(params(bravo).get('read'))
    // Neither is the single-workspace message.
    expect(params(alpha).get('read')).not.toBe(handSigned(FILE_KEY, EXP))

    const a = params(alpha)
    expect(
      withWorkspace('workspace-alpha', () =>
        verifyStorageReadToken(SECRET, FILE_KEY, a.get('read'), a.get('exp'))
      )
    ).toBe(true)
    expect(
      withWorkspace('workspace-bravo', () =>
        verifyStorageReadToken(SECRET, FILE_KEY, a.get('read'), a.get('exp'))
      )
    ).toBe(false)
  })
})

describe('every other prefix is unchanged', () => {
  it('mints the historical non-expiring token, pinned', () => {
    // HMAC-SHA256('fixture-secret', 'read|attachments/2026/08/contract.pdf'),
    // first 32 hex characters. Stored content embeds these; a changed message
    // is a fleet of dead links.
    const url = getPublicUrlOrNull(LEGACY_KEY)
    expect(url).toBe(`/api/storage/${LEGACY_KEY}?read=9439058d60edef4b0c050819ec3fd732`)
    expect(legacySigned(LEGACY_KEY)).toBe('9439058d60edef4b0c050819ec3fd732')
  })

  it('never expires and ignores an exp parameter', () => {
    const sig = params(getPublicUrlOrNull(LEGACY_KEY)).get('read')
    vi.setSystemTime(NOW + 10 * 365 * DAY)
    expect(verifyStorageReadToken(SECRET, LEGACY_KEY, sig)).toBe(true)
    expect(verifyStorageReadToken(SECRET, LEGACY_KEY, sig, null)).toBe(true)
    expect(verifyStorageReadToken(SECRET, LEGACY_KEY, sig, '1')).toBe(true)
  })

  it('does not accept the expiring form for a non-files key', () => {
    expect(
      verifyStorageReadToken(SECRET, LEGACY_KEY, handSigned(LEGACY_KEY, EXP), String(EXP))
    ).toBe(false)
  })

  it('keeps public keys unsigned', () => {
    expect(getPublicUrlOrNull('logos/2026/08/brand.png')).toBe(
      '/api/storage/logos/2026/08/brand.png'
    )
  })
})

describe('trusted attachment URLs', () => {
  it('accepts the expiring form, relative and on the app host', () => {
    const url = getPublicUrlOrNull(FILE_KEY)!
    expect(isTrustedAttachmentUrl(url)).toBe(true)
    expect(isTrustedAttachmentUrl(`https://app.example.com${url}`)).toBe(true)
    expect(isTrustedAttachmentUrl(`https://evil.example.net${url}`)).toBe(false)
  })
})

describe('upload responses', () => {
  it('returns the expiring form from uploadObject', async () => {
    const url = await withWorkspace('workspace-alpha', () =>
      uploadObject(FILE_KEY, new Uint8Array([1]), 'application/pdf')
    )
    expect(params(url).get('exp')).toBe(String(EXP))
    expect(params(url).get('read')).toMatch(/^[0-9a-f]{32}$/)
  })
})
