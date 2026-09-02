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
 *
 * ## Every object name is composed for one workspace
 *
 * Nothing below addresses the bucket directly. {@link currentWorkspaceStorage}
 * returns the only thing that can issue a command; its methods take the *stored*
 * key and compose `w/<selfReportedWorkspaceId>/` internally. It is the only export that
 * yields a client, and the factory behind it is deliberately private — see
 * `workspace-scope.ts` for the hole that was, and `namespace.ts` for why the
 * identifier is `settings.id` and not something else.
 *
 * The exported helpers (`uploadObject`, `getS3Object`, `deleteObject`, the two
 * presigners) keep the signatures ~20 call sites already use and resolve the
 * workspace themselves. Threading a workspace id through those call sites is the
 * convention this design exists to replace: a convention survives until the next
 * call site is added by someone who has not read this file.
 *
 * ## Relocating objects that predate the namespace
 *
 * An install that has been serving before this change holds its objects at bare
 * keys, and composing a namespace makes them unreachable. There is deliberately
 * **no read-time fallback to the bare key.** Under one fleet bucket a bare key
 * is nobody's namespace, so reading it is the §3 failure exactly; and any
 * "…except when the bucket is not shared" carve-out would have to be gated on a
 * configuration value, which is the class of thing nobody checks and everybody
 * eventually gets wrong. The fallback is not merely unsafe by default, it is
 * unsafe in a way nothing in this process can detect.
 *
 * The relocation is instead a one-time move inside the bucket, run by the
 * operator with the credentials they already hold, before the new build serves
 * traffic:
 *
 * ```
 * aws s3 mv s3://<bucket>/ s3://<bucket>/w/<workspace TypeID>/ --recursive --exclude 'w/*'
 * ```
 *
 * The prefix is `fromUuid('workspace', settings.id)` (for example
 * `workspace_01kxddf1jaf6cr22gerxt7z9gg`). `SELECT id FROM settings` returns
 * the UUID spelling; copying under that UUID leaves every restored object
 * unreadable. Convert the UUID before composing `w/<prefix>/`.
 *
 * It is a server-side copy: no bytes leave the bucket, the stored keys do not
 * change, and no content is rewritten, because the namespace appears in neither
 * the database nor any URL. Every affected install holds exactly one workspace
 * per bucket, so that TypeID is unambiguous.
 *
 * **Note what this repository must NOT grow to make that convenient.** Listing
 * and deleting at the bucket root is correct against a bucket that holds one
 * workspace and catastrophic against one that holds the fleet, so the app has no
 * such capability and gains none here, not even for its own migration. The cost
 * is that an operator who deploys without moving the objects serves 404s for
 * pre-existing assets until they do — visible, reversible, and self-announcing,
 * which is the opposite of what the fallback would have been.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { WorkspaceId } from '@quackback/ids'
import { config } from '@/lib/server/config'
import { sniffImageMime } from '@/lib/server/content/magic-bytes'
import {
  getCurrentWorkspace,
  getWorkspaceStorageCredential,
  requireWorkspaceScope,
} from '@/lib/server/workspaces/workspace-context'
import {
  currentWorkspaceNamespace,
  SINGLE_WORKSPACE_NAMESPACE,
} from '@/lib/server/workspaces/workspace-keyed'
import { absolutizeOffHostAssetUrl, storedAssetKeyFromSrc } from './asset-url'
import { composeNamespacedKey, workspaceNamespace } from './namespace'
import { currentWorkspaceId } from './workspace-scope'

// ============================================================================
// Configuration
// ============================================================================

/**
 * Bucket, endpoint and credentials together: a complete capability to address
 * any object in the bucket.
 *
 * **Module-private, and that is the point.** It used to be exported, which made
 * the one thing this design removes — an un-namespaced way to reach the bucket —
 * an import away for any file in the app. Nothing outside this module now
 * receives a bucket name and a credential in the same value.
 */
interface S3Config {
  endpoint?: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
  publicUrl?: string
}

/**
 * Where a workspace's objects live and how their URLs are formed. Deliberately
 * carries no credentials: rendering a public asset URL must not depend on
 * resolving a secret, so the two are split and only the paths that actually
 * talk to storage pay for credential resolution.
 */
interface StoragePlacement {
  endpoint?: string
  bucket: string
  region: string
  forcePathStyle: boolean
  publicUrl?: string
  /**
   * Origin used when a leaf must absolutize a stored `/api/storage` ref
   * (email, widget, OG). Browser PUTs and persisted refs stay relative.
   */
  originUrl: string
}

/**
 * The active workspace's placement, or the process-wide one when unscoped.
 * Returns null when storage is not configured at all.
 */
