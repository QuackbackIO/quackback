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

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '@/lib/server/config'
import { sniffImageMime } from '@/lib/server/content/magic-bytes'
import { getCurrentTenant, getTenantScope } from '@/lib/server/tenancy/tenant-context'
import {
  currentTenantNamespace,
  SINGLE_TENANT_NAMESPACE,
  TenantKeyedCache,
} from '@/lib/server/tenancy/tenant-keyed'

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
 * Where a tenant's objects live and how their URLs are formed. Deliberately
 * carries no credentials: rendering a public asset URL must not depend on
 * resolving a secret, so the two are split and only the paths that actually
 * talk to storage pay for credential resolution.
 */
export interface StoragePlacement {
  endpoint?: string
  bucket: string
  region: string
  forcePathStyle: boolean
  publicUrl?: string
  /**
   * Origin the `/api/storage` fallback URL is built from. Pinned to the
   * tenant's canonical base URL, never derived from the request: contentJson
   * stores ABSOLUTE image URLs, so an origin that followed whichever hostname
   * the visitor happened to use would bake that hostname into stored content.
   */
  originUrl: string
}

/**
 * The active tenant's placement, or the process-wide one when unscoped.
 * Returns null when storage is not configured at all.
 */
export function getStoragePlacementOrNull(): StoragePlacement | null {
  const tenant = getCurrentTenant()
  if (tenant) {
    const storage = tenant.storage
    return {
      endpoint: storage.endpoint || undefined,
      bucket: storage.bucket,
      region: storage.region,
      forcePathStyle: storage.forcePathStyle,
      publicUrl: storage.publicUrl || undefined,
      originUrl: tenant.routing.baseUrl,
    }
  }
  if (!config.s3Bucket || !config.s3Region) return null
  return {
    endpoint: config.s3Endpoint || undefined,
    bucket: config.s3Bucket,
    region: config.s3Region,
    forcePathStyle: config.s3ForcePathStyle ?? true,
    publicUrl: config.s3PublicUrl || undefined,
    originUrl: config.baseUrl,
  }
}

export function getStoragePlacement(): StoragePlacement {
  const placement = getStoragePlacementOrNull()
  if (!placement) {
    throw new Error(
      'S3 storage is not configured. Set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.'
    )
  }
  return placement
}

/** Credentials for one bucket. Never logged, never cached to disk. */
export interface StorageCredentials {
  accessKeyId: string
  secretAccessKey: string
}

/** Storage is addressable but its credentials could not be resolved. */
export class StorageUnavailableError extends Error {
  readonly tenantId: string
  constructor(tenantId: string, detail: string) {
    super(`Storage is not usable for tenant ${tenantId}: ${detail}`)
    this.name = 'StorageUnavailableError'
    this.tenantId = tenantId
  }
}

/**
 * The active tenant's storage keys, or the process-wide ones when unscoped.
 *
 * Under a tenant scope these were resolved on pool checkout from the record's
 * `storage.credentialRef` (`tenancy/tenant-secrets.ts`) and carried on the
 * scope, which is what lets this stay synchronous — `buildPublicUrl` and every
 * gate below are called from hundreds of places that cannot await.
 *
 * When a tenant's credentials did not resolve this throws
 * {@link StorageUnavailableError}, and it never falls back to the fleet-wide
 * environment keys. That fallback is the specific thing this must not do: it
 * would hand one tenant a client pointed at another tenant's bucket, holding
 * credentials that might well open it.
 */
function resolveStorageCredentials(): StorageCredentials {
  const scope = getTenantScope()
  if (!scope) {
    if (!config.s3AccessKeyId || !config.s3SecretAccessKey) {
      throw new Error(
        'S3 storage is not configured. Set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.'
      )
    }
    return { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey }
  }
  const resolved = scope.secrets.storage
  if (!resolved) {
    throw new StorageUnavailableError(
      scope.tenant.tenantId,
      scope.secrets.storageProblem ?? 'no credentials were resolved for this tenant'
    )
  }
  return resolved
}

/**
 * Whether a bucket can be *addressed*. Deliberately does NOT ask about
 * credentials: `buildPublicUrl` needs a placement and nothing else, and a
 * public asset URL must keep resolving for a tenant whose credentials this
 * process cannot dereference.
 */
