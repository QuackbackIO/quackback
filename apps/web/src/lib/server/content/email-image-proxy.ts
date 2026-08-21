/**
 * Email-transport rewrite for stored image srcs inside TipTap content.
 *
 * Persist is host-independent (`/api/storage/<key>`). Outbound HTML emails
 * cannot follow the storage route's 302, so storage srcs are absolutized from
 * the immutable system host and tagged with `?email=1`. Legacy absolute
 * storage srcs are rewritten onto that host at send time; CDN and foreign
 * srcs are left untouched. Structural walk over a copy of the doc — never a
 * string replace over serialized content.
 */
import type { JSONContent } from '@tiptap/core'
import { absolutizeOffHostAssetUrl, isStoredAssetPath } from '@/lib/server/storage/asset-url'

const IMAGE_NODE_TYPES = new Set(['image', 'resizableImage', 'chatImage'])

export function withEmailProxyHint(node: JSONContent): JSONContent {
  let next = node
  if (IMAGE_NODE_TYPES.has(node.type ?? '') && typeof node.attrs?.src === 'string') {
    const src = node.attrs.src
    try {
      const parsed = new URL(src, 'https://placeholder.invalid')
      if (isStoredAssetPath(parsed.pathname) || src.startsWith('/api/storage/')) {
        next = {
          ...node,
          attrs: { ...node.attrs, src: absolutizeOffHostAssetUrl(src, { email: true }) },
        }
      }
    } catch {
      // Unparseable src: leave the node alone; the serializer drops unsafe URLs.
    }
  }
  if (!node.content) return next
  return { ...next, content: node.content.map(withEmailProxyHint) }
}
