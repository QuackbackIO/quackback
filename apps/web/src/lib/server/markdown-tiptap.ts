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
import { lookupEmoji } from '@/lib/shared/content-html'

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
 * Node types this module can faithfully turn into markdown: the server
 * manager's own nodes (see SERVER_EXTENSIONS) plus the two we normalize below
 * (`resizableImage` -> `image`, `mention` -> text). Anything else — `youtube`,
 * `quackbackEmbed`, `emoji`, future custom nodes — would be silently dropped by
 * the narrower server manager, so a document containing one keeps its stored
 * markdown (which the client serialized with full coverage) instead.
 */
const RESERIALIZABLE_NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'text',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  'taskList',
  'taskItem',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'image',
  'resizableImage',
  'chatImage',
  'mention',
  'emoji',
  'youtube',
  'quackbackEmbed',
])

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
 * Re-serialization runs through the narrower server manager, so we only do it
 * when every node is representable (see {@link RESERIALIZABLE_NODE_TYPES}); a
 * document mixing an image with, say, a YouTube embed keeps its stored markdown
 * rather than dropping the embed. Also falls back when `contentJson` is absent
 * (legacy rows / list queries that omit it) or can't be serialized — a read
 * path must never fail over content shape.
 */
export function contentJsonToMarkdown(
  contentJson: TiptapContent | JSONContent | null | undefined,
  fallback: string
): string {
  if (!contentJson || !hasImageNode(contentJson) || !isReserializable(contentJson)) {
    return fallback
  }
  try {
    const markdown = tiptapJsonToMarkdown(normalizeForMarkdown(contentJson))
    return markdown.trim() ? markdown : fallback
  } catch {
    return fallback
  }
}

/**
 * Produce the stored markdown projection for a freshly written contentJson
 * document. Unlike {@link contentJsonToMarkdown}, this always serializes the
 * current tree, including image-free structured-only edits, so the denormalized
 * `content` column cannot retain text from the previous version.
 */
export function projectContentJsonToMarkdown(
  contentJson: TiptapContent | JSONContent | null | undefined,
  fallback: string
): string {
  if (!contentJson || !isReserializable(contentJson)) return fallback
  try {
    return tiptapJsonToMarkdown(normalizeForMarkdown(contentJson)).trim()
  } catch {
    return fallback
  }
}

/**
 * Depth-first scan for an image node (`image` or `resizableImage`) anywhere in a
 * tree. Runs before the serialize try/catch, so it must stay total: a malformed
 * row whose `content` is present but not an array must not throw.
 */
function hasImageNode(node: JSONContent): boolean {
  if (typeof node.type === 'string' && IMAGE_NODE_TYPES.has(node.type)) return true
  return Array.isArray(node.content) ? node.content.some(hasImageNode) : false
}

/**
 * True only when every node in the tree can be re-serialized without loss. A
 * single unknown node type makes this false so the caller keeps stored markdown.
 * Total by the same contract as {@link hasImageNode}.
 */
function isReserializable(node: JSONContent): boolean {
  if (typeof node.type === 'string' && !RESERIALIZABLE_NODE_TYPES.has(node.type)) return false
  return Array.isArray(node.content) ? node.content.every(isReserializable) : true
}

/**
 * Rewrite the editor's custom nodes into ones @tiptap/markdown can serialize:
 * `resizableImage` -> `image` (shares src/alt but has no markdown spec) and
 * `mention` -> the `@label` text the directive would otherwise hide. Only
 * called once {@link isReserializable} has cleared the tree.
 */