export function isS3Configured(): boolean {
  if (getCurrentTenant()) return true
  return !!(config.s3Bucket && config.s3Region && config.s3AccessKeyId && config.s3SecretAccessKey)
}

/**
 * Whether an operation that actually touches the bucket can be attempted.
 *
 * Addressability and usability are different questions, and under pooled
 * tenancy they diverge: a tenant record always names a bucket, so
 * {@link isS3Configured} is true while every upload throws, because the
 * credential reference is an `openbao+kv://` ref no resolver has been
 * registered for.
 *
 * Callers that gate an upload want this one. Both of them already handle
 * "storage is off" by skipping, so asking the addressability question there
 * turned a clean skip into an exception.
 */
export function isS3Usable(): boolean {
  if (!isS3Configured()) return false
  const scope = getTenantScope()
  return scope ? scope.secrets.storage !== null : true
}

/**
 * Full storage configuration including credentials. Only for the paths that
 * actually sign or send a request; use {@link getStoragePlacement} for anything
 * that just needs to name a bucket or build a URL.
 */
export function getS3Config(): S3Config {
  const placement = getStoragePlacement()
  const credentials = resolveStorageCredentials()
  return {
    endpoint: placement.endpoint,
    bucket: placement.bucket,
    region: placement.region,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    forcePathStyle: placement.forcePathStyle,
    publicUrl: placement.publicUrl,
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

/*
 * These two hold the SDK's own module namespace objects, not configuration or
 * credentials — the same value the ESM loader hands every importer. They stay
 * process-wide because partitioning them by tenant would store N references to
 * one object and buy nothing.
 */
let _s3Module: S3Module | null = null
let _presignerModule: PresignerModule | null = null

/**
 * One client per tenant. The client is built FROM a bucket, an endpoint and a
 * credential pair, so a process-wide one is a handle on whichever tenant
 * happened to upload first — every later tenant's upload then lands in that
 * bucket, under a key that reads as valid from both sides.
 *
 * The bound is a client count, not a correctness limit: eviction only costs the
 * evicted tenant a rebuild on its next upload, so it is sized to sit above the
 * tenant count one pod realistically serves rather than to be exact.
 */
const s3Clients = new TenantKeyedCache<S3ClientInstance>(256)
const S3_CLIENT_KEY = 'client'

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

/** Get the S3 client for the active tenant, building it on first use. */
async function getS3Client(): Promise<S3ClientInstance> {
  const existing = s3Clients.get(S3_CLIENT_KEY)
  if (existing) return existing

  const s3Config = getS3Config()
  const { S3Client } = await getS3Module()

  const client = new S3Client({
    region: s3Config.region,
    endpoint: s3Config.endpoint,
    forcePathStyle: s3Config.forcePathStyle,
    credentials: {
      accessKeyId: s3Config.accessKeyId,
      secretAccessKey: s3Config.secretAccessKey,
    },
  })
  s3Clients.set(S3_CLIENT_KEY, client)

  return client
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Build a public URL for a storage key based on the resolved placement.
 *
 * Priority:
 * 1. the placement's public URL — explicit CDN, custom domain, or proxy URL
 * 2. <origin>/api/storage — presigned URL redirect (works with any bucket)
 *
 * The /api/storage route generates presigned GET URLs and returns a 302 redirect,
 * so it works with both public and private buckets. Deployments that want direct
 * endpoint URLs set S3_PUBLIC_URL to their endpoint.
 *
 * Which prefixes are public is fleet-wide policy, not tenant data: the set below
 * names the key spaces this application serves without a capability token, and
 * it means the same thing in every workspace.
 */
const PUBLIC_STORAGE_PREFIXES = new Set([
  'assistant-avatars',
  'avatars',
  'changelog-images',
  'favicons',
  'header-logos',
  'help-center',
  'link-previews',
  'logos',
  'post-images',
  'widget-hero',
])

/** Unknown prefixes are private by default. */
export function isPublicStorageKey(key: string): boolean {
  return PUBLIC_STORAGE_PREFIXES.has(key.split('/', 1)[0] ?? '')
}

/**
 * The signed message binds the tenant as well as the object key.
 *
 * Object keys are per-bucket, so `attachments/<uuid>` names a different object
 * in every tenant while reading identically here. If the signing secret is ever
 * shared across tenants — which it is whenever the fleet-wide environment keys
 * are in play — a read token minted for one tenant would verify against
 * another's object without the binding.
 *
 * The single-tenant namespace signs the historical message byte for byte:
 * these tokens are embedded in absolute URLs stored in contentJson, so a
 * changed message invalidates every private asset link already written.
 */
function tenantBind(message: string): string {
  const namespace = currentTenantNamespace()
  if (namespace === SINGLE_TENANT_NAMESPACE) return message
  return `t:${namespace}|${message}`
}

function storageReadSig(secret: string, key: string): string {
  return createHmac('sha256', secret)
    .update(tenantBind(`read|${key}`))
    .digest('hex')
    .slice(0, 32)
}

/** Verify the capability attached to a private storage URL. */
export function verifyStorageReadToken(secret: string, key: string, sig: string | null): boolean {
  if (!sig) return false
  const expected = storageReadSig(secret, key)
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  } catch {
    return false
  }
}

function buildPublicUrl(placement: StoragePlacement, key: string): string {
  if (placement.publicUrl && isPublicStorageKey(key)) {
    return `${placement.publicUrl.replace(/\/$/, '')}/${key}`
  }

  // Private objects always pass through the application with an unforgeable
  // read capability, even when a public CDN endpoint is configured.
  const base = `${placement.originUrl.replace(/\/$/, '')}/api/storage/${key}`
  if (isPublicStorageKey(key)) return base
  // Only the private branch needs a secret, so a public asset URL still renders
  // on a tenant whose credential reference has no resolver. The private branch
  // cannot: minting a read capability requires the signing secret, so a tenant
  // whose credentials are unresolvable has no URL to offer rather than a broken
  // one. `getPublicUrlOrNull` turns that into null; `getPublicUrl` still throws.
  return `${base}?read=${storageReadSig(resolveStorageCredentials().secretAccessKey, key)}`
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
 * Generate a presigned URL for uploading a file. When S3_PROXY is enabled,
 * returns a server-proxied URL instead of a direct presigned S3 URL.
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
  const publicUrl = buildPublicUrl(getStoragePlacement(), key)

  if (config.s3Proxy) {
    const uploadUrl = buildProxyUploadUrl(s3Config.secretAccessKey, key, contentType, expiresIn)
    return { uploadUrl, publicUrl, key }
  }

  const client = await getS3Client()
  const { PutObjectCommand } = await getS3Module()
  const { getSignedUrl } = await getPresignerModule()

  const command = new PutObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
    ContentType: contentType,
  })

  const uploadUrl = await getSignedUrl(client, command, { expiresIn })
  return { uploadUrl, publicUrl, key }
}

