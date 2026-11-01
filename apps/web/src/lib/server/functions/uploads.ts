/**
 * Upload Server Functions
 *
 * Server functions for file upload operations (presigned URLs, etc.).
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { getWidgetSession } from './widget-auth'
import {
  isS3Usable,
  generatePresignedUploadUrl,
  generateStorageKey,
  isAllowedImageType,
  MAX_FILE_SIZE,
} from '../storage/s3'
import { logger } from '@/lib/server/logger'
import { PERMISSIONS } from '@/lib/shared/permissions'

const log = logger.child({ component: 'uploads' })

// ============================================================================
// Schemas
// ============================================================================

const getPresignedUploadUrlSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
  prefix: z.string().default('uploads'),
})

/** Shared shape for every fixed-prefix image upload. */
const imageUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
})

/**
 * The post-authorization body every fixed-prefix image upload shares: confirm
 * storage is configured, reject non-images, and hand back a presigned PUT for a
 * prefix-scoped key. Only the key prefix and the log label differ.
 *
 * Authorization deliberately stays at each endpoint rather than moving in here.
 * The authz-matrix scanner (lib/server/policy/authz-matrix) parses every
 * `requireAuth` gate statically to build MATRIX.md, and a gate behind a
 * parameter reads as an unparseable site — the permission for those endpoints
 * would silently drop out of the audit surface.
 *
 * A factory returning a whole server fn is not possible either: the Start
 * compiler requires every `createServerFn` to be assigned to its own top-level
 * variable, deriving the function id from that variable's name.
 */
async function presignedImageUpload(
  data: z.infer<typeof imageUploadSchema>,
  opts: {
    label: string
    prefix: string
    /**
     * Also SVG, for a wordmark. Storage serves SVG as a sandboxed download,
     * which an <img> still shows, so it never runs as a page.
     */
    svg?: boolean
  }
) {
  log.debug(
    { content_type: data.contentType, file_size: data.fileSize },
    `${opts.label} upload url requested`
  )

  if (!isS3Usable()) {
    throw new Error('File storage is not configured. Contact your administrator.')
  }

  const svg = opts.svg === true && data.contentType === 'image/svg+xml'
  if (!svg && !isAllowedImageType(data.contentType)) {
    throw new Error(
      `Invalid image type: ${data.contentType}. Allowed types: JPEG, PNG, GIF, WebP${opts.svg ? ', SVG' : ''}.`
    )
  }

  const key = generateStorageKey(opts.prefix, data.filename)
  return await generatePresignedUploadUrl(key, data.contentType)
}

// ============================================================================
// Server Functions
// ============================================================================

/**
 * Check if S3 storage is configured.
 * Use this to conditionally show/hide upload features in the UI.
 */
export const checkS3ConfiguredFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('s3 configured check')
  return { configured: isS3Usable() }
})

/**
 * Get a presigned URL for uploading a file to S3-compatible storage.
 *
 * Returns:
 * - uploadUrl: PUT this URL with the file data
 * - publicUrl: The URL to access the file after upload
 * - key: The storage key for reference
 *
 * Requires authentication (admin or member role).
 */
export const getPresignedUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(getPresignedUploadUrlSchema)
  .handler(async ({ data }) => {
    log.debug(
      { prefix: data.prefix, content_type: data.contentType, file_size: data.fileSize },
      'presigned upload url requested'
    )
    // Require admin or member authentication
    await requireAuth({ permission: PERMISSIONS.POST_CREATE })

    // Check S3 is configured
    if (!isS3Usable()) {
      throw new Error('File storage is not configured. Contact your administrator.')
    }

    // Validate content type for images
    if (data.prefix.includes('image') && !isAllowedImageType(data.contentType)) {
      throw new Error(
        `Invalid file type: ${data.contentType}. Allowed types: JPEG, PNG, GIF, WebP.`
      )
    }

    // Generate storage key
    const key = generateStorageKey(data.prefix, data.filename)

    // Generate presigned URL
    const result = await generatePresignedUploadUrl(key, data.contentType)

    return result
  })

/**
 * Get a presigned URL specifically for changelog images.
 * Validates that the file is an allowed image type.
 */
export const getChangelogImageUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(imageUploadSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
    return presignedImageUpload(data, { label: 'changelog image', prefix: 'changelog-images' })
  })

/**
 * Get a presigned URL specifically for admin feedback post images.
 * Validates that the file is an allowed image type.
 */
export const getPostImageUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(imageUploadSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.POST_CREATE })
    return presignedImageUpload(data, { label: 'post image', prefix: 'post-images' })
  })

/**
 * Get a presigned URL for widget feedback submission images.
 * Requires an active widget Bearer token session — anonymous users are blocked server-side.
 */