function normalizeForMarkdown(node: JSONContent): JSONContent {
  if (node.type === 'mention') {
    const attrs = node.attrs ?? {}
    const label = (attrs.label as string) || (attrs.id as string) || 'mention'
    return { type: 'text', text: `@${label}` }
  }
  if (node.type === 'emoji') {
    const attrs = node.attrs ?? {}
    const name = String(attrs.name ?? '')
    const emoji = String(attrs.emoji ?? lookupEmoji(name)?.emoji ?? (name ? `:${name}:` : ''))
    return { type: 'text', text: emoji }
  }
  if (node.type === 'youtube') {
    const src = String(node.attrs?.src ?? '')
    return {
      type: 'paragraph',
      content: src
        ? [{ type: 'text', text: src, marks: [{ type: 'link', attrs: { href: src } }] }]
        : [{ type: 'text', text: '[YouTube embed]' }],
    }
  }
  if (node.type === 'quackbackEmbed') {
    const kind = String(node.attrs?.kind ?? 'content')
    const id = String(node.attrs?.id ?? '')
    return {
      type: 'paragraph',
      content: [{ type: 'text', text: id ? `[Embedded ${kind}: ${id}]` : `[Embedded ${kind}]` }],
    }
  }
  const next =
    node.type === 'resizableImage' || node.type === 'chatImage' ? { ...node, type: 'image' } : node
  if (!Array.isArray(next.content)) return next
  return { ...next, content: next.content.map(normalizeForMarkdown) }
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

/**
 * Inline node types whose text concatenates directly into their parent run
 * (a paragraph's words, a hard break, a mention). Anything else is a
 * block-level node whose siblings read as separate lines.
 */
const INLINE_LEAF_TYPES = new Set(['text', 'hardBreak', 'mention', 'emoji'])

/**
 * Image node types rendered as a `[image]` placeholder by {@link tiptapJsonToText}:
 * the chat composer's inline `chatImage` plus the two image nodes documents
 * elsewhere store (see {@link IMAGE_NODE_TYPES} above).
 */
const TEXT_PLACEHOLDER_IMAGE_TYPES = new Set(['chatImage', 'image', 'resizableImage'])

/**
 * A node's own text, for the leaf types {@link tiptapJsonToText} renders
 * directly. Returns `null` for a container node, whose text instead comes
 * from walking its `content` children.
 */
function leafText(node: TiptapContent): string | null {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'mention') {
    const attrs = node.attrs ?? {}
    const label = (attrs.label as string) || (attrs.id as string) || 'mention'
    return `@${label}`
  }
  if (TEXT_PLACEHOLDER_IMAGE_TYPES.has(node.type)) return '[image]'
  return null
}

/**
 * Depth-first walk producing one node's plaintext. A container's children
 * are joined with no separator when they're all inline (a paragraph's words)
 * and with `\n` otherwise (a doc's paragraphs, a list's items, …) — mirroring
 * how a document reads line by line.
 */
function walkText(node: TiptapContent): string {
  const leaf = leafText(node)
  if (leaf !== null) return leaf
  const children = node.content ?? []
  if (children.length === 0) return ''
  const separator = children.every((child) => INLINE_LEAF_TYPES.has(child.type)) ? '' : '\n'
  return children.map(walkText).join(separator)
}

/**
 * Derive plaintext from a TipTap doc via a pure JSON-tree walk (no tiptap
 * manager/extensions needed). Used server-side to keep the `content` mirror
 * column (FTS/transcripts/previews) faithful when a caller sends a rich
 * `contentJson` with a blank `content` — mirroring what the client's own
 * `editor.getText()` would have produced.
 */
export function tiptapJsonToText(json: TiptapContent): string {
  return walkText(json).trim()
}

/**
 * True when a doc contains at least one non-empty `text` leaf anywhere in
 * the tree. Callers use this to gate {@link tiptapJsonToText}: an image- or
 * embed-only doc (no text leaves) has nothing meaningful to derive, so a
 * caller should keep its existing fallback-label behavior instead.
 */
export function hasTextLeaf(json: TiptapContent | null | undefined): boolean {
  if (!json) return false
  const visit = (node: TiptapContent): boolean => {
    if (node.type === 'text') return !!node.text?.trim()
    return (node.content ?? []).some(visit)
  }
  return visit(json)
}
