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
 *
 * Type safety: TypeScript with moduleResolution "bundler" cannot fully resolve
 * the AWS SDK v3 barrel exports (deep re-export chains through commands/ and
 * @smithy/smithy-client are only partially resolved). We define structural
 * interfaces for the exact SDK surface we use, with `as unknown as S3Module`
 * applied at the two dynamic import boundaries. All downstream code is fully
 * typed with no `any`.
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
// Dynamic Module Loading (Lazy Singletons)
// ============================================================================

/*
 * Structural types for the AWS SDK surface we use.
 *
 * TypeScript's bundler module resolution cannot resolve all re-exports from
 * the AWS SDK v3 barrel (commands/ and @smithy/smithy-client base class are
 * only partially resolved). These interfaces define the exact shape we need.
 */

/** Common S3 command input shape (Bucket + Key). */
interface BucketKeyInput {
  Bucket: string
  Key: string
  ContentType?: string
  Body?: Buffer | Uint8Array
}

/** Command instance produced by S3 command constructors. */
interface S3Command {
  readonly input: BucketKeyInput
}

/** S3 client instance with the `send` method we use. */
interface S3ClientInstance {
  send(command: S3Command): Promise<unknown>
  destroy(): void
}

/** Typed subset of @aws-sdk/client-s3 exports used by this module. */
interface S3Module {
  S3Client: new (config: {
    region: string
    endpoint?: string
    forcePathStyle: boolean
    credentials: { accessKeyId: string; secretAccessKey: string }
  }) => S3ClientInstance
  PutObjectCommand: new (input: BucketKeyInput) => S3Command
  GetObjectCommand: new (input: BucketKeyInput) => S3Command
  DeleteObjectCommand: new (input: BucketKeyInput) => S3Command
}

/** Typed subset of @aws-sdk/s3-request-presigner exports used by this module. */
interface PresignerModule {
  getSignedUrl: (
    client: S3ClientInstance,
    command: S3Command,
    options?: { expiresIn?: number }
  ) => Promise<string>
}

let _s3Module: S3Module | null = null
let _presignerModule: PresignerModule | null = null
let _s3Client: S3ClientInstance | null = null

/**
 * Get the AWS S3 module singleton.
 * Dynamically imports to avoid build issues when the package isn't installed.
 */
async function getS3Module(): Promise<S3Module> {
  if (_s3Module) return _s3Module
  // Cast required: TS bundler resolution only partially resolves the AWS SDK barrel
  _s3Module = (await import('@aws-sdk/client-s3')) as unknown as S3Module
  return _s3Module
}

/**
 * Get the S3 request presigner module singleton.
 */
async function getPresignerModule(): Promise<PresignerModule> {
  if (_presignerModule) return _presignerModule
  _presignerModule = (await import('@aws-sdk/s3-request-presigner')) as unknown as PresignerModule
  return _presignerModule
}

/**
 * Get the S3 client singleton.
 * Creates a new client on first call, reuses on subsequent calls.
 */
async function getS3Client(): Promise<S3ClientInstance> {
  if (_s3Client) return _s3Client

  const s3Config = getS3Config()
  const { S3Client } = await getS3Module()

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
// Internal Helpers
// ============================================================================

/**
 * Build a public URL for a storage key based on the S3 configuration.
 *
 * Priority:
 * 1. S3_PUBLIC_URL — explicit CDN, custom domain, or proxy URL
 * 2. BASE_URL/api/storage — presigned URL redirect (works with any bucket)
 *
 * The /api/storage route generates presigned GET URLs and returns a 302 redirect,
 * so it works with both public and private buckets (e.g., Railway Buckets).
 * Users who want direct endpoint URLs can set S3_PUBLIC_URL to their endpoint.
 */
function buildPublicUrl(s3Config: S3Config, key: string): string {
  if (s3Config.publicUrl) {
    return `${s3Config.publicUrl.replace(/\/$/, '')}/${key}`
  }

  // Default to the presigned URL redirect route — works with any bucket
  return `${config.baseUrl.replace(/\/$/, '')}/api/storage/${key}`
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
  const { PutObjectCommand } = await getS3Module()
  const { getSignedUrl } = await getPresignerModule()

  const command = new PutObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
    ContentType: contentType,
  })

  const uploadUrl = await getSignedUrl(client, command, { expiresIn })
  const publicUrl = buildPublicUrl(s3Config, key)

  return { uploadUrl, publicUrl, key }
}

/**
 * Upload a file directly to S3 from the server.
 * Use this when the browser cannot reach S3 directly (e.g., ngrok, private networks).
 *
 * @param key - Storage key (path within bucket)
 * @param body - File bytes
 * @param contentType - MIME type of the file
 */
export async function uploadObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<string> {
  const s3Config = getS3Config()
  const client = await getS3Client()
  const { PutObjectCommand } = await getS3Module()

  const command = new PutObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
    ContentType: contentType,
    Body: body,
  })

  await client.send(command)

  return buildPublicUrl(s3Config, key)
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

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
])

/**
 * Validate that a file is an allowed image type.
 */
export function isAllowedImageType(contentType: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(contentType)
}

/**
 * Maximum allowed file size in bytes (5MB).
 */
export const MAX_FILE_SIZE = 5 * 1024 * 1024