export const getWidgetImageUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(imageUploadSchema)
  .handler(async ({ data }) => {
    log.debug(
      { content_type: data.contentType, file_size: data.fileSize },
      'widget image upload url requested'
    )
    const session = await getWidgetSession()
    if (!session) {
      throw new Error('Authentication required to upload images.')
    }
    if (session.principal.type === 'anonymous') {
      throw new Error('Authentication required to upload images.')
    }

    if (!isS3Usable()) {
      throw new Error('File storage is not configured. Contact your administrator.')
    }

    if (!isAllowedImageType(data.contentType)) {
      throw new Error(
        `Invalid image type: ${data.contentType}. Allowed types: JPEG, PNG, GIF, WebP.`
      )
    }

    const key = generateStorageKey('widget-images', data.filename)
    return await generatePresignedUploadUrl(key, data.contentType)
  })

// ============================================================================
// Branding Image Upload Functions
// ============================================================================

/**
 * Get a presigned URL for uploading the workspace logo.
 */
export const getLogoUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(imageUploadSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    return presignedImageUpload(data, { label: 'logo', prefix: 'logos' })
  })

/**
 * Get a presigned URL for uploading the workspace favicon.
 */
export const getFaviconUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(imageUploadSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    return presignedImageUpload(data, { label: 'favicon', prefix: 'favicons' })
  })

/**
 * Get a presigned URL for uploading the workspace header logo.
 */
export const getHeaderLogoUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(imageUploadSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    return presignedImageUpload(data, { label: 'header logo', prefix: 'header-logos' })
  })

/**
 * Get a presigned URL for uploading a portal design's wordmark, light or dark.
 * Unlike the workspace logo, which emails carry, it may be an SVG.
 */
export const getWordmarkUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(imageUploadSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    return presignedImageUpload(data, { label: 'wordmark', prefix: 'header-logos', svg: true })
  })

/**
 * Get a presigned URL for uploading the image a portal design shows in its band.
 */
export const getBandImageUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(imageUploadSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    return presignedImageUpload(data, { label: 'band image', prefix: 'portal-images' })
  })

/**
 * Get a presigned URL for uploading a custom OIDC identity provider's logo.
 */
export const getIdentityProviderLogoUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(imageUploadSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.AUTH_MANAGE })
    return presignedImageUpload(data, { label: 'idp logo', prefix: 'idp-logos' })
  })

/**
 * Get a presigned URL for uploading the widget Home hero image.
 */
export const getWidgetHeroUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(imageUploadSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    return presignedImageUpload(data, { label: 'widget hero', prefix: 'widget-hero' })
  })

/**
 * Get a presigned URL for uploading user avatars.
 */
export const getAvatarUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(imageUploadSchema)
  .handler(async ({ data }) => {
    await requireAuth()
    return presignedImageUpload(data, { label: 'avatar', prefix: 'avatars' })
  })

/**
 * Get a presigned URL for uploading the AI agent's avatar. Gated on
 * ai.customer.manage; the returned publicUrl is stored in identity.avatarUrl.
 */
export const getAssistantAvatarUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(imageUploadSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.AI_CUSTOMER_MANAGE })
    return presignedImageUpload(data, { label: 'assistant avatar', prefix: 'assistant-avatars' })
  })

const fontUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  fileSize: z.number().int().positive(),
})

export type FontUploadResult =
  | { ok: true; uploadUrl: string; key: string }
  | {
      ok: false
      code: 'STORAGE_UNAVAILABLE' | 'NOT_WOFF2' | 'TOO_LARGE' | 'TIER_LIMIT_EXCEEDED'
      message: string
    }

/**
 * Get a presigned URL for uploading one file of a portal font. Only woff2 of
 * up to 400 KB; the upload itself checks the file's signature. Uploading
 * fonts is part of custom CSS on the workspace's plan.
 */
export const getFontUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(fontUploadSchema)
  .handler(async ({ data }): Promise<FontUploadResult> => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const { FONT_UPLOADS } = await import('@/lib/shared/design/fonts')
    if (!isS3Usable()) {
      return {
        ok: false,
        code: 'STORAGE_UNAVAILABLE',
        message: 'Uploading fonts needs file storage.',
      }
    }
    if (!/\.woff2$/i.test(data.filename)) {
      return { ok: false, code: 'NOT_WOFF2', message: `${data.filename} is not a woff2 file.` }
    }
    if (data.fileSize > FONT_UPLOADS.maxBytes) {
      return { ok: false, code: 'TOO_LARGE', message: `${data.filename} is over 400 KB.` }
    }
    const [{ assertTierFeature }, { TierLimitError }] = await Promise.all([
      import('@/lib/server/domains/settings/tier-enforce'),
      import('@/lib/server/errors/tier-limit-error'),
    ])
    try {
      await assertTierFeature('customCss', 'Uploading fonts')
    } catch (error) {
      if (error instanceof TierLimitError) {
        return { ok: false, code: 'TIER_LIMIT_EXCEEDED', message: error.message }
      }
      throw error
    }
    const key = generateStorageKey(FONT_UPLOADS.prefix, data.filename)
    const { uploadUrl } = await generatePresignedUploadUrl(key, FONT_UPLOADS.type)
    log.info({ key }, 'font upload url issued')
    return { ok: true, uploadUrl, key }
  })
