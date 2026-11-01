/**
 * A portal font file's upload URL: for someone who can edit branding, woff2
 * of up to 400 KB only, with file storage and a plan with custom CSS. Each
 * refusal comes back as a value the Brand panel shows.
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
  plan: true,
  permissions: [] as string[],
  signed: [] as Array<[string, string]>,
}))

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
vi.mock('@/lib/server/domains/settings/tier-enforce', async () => {
  const { TierLimitError } = await import('@/lib/server/errors/tier-limit-error')
  return {
    assertTierFeature: async (_feature: string, friendly: string) => {
      if (!state.plan)
        throw new TierLimitError({
          limit: 'features.customCss',
          message: `${friendly} is not available on your plan. Upgrade to enable it.`,
        })
    },
  }
})

const { getFontUploadUrlFn } = await import('../uploads')

const ask = (filename: string, fileSize = 30_000) =>
  getFontUploadUrlFn({ data: { filename, fileSize } })

beforeEach(() => {
  state.storage = true
  state.plan = true
  state.permissions = []
  state.signed = []
})

describe('getFontUploadUrlFn', () => {
  it('signs a woff2 under fonts/ for someone who can edit branding', async () => {
    expect(await ask('Brand-Bold.woff2')).toEqual({
      ok: true,
      uploadUrl: '/api/storage/fonts/2026/10/abc-brand-bold.woff2?sig=x',
      key: 'fonts/2026/10/abc-brand-bold.woff2',
    })
    expect(state.signed).toEqual([['fonts/2026/10/abc-brand-bold.woff2', 'font/woff2']])
    expect(state.permissions).toEqual(['settings.branding'])
  })

  it('refuses other files, large files, no storage and a plan without custom CSS', async () => {
    expect(await ask('Brand-Bold.otf')).toMatchObject({ ok: false, code: 'NOT_WOFF2' })
    expect(await ask('Brand-Bold.woff2', 400 * 1024 + 1)).toMatchObject({
      ok: false,
      code: 'TOO_LARGE',
    })
    state.storage = false
    expect(await ask('Brand-Bold.woff2')).toMatchObject({
      ok: false,
      code: 'STORAGE_UNAVAILABLE',
    })
    state.storage = true
    state.plan = false
    expect(await ask('Brand-Bold.woff2')).toEqual({
      ok: false,
      code: 'TIER_LIMIT_EXCEEDED',
      message: 'Uploading fonts is not available on your plan. Upgrade to enable it.',
    })
    expect(state.signed).toEqual([])
  })
})
