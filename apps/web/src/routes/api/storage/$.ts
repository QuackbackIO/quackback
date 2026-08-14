import { createFileRoute } from '@tanstack/react-router'
import { readBodyWithLimit } from '@/lib/server/utils/read-body'
import { logger } from '@/lib/server/logger'
import { currentWorkspaceNamespace } from '@/lib/server/workspaces/workspace-keyed'

const log = logger.child({ component: 'storage' })

export interface ProxyCacheOptions {
  ttlMs: number
  /** Objects larger than this are served but never cached. */
  maxEntryBytes: number
  /** Total budget across all entries; exceeding it evicts least-recently-used entries. */
  maxTotalBytes: number
}

export interface ProxyCacheEntry {
  data: ArrayBuffer
  contentType: string
}

/**
 * Bounded in-memory cache for proxied assets (e.g. email logos).
 * Each entry buffers a full S3 object, so entries are TTL-expired,
 * size-capped per entry, and LRU-evicted against a total byte budget.
 */
export function createProxyCache(opts: ProxyCacheOptions) {
  // Map iteration order is insertion order; get() re-inserts on hit, so the
  // first keys are always the least recently used.
  const entries = new Map<string, ProxyCacheEntry & { cachedAt: number }>()
  let totalBytes = 0

  const remove = (key: string): void => {
    const entry = entries.get(key)
    if (!entry) return
    entries.delete(key)
    totalBytes -= entry.data.byteLength
  }

  return {
    get(key: string): ProxyCacheEntry | undefined {
      const entry = entries.get(key)
      if (!entry) return undefined
      if (Date.now() - entry.cachedAt >= opts.ttlMs) {
        remove(key)
        return undefined
      }
      entries.delete(key)
      entries.set(key, entry)
      return entry
    },
    set(key: string, data: ArrayBuffer, contentType: string): void {
      if (data.byteLength > opts.maxEntryBytes) return
      remove(key)
      entries.set(key, { data, contentType, cachedAt: Date.now() })
      totalBytes += data.byteLength
      for (const oldestKey of entries.keys()) {
        if (totalBytes <= opts.maxTotalBytes) break
        remove(oldestKey)
      }
    },
    delete(key: string): void {
      remove(key)
    },
    get totalBytes(): number {
      return totalBytes
    },
  }
}

const proxyCache = createProxyCache({
  ttlMs: 60 * 60 * 1000, // 1 hour
  maxEntryBytes: 1 * 1024 * 1024, // logos are typically < 50 KB; skip outliers
  maxTotalBytes: 32 * 1024 * 1024,
})

/**
 * The proxy cache holds file BYTES keyed by storage key, in process memory.
 *
 * Storage keys are per-bucket and the bucket is the workspace boundary, so two
 * workspaces' keys share a namespace in this heap the moment one process serves
 * both — and a hit returns the other workspace's file with a 200 and no error.
 * That is worse than the edge-cache case below: it needs no CDN and no
 * misconfiguration, only a key that appears in two buckets, which is exactly
 * what an import or a migration produces.
 */
export function proxyCacheKey(key: string): string {
  return `${currentWorkspaceNamespace()} ${key}`
}

/**
 * The S3 client reports a missing object two ways depending on the operation and
 * the provider, so both are checked rather than whichever one this provider
 * happened to send today.
 */
function isNotFound(error: unknown): boolean {
  const e = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404
}

const KEY_PREFIX = '/api/storage/'

/**
 * The stored key this request is asking for, or null if it is not one.
 *
 * `decodeURIComponent` throws `URIError` on a malformed escape — `%c0%ae`, a
 * lone `%`, a truncated `%2` — and this runs *outside* the try/catch below, so
 * the route answered 500 for input a caller controls. Worse for this change: a
 * 500 here means the storage boundary's own "malformed percent-encoding"
 * refusal is never reached from the only route that decodes, so the refusal
 * looked covered and was unreachable.
 *
 * Undecodable is not a server fault and not a missing object; it is a key that
 * does not name anything, which is the same answer as `..` — null, and the
 * caller sends 400.
 */
function extractKey(url: URL): string | null {
  let key: string
  try {
    key = decodeURIComponent(url.pathname.slice(KEY_PREFIX.length))
  } catch {
    return null
  }
  return key && !key.includes('..') ? key : null
}

export async function handleProxyUpload({ request }: { request: Request }): Promise<Response> {
  const {
    isS3Usable,
    getStorageSigningSecret,
    uploadObject,
    verifyProxyUploadToken,
    isAllowedImageType,
    MAX_FILE_SIZE,
  } = await import('@/lib/server/storage/s3')
  const { sniffImageMime } = await import('@/lib/server/content/magic-bytes')

  // Browser uploads always come through this route. A 403 "proxy off" used
  // to send the client to a presigned object-store URL, which CORS-fails on
  // every generated workspace host. Credential outages stay 503.
  if (!isS3Usable()) {
    return Response.json({ error: 'Storage not configured' }, { status: 503 })
  }

  const url = new URL(request.url)
  const key = extractKey(url)
  if (!key) return Response.json({ error: 'Invalid storage key' }, { status: 400 })

  const ct = url.searchParams.get('ct')
  if (!ct) return Response.json({ error: 'Missing content-type' }, { status: 400 })

  const exp = url.searchParams.get('exp')
  const sig = url.searchParams.get('sig')
  // Only the signing secret, never the bucket. This route is the surface an
  // unauthenticated request reaches, and it needs an HMAC key, not a capability
  // to address every object in the bucket.
  const secretAccessKey = getStorageSigningSecret()

  if (!verifyProxyUploadToken(secretAccessKey, key, ct, exp, sig)) {
    return Response.json({ error: 'Invalid or expired upload token' }, { status: 401 })
  }

  const body = await readBodyWithLimit(request, MAX_FILE_SIZE)
  if (!body) return Response.json({ error: 'File too large' }, { status: 413 })

  // The token authenticates which (key, ct) may be written, not that the bytes
  // are that type — apply the same magic-byte check as the multipart path.
  // Every presigned flow signs an allowed image type, so non-image cts are
  // rejected outright.
  const sniffed = sniffImageMime(Buffer.from(body.buffer, body.byteOffset, body.byteLength))
  if (!isAllowedImageType(ct) || sniffed !== ct) {
    return Response.json({ error: 'File content does not match its type' }, { status: 400 })
  }

  await uploadObject(key, body, ct)
  proxyCache.delete(proxyCacheKey(key))
  return new Response(null, { status: 200 })
}

