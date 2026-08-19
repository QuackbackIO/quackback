import { createFileRoute } from '@tanstack/react-router'
import { readBodyWithLimit } from '@/lib/server/utils/read-body'
import { logger } from '@/lib/server/logger'

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

const KEY_PREFIX = '/api/storage/'

function extractKey(url: URL): string | null {
  const key = decodeURIComponent(url.pathname.slice(KEY_PREFIX.length))
  return key && !key.includes('..') ? key : null
}

export async function handleProxyUpload({ request }: { request: Request }): Promise<Response> {
  const {
    isS3Configured,
    getS3Config,
    uploadObject,
    verifyProxyUploadToken,
    isAllowedImageType,
    MAX_FILE_SIZE,
  } = await import('@/lib/server/storage/s3')
  const { sniffImageMime } = await import('@/lib/server/content/magic-bytes')
  const { config } = await import('@/lib/server/config')

  if (!isS3Configured() || !config.s3Proxy) {
    return Response.json({ error: 'Proxy uploads not enabled' }, { status: 403 })
  }

  const url = new URL(request.url)
  const key = extractKey(url)
  if (!key) return Response.json({ error: 'Invalid storage key' }, { status: 400 })

  const ct = url.searchParams.get('ct')
  if (!ct) return Response.json({ error: 'Missing content-type' }, { status: 400 })

  const exp = url.searchParams.get('exp')
  const sig = url.searchParams.get('sig')
  const { secretAccessKey } = getS3Config()

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
  proxyCache.delete(key)
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
    isS3Configured,
    generatePresignedGetUrl,
    getS3Object,
    getS3Config,
    isPublicStorageKey,
    verifyStorageReadToken,
  } = await import('@/lib/server/storage/s3')
  const { config } = await import('@/lib/server/config')

  if (!isS3Configured()) {
    return Response.json({ error: 'Storage not configured' }, { status: 503 })
  }

  const url = new URL(request.url)
  const key = extractKey(url)

  if (!key) {
    return Response.json({ error: 'Invalid storage key' }, { status: 400 })
  }

  if (
    !isPublicStorageKey(key) &&
    !verifyStorageReadToken(getS3Config().secretAccessKey, key, url.searchParams.get('read'))
  ) {
    return Response.json({ error: 'Invalid storage read token' }, { status: 403 })
  }

  // Force proxy for email embeds (?email=1) since email clients don't follow redirects
  const forceProxy = url.searchParams.has('email')

  try {
    if (config.s3Proxy || forceProxy) {
      const cached = proxyCache.get(key)
      if (cached) {
        return new Response(cached.data, {
          status: 200,
          headers: {
            'Content-Type': cached.contentType,
            'Cache-Control': isPublicStorageKey(key)
              ? 'public, max-age=31536000, immutable'
              : 'private, max-age=3600, immutable',
            // Stored Content-Types originate from upload requests — never
            // let a browser second-guess them on a same-origin response.
            'X-Content-Type-Options': 'nosniff',
          },
        })
      }

      const { body, contentType } = await getS3Object(key)
      const data = await new Response(body).arrayBuffer()

      proxyCache.set(key, data, contentType)

      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': isPublicStorageKey(key)
            ? 'public, max-age=31536000, immutable'
            : 'private, max-age=3600, immutable',
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
      },
    })
  } catch (error) {
    log.error({ err: error }, 'storage object serve failed')
    return Response.json({ error: 'Failed to resolve storage URL' }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/storage/$')({
  server: {
    handlers: {
      /**
       * PUT /api/storage/*  (S3_PROXY=true only)
       *
       * Server streams the body to S3/MinIO so the browser never needs direct
       * access to the storage endpoint. Requires a valid HMAC-signed token
       * issued by generatePresignedUploadUrl.
       */
      PUT: handleProxyUpload,

      GET: handleStorageGet,
    },
  },
})