// ============================================================================
// Proxy Upload Token (used when S3_PROXY=true)
// ============================================================================

function proxyUploadSig(secret: string, key: string, contentType: string, exp: number): string {
  // truncated to 128 bits; sufficient for short-lived upload auth
  // Tenant-bound for the same reason as the read token: the object key alone
  // does not say which bucket the write lands in.
  return createHmac('sha256', secret)
    .update(tenantBind(`${key}|${contentType}|${exp}`))
    .digest('hex')
    .slice(0, 32)
}

function buildProxyUploadUrl(
  secret: string,
  key: string,
  contentType: string,
  expiresIn: number
): string {
  const origin = getStoragePlacement().originUrl
  if (!origin) throw new Error('BASE_URL must be set to use S3_PROXY upload')
  const exp = Date.now() + expiresIn * 1000
  const sig = proxyUploadSig(secret, key, contentType, exp)
  const base = origin.replace(/\/$/, '')
  return `${base}/api/storage/${key}?ct=${encodeURIComponent(contentType)}&exp=${exp}&sig=${sig}`
}

/**
 * Verify a proxy upload token from the PUT /api/storage/* handler.
 * Returns true only if the signature is valid and the token has not expired.
 */
export function verifyProxyUploadToken(
  secret: string,
  key: string,
  contentType: string,
  exp: string | null,
  sig: string | null
): boolean {
  if (!exp || !sig) return false
  const expNum = Number(exp)
  if (!Number.isFinite(expNum) || Date.now() > expNum) return false
  const expected = proxyUploadSig(secret, key, contentType, expNum)
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  } catch {
    return false
  }
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

  return buildPublicUrl(getStoragePlacement(), key)
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate a unique storage key for a file.
 *
 * @param prefix - Path prefix, e.g., "changelog-images"
 * @param filename - Original filename
 * @returns Storage key like "changelog-images/2024/01/<uuid>-filename.jpg"
 */
