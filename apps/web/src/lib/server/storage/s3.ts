/**
 * S3-Compatible Storage Client
 *
 * Provides a unified interface for uploading files to S3-compatible storage services:
 * - AWS S3
 * - Cloudflare R2
 * - Backblaze B2
 * - MinIO (for local development)
 *
 * Note: AWS SDK imports are dynamic to avoid build issues when packages aren't installed.
 */

import { getConfig } from '../config'

// ============================================================================
// Configuration
// ============================================================================

export interface S3Config {
  endpoint?: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
  publicUrl?: string
}

/**
 * Check if S3 storage is configured.
 * Returns true if all required environment variables are set.
 */
export function isS3Configured(): boolean {
  const config = getConfig()
  return !!(
    config.S3_BUCKET &&
    config.S3_REGION &&
    config.S3_ACCESS_KEY_ID &&
    config.S3_SECRET_ACCESS_KEY
  )
}

/**
 * Get S3 configuration from environment variables.
 * Throws if required variables are missing.
 */
export function getS3Config(): S3Config {
  const config = getConfig()

  if (
    !config.S3_BUCKET ||
    !config.S3_REGION ||
    !config.S3_ACCESS_KEY_ID ||
    !config.S3_SECRET_ACCESS_KEY
  ) {
    throw new Error(
      'S3 storage is not configured. Set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.'
    )
  }

  return {
    endpoint: config.S3_ENDPOINT || undefined,
    bucket: config.S3_BUCKET,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE ?? true,
    publicUrl: config.S3_PUBLIC_URL || undefined,
  }
}

// ============================================================================
// S3 Client (Lazy Loading)
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _s3Client: any = null

/**
 * Get the S3 client singleton.
 * Creates a new client on first call, reuses on subsequent calls.
 * Dynamically imports AWS SDK to avoid build issues.
 */
async function getS3Client() {
  if (_s3Client) return _s3Client

  const config = getS3Config()

  // Dynamic import to avoid build issues when packages aren't properly linked
  const { S3Client } = await import('@aws-sdk/client-s3')

  _s3Client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })

  return _s3Client
}

// ============================================================================
// Presigned URLs
// ============================================================================

export interface PresignedUploadUrl {
  /** URL to PUT the file to (presigned, expires in 15 minutes) */
  uploadUrl: string
  /** Public URL to access the file after upload */
  publicUrl: string
  /** Storage key (path within bucket) */
  key: string
}

/**
 * Generate a presigned URL for uploading a file.
 *
 * @param key - Storage key (path within bucket), e.g., "changelog-images/abc123/image.jpg"
 * @param contentType - MIME type of the file, e.g., "image/jpeg"
 * @param expiresIn - URL expiration time in seconds (default: 900 = 15 minutes)
 */
export async function generatePresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 900
): Promise<PresignedUploadUrl> {
  const config = getS3Config()
  const client = await getS3Client()

  // Dynamic imports
  const { PutObjectCommand } = await import('@aws-sdk/client-s3')
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: contentType,
  })

  const uploadUrl = await getSignedUrl(client, command, { expiresIn })

  // Determine public URL
  let publicUrl: string
  if (config.publicUrl) {
    // Custom public URL (e.g., CDN)
    publicUrl = `${config.publicUrl.replace(/\/$/, '')}/${key}`
  } else if (config.endpoint) {
    // S3-compatible endpoint (MinIO, R2, B2)
    if (config.forcePathStyle) {
      publicUrl = `${config.endpoint}/${config.bucket}/${key}`
    } else {
      // Virtual-hosted style (bucket in subdomain)
      const url = new URL(config.endpoint)
      url.hostname = `${config.bucket}.${url.hostname}`
      url.pathname = `/${key}`
      publicUrl = url.toString()
    }
  } else {
    // AWS S3 default
    publicUrl = `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`
  }

  return {
    uploadUrl,
    publicUrl,
    key,
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate a unique storage key for a file.
 *
 * @param prefix - Path prefix, e.g., "changelog-images"
 * @param filename - Original filename
 * @returns Storage key like "changelog-images/2024/01/abc123-filename.jpg"
 */
export function generateStorageKey(prefix: string, filename: string): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const randomId = crypto.randomUUID().slice(0, 8)
  const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_').toLowerCase()

  return `${prefix}/${year}/${month}/${randomId}-${safeFilename}`
}

/**
 * Validate that a file is an allowed image type.
 */
export function isAllowedImageType(contentType: string): boolean {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  return allowedTypes.includes(contentType)
}

/**
 * Maximum allowed file size in bytes (5MB).
 */
export const MAX_FILE_SIZE = 5 * 1024 * 1024
