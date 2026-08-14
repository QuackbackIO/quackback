/**
 * Off-host leaves absolutize persist refs from the immutable system host.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/config', () => ({
  config: {
    baseUrl: 'https://env-app.example.net',
    s3PublicUrl: 'https://env-cdn.example.net',
  },
}))

const {
  absolutizeOffHostAssetUrl,
  getSystemAssetOrigin,
  isStoredAssetPath,
  systemHostOriginFromPublicUrl,
} = await import('../asset-url')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')

const KEY = 'logos/2026/08/brand.png'

describe('systemHostOriginFromPublicUrl', () => {
  it('reads the origin of a pinned https://host/api/storage value', () => {
    expect(systemHostOriginFromPublicUrl('https://ws-abc123.quackback.co.uk/api/storage')).toBe(
      'https://ws-abc123.quackback.co.uk'
    )
    expect(systemHostOriginFromPublicUrl('https://ws-abc123.quackback.co.uk/api/storage/')).toBe(
      'https://ws-abc123.quackback.co.uk'
    )
  })

  it('ignores CDN-style publicUrl values', () => {
    expect(systemHostOriginFromPublicUrl('https://assets-workspace.example.com')).toBeNull()
    expect(systemHostOriginFromPublicUrl('https://cdn.example.com/bucket')).toBeNull()
    expect(systemHostOriginFromPublicUrl('')).toBeNull()
  })
})

describe('getSystemAssetOrigin', () => {
  it('uses the pinned system host, not the friendly URL or env base', () => {
    const origin = withWorkspace('workspace-alpha', () => getSystemAssetOrigin(), {
      storage: { publicUrl: 'https://ws-abc123.quackback.co.uk/api/storage' },
      baseUrl: 'https://acme.quackback.co.uk',
    })
    expect(origin).toBe('https://ws-abc123.quackback.co.uk')
  })

  it('falls back to the workspace base when the pin is not a system-host storage URL', () => {
    const origin = withWorkspace('workspace-alpha', () => getSystemAssetOrigin(), {
      storage: { publicUrl: 'https://assets-workspace-alpha.example.com' },
    })
    expect(origin).toBe('https://workspace-alpha.example.com')
  })

  it('uses config.baseUrl when unscoped', () => {
    expect(getSystemAssetOrigin()).toBe('https://env-app.example.net')
  })
})

describe('absolutizeOffHostAssetUrl', () => {
  it('prefixes relative persist refs with the system host', () => {
    const url = withWorkspace(
      'workspace-alpha',
      () => absolutizeOffHostAssetUrl(`/api/storage/${KEY}`),
      {
        storage: { publicUrl: 'https://ws-abc123.quackback.co.uk/api/storage' },
        baseUrl: 'https://acme.quackback.co.uk',
      }
    )
    expect(url).toBe(`https://ws-abc123.quackback.co.uk/api/storage/${KEY}`)
  })

  it('rewrites a legacy friendly-host storage src onto the system host', () => {
    const url = withWorkspace(
      'workspace-alpha',
      () => absolutizeOffHostAssetUrl(`https://acme.quackback.co.uk/api/storage/${KEY}`),
      {
        storage: { publicUrl: 'https://ws-abc123.quackback.co.uk/api/storage' },
        baseUrl: 'https://acme.quackback.co.uk',
      }
    )
    expect(url).toBe(`https://ws-abc123.quackback.co.uk/api/storage/${KEY}`)
  })

  it('leaves a legacy CDN src untouched', () => {
    expect(absolutizeOffHostAssetUrl(`https://cdn.example.com/${KEY}`)).toBe(
      `https://cdn.example.com/${KEY}`
    )
  })

  it('adds the email proxy hint on storage refs', () => {
    const url = withWorkspace(
      'workspace-alpha',
      () => absolutizeOffHostAssetUrl(`/api/storage/${KEY}?read=abc`, { email: true }),
      {
        storage: { publicUrl: 'https://ws-abc123.quackback.co.uk/api/storage' },
        baseUrl: 'https://acme.quackback.co.uk',
      }
    )
    expect(url).toBe(`https://ws-abc123.quackback.co.uk/api/storage/${KEY}?read=abc&email=1`)
  })

  it('does not treat /api/storage as a stored asset path', () => {
    expect(isStoredAssetPath('/api/storage')).toBe(false)
    expect(isStoredAssetPath('/api/storage/')).toBe(false)
    expect(isStoredAssetPath(`/api/storage/${KEY}`)).toBe(true)
  })
})
