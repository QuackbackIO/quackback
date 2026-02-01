/**
 * Upload Server Functions
 *
 * Server functions for file upload operations (presigned URLs, etc.).
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import {
  isS3Configured,
  generatePresignedUploadUrl,
  generateStorageKey,
  isAllowedImageType,
  MAX_FILE_SIZE,
} from '../storage/s3'

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
  .inputValidator(getPresignedUploadUrlSchema)
  .handler(async ({ data }) => {
    // Require admin or member authentication
    await requireAuth({ roles: ['admin', 'member'] })

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
  })

/**
 * Get a presigned URL specifically for changelog images.
 * Validates that the file is an allowed image type.
 */
export const getChangelogImageUploadUrlFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      filename: z.string().min(1).max(255),
      contentType: z.string().min(1).max(100),
      fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
    })
  )
  .handler(async ({ data }) => {
    // Require admin authentication for changelog images
    await requireAuth({ roles: ['admin'] })

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
  })
