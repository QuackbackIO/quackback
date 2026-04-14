/**
 * Rehost external images inside TipTap content.
 *
 * Given a TipTap doc tree for a post, changelog entry, or help center article,
 * walk the tree, find every `image` / `resizableImage` node, and try to fetch
 * + re-upload each external src to workspace storage. The returned tree has
 * rewritten src attrs for every image that succeeded; failed images keep
 * their original src (fail-soft). The input tree is never mutated.
 *
 * This module is the single hook point for auto-rehost; service layers for
 * posts / changelog / help-center call it right after building contentJson.
 *
 * Safety: see `./ssrf-guard.ts` for the URL safety pipeline and
 * `./magic-bytes.ts` for the magic-byte content-type verification. External
 * URLs go through both before hitting S3.
 */

import type { TiptapContent } from '@/lib/server/db'
import { isS3Configured, uploadImageBuffer } from '@/lib/server/storage/s3'
import { checkUrlSafety } from './ssrf-guard'
import { sniffImageMime, ALLOWED_REHOST_MIMES } from './magic-bytes'

const MAX_BYTES = Number(process.env.REHOST_MAX_BYTES) || 10 * 1024 * 1024
const MAX_IMAGES_PER_SAVE = Number(process.env.REHOST_MAX_IMAGES_PER_SAVE) || 20
const FETCH_TIMEOUT_MS = Number(process.env.REHOST_FETCH_TIMEOUT_MS) || 10_000

const IMAGE_NODE_TYPES = new Set(['image', 'resizableImage'])

export type RehostContentType = 'post' | 'changelog' | 'help-center'

const PREFIX_BY_CONTENT_TYPE: Record<RehostContentType, string> = {
  post: 'post-images',
  changelog: 'changelog-images',
  'help-center': 'help-center',
}

export interface RehostOptions {
  contentType: RehostContentType
  principalId?: string
}

interface ImageNode {
  type: string
  attrs?: { src?: string } & Record<string, unknown>
  content?: unknown[]
  [key: string]: unknown
}

type RejectReason =
  | 'same-origin-skip'
  | 'svg-rejected'
  | 'mime-rejected'
  | 'oversized'
  | 'fetch-timeout'
  | 'fetch-error'
  | 'upload-error'
  | 'data-uri-decode-error'
  | 'count-cap-exceeded'
  | 'scheme-rejected'
  | 'ssrf-rejected'
  | 'dns-error'
  | 'redirect-rejected'
  | 'magic-mismatch'

function logRejection(src: string, reason: RejectReason, opts: RehostOptions, err?: unknown): void {
  const principal = opts.principalId ?? 'unknown'
  const detail = err instanceof Error ? `: ${err.message}` : ''
  console.warn(
    `[content:rehost-images] skipped image contentType=${opts.contentType} principalId=${principal} src=${src} reason=${reason}${detail}`
  )
}

/**
 * Deep clone a TipTap tree. We don't need reference-identity preservation,
 * so structuredClone is safe and fast.
 */
function cloneTree(json: TiptapContent): TiptapContent {
  return structuredClone(json) as TiptapContent
}

/** Collect all image-ish nodes from a cloned tree, in traversal order. */
function collectImageNodes(root: unknown): ImageNode[] {
  const out: ImageNode[] = []
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    const candidate = node as ImageNode
    if (typeof candidate.type === 'string' && IMAGE_NODE_TYPES.has(candidate.type)) {
      out.push(candidate)
    }
    if (Array.isArray(candidate.content)) {
      // Push in reverse so pop() yields forward traversal order.
      for (let i = candidate.content.length - 1; i >= 0; i--) {
        stack.push(candidate.content[i])
      }
    }
  }
  return out
}

/** Parse a data:image/... URI into (mime, buffer). Throws on malformed input. */
function parseDataUri(src: string): { mime: string; buffer: Buffer } {
  const match = src.match(/^data:([^;,]+)(;base64)?,(.*)$/)
  if (!match) throw new Error('not a data URI')
  const mime = match[1].toLowerCase()
  const isBase64 = match[2] === ';base64'
  const payload = match[3]
  const buffer = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8')
  return { mime, buffer }
}

/**
 * Compare parsed URL origins (and path prefix) to decide whether a src is
 * already on our workspace storage. A raw `startsWith` against the env value
 * would let an attacker host `cdn.example.com.attacker.tld` bypass rehost by
 * embedding a matching prefix.
 */
function isSameOrigin(src: string): boolean {
  const publicUrl = process.env.S3_PUBLIC_URL
  if (!publicUrl) return false
  let srcUrl: URL
  let publicUrlParsed: URL
  try {
    srcUrl = new URL(src)
    publicUrlParsed = new URL(publicUrl)
  } catch {
    return false
  }
  if (srcUrl.origin !== publicUrlParsed.origin) return false
  // If the public URL includes a path (e.g. https://cdn.example.com/bucket),
  // require the src path to be inside it.
  const publicPath = publicUrlParsed.pathname.replace(/\/$/, '')
  if (publicPath === '') return true
  return srcUrl.pathname === publicPath || srcUrl.pathname.startsWith(`${publicPath}/`)
}

