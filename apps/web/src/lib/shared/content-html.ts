/**
 * Pure TipTap-JSON → HTML serializer.
 *
 * Shared by the rich-text editor's read-only render surface (client) and by
 * server-side consumers that need HTML from stored content WITHOUT a browser or
 * a live editor — e.g. the outbound conversation-email body.
 *
 * This module is deliberately free of React, tiptap-react, and browser globals
 * (`window`/`document`/DOMPurify): it is a recursive string walker over
 * write-time-sanitized JSON. Text nodes are HTML-escaped here (defense in
 * depth); client callers additionally run the output through DOMPurify (see
 * `RichTextContent`), which requires a DOM and so stays in the editor module.
 */
import type { JSONContent } from '@tiptap/core'
import {
  escapeHtmlAttr,
  sanitizeUrl,
  sanitizeImageUrl,
  safePositiveInt,
  extractYoutubeId,
} from '@/lib/shared/utils/sanitize'

// NOTE: this module is deliberately free of `@tiptap/extension-emoji` — its
// ~700 KB shortcode dataset would otherwise land in every read-only portal
// chunk that reaches `generateContentHTML`. Emoji nodes are serialized from
// `attrs.emoji` (the Unicode char the picker stores at write time); a legacy
// `name`-only node degrades to its `:shortcode:` placeholder here, and the
// client renderer (`RichTextContent`) upgrades it on demand via a dynamic
// import of `@/lib/shared/content-emoji`. Server-side callers that need the
// legacy lookup import `lookupEmoji` from that module directly.

