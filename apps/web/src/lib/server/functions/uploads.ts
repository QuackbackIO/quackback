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
  opts: { label: string; prefix: string }
) {
  log.debug(
    { content_type: data.contentType, file_size: data.fileSize },
    `${opts.label} upload url requested`
  )

  if (!isS3Usable()) {
    throw new Error('File storage is not configured. Contact your administrator.')
  }

  if (!isAllowedImageType(data.contentType)) {
    throw new Error(`Invalid image type: ${data.contentType}. Allowed types: JPEG, PNG, GIF, WebP.`)
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
 * Get a presigned URL for uploading the portal social share (OG) image.
 */
export const getPortalOgImageUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(imageUploadSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    return presignedImageUpload(data, { label: 'portal og image', prefix: 'portal-og' })
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
 * assistant.manage; the returned publicUrl is stored in identity.avatarUrl.
 */
export const getAssistantAvatarUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(imageUploadSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    return presignedImageUpload(data, { label: 'assistant avatar', prefix: 'assistant-avatars' })
  })
