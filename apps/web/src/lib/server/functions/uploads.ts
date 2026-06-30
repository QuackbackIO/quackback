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
  isS3Configured,
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

// ============================================================================
// Server Functions
// ============================================================================

/**
 * Check if S3 storage is configured.
 * Use this to conditionally show/hide upload features in the UI.
 */
export const checkS3ConfiguredFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('s3 configured check')
  return { configured: isS3Configured() }
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
    try {
      // Require admin or member authentication
      await requireAuth({ permission: PERMISSIONS.POST_CREATE })

      // Check S3 is configured
      if (!isS3Configured()) {
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
    } catch (error) {
      log.error({ err: error }, 'presigned upload url failed')
      throw error
    }
  })

/**
 * Get a presigned URL specifically for changelog images.
 * Validates that the file is an allowed image type.
 */
export const getChangelogImageUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      filename: z.string().min(1).max(255),
      contentType: z.string().min(1).max(100),
      fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
    })
  )
  .handler(async ({ data }) => {
    log.debug(
      { content_type: data.contentType, file_size: data.fileSize },
      'changelog image upload url requested'
    )
    try {
      // Require admin authentication for changelog images
      await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })

      // Check S3 is configured
      if (!isS3Configured()) {
        throw new Error('File storage is not configured. Contact your administrator.')
      }

      // Validate image type
      if (!isAllowedImageType(data.contentType)) {
        throw new Error(
          `Invalid image type: ${data.contentType}. Allowed types: JPEG, PNG, GIF, WebP.`
        )
      }

      // Generate storage key with changelog prefix
      const key = generateStorageKey('changelog-images', data.filename)

      // Generate presigned URL
      const result = await generatePresignedUploadUrl(key, data.contentType)

      return result
    } catch (error) {
      log.error({ err: error }, 'changelog image upload url failed')
      throw error
    }
  })

/**
 * Get a presigned URL specifically for admin feedback post images.
 * Validates that the file is an allowed image type.
 */
export const getPostImageUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      filename: z.string().min(1).max(255),
      contentType: z.string().min(1).max(100),
      fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
    })
  )
  .handler(async ({ data }) => {
    log.debug(
      { content_type: data.contentType, file_size: data.fileSize },
      'post image upload url requested'
    )
    try {
      await requireAuth({ permission: PERMISSIONS.POST_CREATE })

      if (!isS3Configured()) {
        throw new Error('File storage is not configured. Contact your administrator.')
      }

      if (!isAllowedImageType(data.contentType)) {
        throw new Error(
          `Invalid image type: ${data.contentType}. Allowed types: JPEG, PNG, GIF, WebP.`
        )
      }

      const key = generateStorageKey('post-images', data.filename)
      return await generatePresignedUploadUrl(key, data.contentType)
    } catch (error) {
      log.error({ err: error }, 'post image upload url failed')
      throw error
    }
  })

/**
 * Get a presigned URL for widget feedback submission images.
 * Requires an active widget Bearer token session — anonymous users are blocked server-side.
 */
export const getWidgetImageUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      filename: z.string().min(1).max(255),
      contentType: z.string().min(1).max(100),
      fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
    })
  )
  .handler(async ({ data }) => {
    log.debug(
      { content_type: data.contentType, file_size: data.fileSize },
      'widget image upload url requested'
    )
    try {
      const session = await getWidgetSession()
      if (!session) {
        throw new Error('Authentication required to upload images.')
      }
      if (session.principal.type === 'anonymous') {
        throw new Error('Authentication required to upload images.')
      }

      if (!isS3Configured()) {
        throw new Error('File storage is not configured. Contact your administrator.')
      }

      if (!isAllowedImageType(data.contentType)) {
        throw new Error(
          `Invalid image type: ${data.contentType}. Allowed types: JPEG, PNG, GIF, WebP.`
        )
      }

      const key = generateStorageKey('widget-images', data.filename)
      return await generatePresignedUploadUrl(key, data.contentType)
    } catch (error) {
      log.error({ err: error }, 'widget image upload url failed')
      throw error
    }
  })

// ============================================================================
// Branding Image Upload Functions
// ============================================================================

const brandingImageSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
})

/**
 * Get a presigned URL for uploading the workspace logo.
 */
export const getLogoUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(brandingImageSchema)
  .handler(async ({ data }) => {
    log.debug(
      { content_type: data.contentType, file_size: data.fileSize },
      'logo upload url requested'
    )
    try {
      await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })

      if (!isS3Configured()) {
        throw new Error('File storage is not configured. Contact your administrator.')
      }

      if (!isAllowedImageType(data.contentType)) {
        throw new Error(
          `Invalid image type: ${data.contentType}. Allowed types: JPEG, PNG, GIF, WebP.`
        )
      }

      const key = generateStorageKey('logos', data.filename)
      return await generatePresignedUploadUrl(key, data.contentType)
    } catch (error) {
      log.error({ err: error }, 'logo upload url failed')
      throw error
    }
  })

/**
 * Get a presigned URL for uploading the workspace favicon.
 */
export const getFaviconUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(brandingImageSchema)
  .handler(async ({ data }) => {
    log.debug(
      { content_type: data.contentType, file_size: data.fileSize },
      'favicon upload url requested'
    )
    try {
      await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })

      if (!isS3Configured()) {
        throw new Error('File storage is not configured. Contact your administrator.')
      }

      if (!isAllowedImageType(data.contentType)) {
        throw new Error(
          `Invalid image type: ${data.contentType}. Allowed types: JPEG, PNG, GIF, WebP.`
        )
      }

      const key = generateStorageKey('favicons', data.filename)
      return await generatePresignedUploadUrl(key, data.contentType)
    } catch (error) {
      log.error({ err: error }, 'favicon upload url failed')
      throw error
    }
  })

/**
 * Get a presigned URL for uploading the workspace header logo.
 */
export const getHeaderLogoUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(brandingImageSchema)
  .handler(async ({ data }) => {
    log.debug(
      { content_type: data.contentType, file_size: data.fileSize },
      'header logo upload url requested'
    )
    try {
      await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })

      if (!isS3Configured()) {
        throw new Error('File storage is not configured. Contact your administrator.')
      }

      if (!isAllowedImageType(data.contentType)) {
        throw new Error(
          `Invalid image type: ${data.contentType}. Allowed types: JPEG, PNG, GIF, WebP.`
        )
      }

      const key = generateStorageKey('header-logos', data.filename)
      return await generatePresignedUploadUrl(key, data.contentType)
    } catch (error) {
      log.error({ err: error }, 'header logo upload url failed')
      throw error
    }
  })

/**
 * Get a presigned URL for uploading user avatars.
 */
export const getAvatarUploadUrlFn = createServerFn({ method: 'POST' })
  .validator(brandingImageSchema)
  .handler(async ({ data }) => {
    log.debug(
      { content_type: data.contentType, file_size: data.fileSize },
      'avatar upload url requested'
    )
    try {
      // Any authenticated user can upload their own avatar
      await requireAuth()

      if (!isS3Configured()) {
        throw new Error('File storage is not configured. Contact your administrator.')
      }

      if (!isAllowedImageType(data.contentType)) {
        throw new Error(
          `Invalid image type: ${data.contentType}. Allowed types: JPEG, PNG, GIF, WebP.`
        )
      }

      const key = generateStorageKey('avatars', data.filename)
      return await generatePresignedUploadUrl(key, data.contentType)
    } catch (error) {
      log.error({ err: error }, 'avatar upload url failed')
      throw error
    }
  })