// Generate HTML from TipTap JSON content for SSR / email.
export function generateContentHTML(content: JSONContent): string {
  function extractPlainText(node: JSONContent): string {
    if (!node) return ''
    if (node.type === 'text') return node.text ?? ''
    if (Array.isArray(node.content)) return node.content.map(extractPlainText).join('')
    return ''
  }

  function slugifyHeading(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  function renderNode(node: JSONContent): string {
    if (!node) return ''

    switch (node.type) {
      case 'doc':
        return node.content?.map(renderNode).join('') ?? ''

      case 'paragraph': {
        const pContent = node.content?.map(renderNode).join('') ?? ''
        return pContent ? `<p>${pContent}</p>` : '<p></p>'
      }

      case 'heading': {
        const rawLevel = Number(node.attrs?.level)
        const level = [1, 2, 3, 4, 5, 6].includes(rawLevel) ? rawLevel : 2
        const headingContent = node.content?.map(renderNode).join('') ?? ''
        const id = slugifyHeading(extractPlainText(node))
        const idAttr = id ? ` id="${escapeHtmlAttr(id)}"` : ''
        return `<h${level}${idAttr}>${headingContent}</h${level}>`
      }

      case 'text': {
        let text = node.text ?? ''
        // Escape HTML entities
        text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        // Apply marks
        if (node.marks) {
          for (const mark of node.marks) {
            switch (mark.type) {
              case 'bold':
                text = `<strong>${text}</strong>`
                break
              case 'italic':
                text = `<em>${text}</em>`
                break
              case 'underline':
                text = `<u>${text}</u>`
                break
              case 'strike':
                text = `<s>${text}</s>`
                break
              case 'code':
                text = `<code class="bg-muted px-1 py-0.5 rounded text-sm">${text}</code>`
                break
              case 'link': {
                const rawHref = mark.attrs?.href ?? ''
                const href = escapeHtmlAttr(sanitizeUrl(rawHref))
                // Only render link if href is valid after sanitization
                if (href) {
                  text = `<a href="${href}" class="text-primary underline" target="_blank" rel="noopener noreferrer">${text}</a>`
                }
                break
              }
            }
          }
        }
        return text
      }

      case 'bulletList':
        return `<ul>${node.content?.map(renderNode).join('') ?? ''}</ul>`

      case 'orderedList':
        return `<ol>${node.content?.map(renderNode).join('') ?? ''}</ol>`

      case 'listItem': {
        // Unwrap single-paragraph list items to avoid <li><p>…</p></li>
        // which causes Tailwind prose to add large p margins inside li
        const children = node.content ?? []
        if (children.length === 1 && children[0].type === 'paragraph') {
          const inlineHtml = children[0].content?.map(renderNode).join('') ?? ''
          return `<li>${inlineHtml}</li>`
        }
        return `<li>${children.map(renderNode).join('')}</li>`
      }

      case 'taskList':
        return `<ul class="not-prose list-none pl-0">${node.content?.map(renderNode).join('') ?? ''}</ul>`

      case 'taskItem': {
        const checked = node.attrs?.checked ?? false
        const checkboxHtml = `<input type="checkbox" ${checked ? 'checked' : ''} disabled class="mr-2 mt-1" />`
        const itemContent = node.content?.map(renderNode).join('') ?? ''
        return `<li class="flex gap-2 items-start">${checkboxHtml}<div>${itemContent}</div></li>`
      }

      case 'blockquote':
        return `<blockquote class="border-l-4 border-border pl-4 italic">${node.content?.map(renderNode).join('') ?? ''}</blockquote>`

      case 'horizontalRule':
        return '<hr class="my-4 border-border" />'

      case 'table':
        return `<table class="w-full border-collapse">${node.content?.map(renderNode).join('') ?? ''}</table>`

      case 'tableRow':
        return `<tr>${node.content?.map(renderNode).join('') ?? ''}</tr>`

      case 'tableHeader':
        return `<th class="border border-border bg-muted/50 p-2 text-left font-semibold">${node.content?.map(renderNode).join('') ?? ''}</th>`

      case 'tableCell':
        return `<td class="border border-border p-2">${node.content?.map(renderNode).join('') ?? ''}</td>`

      case 'codeBlock': {
        const language = escapeHtmlAttr(String(node.attrs?.language ?? ''))
        const codeContent = node.content?.map(renderNode).join('') ?? ''
        return `<pre class="not-prose rounded-lg bg-muted p-4 overflow-x-auto"><code class="language-${language}">${codeContent}</code></pre>`
      }

      case 'image':
      case 'resizableImage': {
        const rawSrc = node.attrs?.src ?? ''
        const rawAlt = node.attrs?.alt ?? ''
        const src = escapeHtmlAttr(sanitizeImageUrl(rawSrc))
        const alt = escapeHtmlAttr(rawAlt)
        // Only render image if src is valid after sanitization
        if (!src) return ''
        const imgWidth = node.attrs?.width !== undefined ? safePositiveInt(node.attrs.width, 0) : 0
        // Both width AND height present (and valid, non-zero) → emit numeric
        // width/height attributes plus an aspect-ratio hint so the browser can
        // reserve the correct box before the image loads (avoids CLS). Falls
        // back to the width-only behavior below for nodes that only carry a
        // legacy width (or no dimensions at all), which is still the common
        // case for historical content authored before dimensions were tracked.
        const imgHeight =
          node.attrs?.height !== undefined ? safePositiveInt(node.attrs.height, 0) : 0
        if (imgWidth && imgHeight) {
          const style = `style="aspect-ratio: ${imgWidth} / ${imgHeight};"`
          return `<img src="${src}" alt="${alt}" width="${imgWidth}" height="${imgHeight}" class="max-w-full h-auto rounded-lg" ${style} />`
        }
        // Only apply width (not height) so h-auto preserves aspect ratio
        const style = imgWidth ? `style="width:${imgWidth}px;"` : ''
        return `<img src="${src}" alt="${alt}" class="max-w-full h-auto rounded-lg" ${style} />`
      }

      case 'chatImage': {
        // Inline conversation image. Bounded (max-w-xs) so it sits inside a message bubble.
        // Renders nothing if the src is empty after sanitization.
        const src = escapeHtmlAttr(sanitizeImageUrl(String(node.attrs?.src ?? '')))
        const alt = escapeHtmlAttr(String(node.attrs?.alt ?? ''))
        if (!src) return ''
        return `<img src="${src}" alt="${alt}" class="max-w-xs rounded-md" />`
      }

      case 'youtube': {
        const src = node.attrs?.src ?? ''
        const width = safePositiveInt(node.attrs?.width, 640)
        const height = safePositiveInt(node.attrs?.height, 360)
        // Extract video ID (only allows alphanumeric, hyphens, underscores)
        const videoId = extractYoutubeId(src)
        if (videoId) {
          const safeVideoId = escapeHtmlAttr(videoId)
          return `<div class="relative aspect-video my-4 rounded-lg overflow-hidden"><iframe src="https://www.youtube-nocookie.com/embed/${safeVideoId}" width="${width}" height="${height}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen class="absolute inset-0 w-full h-full"></iframe></div>`
        }
        return ''
      }

      case 'hardBreak':
        return '<br>'

      case 'mention': {
        // Inline leaf node. The picker stores {id: principalId, label: displayName}.
        // We emit a chip span with both attrs so the client overlay can resolve a
        // hover card by principalId; label is also rendered as the visible "@name".
        // escapeHtmlAttr escapes &<>"' so it's safe for both attribute and text use.
        const id = escapeHtmlAttr(String(node.attrs?.id ?? ''))
        const label = escapeHtmlAttr(String(node.attrs?.label ?? ''))
        if (!id) return ''
        return `<span class="mention" data-principal-id="${id}" data-display-name="${label}">@${label}</span>`
      }

      case 'emoji': {
        // Prefer the Unicode char the picker persists in `attrs.emoji`. A legacy
        // `name`-only node (older @tiptap/extension-emoji stored just the
        // shortcode) has no char here — rather than statically pull in the
        // ~700 KB emoji dataset, we emit the `:shortcode:` placeholder and let
        // the client renderer swap in the real glyph on demand (see
        // RichTextContent's emoji upgrade). HTML-escape for defence-in-depth.
        const rawName = String(node.attrs?.name ?? '')
        const rawChar = String(node.attrs?.emoji ?? '')
        const ch = rawChar || (rawName ? `:${rawName}:` : '')
        const escaped = ch.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const name = escapeHtmlAttr(rawName)
        const dataNameAttr = name ? ` data-name="${name}"` : ''
        return `<span data-type="emoji"${dataNameAttr}>${escaped}</span>`
      }

      case 'quackbackEmbed': {
        // Atom block. Saved content isn't rendered through a live editor on
        // display surfaces, so we emit a static placeholder div that survives
        // DOMPurify; EmbedHydration portals a live card into it client-side.
        // A missing/foreign kind or id renders nothing — the embed degrades to
        // empty rather than breaking the page.
        const kind = String(node.attrs?.kind ?? '')
        const id = String(node.attrs?.id ?? '')
        if ((kind !== 'post' && kind !== 'changelog') || !id) return ''
        return `<div data-quackback-embed="1" data-kind="${escapeHtmlAttr(kind)}" data-id="${escapeHtmlAttr(id)}" class="quackback-embed-placeholder"></div>`
      }

      default:
        // For unknown nodes, try to render their content
        return node.content?.map(renderNode).join('') ?? ''
    }
  }

  return renderNode(content)
}