function getStoragePlacementOrNull(): StoragePlacement | null {
  const workspace = getCurrentWorkspace()
  if (workspace) {
    const storage = workspace.storage
    return {
      endpoint: storage.endpoint || undefined,
      bucket: storage.bucket,
      region: storage.region,
      forcePathStyle: storage.forcePathStyle,
      publicUrl: storage.publicUrl || undefined,
      originUrl: workspace.routing.baseUrl,
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

function getStoragePlacement(): StoragePlacement {
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
  readonly workspaceKey: string
  constructor(workspaceKey: string, detail: string) {
    super(`Storage is not usable for workspace ${workspaceKey}: ${detail}`)
    this.name = 'StorageUnavailableError'
    this.workspaceKey = workspaceKey
  }
}

/**
 * The active workspace's storage keys, or the process-wide ones when unscoped.
 *
 * Under a workspace scope these were resolved on pool checkout from the record's
 * `storage.credentialRef` (`workspaces/workspace-secrets.ts`) and carried on the
 * scope, which is what lets this stay synchronous — `buildPublicUrl` and every
 * gate below are called from hundreds of places that cannot await.
 *
 * Read through `getWorkspaceStorageCredential()`, which yields the credential
 * and nothing else. The scope no longer exposes a `secrets` field at all, so
 * this module holds the storage keys and never the workspace `SECRET_KEY`, and
 * the bucket still arrives separately from {@link getStoragePlacement}. Nothing
 * here receives both halves in one call.
 *
 * When a workspace's credentials did not resolve this throws
 * {@link StorageUnavailableError}, and it never falls back to the fleet-wide
 * environment keys. That fallback is the specific thing this must not do: it
 * would hand one workspace a client pointed at another workspace's bucket, holding
 * credentials that might well open it.
 */
function resolveStorageCredentials(): StorageCredentials {
  const resolved = getWorkspaceStorageCredential()
  if (!resolved) {
    if (!config.s3AccessKeyId || !config.s3SecretAccessKey) {
      throw new Error(
        'S3 storage is not configured. Set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.'
      )
    }
    return { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey }
  }
  if (resolved.ok) return resolved.credential
  // A credential result at all means a scope is active, so the identity read is
  // total. Asserted rather than defaulted: a placeholder workspace id in this
  // message would be indistinguishable from a real one nobody recognises.
  throw new StorageUnavailableError(
    requireWorkspaceScope().workspace.workspaceKey,
    resolved.problem
  )
}

/**
 * Whether a bucket can be *addressed*. Deliberately does NOT ask about
 * credentials: `buildPublicUrl` needs a placement and nothing else, and a
 * public asset URL must keep resolving for a workspace whose credentials this
 * process cannot dereference.
 */
export function isS3Configured(): boolean {
  if (getCurrentWorkspace()) return true
  return !!(config.s3Bucket && config.s3Region && config.s3AccessKeyId && config.s3SecretAccessKey)
}

/**
 * Whether an operation that actually touches the bucket can be attempted.
 *
 * Addressability and usability are different questions, and under pooled
 * workspaces they diverge: a workspace record always names a bucket, so
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
  // `null` is "no scope", where addressability was already the whole question.
  const resolved = getWorkspaceStorageCredential()
  return resolved === null || resolved.ok
}

/**
 * Full storage configuration including credentials. Only for the paths that
 * actually sign or send a request; use {@link getStoragePlacement} for anything
 * that just needs to name a bucket or build a URL.
 */
function getS3Config(): S3Config {
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

/**
 * The key the storage read and proxy-upload tokens are signed with.
 *
 * This exists so the `/api/storage` route can verify a token without being
 * handed a bucket name and a credential pair. It asked for `getS3Config()` and
 * used the one field, which meant a route — the surface reachable by an
 * unauthenticated GET — held a complete capability to address any object in the
 * bucket for the sake of an HMAC. Both of its uses take exactly this.
 *
 * Still the storage secret rather than a purpose-derived one: the tokens it
 * verifies are embedded in absolute URLs already written into `contentJson`, so
 * changing the signing key is a fleet of dead asset links rather than a
 * rotation. The narrowing here is of who can *see* the value, not of what it is.
 *
 * Throws {@link StorageUnavailableError} for a workspace whose credentials did not
 * resolve, exactly as `getS3Config()` did. Both callers gate on
 * {@link isS3Usable} first.
 */
export function getStorageSigningSecret(): string {
  return resolveStorageCredentials().secretAccessKey
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
 * process-wide because partitioning them by workspace would store N references to
 * one object and buy nothing.
 */
let _s3Module: S3Module | null = null
let _presignerModule: PresignerModule | null = null

/**
 * One client per set of connection parameters.
 *
 * This used to be keyed by the ambient workspace, which was correct only while a
 * client was built and used inside one scope. It is not a property of the
 * client: an SDK client is a signer and a connection pool built from a region,
 * an endpoint and a credential pair, and nothing else. Keying it by *who was
 * asking* meant a `WorkspaceStorage` captured under one scope and used under
 * another picked up the other scope's client — its own bucket reached through
 * somebody else's endpoint and credentials.
 *
 * Keyed by the parameters instead, the value is a pure function of the key, so
 * a hit across two scopes is byte-identical to what the asking scope would have
 * built. Under §9's one fleet credential that is one client for the fleet, which
 * is the correct number; under per-workspace credentials the keys differ and so do
 * the clients.
 *
 * The bound is a client count, not a correctness limit: eviction only costs a
 * rebuild on the next command.
 */
const s3Clients = new Map<string, S3ClientInstance>()
const MAX_S3_CLIENTS = 256

/**
 * A stable name for one set of connection parameters.
 *
 * The non-secret half is spelled out so a cache key is legible during an
 * incident; the credential pair is hashed rather than embedded, because this
 * string is a Map key that a future debug log would be all too willing to print.
 */
function connectionKey(cfg: S3Config): string {
  const credential = createHash('sha256')
    .update(`${cfg.accessKeyId}\u0000${cfg.secretAccessKey}`)
    .digest('hex')
    .slice(0, 16)
  return `${cfg.region}|${cfg.endpoint ?? ''}|${cfg.forcePathStyle}|${credential}`
}

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
 * The S3 client for one set of connection parameters, building it on first use.
 *
 * Takes the config rather than resolving it, so the caller decides *when* the
 * ambient scope was read. {@link workspaceStorage} reads it once, at
 * construction; nothing re-reads it mid-operation.
 */
async function getS3Client(s3Config: S3Config): Promise<S3ClientInstance> {
  const key = connectionKey(s3Config)
  const existing = s3Clients.get(key)
  if (existing) return existing

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
  s3Clients.set(key, client)
  while (s3Clients.size > MAX_S3_CLIENTS) {
    const oldest = s3Clients.keys().next()
    if (oldest.done) break
    s3Clients.delete(oldest.value)
  }

  return client
}

// ============================================================================
// The workspace-scoped client — the only way to reach the bucket
// ============================================================================

/**
 * Every operation this application performs on an object, for one workspace.
 *
 * The methods take the **stored** key — `uploads/2026/08/…`, exactly what the
 * database holds — and compose `w/<selfReportedWorkspaceId>/` themselves. There is no method
 * that accepts a finished object name, and no accessor that hands out the bucket
 * with a credential, so "address something outside my namespace" is not a
 * request that can be expressed rather than one that is checked for.
 */
export interface WorkspaceStorage {
  readonly selfReportedWorkspaceId: WorkspaceId
  /** Everything every object name this client produces begins with. */
  readonly namespace: string
  /**
   * What a stored key composes to. Exposed because it is the fact worth
   * asserting about — a caller that wants it for anything other than an
   * assertion is reaching for the capability this type exists to withhold.
   */
  objectName(key: string): string
  presignPut(key: string, contentType: string, expiresIn: number): Promise<string>
  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<S3ObjectResult>
  presignGet(key: string, expiresIn: number, downloadName?: string): Promise<string>
  remove(key: string): Promise<void>
}

/**
 * A client bound to one workspace and to one set of connection parameters.
 *
 * **Not exported, and that is the fix for the hole this function used to be.**
 * An earlier revision exported it and guarded it by comparing `selfReportedWorkspaceId`
 * against the ambient scope — which skipped the comparison when there was no
 * scope, so an unscoped caller in a pooled process could name any workspace and
 * reach the fleet bucket with the fleet credential. The refusal that makes an
 * unscoped access safe lives in {@link currentWorkspaceId}, and this function
 * did not call it.
 *
 * A guard cannot repair that, because "no scope" is a legitimate state: it is
 * every self-hosted install, and that path resolves correctly by reading its own
 * `settings.id`. So the fix is to remove the choice rather than to police it —
 * {@link currentWorkspaceStorage} is the only door, and it always resolves.
 *
 * Nor could the type system have carried it. `TypeId<'workspace'>` is
 * `` `workspace_${string}` ``, a template-literal type and not a nominal brand,
 * so `` workspaceStorage(`workspace_${req.params.ws}`) `` compiles with no cast
 * and no error. The branded parameter is a real constraint on a *literal*
 * mistake and no constraint at all on an interpolated one.
 *
 * Placement and credentials are read **once, here**, from the scope that is
 * active at construction. They used to be re-read inside every method, so a
 * client held across a scope boundary composed its own workspace's prefix
 * against whichever bucket the *later* scope named — which in one shared bucket
 * is somebody else's objects. Capturing them binds the whole client, not just
 * its prefix, to the scope that built it.
 */
function workspaceStorage(selfReportedWorkspaceId: WorkspaceId): WorkspaceStorage {
  const connection = getS3Config()

  /**
   * Compose, then verify — in one place, before the name reaches any command.
   *
   * Doing it here rather than at each call site is what makes traversal,
   * absolute keys, empty keys and encoding tricks one refusal rather than five
   * that each command has to remember. A name that fails throws; there is no
   * branch in which a command runs against the un-namespaced key.
   */
  const objectName = (key: string): string => composeNamespacedKey(selfReportedWorkspaceId, key)

  return {
    selfReportedWorkspaceId,
    namespace: workspaceNamespace(selfReportedWorkspaceId),
    objectName,

    async presignPut(key, contentType, expiresIn) {
      const Key = objectName(key)
      const client = await getS3Client(connection)
      const { PutObjectCommand } = await getS3Module()
      const { getSignedUrl } = await getPresignerModule()
      const command = new PutObjectCommand({
        Bucket: connection.bucket,
        Key,
        ContentType: contentType,
      })
      return getSignedUrl(client, command, { expiresIn })
    },

    async put(key, body, contentType) {
      const Key = objectName(key)
      const client = await getS3Client(connection)
      const { PutObjectCommand } = await getS3Module()
      await client.send(
        new PutObjectCommand({
          Bucket: connection.bucket,
          Key,
          ContentType: contentType,
          Body: body,
        })
      )
    },

    async get(key) {
      const Key = objectName(key)
      const client = await getS3Client(connection)
      const { GetObjectCommand } = await getS3Module()
      const response = (await client.send(
        new GetObjectCommand({ Bucket: connection.bucket, Key })
      )) as {
        Body?: { transformToWebStream(): ReadableStream<Uint8Array> }
        ContentType?: string
      }
      if (!response.Body) throw new Error(`S3 object not found: ${key}`)
      return {
        body: response.Body.transformToWebStream(),
        contentType: response.ContentType || 'application/octet-stream',
      }
    },

    async presignGet(key, expiresIn, downloadName) {
      const Key = objectName(key)
      const client = await getS3Client(connection)
      const { GetObjectCommand } = await getS3Module()
      const { getSignedUrl } = await getPresignerModule()
      const command = new GetObjectCommand({
        Bucket: connection.bucket,
        Key,
        ...(downloadName
          ? { ResponseContentDisposition: `attachment; filename="${downloadName}"` }
          : {}),
      })
      return getSignedUrl(client, command, { expiresIn })
    },

    async remove(key) {
      const Key = objectName(key)
      const client = await getS3Client(connection)
      const { DeleteObjectCommand } = await getS3Module()
      await client.send(new DeleteObjectCommand({ Bucket: connection.bucket, Key }))
    },
  }
}

/**
 * The client for the workspace this call is running as.
 *
 * The one place the workspace id is resolved, so that the ~20 call sites below
 * and outside this module keep taking a bare key. What an unscoped call does —
 * and why it needs no guard of its own — is in `workspace-scope.ts`.
 */
export async function currentWorkspaceStorage(): Promise<WorkspaceStorage> {
  return workspaceStorage(await currentWorkspaceId())
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
 * Which prefixes are public is fleet-wide policy, not workspace data: the set below
 * names the key spaces this application serves without a capability token, and
 * it means the same thing in every workspace.
 */
const PUBLIC_STORAGE_PREFIXES = new Set([
  'assistant-avatars',
  'avatars',
  // Admin changelog editor writes `changelog/`; rehost writes `changelog-images/`.
  'changelog',
  'changelog-images',
  'comment-images',
  'favicons',
  'header-logos',
  'help-center',
  'link-previews',
  'logos',
  'portal-images',
  'portal-og',
  'portal-welcome',
  'post-images',
  'widget-hero',
])

/** Unknown prefixes are private by default. */
export function isPublicStorageKey(key: string): boolean {
  return PUBLIC_STORAGE_PREFIXES.has(key.split('/', 1)[0] ?? '')
}

/**
 * The signed message binds the workspace as well as the object key.
 *
 * Object keys are per-bucket, so `attachments/<uuid>` names a different object
 * in every workspace while reading identically here. If the signing secret is ever
 * shared across workspaces — which it is whenever the fleet-wide environment keys
 * are in play — a read token minted for one workspace would verify against
 * another's object without the binding.
 *
 * The single-workspace namespace signs the historical message byte for byte:
 * these tokens are embedded in absolute URLs stored in contentJson, so a
 * changed message invalidates every private asset link already written.
 */
function workspaceBind(message: string): string {
  const namespace = currentWorkspaceNamespace()
  if (namespace === SINGLE_WORKSPACE_NAMESPACE) return message
  return `t:${namespace}|${message}`
}

function storageReadSig(secret: string, key: string): string {
  return createHmac('sha256', secret)
    .update(workspaceBind(`read|${key}`))
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

function buildPublicUrl(_placement: StoragePlacement, key: string): string {
  // Persist a host-independent ref. Friendly platform URLs and the request
  // Host must not land in contentJson; leaves absolutize from the system host.
  const base = `/api/storage/${key}`
  if (isPublicStorageKey(key)) return base
  // Only the private branch needs a secret, so a public asset URL still renders
  // on a workspace whose credential reference has no resolver. The private branch
  // cannot: minting a read capability requires the signing secret, so a workspace
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
 * Mint a same-origin PUT target for a browser upload.
 *
 * The browser never talks to the object store. Workspace hosts have no CORS
 * grant there, and a friendly URL rename must not change the stored ref or
 * the upload path. Persist stays `/api/storage/<key>`; the PUT is the same
 * path with a short-lived HMAC.
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
  // Resolve the workspace first so a pooled call with no scope still refuses.
  // The client is not used to presign: the browser PUTs to /api/storage.
  await currentWorkspaceStorage()
  const publicUrl = buildPublicUrl(getStoragePlacement(), key)
  const uploadUrl = buildProxyUploadUrl(getStorageSigningSecret(), key, contentType, expiresIn)
  return { uploadUrl, publicUrl, key }
}

// ============================================================================
// Proxy Upload Token (used when S3_PROXY=true)
// ============================================================================

function proxyUploadSig(secret: string, key: string, contentType: string, exp: number): string {
  // truncated to 128 bits; sufficient for short-lived upload auth
  // Workspace-bound for the same reason as the read token: the object key alone
  // does not say which bucket the write lands in.
  return createHmac('sha256', secret)
    .update(workspaceBind(`${key}|${contentType}|${exp}`))
    .digest('hex')
    .slice(0, 32)
}

function buildProxyUploadUrl(
  secret: string,
  key: string,
  contentType: string,
  expiresIn: number
): string {
  const exp = Date.now() + expiresIn * 1000
  const sig = proxyUploadSig(secret, key, contentType, exp)
  return `/api/storage/${key}?ct=${encodeURIComponent(contentType)}&exp=${exp}&sig=${sig}`
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
  const storage = await currentWorkspaceStorage()
  await storage.put(key, body, contentType)
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
  // A private key needs a signature, and a workspace whose storage credentials are
  // unresolvable cannot produce one. Returning null degrades an avatar or an
  // attachment link; letting the throw escape would take down every page that
  // renders one, which is a much larger blast radius for the same fault.
  if (!isPublicStorageKey(key) && !isS3Usable()) return null

  return buildPublicUrl(getStoragePlacement(), key)
}

/**
 * Mint a current-workspace persist ref for a stored `/api/storage` src.
 *
 * Private keys get a fresh `?read=` capability; public keys stay unsigned.
 * Stale tokens, unbound K8s signatures, and unsigned legacy URLs are all
 * replaced. Foreign srcs are returned unchanged. A workspace whose storage
 * credentials do not resolve keeps the original src rather than a blank one.
 */
export function resignStoredAssetUrl(src: string): string {
  const key = storedAssetKeyFromSrc(src)
  if (!key) return src
  return getPublicUrlOrNull(key) ?? src
}

/**
 * Get an email-safe URL for a storage key.
 *
 * Persist is host-independent; this leaf absolutizes from the immutable
 * system host and tags `?email=1` so mail clients receive bytes instead of
 * following the storage route's 302.
 */
export function getEmailSafeUrl(key: string | null | undefined): string | null {
  if (!key) return null
  if (!isS3Configured()) return null
  if (!isPublicStorageKey(key) && !isS3Usable()) return null

  return absolutizeOffHostAssetUrl(buildPublicUrl(getStoragePlacement(), key), { email: true })
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
  const storage = await currentWorkspaceStorage()
  return storage.presignGet(key, expiresIn, downloadName)
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
  const storage = await currentWorkspaceStorage()
  return storage.get(key)
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
  const storage = await currentWorkspaceStorage()
  await storage.remove(key)
}
