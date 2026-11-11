/**
 * Welcome bodies keep their own images as host-independent storage refs
 * (`/api/storage/<key>`), the form every other stored content uses, so a
 * domain change, a custom domain or a restore onto a new host leaves them
 * loading. An absolute URL to this workspace's storage, on any host or under
 * the public bucket URL, is rewritten to that ref on save and again on every
 * read, so designs saved before this still render after a domain change.
 * Foreign images are left as they are.
 */
import type { PortalDesign } from '@/lib/shared/design/schema'
import { storedAssetKeyFromSrc } from '@/lib/server/storage/asset-url'
import { isPublicStorageKey, resignStoredAssetUrl } from '@/lib/server/storage/s3'
import { namesPipelineFile, publicBucketKey } from '@/lib/server/storage/trusted-url'

const MEDIA_NODES = new Set(['image', 'video'])

/** The storage ref an absolute own-storage src names, or null to leave it alone. */
export function welcomeImageRef(src: string): string | null {
  if (!/^https?:\/\//i.test(src) || namesPipelineFile(src)) return null
  const key = storedAssetKeyFromSrc(src) ?? publicBucketKey(src)
  if (!key) return null
  const ref = `/api/storage/${key.split('/').map(encodeURIComponent).join('/')}`
  // A private key keeps its read capability, freshly minted for this workspace.
  return isPublicStorageKey(key) ? ref : resignStoredAssetUrl(ref)
}

function rewriteBody(body: unknown): void {
  const stack: unknown[] = [body]
  while (stack.length > 0) {
    const node = stack.pop() as { type?: unknown; attrs?: { src?: unknown }; content?: unknown }
    if (!node || typeof node !== 'object') continue
    if (typeof node.type === 'string' && MEDIA_NODES.has(node.type)) {
      const src = node.attrs?.src
      const ref = typeof src === 'string' ? welcomeImageRef(src) : null
      if (ref && node.attrs) node.attrs.src = ref
    }
    if (Array.isArray(node.content)) stack.push(...node.content)
  }
}

/** The design with its Welcome bodies' own images as storage refs. Changes the design in place. */
export function withWelcomeImageRefs(design: PortalDesign): PortalDesign {
  rewriteBody(design.pages.feedback.welcome.body)
  for (const block of design.pages.home.blocks) {
    if (block.type === 'welcome') rewriteBody(block.body)
  }
  return design
}
