/**
 * Server-side Markdown <-> TipTap JSON conversion
 *
 * Uses @tiptap/markdown's MarkdownManager with server-safe extensions
 * (no browser-only deps like ResizableImage, YouTube, Placeholder, BubbleMenu).
 *
 * Following Linear's pattern: markdown in via API, ProseMirror JSON stored internally.
 */

import { MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Image from '@tiptap/extension-image'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import type { TiptapContent } from '@/lib/server/db'
import type { JSONContent } from '@tiptap/core'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'

/**
 * Server-safe extensions for markdown conversion.
 *
 * Excludes browser-only extensions: ResizableImage (uses DOM resize handles),
 * Youtube (lossy in markdown - becomes a link), Placeholder, BubbleMenu,
 * CodeBlockLowlight (lowlight needs no special markdown handling; StarterKit's
 * codeBlock handles ``` fences).
 */
const SERVER_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
  }),
  Link.configure({ openOnClick: false }),
  Underline,
  Image,
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
]

/** Singleton MarkdownManager - created once at module load */
const manager = new MarkdownManager({
  extensions: SERVER_EXTENSIONS,
  markedOptions: { gfm: true },
})

/**
 * Parse a markdown string into TipTap JSON.
 *
 * Used by the service layer when content arrives via MCP/API without contentJson.
 * The output is from a trusted parser and does NOT need sanitizeTiptapContent().
 */
export function markdownToTiptapJson(markdown: string): TiptapContent {
  return manager.parse(markdown) as TiptapContent
}

/**
 * Serialize TipTap JSON to a markdown string.
 *
 * Used by the backfill script and potentially future export flows.
 * YouTube embeds and ResizableImage attrs are lossy - they become plain
 * links/images in markdown. The contentJson preserves the full fidelity.
 */
export function tiptapJsonToMarkdown(json: TiptapContent | JSONContent): string {
  return manager.serialize(json as JSONContent)
}

/**
 * Image node types found in stored `contentJson`. The editor stores uploads as
 * `resizableImage`; markdown parsed via {@link markdownToTiptapJson} yields the
 * plain `image`. Mirrors `IMAGE_NODE_TYPES` in content/rehost-images.ts.
 */
const IMAGE_NODE_TYPES = new Set(['image', 'resizableImage'])

/**
 * Render an entity's markdown for output (API / MCP responses), preferring the
 * stored `content` column but restoring images from the canonical `contentJson`.
 *
 * The stored markdown is faithful for everything except images: the editor's
 * resizable-image node has no markdown serializer, so client-computed markdown
 * silently dropped them. `contentJson` keeps the images (with rehosted src), so
 * only when it carries an image do we re-serialize it to put them back as
 * `![alt](src)`. Image-free content returns the stored markdown verbatim — no
 * reason to pay for, or risk reformatting from, a re-serialize.
 *
 * Falls back to the stored markdown when `contentJson` is absent (legacy rows,
 * or list queries that omit it for performance) or can't be serialized — a read
 * path must never fail over content shape.
 */
export function contentJsonToMarkdown(
  contentJson: TiptapContent | JSONContent | null | undefined,
  fallback: string
): string {
  if (!contentJson || !hasImageNode(contentJson)) return fallback
  try {
    const markdown = tiptapJsonToMarkdown(normalizeImageNodes(contentJson))
    return markdown.trim() ? markdown : fallback
  } catch {
    return fallback
  }
}

/** Depth-first scan for an image node (`image` or `resizableImage`) anywhere in a tree. */
function hasImageNode(node: JSONContent): boolean {
  if (typeof node.type === 'string' && IMAGE_NODE_TYPES.has(node.type)) return true
  return node.content?.some(hasImageNode) ?? false
}

/**
 * Rewrite `resizableImage` nodes to plain `image` so @tiptap/markdown's Image
 * extension serializes them — the editor's resizable node shares the `src`/`alt`
 * attrs but has no markdown spec, so it would otherwise serialize to nothing.
 */
function normalizeImageNodes(node: JSONContent): JSONContent {
  const next = node.type === 'resizableImage' ? { ...node, type: 'image' } : node
  if (!next.content) return next
  return { ...next, content: next.content.map(normalizeImageNodes) }
}

/**
 * Slim extension set for comments — no images, no tables, no YouTube.
 * Comments are short, dense, and inline; we want the safe subset only.
 */
const COMMENT_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    hardBreak: { keepMarks: true },
  }),
  Link.configure({ openOnClick: false, autolink: true }),
  Underline,
  TaskList,
  TaskItem.configure({ nested: true }),
]

const commentManager = new MarkdownManager({
  extensions: COMMENT_EXTENSIONS,
  markedOptions: { gfm: true, breaks: true },
})

/**
 * Parse a comment-style markdown string into TipTap JSON.
 */
export function commentMarkdownToTiptapJson(markdown: string): TiptapContent {
  const json = commentManager.parse(markdown) as TiptapContent
  return sanitizeTiptapContent(json) as TiptapContent
}
