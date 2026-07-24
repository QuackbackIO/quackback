import { createFileRoute } from '@tanstack/react-router'
import { gzipSync, brotliCompressSync, constants as zlibConstants } from 'node:zlib'
import { config } from '@/lib/server/config'
// Vite `?raw` imports ship the bundle content as a string at build time.
// packages/widget/dist/browser.js must exist — produced by `bun run --filter
// @quackback/widget build` before the web app builds.
import widgetBundle from '../../../../../../packages/widget/dist/browser.js?raw'

/**
 * Pre-compressed variants, memoized per body string. The body only changes
 * when the widget config changes (cache-invalidated, at most a handful of
 * variants alive at once), so this is effectively compress-once. sdk.js sits
 * on third-party pages' critical path and the bare-Bun deployment has no
 * proxy to compress for it.
 */
const encodedCache = new Map<string, { gzip: Uint8Array; br: Uint8Array }>()

function encodeBody(body: string): { gzip: Uint8Array; br: Uint8Array } {
  const hit = encodedCache.get(body)
  if (hit) return hit
  const raw = Buffer.from(body, 'utf-8')
  const encoded = {
    gzip: gzipSync(raw),
    br: brotliCompressSync(raw, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9 },
    }),
  }
  // The body varies only with the tenant's base URL + widget config; a tiny
  // cap guards against unbounded growth if that assumption ever breaks.
  if (encodedCache.size > 8) encodedCache.clear()
  encodedCache.set(body, encoded)
  return encoded
}

function jsResponse(body: string, maxAge: number, acceptEncoding: string): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': `public, max-age=${maxAge}`,
    Vary: 'Accept-Encoding',
  }
  if (/\bbr\b/.test(acceptEncoding)) {
    return new Response(encodeBody(body).br as BodyInit, {
      headers: { ...headers, 'Content-Encoding': 'br' },
    })
  }
  if (/\bgzip\b/.test(acceptEncoding)) {
    return new Response(encodeBody(body).gzip as BodyInit, {
      headers: { ...headers, 'Content-Encoding': 'gzip' },
    })
  }
  return new Response(body, { headers })
}

export const Route = createFileRoute('/api/widget/sdk.js')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const acceptEncoding = request.headers.get('accept-encoding') ?? ''
        const { getPublicServerConfig } = await import('@/lib/server/widget/public-config')
        const { enabled, config: serverConfig } = await getPublicServerConfig()
        if (!enabled) {
          return jsResponse(
            '/* Quackback widget is disabled */ console.warn("Quackback: Widget is disabled for this workspace.");',
            60,
            acceptEncoding
          )
        }
        // Prepend the tenant URL and the public server config. The bundle
        // reads window.__QUACKBACK_URL__ during browser-queue init to
        // auto-fire Quackback.init when the script loads via a raw
        // <script src="/api/widget/sdk.js"> tag; window.__QUACKBACK_CONFIG__
        // lets the SDK paint the launcher in brand colors and reveal it
        // immediately, with no config.json round trip.
        const prelude =
          `window.__QUACKBACK_URL__=${JSON.stringify(config.baseUrl)};` +
          `window.__QUACKBACK_CONFIG__=${JSON.stringify(serverConfig)};`
        return jsResponse(prelude + (widgetBundle as string), 3600, acceptEncoding)
      },
    },
  },
})
