/**
 * Storage keys double as capability URLs on public buckets, so the random
 * segment must be a full UUID (122 bits), not a truncated prefix.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://app.example.com' },
}))

const { generateStorageKey } = await import('@/lib/server/storage/s3')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('generateStorageKey', () => {
  it('uses a full UUID as the random segment', () => {
    const key = generateStorageKey('changelog-images', 'photo.jpg')
    const file = key.split('/').at(-1)!
    const randomId = file.slice(0, file.length - '-photo.jpg'.length)
    expect(randomId).toMatch(UUID_RE)
    expect(file.endsWith('-photo.jpg')).toBe(true)
  })

  it('keeps the prefix/year/month layout and sanitizes the filename', () => {
    const key = generateStorageKey('portal-images', 'My File (1).PNG')
    expect(key).toMatch(/^portal-images\/\d{4}\/\d{2}\/[0-9a-f-]{36}-my_file__1_.png$/)
  })
})
