/**
 * The wide (header) logo upload: a branding permission, and the only image
 * upload that may be an SVG. Every other branding upload stays raster only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = (args: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler(args)
    }
    fn.validator = () => fn
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      _handler = h
      return fn
    }
    return fn
  },
}))

const requireAuth = vi.fn(async (_options?: { permission?: string }) => ({}))
vi.mock('../auth-helpers', () => ({ requireAuth }))

const generatePresignedUploadUrl = vi.fn(async (key: string, _contentType: string) => ({
  uploadUrl: `/api/storage/${key}?sig`,
  publicUrl: `/api/storage/${key}`,
  key,
}))
vi.mock('../../storage/s3', () => ({
  isS3Usable: vi.fn(() => true),
  generatePresignedUploadUrl,
  generateStorageKey: vi.fn((prefix: string, filename: string) => `${prefix}/${filename}`),
  isAllowedImageType: vi.fn((type: string) =>
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type)
  ),
  MAX_FILE_SIZE: 10 * 1024 * 1024,
}))

vi.mock('../widget-auth', () => ({ getWidgetSession: vi.fn() }))

const recordStagedUpload = vi.fn(async (_key: string) => {})
vi.mock('@/lib/server/domains/settings/settings.staged-uploads', () => ({ recordStagedUpload }))

const {
  getHeaderLogoUploadUrlFn,
  getIconUploadUrlsFn,
  getLogoUploadUrlFn,
  getFaviconUploadUrlFn,
  getPostImageUploadUrlFn,
} = await import('../uploads')

const svg = { filename: 'wordmark.svg', contentType: 'image/svg+xml', fileSize: 2_000 }
const png = { filename: 'wordmark.png', contentType: 'image/png', fileSize: 2_000 }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getHeaderLogoUploadUrlFn', () => {
  it('needs the branding permission, as the rest of the portal look does', async () => {
    await getHeaderLogoUploadUrlFn({ data: png })
    expect(requireAuth).toHaveBeenCalledWith({ permission: 'settings.branding' })
  })

  it('accepts an SVG under header-logos/', async () => {
    const result = await getHeaderLogoUploadUrlFn({ data: svg })
    expect(result.key).toBe('header-logos/wordmark.svg')
    expect(generatePresignedUploadUrl).toHaveBeenCalledWith(
      'header-logos/wordmark.svg',
      'image/svg+xml'
    )
  })

  it('still accepts a raster logo', async () => {
    const result = await getHeaderLogoUploadUrlFn({ data: png })
    expect(result.key).toBe('header-logos/wordmark.png')
  })

  it('refuses anything else, naming SVG among the types allowed', async () => {
    await expect(
      getHeaderLogoUploadUrlFn({ data: { ...svg, contentType: 'text/html' } })
    ).rejects.toThrow(/JPEG, PNG, GIF, WebP, SVG/)
  })
})

describe('getHeaderLogoUploadUrlFn: a staged upload', () => {
  // The upload is not saved: a publish saves it. Until then it is on the
  // staged list, so the daily sweep can remove it if it is never published.
  it('records the key as staged before handing out the upload URL', async () => {
    await getHeaderLogoUploadUrlFn({ data: svg })
    expect(recordStagedUpload).toHaveBeenCalledWith('header-logos/wordmark.svg')
    expect(recordStagedUpload.mock.invocationCallOrder[0]).toBeLessThan(
      generatePresignedUploadUrl.mock.invocationCallOrder[0]!
    )
  })

  it('hands out no upload URL when the key cannot be recorded', async () => {
    recordStagedUpload.mockRejectedValueOnce(new Error('Too many uploads are waiting'))
    await expect(getHeaderLogoUploadUrlFn({ data: svg })).rejects.toThrow(/Too many/)
    expect(generatePresignedUploadUrl).not.toHaveBeenCalled()
  })

  it('stages nothing for an upload that is saved at once', async () => {
    await getLogoUploadUrlFn({ data: png })
    expect(recordStagedUpload).not.toHaveBeenCalled()
  })
})

describe('getIconUploadUrlsFn: the icon and its favicon, staged for a publish', () => {
  const favicon = { filename: 'favicon.png', contentType: 'image/png', fileSize: 400 }

  it('needs settings.manage, since the icon is in emails and the browser tab too', async () => {
    await getIconUploadUrlsFn({ data: { icon: png, favicon } })
    expect(requireAuth).toHaveBeenCalledWith({ permission: 'settings.manage' })
  })

  it('stages both under their own prefixes before handing out the URLs', async () => {
    const result = await getIconUploadUrlsFn({ data: { icon: png, favicon } })
    expect([result.icon.key, result.favicon.key]).toEqual([
      'logos/wordmark.png',
      'favicons/favicon.png',
    ])
    expect(recordStagedUpload.mock.calls.map(([key]) => key)).toEqual([
      'logos/wordmark.png',
      'favicons/favicon.png',
    ])
  })

  it('refuses an SVG icon: emails cannot show one', async () => {
    await expect(getIconUploadUrlsFn({ data: { icon: svg, favicon } })).rejects.toThrow()
  })
})

describe('every other image upload', () => {
  it.each([
    ['logo', getLogoUploadUrlFn],
    ['favicon', getFaviconUploadUrlFn],
    ['post image', getPostImageUploadUrlFn],
  ])('refuses an SVG for the %s', async (_label, fn) => {
    await expect(fn({ data: svg })).rejects.toThrow(/Invalid image type/)
    expect(generatePresignedUploadUrl).not.toHaveBeenCalled()
  })
})
