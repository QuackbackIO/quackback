/**
 * Email-transport rewrite for self-hosted image srcs inside TipTap content.
 *
 * Outbound HTML emails can't rely on the `/api/storage/` route's default
 * behavior — it answers with a 302 to a presigned S3 URL, which many mail
 * clients refuse to follow — so same-origin storage srcs are absolutized
 * against the deployment base URL and tagged with the route's `?email=1`
 * force-proxy hint, making the asset proxy inline. `S3_PUBLIC_URL` srcs are
 * already directly fetchable and are left untouched, as is every foreign
 * origin. Structural walk over a copy of the doc — never a string replace
 * over serialized content.
 */
import type { JSONContent } from '@tiptap/core'
import { config } from '@/lib/server/config'

const IMAGE_NODE_TYPES = new Set(['image', 'resizableImage', 'chatImage'])

export function withEmailProxyHint(node: JSONContent): JSONContent {
  let next = node
  if (IMAGE_NODE_TYPES.has(node.type ?? '') && typeof node.attrs?.src === 'string') {
    try {
      const src = new URL(node.attrs.src, config.baseUrl)
      const sameOrigin = src.origin === new URL(config.baseUrl).origin
      if (
        sameOrigin &&
        src.pathname.startsWith('/api/storage/') &&
        !src.searchParams.has('email')
      ) {
        src.searchParams.set('email', '1')
        next = { ...node, attrs: { ...node.attrs, src: src.toString() } }
      }
    } catch {
      // Unparseable src: leave the node alone; the serializer drops unsafe URLs.
    }
  }
  if (!node.content) return next
  return { ...next, content: node.content.map(withEmailProxyHint) }
}
