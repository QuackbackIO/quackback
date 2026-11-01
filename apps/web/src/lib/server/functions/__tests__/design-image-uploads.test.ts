import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = (args: { data: unknown }) => handler!(args)
    fn.validator = () => fn
    fn.handler = (h: typeof handler) => {
      handler = h
      return fn
    }
    return fn
  },
}))

vi.mock('../../storage/s3', () => ({
  isS3Usable: vi.fn(() => true),
  generatePresignedUploadUrl: vi.fn(async (key: string, contentType: string) => ({
    uploadUrl: `https://s3.example.com/${key}?presigned`,
    key,
    contentType,
  })),
  generateStorageKey: vi.fn((prefix: string, filename: string) => `${prefix}/${filename}`),
  isAllowedImageType: vi.fn((type: string) =>
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type)
  ),
  MAX_FILE_SIZE: 10 * 1024 * 1024,
}))

const requireAuth = vi.hoisted(() => vi.fn())
vi.mock('../auth-helpers', () => ({ requireAuth }))
vi.mock('../widget-auth', () => ({ getWidgetSession: vi.fn() }))

import { PERMISSIONS } from '@/lib/shared/permissions'
import { getBandImageUploadUrlFn, getLogoUploadUrlFn, getWordmarkUploadUrlFn } from '../uploads'

const file = (filename: string, contentType: string) => ({
  data: { filename, contentType, fileSize: 2000 },
})

beforeEach(() => vi.clearAllMocks())

describe('a design’s wordmark upload', () => {
  it('takes an SVG, as most logos are, beside the usual images', async () => {
    const svg = await getWordmarkUploadUrlFn(file('wordmark.svg', 'image/svg+xml'))
    expect(svg).toMatchObject({ key: 'header-logos/wordmark.svg', contentType: 'image/svg+xml' })
    await expect(getWordmarkUploadUrlFn(file('w.png', 'image/png'))).resolves.toMatchObject({
      key: 'header-logos/w.png',
    })
    expect(requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.SETTINGS_MANAGE })
  })

  it('still refuses what is not an image', async () => {
    await expect(getWordmarkUploadUrlFn(file('page.html', 'text/html'))).rejects.toThrow(
      'Invalid image type'
    )
  })
})

describe('other image uploads', () => {
  it('keep refusing SVG: the workspace logo also goes in emails', async () => {
    await expect(getLogoUploadUrlFn(file('logo.svg', 'image/svg+xml'))).rejects.toThrow(
      'Invalid image type'
    )
  })

  it('take a band image as a photo, never an SVG', async () => {
    await expect(getBandImageUploadUrlFn(file('room.jpg', 'image/jpeg'))).resolves.toMatchObject({
      key: 'portal-images/room.jpg',
    })
    await expect(getBandImageUploadUrlFn(file('x.svg', 'image/svg+xml'))).rejects.toThrow(
      'Invalid image type'
    )
    expect(requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.SETTINGS_MANAGE })
  })
})
