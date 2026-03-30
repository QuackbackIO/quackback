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
