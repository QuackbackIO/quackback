/**
 * Workspace content-hold signals: hold submissions that contain images or
 * external links. Orthogonal to the author-type requireApproval policy.
 */
import type { TiptapContent } from '@/lib/shared/db-types'
import { hasExternalLink, hasImageNode } from '@/lib/server/markdown-tiptap'
import { getBaseUrl } from '@/lib/server/config'

export type ContentHoldReason = 'images' | 'links' | 'images+links'

export interface ContentHoldFlags {
  holdImages?: boolean
  holdLinks?: boolean
}

export function contentHoldReason(
  flags: ContentHoldFlags | undefined,
  contentJson: TiptapContent | null | undefined,
  fallbackText?: string
): ContentHoldReason | null {
  if (!flags) return null
  const origin = (() => {
    try {
      return getBaseUrl()
    } catch {
      return undefined
    }
  })()
  const images = flags.holdImages === true && hasImageNode(contentJson)
  const links = flags.holdLinks === true && hasExternalLink(contentJson, fallbackText, origin)
  if (images && links) return 'images+links'
  if (images) return 'images'
  if (links) return 'links'
  return null
}