/**
 * GET /api/storage/*
 * Serve files from S3 storage.
 *
 * When S3_PROXY is enabled, streams file bytes through the server — useful when
 * the browser can't reach the S3 endpoint directly (e.g., ngrok, mixed content).
 *
 * Otherwise, redirects to a presigned S3 URL (302) so the browser fetches
 * directly from S3 — no bytes are proxied through the server.
 */
export async function handleStorageGet({ request }: { request: Request }): Promise<Response> {
  const {
    isS3Usable,
    generatePresignedGetUrl,
    getS3Object,
    getStorageSigningSecret,
    isPublicStorageKey,
    StorageUnavailableError,
    verifyStorageReadToken,
  } = await import('@/lib/server/storage/s3')
  const { config } = await import('@/lib/server/config')

  // Usability, not addressability. A pooled workspace record always names a bucket,
  // so the addressability question answers `true` while the credential read
  // throws a few lines later — and because that call sits outside the try/catch,
  // the whole route answered **500** for every key of every workspace. A workspace
  // whose storage credentials do not resolve is a configuration state, not a
  // crash, and it has to be distinguishable from one: a 500 tells a caller
  // nothing, and it cost the isolation probe its P03 verdict on top of the
  // feature.
  if (!isS3Usable()) {
    return Response.json({ error: 'Storage not configured' }, { status: 503 })
  }

  const url = new URL(request.url)
  const key = extractKey(url)

  if (!key) {
    return Response.json({ error: 'Invalid storage key' }, { status: 400 })
  }

  if (
    !isPublicStorageKey(key) &&
    !verifyStorageReadToken(getStorageSigningSecret(), key, url.searchParams.get('read'))
  ) {
    return Response.json({ error: 'Invalid storage read token' }, { status: 403 })
  }

  // Force proxy for email embeds (?email=1) since email clients don't follow redirects
  const forceProxy = url.searchParams.has('email')

  try {
    if (config.s3Proxy || forceProxy) {
      const cached = proxyCache.get(proxyCacheKey(key))
      if (cached) {
        return new Response(cached.data, {
          status: 200,
          headers: {
            'Content-Type': cached.contentType,
            'Cache-Control': isPublicStorageKey(key)
              ? 'public, max-age=31536000, immutable'
              : 'private, max-age=3600, immutable',
            // The key namespace is per-bucket and the bucket is the workspace
            // boundary, so the same path can name a different object per host.
            Vary: 'Host',
            // Stored Content-Types originate from upload requests — never
            // let a browser second-guess them on a same-origin response.
            'X-Content-Type-Options': 'nosniff',
          },
        })
      }

      const { body, contentType } = await getS3Object(key)
      const data = await new Response(body).arrayBuffer()

      proxyCache.set(proxyCacheKey(key), data, contentType)

      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': isPublicStorageKey(key)
            ? 'public, max-age=31536000, immutable'
            : 'private, max-age=3600, immutable',
          Vary: 'Host',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }

    const presignedUrl = await generatePresignedGetUrl(key)

    return new Response(null, {
      status: 302,
      headers: {
        Location: presignedUrl,
        'Cache-Control': isPublicStorageKey(key) ? 'public, max-age=86400' : 'private, no-store',
        Vary: 'Host',
      },
    })
  } catch (error) {
    // Second barrier behind the gate above. The gate is the one that fires in
    // practice; this is here so that a credential that becomes unresolvable
    // between the two still reports as a refusal rather than as a crash.
    if (error instanceof StorageUnavailableError) {
      log.error({ err: error }, 'storage credentials unresolvable')
      return Response.json({ error: 'Storage not configured' }, { status: 503 })
    }
    // An object that is not there is not a server fault. It reached this branch
    // as a 500 before, which under pooled workspaces is actively misleading: the
    // three states a caller has to tell apart are "this workspace has no
    // storage" (503), "this object does not exist" (404) and "something broke"
    // (500), and collapsing the middle one into the last makes an ordinary
    // missing asset look like an outage.
    if (isNotFound(error)) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    log.error({ err: error }, 'storage object serve failed')
    return Response.json({ error: 'Failed to resolve storage URL' }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/storage/$')({
  server: {
    handlers: {
      /**
       * PUT /api/storage/*
       *
       * Server streams the body to the object store so the browser never
       * needs direct access to the storage endpoint. Requires a valid
       * HMAC-signed token issued by generatePresignedUploadUrl.
       */
      PUT: handleProxyUpload,

      GET: handleStorageGet,
    },
  },
})