/** Fetch a URL with timeout + manual redirect + stream-limited body read. */
async function fetchWithLimits(
  url: string
): Promise<{ ok: true; buffer: Buffer; mimeHeader: string } | { ok: false; reason: RejectReason }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
    })
  } catch (err) {
    clearTimeout(timer)
    const reason = (err as Error).name === 'AbortError' ? 'fetch-timeout' : 'fetch-error'
    return { ok: false, reason }
  }
  clearTimeout(timer)

  if (response.status >= 300 && response.status < 400) {
    return { ok: false, reason: 'redirect-rejected' }
  }
  if (!response.ok) {
    return { ok: false, reason: 'fetch-error' }
  }

  const mimeHeader = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (mimeHeader === 'image/svg+xml') {
    return { ok: false, reason: 'svg-rejected' }
  }
  if (!ALLOWED_REHOST_MIMES.has(mimeHeader)) {
    return { ok: false, reason: 'mime-rejected' }
  }

  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && Number(declaredLength) > MAX_BYTES) {
    return { ok: false, reason: 'oversized' }
  }

  // Stream-limited read: abort if the body overruns the cap.
  if (!response.body) {
    return { ok: false, reason: 'fetch-error' }
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > MAX_BYTES) {
          await reader.cancel()
          return { ok: false, reason: 'oversized' }
        }
        chunks.push(value)
      }
    }
  } catch {
    return { ok: false, reason: 'fetch-error' }
  }

  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)))
  return { ok: true, buffer, mimeHeader }
}

/** Process a single external URL. Returns the new URL on success, or a rejection reason. */
async function rehostOne(
  src: string,
  opts: RehostOptions
): Promise<{ url: string } | { rejected: RejectReason }> {
  // Data URI path
  if (src.startsWith('data:')) {
    let mime: string
    let buffer: Buffer
    try {
      ;({ mime, buffer } = parseDataUri(src))
    } catch {
      return { rejected: 'data-uri-decode-error' }
    }
    if (mime === 'image/svg+xml') return { rejected: 'svg-rejected' }
    if (!ALLOWED_REHOST_MIMES.has(mime)) return { rejected: 'mime-rejected' }
    if (buffer.length > MAX_BYTES) return { rejected: 'oversized' }
    // Skip magic-byte sniff for data URIs — the declared mime is authoritative
    // and we already validated it against the allow-list.
    try {
      const { url } = await uploadImageBuffer(
        buffer,
        mime,
        PREFIX_BY_CONTENT_TYPE[opts.contentType]
      )
      return { url }
    } catch {
      return { rejected: 'upload-error' }
    }
  }

  // HTTP(S) path
  const safety = await checkUrlSafety(src)
  if (!safety.safe) {
    return { rejected: safety.reason }
  }

  const fetched = await fetchWithLimits(src)
  if (!fetched.ok) {
    return { rejected: fetched.reason }
  }

  const sniffedMime = sniffImageMime(fetched.buffer)
  if (sniffedMime === null || sniffedMime !== fetched.mimeHeader) {
    return { rejected: 'magic-mismatch' }
  }

  try {
    const { url } = await uploadImageBuffer(
      fetched.buffer,
      sniffedMime,
      PREFIX_BY_CONTENT_TYPE[opts.contentType]
    )
    return { url }
  } catch {
    return { rejected: 'upload-error' }
  }
}

/**
 * Rehost every external image src inside a TipTap content tree.
 * Never throws — top-level errors return the input unchanged.
 */
export async function rehostExternalImages(
  json: TiptapContent,
  opts: RehostOptions
): Promise<TiptapContent> {
  try {
    if (!json || typeof json !== 'object') return json
    if (!isS3Configured()) {
      console.info('[content:rehost-images] S3 not configured — no-op')
      return json
    }

    const cloned = cloneTree(json)
    const nodes = collectImageNodes(cloned)
    if (nodes.length === 0) return cloned

    // Dedupe by src; cap at MAX_IMAGES_PER_SAVE unique URLs.
    const unique = new Map<string, { nodes: ImageNode[]; rewrite: string | null }>()
    let considered = 0
    for (const node of nodes) {
      const src = node.attrs?.src
      if (typeof src !== 'string' || src.length === 0) continue
      if (isSameOrigin(src)) {
        // Not an error — just skip silently. Keep src as-is.
        continue
      }
      if (!unique.has(src)) {
        if (considered >= MAX_IMAGES_PER_SAVE) {
          logRejection(src, 'count-cap-exceeded', opts)
          continue
        }
        unique.set(src, { nodes: [], rewrite: null })
        considered++
      }
      const entry = unique.get(src)
      if (entry) entry.nodes.push(node)
    }

    // Fetch + upload each unique URL sequentially.
    for (const [src, entry] of unique) {
      const result = await rehostOne(src, opts)
      if ('url' in result) {
        entry.rewrite = result.url
      } else {
        logRejection(src, result.rejected, opts)
      }
    }

    // Patch the cloned tree.
    for (const entry of unique.values()) {
      if (entry.rewrite === null) continue
      for (const node of entry.nodes) {
        if (node.attrs) {
          node.attrs.src = entry.rewrite
        }
      }
    }

    return cloned
  } catch (err) {
    console.error('[content:rehost-images] unexpected error, returning input unchanged', err)
    return json
  }
}
