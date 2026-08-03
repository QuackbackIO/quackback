import { createFileRoute } from '@tanstack/react-router'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'storage' })

// In-memory cache for proxied assets (e.g. email logos) to avoid S3 round-trips.
// Entries expire after 1 hour. Logo images are typically < 50 KB so memory is negligible.
const proxyCache = new Map<string, { data: ArrayBuffer; contentType: string; cachedAt: number }>()
const PROXY_CACHE_TTL = 60 * 60 * 1000 // 1 hour

const KEY_PREFIX = '/api/storage/'

function extractKey(url: URL): string | null {
  const key = decodeURIComponent(url.pathname.slice(KEY_PREFIX.length))
  return key && !key.includes('..') ? key : null
}

/**
 * Returns true when the presigned URL's host is a private / loopback address
 * that the browser cannot reach from the public internet (or through a tunnel).
 * In those cases the storage GET handler must proxy bytes instead of redirecting,
 * otherwise HTTPS pages get mixed-content errors (e.g. Cloudflare / ngrok tunnels
 * where MinIO runs on http://localhost:9000).
 */
function isPrivateHost(urlStr: string): boolean {
  try {
    const { hostname } = new URL(urlStr)
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      // RFC 1918 — 10.x, 172.16-31.x, 192.168.x
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      /^192\.168\./.test(hostname)
    )
  } catch {
    return false
  }
}

// Reads up to maxBytes from the request body stream, cancelling early if exceeded.
// Returns null when the body exceeds the limit, avoiding full buffering of oversized payloads.
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<Uint8Array | null> {
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array(0)

  const chunks: Uint8Array[] = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
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
  const { isS3Configured, generatePresignedGetUrl, getS3Object } =
    await import('@/lib/server/storage/s3')
  const { config } = await import('@/lib/server/config')

  if (!isS3Configured()) {
    return Response.json({ error: 'Storage not configured' }, { status: 503 })
  }

  const url = new URL(request.url)
  const key = extractKey(url)

  if (!key) {
    return Response.json({ error: 'Invalid storage key' }, { status: 400 })
  }

  // Force proxy for email embeds (?email=1) since email clients don't follow redirects
  const forceProxy = url.searchParams.has('email')

  try {
    if (config.s3Proxy || forceProxy) {
      const cached = proxyCache.get(key)
      if (cached) {
        if (Date.now() - cached.cachedAt < PROXY_CACHE_TTL) {
          return new Response(cached.data, {
            status: 200,
            headers: {
              'Content-Type': cached.contentType,
              'Cache-Control': 'public, max-age=31536000, immutable',
              // Stored Content-Types originate from upload requests — never
              // let a browser second-guess them on a same-origin response.
              'X-Content-Type-Options': 'nosniff',
            },
          })
        }
        proxyCache.delete(key)
      }

      const { body, contentType } = await getS3Object(key)
      const data = await new Response(body).arrayBuffer()

      proxyCache.set(key, { data, contentType, cachedAt: Date.now() })

      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }

    const presignedUrl = await generatePresignedGetUrl(key)

    // When the presigned URL points to a private/localhost endpoint (e.g. MinIO
    // in local dev), the browser cannot reach it directly and HTTPS pages get
    // mixed-content errors through tunnels like Cloudflare / ngrok.
    // Proxy the bytes through the app instead of issuing a 302 redirect.
    if (isPrivateHost(presignedUrl)) {
      const { body, contentType } = await getS3Object(key)
      const data = await new Response(body).arrayBuffer()
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: presignedUrl,
        'Cache-Control': 'public, max-age=86400',
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
