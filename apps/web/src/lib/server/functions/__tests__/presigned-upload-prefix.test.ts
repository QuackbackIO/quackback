/**
 * The generic upload URL takes only the prefixes the editors that upload
 * media use. Branding keys (the wide logo, the square logo, portal fonts)
 * have upload functions of their own, behind the branding permission, so a
 * role that can only post cannot write there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const signed = vi.hoisted(() => [] as string[])
vi.mock('../../storage/s3', () => ({
  isS3Usable: () => true,
  generatePresignedUploadUrl: async (key: string) => {
    signed.push(key)
    return { uploadUrl: `/api/storage/${key}?sig=x`, publicUrl: `/api/storage/${key}`, key }
  },
  generateStorageKey: (prefix: string, filename: string) => `${prefix}/2026/11/abc-${filename}`,
  isAllowedImageType: () => true,
  MAX_FILE_SIZE: 5 * 1024 * 1024,
}))
vi.mock('../widget-auth', () => ({ getWidgetSession: vi.fn() }))
vi.mock('../auth-helpers', () => ({ requireAuth: async () => ({}) }))

const { getPresignedUploadUrlFn } = await import('../uploads')

// The prefix comes from the network: any string can arrive.
type AnyPrefix = Parameters<typeof getPresignedUploadUrlFn>[0]['data']['prefix']
const ask = (prefix?: string) =>
  getPresignedUploadUrlFn({
    data: {
      filename: 'a.png',
      contentType: 'image/png',
      fileSize: 1000,
      ...(prefix ? { prefix: prefix as AnyPrefix } : {}),
    },
  })

beforeEach(() => {
  signed.length = 0
})

describe('getPresignedUploadUrlFn', () => {
  it('signs the media prefixes, and uploads/ by default', async () => {
    await ask('post-images')
    await ask()
    expect(signed).toEqual(['post-images/2026/11/abc-a.png', 'uploads/2026/11/abc-a.png'])
  })

  it.each(['header-logos', 'fonts', 'logos', 'avatars', 'header-logos/../x', 'anything'])(
    'refuses the %s prefix',
    async (prefix) => {
      await expect(ask(prefix)).rejects.toThrow()
      expect(signed).toEqual([])
    }
  )
})
