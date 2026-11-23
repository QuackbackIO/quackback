/**
 * A portal font file's upload URL: for someone who can edit branding, a
 * woff2, woff, ttf or otf within its size cap, with file storage, on every
 * plan. Each refusal comes back as a value the editor shows.
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

const state = vi.hoisted(() => ({
  storage: true,
  permissions: [] as string[],
  signed: [] as Array<[string, string]>,
  staged: [] as string[],
  tooMany: false,
}))

vi.mock('@/lib/server/domains/settings/settings.staged-uploads', async () => {
  const { ValidationError } = await import('@/lib/shared/errors')
  return {
    recordStagedUpload: async (key: string) => {
      if (state.tooMany)
        throw new ValidationError(
          'TOO_MANY_STAGED_UPLOADS',
          'Too many uploads are waiting to be published. Publish your changes or try again tomorrow.'
        )
      state.staged.push(key)
    },
  }
})

vi.mock('../../storage/s3', () => ({
  isS3Usable: () => state.storage,
  generatePresignedUploadUrl: async (key: string, contentType: string) => {
    state.signed.push([key, contentType])
    return { uploadUrl: `/api/storage/${key}?sig=x`, publicUrl: `/api/storage/${key}`, key }
  },
  generateStorageKey: (prefix: string, filename: string) =>
    `${prefix}/2026/10/abc-${filename.toLowerCase()}`,
  isAllowedImageType: () => true,
  MAX_FILE_SIZE: 5 * 1024 * 1024,
}))
vi.mock('../widget-auth', () => ({ getWidgetSession: vi.fn() }))
vi.mock('../auth-helpers', () => ({
  requireAuth: async (options: { permission: string }) => {
    state.permissions.push(options.permission)
    return {}
  },
}))

const { getFontUploadUrlFn } = await import('../uploads')

const ask = (filename: string, fileSize = 30_000) =>
  getFontUploadUrlFn({ data: { filename, fileSize } })

beforeEach(() => {
  state.storage = true
  state.permissions = []
  state.signed = []
  state.staged = []
  state.tooMany = false
})

describe('getFontUploadUrlFn', () => {
  it('signs a woff2 under fonts/ for someone who can edit branding', async () => {
    expect(await ask('Brand-Bold.woff2')).toEqual({
      ok: true,
      uploadUrl: '/api/storage/fonts/2026/10/abc-brand-bold.woff2?sig=x',
      key: 'fonts/2026/10/abc-brand-bold.woff2',
      contentType: 'font/woff2',
    })
    expect(state.signed).toEqual([['fonts/2026/10/abc-brand-bold.woff2', 'font/woff2']])
    expect(state.permissions).toEqual(['settings.branding'])
    // Staged until a publish names it; the daily sweep removes it otherwise.
    expect(state.staged).toEqual(['fonts/2026/10/abc-brand-bold.woff2'])
  })

  it('refuses as a value when too many uploads wait for a publish, signing nothing', async () => {
    state.tooMany = true
    expect(await ask('Brand-Bold.woff2')).toEqual({
      ok: false,
      code: 'TOO_MANY_STAGED_UPLOADS',
      message:
        'Too many uploads are waiting to be published. Publish your changes or try again tomorrow.',
    })
    expect(state.signed).toEqual([])
  })

  it('signs woff, ttf and otf files with their own type and size cap', async () => {
    expect(await ask('Brand-Bold.woff', 500 * 1024)).toMatchObject({
      ok: true,
      contentType: 'font/woff',
    })
    expect(await ask('Brand-Bold.ttf', 900 * 1024)).toMatchObject({
      ok: true,
      contentType: 'font/ttf',
    })
    expect(await ask('Brand-Bold.otf')).toMatchObject({ ok: true, contentType: 'font/otf' })
    expect(await ask('Brand-Bold.ttf', 1024 * 1024 + 1)).toEqual({
      ok: false,
      code: 'TOO_LARGE',
      message: 'Brand-Bold.ttf is over 1 MB.',
    })
  })

  it('refuses other files, large files and no storage', async () => {
    expect(await ask('Brand-Bold.eot')).toMatchObject({
      ok: false,
      code: 'NOT_A_FONT',
      message: 'Brand-Bold.eot is not a woff2, woff, ttf or otf file.',
    })
    expect(await ask('Brand-Bold.woff2', 400 * 1024 + 1)).toMatchObject({
      ok: false,
      code: 'TOO_LARGE',
    })
    state.storage = false
    expect(await ask('Brand-Bold.woff2')).toMatchObject({
      ok: false,
      code: 'STORAGE_UNAVAILABLE',
    })
    expect(state.signed).toEqual([])
  })

  it('stages nothing for a refused file', async () => {
    await ask('Brand-Bold.eot')
    expect(state.staged).toEqual([])
  })
})
