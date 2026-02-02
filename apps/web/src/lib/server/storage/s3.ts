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

import { config } from '@/lib/server/config'

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
  return !!(config.s3Bucket && config.s3Region && config.s3AccessKeyId && config.s3SecretAccessKey)
}

/**
 * Get S3 configuration from environment variables.
 * Throws if required variables are missing.
 */
export function getS3Config(): S3Config {
  if (!config.s3Bucket || !config.s3Region || !config.s3AccessKeyId || !config.s3SecretAccessKey) {
    throw new Error(
      'S3 storage is not configured. Set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.'
    )
  }

  return {
    endpoint: config.s3Endpoint || undefined,
    bucket: config.s3Bucket,
    region: config.s3Region,
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
    forcePathStyle: config.s3ForcePathStyle ?? true,
    publicUrl: config.s3PublicUrl || undefined,
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

  const s3Config = getS3Config()

  // Dynamic import to avoid build issues when packages aren't properly linked
  const { S3Client } = await import('@aws-sdk/client-s3')

  _s3Client = new S3Client({
    region: s3Config.region,
    endpoint: s3Config.endpoint,
    forcePathStyle: s3Config.forcePathStyle,
    credentials: {
      accessKeyId: s3Config.accessKeyId,
      secretAccessKey: s3Config.secretAccessKey,
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
  const s3Config = getS3Config()
  const client = await getS3Client()

  // Dynamic imports
  const { PutObjectCommand } = await import('@aws-sdk/client-s3')
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')

  const command = new PutObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
    ContentType: contentType,
  })

  const uploadUrl = await getSignedUrl(client, command, { expiresIn })

  // Determine public URL
  let publicUrl: string
  if (s3Config.publicUrl) {
    // Custom public URL (e.g., CDN)
    publicUrl = `${s3Config.publicUrl.replace(/\/$/, '')}/${key}`
  } else if (s3Config.endpoint) {
    // S3-compatible endpoint (MinIO, R2, B2)
    if (s3Config.forcePathStyle) {
      publicUrl = `${s3Config.endpoint}/${s3Config.bucket}/${key}`
    } else {
      // Virtual-hosted style (bucket in subdomain)
      const url = new URL(s3Config.endpoint)
      url.hostname = `${s3Config.bucket}.${url.hostname}`
      url.pathname = `/${key}`
      publicUrl = url.toString()
    }
  } else {
    // AWS S3 default
    publicUrl = `https://${s3Config.bucket}.s3.${s3Config.region}.amazonaws.com/${key}`
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

// ============================================================================
// Public URL Helpers
// ============================================================================

/**
 * Get the public URL for a storage key.
 * Returns null if the key is null/undefined or S3 is not configured.
 */
export function getPublicUrlOrNull(key: string | null | undefined): string | null {
  if (!key) return null
  if (!isS3Configured()) return null

  const s3Config = getS3Config()

  if (s3Config.publicUrl) {
    return `${s3Config.publicUrl.replace(/\/$/, '')}/${key}`
  } else if (s3Config.endpoint) {
    if (s3Config.forcePathStyle) {
      return `${s3Config.endpoint}/${s3Config.bucket}/${key}`
    } else {
      const url = new URL(s3Config.endpoint)
      url.hostname = `${s3Config.bucket}.${url.hostname}`
      url.pathname = `/${key}`
      return url.toString()
    }
  } else {
    return `https://${s3Config.bucket}.s3.${s3Config.region}.amazonaws.com/${key}`
  }
}

/**
 * Get the public URL for a storage key.
 * Throws if the key is null/undefined or S3 is not configured.
 */
export function getPublicUrl(key: string): string {
  const url = getPublicUrlOrNull(key)
  if (!url) {
    throw new Error('Failed to generate public URL: S3 not configured or invalid key')
  }
  return url
}

// ============================================================================
// Delete Operations
// ============================================================================

/**
 * Delete an object from S3.
 *
 * @param key - Storage key (path within bucket) to delete
 */
export async function deleteObject(key: string): Promise<void> {
  const s3Config = getS3Config()
  const client = await getS3Client()

  // Dynamic import for delete command
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s3Module = (await import('@aws-sdk/client-s3')) as any
  const command = new s3Module.DeleteObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
  })

  await client.send(command)
}
