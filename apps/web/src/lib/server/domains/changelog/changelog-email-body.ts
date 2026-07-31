/**
 * The entry's full body as sanitized HTML for the publish notification email:
 * the rich `contentJson` rendered through the shared JSON→HTML serializer when
 * present (text nodes are HTML-escaped by the serializer), else the stored
 * markdown `content` column parsed and rendered the same way so markdown-only
 * rows still produce a formatted body. Self-hosted image srcs carry the
 * email-proxy hint so mail clients can load them inline. Empty when the entry
 * has no renderable content, in which case the template falls back to its
 * plain-text preview excerpt.
 */
import type { TiptapContent } from '@/lib/server/db'
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { withEmailProxyHint } from '@/lib/server/content/email-image-proxy'
import { generateContentHTML } from '@/lib/shared/content-html'

export function changelogBodyHtml(content: string, contentJson: TiptapContent | null): string {
  try {
    const json = contentJson ?? markdownToTiptapJson(content)
    return generateContentHTML(withEmailProxyHint(json))
  } catch {
    // A read path must never fail over content shape: the email keeps its
    // plain-text preview fallback when the body can't be rendered.
    return ''
  }
}