export function generateStorageKey(prefix: string, filename: string): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  // Full UUID: object keys are effectively unguessable capability URLs on
  // public buckets, so a truncated ID would be brute-forceable.
  const randomId = crypto.randomUUID()
  const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_').toLowerCase()

  return `${prefix}/${year}/${month}/${randomId}-${safeFilename}`
}

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/x-icon',
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
    // The multipart type label is caller-controlled and becomes the stored
    // Content-Type, so verify it against the actual bytes before storing —
    // same check the unfurl image proxy applies to fetched images.
    if (sniffImageMime(body) !== file.type) {
      return Response.json({ error: 'File content does not match its type' }, { status: 400 })
    }
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
 * @param opts.contentAddressed - Derive the key from a hash of the bytes instead
 *   of a timestamp, so re-uploading identical content overwrites one object
 *   rather than accumulating duplicates. Used for highly repetitive assets like
 *   favicons that the same source serves across many pages.
 * @returns Public URL to the uploaded object
 * @throws Error if the mime type is not allowed, the buffer is empty, or the upload fails
 */
export async function uploadImageBuffer(
  buffer: Buffer,
  mimeType: string,
  storagePrefix: string,
  opts?: { contentAddressed?: boolean }
): Promise<{ url: string }> {
  if (!isAllowedImageType(mimeType)) {
    throw new Error(`Invalid mime type for rehost: ${mimeType}`)
  }
  if (buffer.length === 0) {
    throw new Error('Cannot upload empty buffer')
  }
  const ext = mimeType.split('/')[1] ?? 'bin'
  const key = opts?.contentAddressed
    ? `${storagePrefix}/${createHash('sha256').update(buffer).digest('hex')}.${ext}`
    : generateStorageKey(storagePrefix, `rehost-${Date.now()}.${ext}`)
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
  // A private key needs a signature, and a tenant whose storage credentials are
  // unresolvable cannot produce one. Returning null degrades an avatar or an
  // attachment link; letting the throw escape would take down every page that
  // renders one, which is a much larger blast radius for the same fault.
  if (!isPublicStorageKey(key) && !isS3Usable()) return null

  return buildPublicUrl(getStoragePlacement(), key)
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
  if (!isPublicStorageKey(key) && !isS3Usable()) return null

  const placement = getStoragePlacement()
  const storageUrl = buildPublicUrl(placement, key)
  if (placement.publicUrl && isPublicStorageKey(key)) return storageUrl

  // Force proxy mode so email clients get bytes directly (no 302 redirect)
  const url = new URL(storageUrl)
  url.searchParams.set('email', '1')
  return url.toString()
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
 * @param expiresIn - URL expiration time in seconds (default: 172800 = 48 hours).
 *   The sole caller (GET /api/storage 302 redirect) marks the redirect
 *   cacheable for 24h, so the presigned URL must outlive cached copies;
 *   48h keeps a 2x margin over that cache window.
 * @param downloadName - When set, S3 responds with
 *   `Content-Disposition: attachment; filename="<downloadName>"`, so the
 *   browser saves a friendly name instead of the raw object key.
 */
export async function generatePresignedGetUrl(
  key: string,
  expiresIn: number = 172800,
  downloadName?: string
): Promise<string> {
  const s3Config = getS3Config()
  const client = await getS3Client()
  const { GetObjectCommand } = await getS3Module()
  const { getSignedUrl } = await getPresignerModule()

  const command = new GetObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
    ...(downloadName
      ? { ResponseContentDisposition: `attachment; filename="${downloadName}"` }
      : {}),
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
