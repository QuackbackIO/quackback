/**
 * Read-time rewrite of stored image srcs inside TipTap content.
 *
 * Persist may hold a host-independent `/api/storage/<key>`, a legacy absolute
 * URL, or a private ref whose `?read=` token was minted under a previous
 * secret or binding. Leaves that send content to a browser mint a current
 * capability here. The stored doc is not written back.
 *
 * Structural walk over a copy of the doc — never a string replace over
 * serialized content.
 */
import type { JSONContent } from '@tiptap/core'
import { resignStoredAssetUrl } from '@/lib/server/storage/s3'

const IMAGE_NODE_TYPES = new Set(['image', 'resizableImage', 'chatImage'])

export function withCurrentStorageReadTokens(node: JSONContent): JSONContent {
  let next = node
  if (IMAGE_NODE_TYPES.has(node.type ?? '') && typeof node.attrs?.src === 'string') {
    const src = resignStoredAssetUrl(node.attrs.src)
    if (src !== node.attrs.src) {
      next = { ...node, attrs: { ...node.attrs, src } }
    }
  }
  if (!node.content) return next
  return { ...next, content: node.content.map(withCurrentStorageReadTokens) }
}

/** Null-preserving leave for stored `contentJson` sent to a browser. */
export function contentJsonForClient<T extends JSONContent | null | undefined>(node: T): T {
  if (!node) return node
  return withCurrentStorageReadTokens(node) as T
}