/**
 * Validate and upload an image from a parsed multipart FormData body.
 * Called by upload route handlers after they have verified auth and S3 config.
 *
 * @param formData - Already-parsed request FormData (must contain a `file` field)
 * @param storagePrefix - Bucket prefix, e.g. "portal-images"
 */
export async function uploadImageFromFormData(
  formData: FormData,
  storagePrefix: string
): Promise<Response> {
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'No file provided' }, { status: 400 })
  }
  if (!isAllowedImageType(file.type)) {
    return Response.json({ error: 'Invalid file type' }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` },
      { status: 400 }
    )
  }
  try {
    const ext = file.type.split('/')[1] || 'png'
    const filename = file.name || `paste-${Date.now()}.${ext}`
    const key = generateStorageKey(storagePrefix, filename)
    const body = Buffer.from(await file.arrayBuffer())
    const publicUrl = await uploadObject(key, body, file.type)
    return Response.json({ publicUrl })
  } catch {
    return Response.json({ error: 'Upload failed' }, { status: 500 })
  }
}

/**
 * Upload pre-read image bytes to storage.
 *
 * Used by the content rehoster when it has already fetched and validated
 * the bytes (see `lib/server/content/rehost-images.ts`). This is the
 * buffer-level twin of `uploadImageFromFormData`.
 *
 * @param buffer - Image bytes
 * @param mimeType - Must be one of the allowed image types (see isAllowedImageType)
 * @param storagePrefix - Bucket prefix, e.g. "post-images" | "changelog-images" | "help-center"
 * @returns Public URL to the uploaded object
 * @throws Error if the mime type is not allowed, the buffer is empty, or the upload fails
 */
export async function uploadImageBuffer(
  buffer: Buffer,
  mimeType: string,
  storagePrefix: string
): Promise<{ url: string }> {
  if (!isAllowedImageType(mimeType)) {
    throw new Error(`Invalid mime type for rehost: ${mimeType}`)
  }
  if (buffer.length === 0) {
    throw new Error('Cannot upload empty buffer')
  }
  const ext = mimeType.split('/')[1] ?? 'bin'
  const filename = `rehost-${Date.now()}.${ext}`
  const key = generateStorageKey(storagePrefix, filename)
  const url = await uploadObject(key, buffer, mimeType)
  return { url }
}

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

  return buildPublicUrl(getS3Config(), key)
}

/**
 * Get an email-safe URL for a storage key.
 * Email clients often don't follow redirects, so when there's no S3_PUBLIC_URL
 * this returns a proxy URL (?email=1) that streams bytes directly.
 * Returns null if the key is null/undefined or S3 is not configured.
 */
export function getEmailSafeUrl(key: string | null | undefined): string | null {
  if (!key) return null
  if (!isS3Configured()) return null

  const s3Config = getS3Config()
  if (s3Config.publicUrl) {
    return buildPublicUrl(s3Config, key)
  }

  // Force proxy mode so email clients get bytes directly (no 302 redirect)
  return `${config.baseUrl.replace(/\/$/, '')}/api/storage/${key}?email=1`
}

/**
 * Get the public URL for a storage key.
 * Throws if the key is null/undefined or S3 is not configured.
 */
export function getPublicUrl(key: string): string {
  const url = getPublicUrlOrNull(key)
  if (!url) {
    throw new Error(
      'Failed to generate public URL. Ensure S3 is configured and S3_PUBLIC_URL or S3_ENDPOINT is set.'
    )
  }
  return url
}

// ============================================================================
// Presigned GET URLs (for private buckets like Railway)
// ============================================================================

/**
 * Generate a presigned URL for reading a file from S3.
 * Use this when the bucket is not publicly accessible (e.g., Railway Buckets).
 *
 * @param key - Storage key (path within bucket)
 * @param expiresIn - URL expiration time in seconds (default: 172800 = 48 hours)
 */
export async function generatePresignedGetUrl(
  key: string,
  expiresIn: number = 172800
): Promise<string> {
  const s3Config = getS3Config()
  const client = await getS3Client()
  const { GetObjectCommand } = await getS3Module()
  const { getSignedUrl } = await getPresignerModule()

  const command = new GetObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
  })

  return getSignedUrl(client, command, { expiresIn })
}

// ============================================================================
// Object Retrieval (for proxy mode)
// ============================================================================

/** Result of fetching an S3 object. */
export interface S3ObjectResult {
  body: ReadableStream<Uint8Array>
  contentType: string
}

/**
 * Fetch an object from S3 and return its body stream and content type.
 * Used when S3_PROXY is enabled to stream file bytes through the server.
 */
export async function getS3Object(key: string): Promise<S3ObjectResult> {
  const s3Config = getS3Config()
  const client = await getS3Client()
  const { GetObjectCommand } = await getS3Module()

  const command = new GetObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
  })

  const response = (await client.send(command)) as {
    Body?: { transformToWebStream(): ReadableStream<Uint8Array> }
    ContentType?: string
  }

  if (!response.Body) {
    throw new Error(`S3 object not found: ${key}`)
  }

  return {
    body: response.Body.transformToWebStream(),
    contentType: response.ContentType || 'application/octet-stream',
  }
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
  const { DeleteObjectCommand } = await getS3Module()

  const command = new DeleteObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
  })

  await client.send(command)
}
