import {
  useEditor,
  useEditorState,
  EditorContent,
  ReactRenderer,
  type Editor,
  type JSONContent,
} from '@tiptap/react'
import { BubbleMenu, type BubbleMenuProps } from '@tiptap/react/menus'
import { redoDepth, undoDepth } from '@tiptap/pm/history'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import { ResizableImage } from 'tiptap-extension-resizable-image'
import 'tiptap-extension-resizable-image/styles.css'
import './rich-text-editor.css'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import Youtube from '@tiptap/extension-youtube'
import { MentionExtension } from './mention-extension'
import { createSuggestionPopup, createSuggestionPositioner } from './suggestion-popup'
import { applySuggestionListKey } from './suggestion-list-keys'
import { HighlightQuery, emojiSuggestionLabel } from './highlight-query'
import { QuackbackEmbed } from './quackback-embed-extension'
import { ConversationImage } from './conversation-image-node'
import { UploadedVideo } from './uploaded-video-node'
import { Markdown } from '@tiptap/markdown'
import { Extension, getHTMLFromFragment } from '@tiptap/core'
import type { Range } from '@tiptap/core'
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion'
import { createLowlight } from 'lowlight'
import langBash from 'highlight.js/lib/languages/bash'
import langC from 'highlight.js/lib/languages/c'
import langCss from 'highlight.js/lib/languages/css'
import langDiff from 'highlight.js/lib/languages/diff'
import langGo from 'highlight.js/lib/languages/go'
import langJava from 'highlight.js/lib/languages/java'
import langJavascript from 'highlight.js/lib/languages/javascript'
import langJson from 'highlight.js/lib/languages/json'
import langPhp from 'highlight.js/lib/languages/php'
import langPlaintext from 'highlight.js/lib/languages/plaintext'
import langPython from 'highlight.js/lib/languages/python'
import langRuby from 'highlight.js/lib/languages/ruby'
import langRust from 'highlight.js/lib/languages/rust'
import langShell from 'highlight.js/lib/languages/shell'
import langSql from 'highlight.js/lib/languages/sql'
import langTypescript from 'highlight.js/lib/languages/typescript'
import langXml from 'highlight.js/lib/languages/xml'
import langYaml from 'highlight.js/lib/languages/yaml'
import {
  useEffect,
  useCallback,
  useState,
  useMemo,
  memo,
  forwardRef,
  useImperativeHandle,
  useRef,
} from 'react'
import { cn } from '@/lib/shared/utils'
import { resolveVideoMimeType, VIDEO_FILE_ACCEPT } from '@/lib/shared/storage-config'
import { resizableImageInsertAttrs } from '@/lib/client/resizable-image-insert-attrs'
// The read-only JSON→HTML serializer now lives in a browser-free shared module
// so server-side consumers (e.g. outbound conversation email) can import it
// without pulling in React/tiptap-react. Re-exported below for existing callers.
import { generateContentHTML } from '@/lib/shared/content-html'
// The emoji dataset + shortcode lookup live in their own module, which the
// emoji node loads when an editor first needs it (see ./emoji-node).
import type { EmojiItem } from '@/lib/shared/content-emoji'
import { EmojiNode, loadEmojiData } from './emoji-node'
import {
  MAX_EMOJI_SUGGESTIONS,
  POPULAR_EMOJI_SHORTCODES,
  readRecentEmojis,
  recommendEmojiItems,
  recordRecentEmoji,
} from '@/lib/shared/emoji-recommendations'
// Read-only rendering (RichTextContent / isRichTextContent) lives in a sibling
// module with only light deps. Re-exported below for backward compatibility;
// read-only consumers should import from '@/components/ui/rich-text-content'.
import { RichTextContent, isRichTextContent } from './rich-text-content'
import { RichTextEditorEmptyState } from './lazy-rich-text-editor'
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Code2,
  ImagePlus,
  Type,
  Quote,
  Minus,
  CheckSquare,
  Table as TableIcon,
  ChevronDown,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Play as YoutubeIcon,
  Download,
  Copy,
  Expand,
  Link2,
  Video as VideoIcon,
} from 'lucide-react'
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  LinkIcon,
  ListBulletIcon,
} from '@heroicons/react/24/solid'
import { Button } from './button'
import { Input } from './input'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './context-menu'
import { ScrollArea } from './scroll-area'

// Curated grammar set instead of lowlight's `common` (~37 languages): the
// bundle cost of every registered grammar is paid by all editor surfaces,
// including the lazy-loaded visitor composer, so registration is limited to
// languages that actually appear in support and product content. An
// unregistered language renders as plain text inside the code block.
const lowlight = createLowlight({
  bash: langBash,
  c: langC,
  css: langCss,
  diff: langDiff,
  go: langGo,
  java: langJava,
  javascript: langJavascript,
  json: langJson,
  php: langPhp,
  plaintext: langPlaintext,
  python: langPython,
  ruby: langRuby,
  rust: langRust,
  shell: langShell,
  sql: langSql,
  typescript: langTypescript,
  xml: langXml,
  yaml: langYaml,
})
// Fence aliases people actually type (```js, ```html, ```sh …) — without
// these an aliased block silently falls back to plain text.
lowlight.registerAlias({
  bash: ['sh', 'zsh'],
  javascript: ['js', 'jsx', 'node'],
  python: ['py'],
  ruby: ['rb'],
  typescript: ['ts', 'tsx'],
  xml: ['html', 'svg'],
  yaml: ['yml'],
})

// ============================================================================
// Extension builder (exported for testing)
// ============================================================================

/**
 * Build the TipTap extension list for a given feature set.
 * Extracted as a pure function so it can be memoized with useMemo
 * and independently tested (catches duplicate-extension regressions).
 *
 * NOTE: StarterKit v3 bundles Underline by default — do NOT add it separately.
 */
export function buildExtensions(
  features: EditorFeatures,
  options: {
    placeholder: string
    onImageUpload?: (file: File) => Promise<string>
    onVideoUpload?: (file: File) => Promise<string>
    /** When set, Enter submits (chat-send) instead of splitting the block. */
    onSubmit?: () => void
  }
) {
  const { placeholder, onImageUpload, onVideoUpload, onSubmit } = options
  return [
    StarterKit.configure({
      heading: features.headings ? { levels: [1, 2, 3] } : false,
      codeBlock: false,
      blockquote: features.blockquotes ? {} : false,
      horizontalRule: features.dividers ? {} : false,
      link: false,
    }),
    Placeholder.configure({
      placeholder,
      emptyEditorClass: 'is-editor-empty',
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        class: 'text-primary underline',
      },
    }),
    // Always register so the schema can parse image nodes in existing content.
    // Width/height default to null (not the extension's 500×500, and not 0): a
    // stored post/changelog image that omitted dims must keep its natural box.
    // New inserts still get a measured box from `resizableImageInsertAttrs`.
    ResizableImage.extend({
      addAttributes() {
        const parent = this.parent?.() ?? {}
        const keepRatio = parent['data-keep-ratio']
        return {
          ...parent,
          width: { ...parent.width, default: null },
          height: { ...parent.height, default: null },
          'data-keep-ratio': {
            ...keepRatio,
            renderHTML(attributes: { width?: number | null; 'data-keep-ratio'?: boolean }) {
              if (!attributes['data-keep-ratio']) return {}
              const width = Number(attributes.width)
              if (Number.isFinite(width) && width > 0) {
                return { style: `max-width: ${width}px`, 'data-keep-ratio': 'true' }
              }
              return { 'data-keep-ratio': 'true' }
            },
          },
        }
      },
    }).configure({
      HTMLAttributes: {
        class: 'max-w-full h-auto rounded-lg',
      },
      allowBase64: false,
    }),
    // Always register so saved embed nodes round-trip in any editor; paste rules
    // only fire when quackbackEmbeds is enabled for this editor.
    QuackbackEmbed.configure({ enablePaste: !!features.quackbackEmbeds }),
    // Always register so legacy inline conversation images (the `chatImage` node
    // authored by the retired hand-rolled composers) still parse in the editor
    // schema and round-trip. New images author as resizableImage.
    ConversationImage,
    // Always register so previously saved native videos remain editable even
    // when uploads are disabled for the current viewer.
    UploadedVideo,
    ...(features.codeBlocks
      ? [
          CodeBlockLowlight.configure({
            lowlight,
            HTMLAttributes: {
              class: 'not-prose rounded-lg bg-muted p-4 overflow-x-auto',
            },
          }),
        ]
      : []),
    ...(features.taskLists
      ? [
          TaskList.configure({
            HTMLAttributes: {
              class: 'not-prose',
            },
          }),
          TaskItem.configure({
            nested: true,
            HTMLAttributes: {
              class: 'flex gap-2 items-start',
            },
          }),
        ]
      : []),
    ...(features.tables
      ? [
          Table.configure({
            resizable: true,
            HTMLAttributes: {
              class: 'not-prose border-collapse w-full',
            },
          }),
          TableRow,
          TableHeader.configure({
            HTMLAttributes: {
              class: 'border border-border bg-muted/50 p-2 text-left font-semibold',
            },
          }),
          TableCell.configure({
            HTMLAttributes: {
              class: 'border border-border p-2',
            },
          }),
        ]
      : []),
    ...(features.embeds
      ? [
          Youtube.configure({
            controls: true,
            nocookie: true,
            width: 640,
            height: 360,
            allowFullscreen: true,
            autoplay: false,
          }),
        ]
      : []),
    ...(features.slashMenu !== false
      ? [createSlashCommands(features, onImageUpload, onVideoUpload)]
      : []),
    ...(features.emojiPicker !== false ? [createEmojiExtension()] : []),
    // Enter-key bindings, highest precedence first. createSubmitOnEnter registers
    // at a higher priority than createEnterAsHardBreak (see the factory below), so
    // a consumer that passes onSubmit gets Enter-to-send even when the preset also
    // sets enterAsHardBreak — Enter submits, Shift+Enter breaks. Both yield to an
    // open slash/mention/emoji popover via hasActiveSuggestion.
    ...(onSubmit ? [createSubmitOnEnter(onSubmit)] : []),
    ...(features.enterAsHardBreak ? [createEnterAsHardBreak()] : []),
    // Registered unless mentions are explicitly disabled (undefined = enabled), so
    // every existing consumer keeps the `@` menu while visitor-facing composers can
    // drop it. Read-only surfaces render mention nodes via generateContentHTML,
    // which doesn't go through buildExtensions.
    ...(features.mentions !== false ? [MentionExtension] : []),
    Markdown,
  ]
}

// Single line break on Enter instead of TipTap's default paragraph split.
// Shift+Enter still splits the block via StarterKit's own binding so power
// users keep both affordances.
function createEnterAsHardBreak() {
  return Extension.create({
    name: 'enterAsHardBreak',
    addKeyboardShortcuts() {
      return {
        Enter: () => {
          // When the emoji picker, slash menu, or mention popover is open,
          // Enter belongs to the suggestion plugin. ProseMirror invokes keymap
          // handlers (this one) before suggestion handleKeyDown, so returning
          // false here lets the popover's onKeyDown pick the highlighted item
          // instead of inserting a hardBreak under the popover.
          if (hasActiveSuggestion(this.editor)) return false
          return this.editor.commands.first(({ commands }) => [
            () => commands.newlineInCode(),
            () => commands.splitListItem('listItem'),
            () => commands.splitListItem('taskItem'),
            () => commands.setHardBreak(),
          ])
        },
      }
    },
  })
}

// Enter submits (chat-send); Shift+Enter and Alt+Enter insert a line break.
// Registered at a priority above createEnterAsHardBreak and StarterKit (default
// 100) so, when a preset sets enterAsHardBreak while a consumer also passes
// onSubmit, Enter still submits rather than inserting a break. TipTap tries
// same-key bindings in descending priority order and stops at the first that
// returns true. ProseMirror runs keymap handlers before a suggestion popover's
// handleKeyDown, so an open slash/mention/emoji menu keeps Enter — we yield by
// returning false.
function createSubmitOnEnter(onSubmit: () => void) {
  return Extension.create({
    name: 'submitOnEnter',
    priority: 1000,
    addKeyboardShortcuts() {
      return {
        Enter: () => {
          if (hasActiveSuggestion(this.editor)) return false
          onSubmit()
          return true
        },
        'Mod-Enter': () => {
          if (hasActiveSuggestion(this.editor)) return false
          onSubmit()
          return true
        },
        'Shift-Enter': () => this.editor.commands.setHardBreak(),
        'Alt-Enter': () => this.editor.commands.setHardBreak(),
      }
    },
  })
}

// Suggestion-style plugins (emoji picker, slash menu, mention) keep
// `{ active: boolean, range, query, ... }` on their plugin state. We probe
// every plugin generically rather than importing each PluginKey because
// MentionExtension constructs an anonymous key per instance and isn't reachable
// from here. Non-object states are skipped — those are unrelated plugins.
/**
 * Stop Enter (and Shift+Enter) bubbling out of the editor so a parent <form>
 * cannot treat it as implicit submit. Cmd/Ctrl+Enter is left alone — comment
 * composers listen for that chord in capture on the wrapper. Returns false so
 * TipTap keymaps still insert the break / split the block / send (onSubmit).
 */
export function stopEnterFromReachingParentForm(event: KeyboardEvent): boolean {
  if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
    event.stopPropagation()
  }
  return false
}

export function hasActiveSuggestion(editor: Pick<Editor, 'state'>): boolean {
  for (const plugin of editor.state.plugins) {
    const state = plugin.getState(editor.state) as { active?: unknown } | null | undefined
    if (state && typeof state === 'object' && state.active === true) return true
  }
  return false
}

/**
 * Run a command against the editor only when it's live — guards both the
 * not-yet-created (null) and torn-down (isDestroyed) states. TipTap can recreate
 * or destroy the editor out from under an imperative ref (e.g. React StrictMode's
 * double-mount, or a call that lands after unmount during an async upload), and
 * chaining off a destroyed editor hits a null commandManager and throws.
 */
export function withLiveEditor(editor: Editor | null, run: (editor: Editor) => void): void {
  if (editor && !editor.isDestroyed) run(editor)
}

/**
 * Markdown for an edited document. Catch serializer failures so a custom
 * node can't prevent JSON from reaching the form — otherwise changelog create
 * submits an empty `content` string and the server rejects with
 * "Content is required" while the editor still shows a body.
 *
 * On throw, project plaintext from the current JSON (so the markdown
 * mirror matches this edit) and only then fall back to the last successful
 * serialization so comment composers that gate send on trim() don't go empty.
 */
export function markdownFromEditor(
  editor: { getMarkdown?: () => string },
  fallback = '',
  json?: unknown
): string {
  try {
    return editor.getMarkdown?.() ?? ''
  } catch {
    return plaintextFromTiptapJson(json) || fallback
  }
}

const PLAINTEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])

/** Text from a TipTap JSON doc, with newlines between blocks. Used when
 *  getMarkdown() throws so the markdown mirror still matches this edit. */
export function plaintextFromTiptapJson(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return ''

  const inlineText = (node: { type?: string; text?: string; content?: unknown[] }): string => {
    if (node.type === 'text') return node.text ?? ''
    if (node.type === 'hardBreak') return '\n'
    if (!Array.isArray(node.content)) return ''
    return node.content
      .map((child) => (child && typeof child === 'object' ? inlineText(child as typeof node) : ''))
      .join('')
  }

  const blocks: string[] = []
  const walk = (node: { type?: string; content?: unknown[] }) => {
    if (node.type && PLAINTEXT_BLOCKS.has(node.type)) {
      const text = inlineText(node).trim()
      if (text) blocks.push(text)
      return
    }
    if (!Array.isArray(node.content)) return
    for (const child of node.content) {
      if (child && typeof child === 'object') walk(child as typeof node)
    }
  }
  walk(doc as { type?: string; content?: unknown[] })
  return blocks.join('\n')
}

/**
 * The document after an edit, serialized on demand. Nothing is serialized
 * until a format is read, and each format at most once, so a host can keep the
 * latest document while it is written and serialize it once, when it is sent.
 * A later read still returns the document as it was at this edit.
 */
export interface EditorDocument {
  json(): JSONContent
  html(): string
  /** Markdown, with markdownFromEditor's fallbacks when the serializer throws. */
  markdown(): string
}

/**
 * An EditorDocument for the editor's current document. `markdownFallback` is
 * what markdownFromEditor falls back on; `onSerialize` hears the JSON and the
 * markdown the first time each is serialized.
 */
function editorDocument(
  editor: Pick<Editor, 'state' | 'schema' | 'markdown'>,
  {
    markdownFallback = () => '',
    onSerialize,
  }: {
    markdownFallback?: () => string
    onSerialize?: (format: 'json' | 'markdown', value: JSONContent | string) => void
  } = {}
): EditorDocument {
  // A ProseMirror document is immutable, so this one stays the edit's own.
  const { doc } = editor.state
  const { schema, markdown: markdownManager } = editor
  let json: JSONContent | undefined
  let html: string | undefined
  let markdown: string | undefined
  const snapshot: EditorDocument = {
    json() {
      if (json === undefined) {
        json = doc.toJSON() as JSONContent
        onSerialize?.('json', json)
      }
      return json
    },
    html() {
      html ??= getHTMLFromFragment(doc.content, schema)
      return html
    },
    markdown() {
      if (markdown === undefined) {
        const serializer = markdownManager
          ? { getMarkdown: () => markdownManager.serialize(snapshot.json()) }
          : {}
        markdown = markdownFromEditor(serializer, markdownFallback(), snapshot.json())
        onSerialize?.('markdown', markdown)
      }
      return markdown
    },
  }
  return snapshot
}

export function seedMarkdownFallback(
  value: string | JSONContent | undefined | null,
  editor?: { getMarkdown?: () => string }
): string {
  const fromValue = typeof value === 'string' ? value : plaintextFromTiptapJson(value)
  if (!editor) return fromValue
  try {
    return editor.getMarkdown?.() || fromValue
  } catch {
    return fromValue
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Feature flags for configuring which editor capabilities are enabled.
 * Basic features (bold, italic, lists, links) are always available.
 */
export interface EditorFeatures {
  /** Enable H1, H2, H3 heading buttons */
  headings?: boolean
  /** Enable image paste/drop/button with upload support */
  images?: boolean
  /** Enable native MP4/WebM/MOV/M4V upload and inline playback. */
  videos?: boolean
  /** Enable syntax-highlighted code blocks */
  codeBlocks?: boolean
  /** Enable floating bubble menu on text selection (default: true) */
  bubbleMenu?: boolean
  /** Enable slash "/" command menu for inserting blocks */
  slashMenu?: boolean
  /** Enable checklist/task lists */
  taskLists?: boolean
  /** Enable blockquotes */
  blockquotes?: boolean
  /** Enable table insertion */
  tables?: boolean
  /** Enable horizontal dividers */
  dividers?: boolean
  /** Enable YouTube/Figma/Loom embeds */
  embeds?: boolean
  /** Enable pasting Quackback post/changelog URLs as live embed cards.
   * Independent of `embeds` — the embed node is always in the schema (so saved
   * embeds render everywhere); this flag only turns on the paste-to-embed rule. */
  quackbackEmbeds?: boolean
  /** Enable `:` emoji picker (default: true). Uses TipTap's Unicode emoji
   * set; emojis are inserted as nodes and serialize to native Unicode
   * characters in markdown. */
  emojiPicker?: boolean
  /** Make plain Enter insert a hardBreak instead of splitting the block.
   * Shift+Enter still splits the paragraph via StarterKit's default
   * binding. Use this for chat-shaped editors (comments) and leave off
   * for document-shaped ones (posts, changelog) where paragraph-per-Enter
   * is the expected affordance. */
  enterAsHardBreak?: boolean
  /** Enable the `@` mention menu (default: true). Registered unless explicitly
   * false, so existing consumers keep mentions and saved mention nodes still
   * round-trip; disable for visitor-facing composers where there's nobody to
   * mention. */
  mentions?: boolean
}

// ============================================================================
// Slash Menu Types and Extension
// ============================================================================

interface SlashMenuItem {
  title: string
  description: string
  icon: React.ReactNode
  command: (props: { editor: Editor; range: Range }) => void
  aliases?: string[]
  group: 'text' | 'lists' | 'blocks' | 'advanced'
}

function getSlashMenuItems(
  features: EditorFeatures,
  onImageUpload?: (file: File) => Promise<string>,
  onVideoUpload?: (file: File) => Promise<string>
): SlashMenuItem[] {
  const items: SlashMenuItem[] = [
    // Text group - always available
    {
      title: 'Text',
      description: 'Plain paragraph text',
      icon: <Type className="size-4" />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setParagraph().run()
      },
      aliases: ['p', 'paragraph'],
      group: 'text',
    },
  ]

  // Headings - conditional
  if (features.headings) {
    items.push(
      {
        title: 'Heading 1',
        description: 'Large section heading',
        icon: <Heading1 className="size-4" />,
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run()
        },
        aliases: ['h1', '#'],
        group: 'text',
      },
      {
        title: 'Heading 2',
        description: 'Medium section heading',
        icon: <Heading2 className="size-4" />,
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run()
        },
        aliases: ['h2', '##'],
        group: 'text',
      },
      {
        title: 'Heading 3',
        description: 'Small section heading',
        icon: <Heading3 className="size-4" />,
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run()
        },
        aliases: ['h3', '###'],
        group: 'text',
      }
    )
  }

  // Lists - always available (part of StarterKit)
  items.push(
    {
      title: 'Bullet List',
      description: 'Unordered list',
      icon: <ListBulletIcon className="size-4" />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run()
      },
      aliases: ['ul', 'bullet', '-'],
      group: 'lists',
    },
    {
      title: 'Numbered List',
      description: 'Ordered list',
      icon: <ListOrdered className="size-4" />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run()
      },
      aliases: ['ol', 'numbered', '1.'],
      group: 'lists',
    }
  )

  // Task list - conditional
  if (features.taskLists) {
    items.push({
      title: 'Checklist',
      description: 'Task list with checkboxes',
      icon: <CheckSquare className="size-4" />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleTaskList().run()
      },
      aliases: ['todo', 'task', 'checklist', '[]'],
      group: 'lists',
    })
  }

  // Blockquote - conditional
  if (features.blockquotes) {
    items.push({
      title: 'Quote',
      description: 'Blockquote for citations',
      icon: <Quote className="size-4" />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run()
      },
      aliases: ['blockquote', 'quote', '>'],
      group: 'blocks',
    })
  }

  // Horizontal divider - conditional
  if (features.dividers) {
    items.push({
      title: 'Divider',
      description: 'Horizontal line separator',
      icon: <Minus className="size-4" />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHorizontalRule().run()
      },
      aliases: ['hr', 'divider', 'line', '---'],
      group: 'blocks',
    })
  }

  // Code blocks - conditional
  if (features.codeBlocks) {
    items.push({
      title: 'Code Block',
      description: 'Syntax highlighted code',
      icon: <Code2 className="size-4" />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
      },
      aliases: ['code', '```'],
      group: 'advanced',
    })
  }

  // Images - conditional
  if (features.images && onImageUpload) {
    items.push({
      title: 'Image',
      description: 'Upload an image',
      icon: <ImagePlus className="size-4" />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run()
        // Open file picker
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.onchange = async () => {
          const file = input.files?.[0]
          if (!file) return
          try {
            const src = await onImageUpload(file)
            editor.commands.setResizableImage(await resizableImageInsertAttrs(src, file))
          } catch (error) {
            console.error('Failed to upload image:', error)
            const { toast } = await import('sonner')
            toast.error("Couldn't upload image. Try again.")
          }
        }
        input.click()
      },
      aliases: ['img', 'picture'],
      group: 'advanced',
    })
  }

  if (features.videos && onVideoUpload) {
    items.push({
      title: 'Video',
      description: 'Upload an MP4, WebM, MOV, or M4V video',
      icon: <VideoIcon className="size-4" />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run()
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = VIDEO_FILE_ACCEPT
        input.onchange = async () => {
          const file = input.files?.[0]
          if (!file) return
          try {
            const src = await onVideoUpload(file)
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'video',
                attrs: {
                  src,
                  mimeType: resolveVideoMimeType(file.type, file.name) ?? file.type,
                  title: file.name,
                },
              })
              .run()
          } catch (error) {
            console.error('Failed to upload video:', error)
            const { toast } = await import('sonner')
            toast.error("Couldn't upload video. Try again.")
          }
        }
        input.click()
      },
      aliases: ['recording', 'mp4', 'webm', 'mov', 'm4v', 'quicktime'],
      group: 'advanced',
    })
  }

  // Table - conditional
  if (features.tables) {
    items.push({
      title: 'Table',
      description: 'Insert a table',
      icon: <TableIcon className="size-4" />,
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run()
      },
      aliases: ['table', '|--'],
      group: 'advanced',
    })
  }

  // YouTube embed - conditional
  if (features.embeds) {
    items.push({
      title: 'YouTube',
      description: 'Embed a YouTube video',
      icon: <YoutubeIcon className="size-4" />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run()
        const url = window.prompt('Paste YouTube video URL:')
        if (url && url.trim()) {
          editor.commands.setYoutubeVideo({
            src: url.trim(),
            width: 640,
            height: 360,
          })
        }
      },
      aliases: ['youtube', 'video', 'embed'],
      group: 'advanced',
    })
  }

  return items
}

// Filter items based on search query
function filterSlashItems(items: SlashMenuItem[], query: string): SlashMenuItem[] {
  const lowerQuery = query.toLowerCase()
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(lowerQuery) ||
      item.aliases?.some((alias) => alias.toLowerCase().includes(lowerQuery))
  )
}

// Group items by their group property
function groupSlashItems(items: SlashMenuItem[]): Record<string, SlashMenuItem[]> {
  return items.reduce(
    (acc, item) => {
      if (!acc[item.group]) {
        acc[item.group] = []
      }
      acc[item.group].push(item)
      return acc
    },
    {} as Record<string, SlashMenuItem[]>
  )
}

// Slash menu list component
interface SlashMenuListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface SlashMenuListProps {
  items: SlashMenuItem[]
  command: (item: SlashMenuItem) => void
  query?: string
}

export const SlashMenuList = forwardRef<SlashMenuListRef, SlashMenuListProps>(
  ({ items, command, query = '' }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const containerRef = useRef<HTMLDivElement>(null)
    const selectedRef = useRef(0)
    const itemsRef = useRef(items)
    const commandRef = useRef(command)
    itemsRef.current = items
    commandRef.current = command

    const selectItem = (index: number) => {
      const item = itemsRef.current[index]
      if (item) commandRef.current(item)
    }

    const updateSelected = (index: number) => {
      selectedRef.current = index
      setSelectedIndex(index)
    }

    // Scroll selected item into view
    const scrollToSelected = useCallback((index: number) => {
      const container = containerRef.current
      if (!container) return

      const buttons = container.querySelectorAll('button')
      const selectedButton = buttons[index]
      if (selectedButton) {
        selectedButton.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }, [])

    // Reset selection when items change
    useEffect(() => {
      updateSelected(0)
    }, [items])

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: ({ event }) =>
          applySuggestionListKey(event, {
            items: itemsRef.current,
            selected: selectedRef.current,
            onMove: (index) => {
              updateSelected(index)
              scrollToSelected(index)
            },
            onConfirm: (item) => commandRef.current(item),
          }),
      }),
      [scrollToSelected]
    )

    if (items.length === 0) {
      return (
        <div className="z-50 w-52 rounded-lg border bg-popover p-2 shadow-lg">
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            No matching commands
          </div>
        </div>
      )
    }

    const groupedItems = groupSlashItems(items)
    const groupLabels: Record<string, string> = {
      text: 'Text',
      lists: 'Lists',
      blocks: 'Blocks',
      advanced: 'Advanced',
    }

    // Calculate global index for selection tracking
    let globalIndex = -1

    return (
      <div
        className="z-50 w-52 rounded-lg border bg-popover shadow-lg"
        onWheel={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ScrollArea
          className="[&_[data-slot=scroll-area-viewport]]:max-h-64"
          scrollBarClassName="w-1.5"
        >
          <div ref={containerRef} className="p-0.5">
            {Object.entries(groupedItems).map(([group, groupItems]) => (
              <div key={group}>
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {groupLabels[group] || group}
                </div>
                {groupItems.map((item) => {
                  globalIndex++
                  const currentIndex = globalIndex
                  return (
                    <button
                      key={item.title}
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-xs',
                        'hover:bg-accent focus:bg-accent focus:outline-none',
                        currentIndex === selectedIndex && 'bg-accent'
                      )}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        selectItem(currentIndex)
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded border bg-background text-xs">
                        {item.icon}
                      </span>
                      <span className="truncate font-medium">
                        <HighlightQuery text={item.title} query={query} />
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    )
  }
)
SlashMenuList.displayName = 'SlashMenuList'

// Create the slash commands extension
function createSlashCommands(
  features: EditorFeatures,
  onImageUpload?: (file: File) => Promise<string>,
  onVideoUpload?: (file: File) => Promise<string>
) {
  // Compute once per extension instance. Since buildExtensions() is wrapped in
  // useMemo, this only re-runs when features or onImageUpload actually changes —
  // NOT on every keystroke.
  const allItems = getSlashMenuItems(features, onImageUpload, onVideoUpload)

  return Extension.create({
    name: 'slashCommands',

    addOptions() {
      return {
        suggestion: {
          char: '/',
          command: ({
            editor,
            range,
            props,
          }: {
            editor: Editor
            range: Range
            props: SlashMenuItem
          }) => {
            props.command({ editor, range })
          },
        } satisfies Omit<SuggestionOptions<SlashMenuItem>, 'editor'>,
      }
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion,
          allowedPrefixes: null, // Allow anywhere (null = no prefix required)
          items: ({ query }: { query: string }) => filterSlashItems(allItems, query),
          allow: ({ editor }: { editor: Editor }) => {
            // Don't allow in code blocks
            return !editor.isActive('codeBlock')
          },
          render: () => {
            let component: ReactRenderer<SlashMenuListRef> | null = null
            let floatingEl: HTMLDivElement | null = null
            const positioner = createSuggestionPositioner()

            return {
              onStart: (props: SuggestionProps<SlashMenuItem>) => {
                component = new ReactRenderer(SlashMenuList, {
                  props: {
                    items: props.items,
                    command: (item: SlashMenuItem) => props.command(item),
                    query: props.query,
                  },
                  editor: props.editor,
                })

                // Create container element
                floatingEl = createSuggestionPopup()
                floatingEl.appendChild(component.element)
                document.body.appendChild(floatingEl)

                positioner.attach(floatingEl, props.clientRect ?? null)
              },

              onUpdate: (props: SuggestionProps<SlashMenuItem>) => {
                component?.updateProps({
                  items: props.items,
                  command: (item: SlashMenuItem) => props.command(item),
                  query: props.query,
                })
                if (floatingEl) positioner.attach(floatingEl, props.clientRect ?? null)
              },

              onKeyDown: (props: { event: KeyboardEvent }) => {
                if (props.event.key === 'Escape') {
                  return true
                }

                return component?.ref?.onKeyDown(props) ?? false
              },

              onExit: () => {
                positioner.detach()
                if (floatingEl) {
                  floatingEl.remove()
                  floatingEl = null
                }
                component?.destroy()
              },
            }
          },
        }),
      ]
    },
  })
}

// ============================================================================
// Emoji Picker (`:` trigger)
// ============================================================================

interface EmojiSuggestionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface EmojiSuggestionListProps {
  items: EmojiItem[]
  command: (item: EmojiItem) => void
  /** Leading items that are recents (bare `:` only). 0 hides section labels. */
  recentCount?: number
  /** Typed text after `:`; highlighted Slack-style in each shortcode. */
  query?: string
}

function filterEmojiItems(
  query: string,
  { lookupEmoji, defaultEmojis }: Awaited<ReturnType<typeof loadEmojiData>>
): EmojiItem[] {
  return recommendEmojiItems(query, {
    recents: readRecentEmojis(),
    popularShortcodes: POPULAR_EMOJI_SHORTCODES,
    lookup: lookupEmoji,
    catalog: defaultEmojis,
    max: MAX_EMOJI_SUGGESTIONS,
  })
}

function rememberAndInsertEmoji(item: EmojiItem, command: (item: EmojiItem) => void): void {
  if (item.emoji) recordRecentEmoji(item.emoji)
  command(item)
}

function emojiSuggestionProps(props: SuggestionProps<EmojiItem>): EmojiSuggestionListProps {
  const recents = readRecentEmojis()
  let recentCount = 0
  if (!props.query.trim()) {
    for (const item of props.items) {
      if (item.emoji && recents.includes(item.emoji)) recentCount++
      else break
    }
  }
  return {
    items: props.items,
    command: (item: EmojiItem) => rememberAndInsertEmoji(item, props.command),
    recentCount,
    query: props.query,
  }
}

export const EmojiSuggestionList = forwardRef<EmojiSuggestionListRef, EmojiSuggestionListProps>(
  ({ items, command, recentCount = 0, query = '' }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const containerRef = useRef<HTMLDivElement>(null)
    const selectedRef = useRef(0)
    const itemsRef = useRef(items)
    const commandRef = useRef(command)
    itemsRef.current = items
    commandRef.current = command

    const selectItem = (index: number) => {
      const item = itemsRef.current[index]
      if (item) commandRef.current(item)
    }

    const updateSelected = (index: number) => {
      selectedRef.current = index
      setSelectedIndex(index)
    }

    const scrollToSelected = useCallback((index: number) => {
      const container = containerRef.current
      if (!container) return
      const buttons = container.querySelectorAll('button')
      const selectedButton = buttons[index]
      if (selectedButton) {
        selectedButton.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }, [])

    useEffect(() => {
      updateSelected(0)
    }, [items])

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: ({ event }) =>
          applySuggestionListKey(event, {
            items: itemsRef.current,
            selected: selectedRef.current,
            onMove: (index) => {
              updateSelected(index)
              scrollToSelected(index)
            },
            onConfirm: (item) => commandRef.current(item),
          }),
      }),
      [scrollToSelected]
    )

    if (items.length === 0) return null

    return (
      <div
        data-emoji-picker
        className="z-50 w-56 rounded-lg border bg-popover shadow-lg"
        onWheel={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div ref={containerRef} className="p-0.5">
          {items.map((item, index) => {
            const label = emojiSuggestionLabel(item, query)
            return (
              <div key={item.name}>
                {recentCount > 0 && index === 0 && (
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Recent</div>
                )}
                {recentCount > 0 && index === recentCount && (
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Popular</div>
                )}
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs',
                    'hover:bg-accent focus:bg-accent focus:outline-none',
                    index === selectedIndex && 'bg-accent'
                  )}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    selectItem(index)
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <span className="text-base leading-none">{item.emoji}</span>
                  <span className="truncate text-muted-foreground" data-emoji-shortcode={label}>
                    :<HighlightQuery text={label} query={query} />:
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }
)
EmojiSuggestionList.displayName = 'EmojiSuggestionList'

/** The `:`-triggered inline emoji picker, shared with the conversation composers so
 *  reply + note get the same emoji UX as posts. */
export function createEmojiExtension() {
  return EmojiNode.configure({
    enableEmoticons: true,
    suggestion: {
      items: async ({ query }) => filterEmojiItems(query, await loadEmojiData()),
      allow: ({ editor }) => !editor.isActive('codeBlock'),
      render: () => {
        let component: ReactRenderer<EmojiSuggestionListRef> | null = null
        let floatingEl: HTMLDivElement | null = null
        const positioner = createSuggestionPositioner()

        return {
          onStart: (props: SuggestionProps<EmojiItem>) => {
            if (props.items.length === 0) return
            component = new ReactRenderer(EmojiSuggestionList, {
              props: emojiSuggestionProps(props),
              editor: props.editor,
            })
            floatingEl = createSuggestionPopup()
            floatingEl.appendChild(component.element)
            document.body.appendChild(floatingEl)
            positioner.attach(floatingEl, props.clientRect ?? null)
          },
          onUpdate: (props: SuggestionProps<EmojiItem>) => {
            // No matches → tear down so a bare `:` doesn't leave a stale
            // dropdown floating.
            if (props.items.length === 0) {
              positioner.detach()
              if (floatingEl) {
                floatingEl.remove()
                floatingEl = null
              }
              component?.destroy()
              component = null
              return
            }
            if (!component) {
              component = new ReactRenderer(EmojiSuggestionList, {
                props: emojiSuggestionProps(props),
                editor: props.editor,
              })
              floatingEl = createSuggestionPopup()
              floatingEl.appendChild(component.element)
              document.body.appendChild(floatingEl)
            } else {
              component.updateProps(emojiSuggestionProps(props))
            }
            if (floatingEl) positioner.attach(floatingEl, props.clientRect ?? null)
          },
          onKeyDown: (props: { event: KeyboardEvent }) => {
            if (props.event.key === 'Escape') return true
            return component?.ref?.onKeyDown(props) ?? false
          },
          onExit: () => {
            positioner.detach()
            if (floatingEl) {
              floatingEl.remove()
              floatingEl = null
            }
            component?.destroy()
            component = null
          },
        }
      },
    },
  })
}

/**
 * The imperative seam a host uses to move focus into a mounted editor —
 * keyboard shortcuts that open a composer, "insert then keep typing" flows.
 * Exposed through `editorRef` so callers never reach for the ProseMirror DOM
 * node, whose class names are an editor internal.
 */
export interface RichTextEditorHandle {
  /** Focus the editing surface, placing the cursor at `position` (default 'end'). */
  focus: (position?: 'start' | 'end' | number) => void
  /** Empty the document in place. Unlike a key-remount clear, the ProseMirror
   * node survives, so focus never leaves the editing surface. */
  clear: () => void
}

interface RichTextEditorProps {
  value?: string | JSONContent
  /**
   * Called after every edit with the document, serialized only when read, so
   * a host pays for a format when it reads it: on send, after a pause, or for
   * a value it shows.
   */
  onDocumentChange?: (document: EditorDocument) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  minHeight?: string
  /** Stretch the writing surface to fill a flex parent (modal body). */
  fill?: boolean
  borderless?: boolean
  /** Where the formatting toolbar sits relative to the content area.
   * - 'top': classic bordered strip above the editor (filled, muted bg)
   * - 'bottom': quiet ghost icon row on a transparent background, sitting
   *   directly on the editor card below the content (no bordered strip)
   * - 'none': no fixed toolbar (bubble + slash menus only)
   * Defaults to 'bottom' for bordered editors and 'none' for borderless ones.
   * Both 'top' and 'bottom' render the SAME feature-gated button set. */
  toolbarPosition?: 'top' | 'none' | 'bottom'
  /** Where to place the cursor when the editor mounts ('end' is the common
   * choice for edit forms; default is no autofocus). */
  autofocus?: boolean | 'start' | 'end' | number
  /** Feature flags for enabling advanced features */
  features?: EditorFeatures
  /** Callback for uploading images. Returns the public URL of the uploaded image. */
  onImageUpload?: (file: File) => Promise<string>
  /** Callback for uploading an MP4/WebM/MOV/M4V recording. */
  onVideoUpload?: (file: File) => Promise<string>
  /** When set, Enter submits (chat-send) instead of splitting the block and
   * Shift+Enter / Alt+Enter insert a line break. Yields to an open
   * slash/mention/emoji popover. MUST be a stable callback (wrap churning state
   * in a ref): the keymap closure is baked in at editor creation and is NOT
   * refreshed by setOptions, so an unstable callback leaves Enter firing the
   * first render's stale closure forever. */
  onSubmit?: () => void
  /** Publishes the imperative focus seam. Mutually exclusive editors may share
   * one ref object: whichever instance is mounted owns it. */
  editorRef?: React.RefObject<RichTextEditorHandle | null>
}

// ============================================================================
// Editor Component
// ============================================================================

function RichTextEditorBase({
  value,
  onDocumentChange,
  placeholder = 'Write something...',
  className,
  disabled = false,
  minHeight = '120px',
  fill = false,
  borderless = false,
  toolbarPosition = borderless ? 'none' : 'bottom',
  autofocus = false,
  features = {},
  onImageUpload,
  onVideoUpload,
  onSubmit,
  editorRef,
}: RichTextEditorProps) {
  // Memoize extensions keyed on individual feature flags.
  // TipTap v3's useEditor calls editor.setOptions() whenever the extensions
  // array reference changes (uses reference equality via compareOptions).
  // Rebuilding the array on every render causes setOptions→transaction→onUpdate
  // on every keystroke, resulting in 300–400 ms input violations.
  const extensions = useMemo(
    () => buildExtensions(features, { placeholder, onImageUpload, onVideoUpload, onSubmit }),

    [
      features.headings,
      features.codeBlocks,
      features.blockquotes,
      features.dividers,
      features.images,
      features.videos,
      features.taskLists,
      features.tables,
      features.embeds,
      features.quackbackEmbeds,
      features.slashMenu,
      features.emojiPicker,
      features.enterAsHardBreak,
      features.mentions,
      onImageUpload,
      onVideoUpload,
      onSubmit,
      placeholder,
    ]
  )

  // Memoize editorProps for the same reason — handleDrop/handlePaste are
  // closures over onImageUpload and would change reference every render.
  const editorProps = useMemo(
    () => ({
      attributes: {
        class: cn(
          'prose prose-sm prose-neutral dark:prose-invert max-w-none focus:outline-none',
          'min-h-[var(--editor-min-height)]',
          borderless ? 'py-0' : 'px-3 py-2'
        ),
        style: `--editor-min-height: ${minHeight}`,
      },
      handleDrop:
        (features.images && onImageUpload) || (features.videos && onVideoUpload)
          ? handleMediaDrop(
              features.images ? onImageUpload : undefined,
              features.videos ? onVideoUpload : undefined
            )
          : undefined,
      handlePaste:
        (features.images && onImageUpload) || (features.videos && onVideoUpload)
          ? handleMediaPaste(
              features.images ? onImageUpload : undefined,
              features.videos ? onVideoUpload : undefined
            )
          : undefined,
      handleDOMEvents: {
        keydown: (_view: import('@tiptap/pm/view').EditorView, event: KeyboardEvent) =>
          stopEnterFromReachingParentForm(event),
      },
    }),

    [features.images, features.videos, onImageUpload, onVideoUpload, borderless, minHeight]
  )

  // Stores the last JSON emitted by onUpdate so the value-sync useEffect can
  // skip the redundant setContent when the value prop is the same object we
  // just emitted. Using the object reference (not a boolean flag) avoids the
  // edge case where a batched external reset (e.g. collapseForm → null) would
  // be incorrectly skipped by a stale boolean flag.
  const lastEmittedJsonRef = useRef<unknown>(null)
  // Parallel guard for string-shaped callers (markdown). When the form's
  // `value` is the markdown we just serialized, skip the sync so we don't
  // bulldoze the user's typing — e.g. `# ` produces an empty heading whose
  // markdown serialization is "", which without this guard would round-trip
  // back through clearContent() and erase the heading they just created.
  const lastEmittedMarkdownRef = useRef<string | null>(null)
  // Last markdown that actually serialized. Distinct from the sync sentinel
  // above, which is cleared after a controlled-value round trip; comment
  // composers need this if a later getMarkdown() throw would otherwise emit ''.
  const lastSuccessfulMarkdownRef = useRef(seedMarkdownFallback(value))
  // The latest edit's document. Only its reads count as what the editor
  // emitted, for the guards above; a host reading an older document later (on
  // send) changes nothing.
  const latestDocumentRef = useRef<EditorDocument | null>(null)

  // Stable initial content reference — passed once to useEditor so TipTap v3's
  // compareOptions never sees a reference change on `content` and never calls
  // setOptions on re-renders. Subsequent value changes are handled by the
  // useEffect below (value sync).
  const initialContentRef = useRef(value ?? '')

  const editor = useEditor({
    immediatelyRender: false,
    // When no toolbar is visible (borderless/widget), skip re-renders on every
    // ProseMirror transaction for a significant perf win. When the toolbar IS
    // shown, we need re-renders so MenuBar's active-state indicators stay current.
    shouldRerenderOnTransaction: toolbarPosition === 'none' ? false : undefined,
    extensions,
    content: initialContentRef.current,
    autofocus,
    editable: !disabled,
    onCreate: ({ editor }) => {
      lastSuccessfulMarkdownRef.current = seedMarkdownFallback(initialContentRef.current, editor)
    },
    onUpdate: ({ editor }) => {
      if (!onDocumentChange) return
      const edited = editorDocument(editor, {
        markdownFallback: () => lastSuccessfulMarkdownRef.current,
        onSerialize: (format, serialized) => {
          if (latestDocumentRef.current !== edited) return
          if (format === 'json') {
            lastEmittedJsonRef.current = serialized
          } else {
            lastEmittedMarkdownRef.current = serialized as string
            lastSuccessfulMarkdownRef.current = serialized as string
          }
        },
      })
      latestDocumentRef.current = edited
      lastEmittedJsonRef.current = null
      lastEmittedMarkdownRef.current = null
      onDocumentChange(edited)
    },
    editorProps,
  })

  // The imperative focus seam. `withLiveEditor` guards the window where the
  // editor is still null or already torn down, so a stale host reference can
  // never chain off a destroyed editor.
  useImperativeHandle(
    editorRef,
    () => ({
      focus: (position: 'start' | 'end' | number = 'end') =>
        withLiveEditor(editor, (live) => live.commands.focus(position)),
      clear: () => withLiveEditor(editor, (live) => live.commands.clearContent()),
    }),
    [editor]
  )

  // The editor instance the value-sync below last ran for.
  const syncedEditorRef = useRef<Editor | null>(null)

  // Sync external value changes into the editor.
  // Skipped when the value is the exact object/string we just emitted via onUpdate.
  useEffect(() => {
    if (!editor) return

    // A new editor was created from this very value. Applying it again would
    // only re-normalize the document (the trailing paragraph, attribute
    // defaults), leave a step to undo and hand the host an update it did not
    // cause.
    const firstSync = syncedEditorRef.current !== editor
    syncedEditorRef.current = editor
    if (firstSync && value === initialContentRef.current) return

    if (value === lastEmittedJsonRef.current) {
      lastEmittedJsonRef.current = null
      return
    }
    lastEmittedJsonRef.current = null

    if (typeof value === 'string') {
      // The string path is for markdown-shaped callers (react-hook-form
      // tracking a markdown field). If the form's value matches the markdown
      // we just emitted, the user is the source of truth - don't bulldoze
      // their doc. This matters for transient states like an empty heading
      // (`# ` then nothing typed yet) where the markdown serializes to "".
      if (value === lastEmittedMarkdownRef.current) {
        lastEmittedMarkdownRef.current = null
        return
      }
      lastEmittedMarkdownRef.current = null
      if (value === '' && !editor.isEmpty) {
        editor.commands.clearContent()
      }
      return
    }

    if (value === undefined) {
      if (!editor.isEmpty) editor.commands.clearContent()
      return
    }

    if (typeof value === 'object') {
      const currentContent = JSON.stringify(editor.getJSON())
      const newContent = JSON.stringify(value)
      if (currentContent !== newContent) {
        editor.commands.setContent(value)
      }
    }
  }, [value, editor])

  // Update editable state. Editability is not a change to the document, so
  // it emits no update (which would reach the host as an onDocumentChange).
  useEffect(() => {
    if (editor && editor.isEditable !== !disabled) {
      editor.setEditable(!disabled, false)
    }
  }, [disabled, editor])

  if (!editor) {
    // Reserve the editor's eventual size, toolbar row included, so the
    // surrounding layout doesn't jump when TipTap finishes mounting. Keeping
    // immediatelyRender=false preserves SSR safety.
    return (
      <RichTextEditorEmptyState
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        minHeight={minHeight}
        fill={fill}
        borderless={borderless}
        toolbarPosition={toolbarPosition}
        aria-hidden="true"
      />
    )
  }

  return (
    <EditorChrome
      editor={editor}
      className={className}
      disabled={disabled}
      fill={fill}
      borderless={borderless}
      toolbarPosition={toolbarPosition}
      features={features}
      onImageUpload={onImageUpload}
      onVideoUpload={onVideoUpload}
    />
  )
}

// Held at module scope: TipTap's BubbleMenu dispatches a transaction to update
// its plugin whenever `options` or `shouldShow` changes identity.
const BUBBLE_MENU_OPTIONS = { strategy: 'fixed', placement: 'top' } as const

const showFormattingBubble: BubbleMenuProps['shouldShow'] = ({ editor, state }) => {
  // Don't show in code blocks or tables
  if (editor.isActive('codeBlock')) return false
  if (editor.isActive('table')) return false
  // Only show when text is selected
  const { from, to } = state.selection
  return from !== to
}

const showTableBubble: BubbleMenuProps['shouldShow'] = ({ editor }) => editor.isActive('table')

const showImageBubble: BubbleMenuProps['shouldShow'] = ({ editor }) =>
  editor.isActive('resizableImage')

interface EditorChromeProps {
  editor: Editor
  className?: string
  disabled: boolean
  fill: boolean
  borderless: boolean
  toolbarPosition: 'top' | 'none' | 'bottom'
  features: EditorFeatures
  onImageUpload?: (file: File) => Promise<string>
  onVideoUpload?: (file: File) => Promise<string>
}

/**
 * The writing surface and everything around it: the toolbar, the bubble menus
 * and the image context menu. None of it takes the document as a prop, so a
 * controlled host that re-renders on every keystroke (a new value and often a
 * new onDocumentChange) stops at RichTextEditorBase. The toolbar and menus follow the
 * selection through their own useEditorState subscriptions instead.
 */
const EditorChrome = memo(function EditorChrome({
  editor,
  className,
  disabled,
  fill,
  borderless,
  toolbarPosition,
  features,
  onImageUpload,
  onVideoUpload,
}: EditorChromeProps) {
  // Image context menu state - stores the src of the right-clicked image
  const [contextMenuImageSrc, setContextMenuImageSrc] = useState<string | null>(null)

  // Handle right-click - check if it's on an image and store the src
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!features.images) {
        setContextMenuImageSrc(null)
        return
      }

      // Check if right-clicked on an image
      const target = e.target as HTMLElement
      const imageWrapper = target.closest('.resizable-image-wrapper')
      const img = imageWrapper?.querySelector('img') || (target.tagName === 'IMG' ? target : null)

      if (img && img instanceof HTMLImageElement) {
        setContextMenuImageSrc(img.src)
      } else {
        // Not an image - prevent Radix context menu from opening
        setContextMenuImageSrc(null)
      }
    },
    [features.images]
  )

  // Use shared image actions hook for context menu
  const contextMenuActions = useImageActions({
    src: contextMenuImageSrc ?? undefined,
    editor,
  })

  // Ref for finding the nearest dialog content to append bubble menus to.
  // Appending to the dialog (instead of document.body) keeps the menu inside
  // Radix's focus-trap so clicks still work, while escaping ScrollArea overflow.
  const containerRef = useRef<HTMLDivElement>(null)
  const getBubbleMenuContainer = useCallback(() => {
    const dialogContent = containerRef.current?.closest<HTMLElement>('[data-slot="dialog-content"]')
    return dialogContent ?? document.body
  }, [])
  const bubbleMenuRef = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      el.style.zIndex = '99'
      el.style.overflow = 'visible'
    }
  }, [])

  return (
    <ContextMenu>
      {/* No `disabled` here: Base UI disables pointer events for the whole
          trigger subtree, which would make the editor itself unclickable.
          The image menu can't open without images anyway — handleContextMenu
          clears the src unless features.images is on. */}
      <ContextMenuTrigger asChild>
        <div
          ref={containerRef}
          className={cn(
            !borderless && 'overflow-hidden rounded-md border border-input bg-background',
            disabled && 'opacity-50 cursor-not-allowed',
            fill && 'flex h-full min-h-0 flex-col',
            className
          )}
          onContextMenu={handleContextMenu}
        >
          {toolbarPosition === 'top' && (
            <MenuBar
              editor={editor}
              disabled={disabled}
              features={features}
              onImageUpload={onImageUpload}
              onVideoUpload={onVideoUpload}
              variant="top"
            />
          )}

          <EditorContent
            editor={editor}
            className={cn(fill && 'min-h-0 flex-1 overflow-y-auto [&_.tiptap]:min-h-full')}
          />

          {toolbarPosition === 'bottom' && (
            <MenuBar
              editor={editor}
              disabled={disabled}
              features={features}
              onImageUpload={onImageUpload}
              onVideoUpload={onVideoUpload}
              variant="bottom"
              borderless={borderless}
            />
          )}
        </div>
      </ContextMenuTrigger>

      {contextMenuImageSrc && (
        <ContextMenuContent className="min-w-[180px]">
          <ContextMenuItem onClick={contextMenuActions.viewImage}>
            <Expand className="mr-3 size-4 text-muted-foreground" />
            View image
          </ContextMenuItem>
          <ContextMenuItem onClick={contextMenuActions.downloadImage}>
            <Download className="mr-3 size-4 text-muted-foreground" />
            Download
          </ContextMenuItem>
          <ContextMenuItem onClick={contextMenuActions.copyImage}>
            <Copy className="mr-3 size-4 text-muted-foreground" />
            Copy to clipboard
          </ContextMenuItem>
          <ContextMenuItem onClick={contextMenuActions.copyLink}>
            <Link2 className="mr-3 size-4 text-muted-foreground" />
            Copy link
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={contextMenuActions.deleteImage}>
            <Trash2 className="mr-3 size-4 text-muted-foreground" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      )}

      {features.bubbleMenu !== false && (
        <BubbleMenu
          editor={editor}
          appendTo={getBubbleMenuContainer}
          ref={bubbleMenuRef}
          options={BUBBLE_MENU_OPTIONS}
          shouldShow={showFormattingBubble}
        >
          <BubbleMenuContent editor={editor} disabled={disabled} />
        </BubbleMenu>
      )}

      {features.tables && (
        <BubbleMenu
          editor={editor}
          appendTo={getBubbleMenuContainer}
          ref={bubbleMenuRef}
          options={BUBBLE_MENU_OPTIONS}
          shouldShow={showTableBubble}
        >
          <TableToolbar editor={editor} disabled={disabled} />
        </BubbleMenu>
      )}

      {features.images && (
        <BubbleMenu
          editor={editor}
          appendTo={getBubbleMenuContainer}
          ref={bubbleMenuRef}
          options={BUBBLE_MENU_OPTIONS}
          shouldShow={showImageBubble}
        >
          <ImageToolbar editor={editor} disabled={disabled} />
        </BubbleMenu>
      )}
    </ContextMenu>
  )
}, sameChromeProps)

function sameChromeProps(prev: EditorChromeProps, next: EditorChromeProps): boolean {
  return (
    prev.editor === next.editor &&
    prev.className === next.className &&
    prev.disabled === next.disabled &&
    prev.fill === next.fill &&
    prev.borderless === next.borderless &&
    prev.toolbarPosition === next.toolbarPosition &&
    prev.onImageUpload === next.onImageUpload &&
    prev.onVideoUpload === next.onVideoUpload &&
    sameFeatures(prev.features, next.features)
  )
}

// Every feature flag, so a comparison can never miss one added later.
const FEATURE_FLAGS: Record<keyof EditorFeatures, true> = {
  headings: true,
  images: true,
  videos: true,
  codeBlocks: true,
  bubbleMenu: true,
  slashMenu: true,
  taskLists: true,
  blockquotes: true,
  tables: true,
  dividers: true,
  embeds: true,
  quackbackEmbeds: true,
  emojiPicker: true,
  enterAsHardBreak: true,
  mentions: true,
}
const FEATURE_KEYS = Object.keys(FEATURE_FLAGS) as (keyof EditorFeatures)[]

/** Feature sets compared flag by flag, so callers may pass inline objects. */
function sameFeatures(prev: EditorFeatures = {}, next: EditorFeatures = {}): boolean {
  return FEATURE_KEYS.every((key) => prev[key] === next[key])
}

// Skip re-render when individual feature flags and all other props are unchanged.
// Compares features by primitive values rather than object reference so callers
// can safely pass inline objects without triggering unnecessary editor rebuilds.
export const RichTextEditor = memo(RichTextEditorBase, (prev, next) => {
  if (
    prev.value !== next.value ||
    prev.onDocumentChange !== next.onDocumentChange ||
    prev.onImageUpload !== next.onImageUpload ||
    prev.onVideoUpload !== next.onVideoUpload ||
    prev.onSubmit !== next.onSubmit ||
    prev.disabled !== next.disabled ||
    prev.placeholder !== next.placeholder ||
    prev.minHeight !== next.minHeight ||
    prev.fill !== next.fill ||
    prev.borderless !== next.borderless ||
    prev.toolbarPosition !== next.toolbarPosition ||
    prev.className !== next.className ||
    prev.editorRef !== next.editorRef
  )
    return false
  return sameFeatures(prev.features, next.features)
})

// ============================================================================
// Uploaded media handling
// ============================================================================

type EditorMediaKind = 'image' | 'video'

/**
 * Resolve a dropped or pasted file through the same rules as the media picker.
 * Some desktop browsers leave QuickTime/M4V MIME types empty (or use
 * application/octet-stream), so video detection must also consider the file
 * extension instead of relying on `type.startsWith('video/')` alone.
 */
export function resolveEditorMediaKind(
  file: Pick<File, 'name' | 'type'>,
  allowImage: boolean,
  allowVideo: boolean
): EditorMediaKind | null {
  if (allowImage && file.type.startsWith('image/')) return 'image'
  if (allowVideo && resolveVideoMimeType(file.type, file.name)) return 'video'
  return null
}

/**
 * Handle image/video drop events in the editor.
 */
function handleMediaDrop(
  onImageUpload?: (file: File) => Promise<string>,
  onVideoUpload?: (file: File) => Promise<string>
): (
  view: import('@tiptap/pm/view').EditorView,
  event: DragEvent,
  slice: unknown,
  moved: boolean
) => boolean {
  return (view, event, _slice, moved) => {
    if (moved || !event.dataTransfer?.files?.length) {
      return false
    }

    const files = Array.from(event.dataTransfer.files)
      .map((file) => ({
        file,
        kind: resolveEditorMediaKind(file, !!onImageUpload, !!onVideoUpload),
      }))
      .filter((entry): entry is { file: File; kind: EditorMediaKind } => entry.kind !== null)

    if (files.length === 0) {
      return false
    }

    event.preventDefault()

    const { schema } = view.state
    const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY })

    files.forEach(({ file, kind }) => {
      const isVideo = kind === 'video'
      const upload = isVideo ? onVideoUpload : onImageUpload
      if (!upload) return
      upload(file)
        .then(async (src) => {
          const nodeType = isVideo
            ? schema.nodes.video
            : schema.nodes.resizableImage || schema.nodes.image
          const attrs = isVideo
            ? {
                src,
                mimeType: resolveVideoMimeType(file.type, file.name) ?? file.type,
                title: file.name,
              }
            : await resizableImageInsertAttrs(src, file)
          const node = nodeType?.create(attrs)
          if (node && coordinates) {
            const transaction = view.state.tr.insert(coordinates.pos, node)
            view.dispatch(transaction)
          }
        })
        .catch((err) => {
          console.error('[RichTextEditor] Media drop upload failed:', err)
          void import('sonner').then(({ toast }) =>
            toast.error(`Couldn't upload ${isVideo ? 'video' : 'image'}. Try again.`)
          )
        })
    })

    return true
  }
}

/**
 * Handle image/video paste events in the editor.
 */
function handleMediaPaste(
  onImageUpload?: (file: File) => Promise<string>,
  onVideoUpload?: (file: File) => Promise<string>
): (view: import('@tiptap/pm/view').EditorView, event: ClipboardEvent, slice: unknown) => boolean {
  return (view, event) => {
    const media = Array.from(event.clipboardData?.items ?? [])
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
      .map((file) => ({
        file,
        kind: resolveEditorMediaKind(file, !!onImageUpload, !!onVideoUpload),
      }))
      .filter((entry): entry is { file: File; kind: EditorMediaKind } => entry.kind !== null)

    if (media.length === 0) {
      return false
    }

    event.preventDefault()

    media.forEach(({ file, kind }) => {
      const isVideo = kind === 'video'
      const upload = isVideo ? onVideoUpload : onImageUpload
      if (!upload) return

      upload(file)
        .then(async (src) => {
          const { schema } = view.state
          const nodeType = isVideo
            ? schema.nodes.video
            : schema.nodes.resizableImage || schema.nodes.image
          const attrs = isVideo
            ? {
                src,
                mimeType: resolveVideoMimeType(file.type, file.name) ?? file.type,
                title: file.name,
              }
            : await resizableImageInsertAttrs(src, file)
          const node = nodeType?.create(attrs)
          if (node) {
            const transaction = view.state.tr.replaceSelectionWith(node)
            view.dispatch(transaction)
          }
        })
        .catch((err) => {
          console.error('[RichTextEditor] Media paste upload failed:', err)
          void import('sonner').then(({ toast }) =>
            toast.error(`Couldn't upload ${isVideo ? 'video' : 'image'}. Try again.`)
          )
        })
    })

    return true
  }
}

// ============================================================================
// Toolbar Components
// ============================================================================

interface ToolbarButtonProps {
  /** Drawn at size-4. A component rather than an element, so a memoized
   * button can compare it across renders. */
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
  disabled: boolean
  isActive?: boolean
  title?: string
  'aria-label'?: string
  /** 'quiet' renders a muted ghost icon on a transparent background (for the
   * bottom toolbar); 'default' keeps the filled active-state look. */
  variant?: 'default' | 'quiet'
}

/**
 * Memoized: a toolbar re-renders when any state it shows changes, and with
 * stable onClick handlers only the buttons whose own state changed follow it.
 */
const ToolbarButton = memo(function ToolbarButton({
  icon: Icon,
  onClick,
  disabled,
  isActive,
  title,
  'aria-label': ariaLabel,
  variant = 'default',
}: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        'h-7 w-7 p-0',
        variant === 'quiet'
          ? cn(
              'text-muted-foreground/60 hover:text-foreground',
              isActive && 'bg-muted/60 text-foreground'
            )
          : isActive && 'bg-muted'
      )}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel || title}
    >
      <Icon className="size-4" />
    </Button>
  )
})

function ToolbarDivider() {
  return <div className="w-px h-4 bg-border mx-1" />
}

// ============================================================================
// Bubble Menu Components
// ============================================================================

interface BubbleMenuContentProps {
  editor: Editor
  disabled: boolean
}

const selectBubbleMarks = ({ editor: e }: { editor: Editor }) => ({
  bold: e.isActive('bold'),
  italic: e.isActive('italic'),
  underline: e.isActive('underline'),
  strike: e.isActive('strike'),
  code: e.isActive('code'),
  link: e.isActive('link'),
})

/**
 * The toolbar and bubble menu commands, created once per editor so the
 * memoized buttons that run them keep the same onClick across renders.
 */
function useToolbarCommands(editor: Editor) {
  return useMemo(
    () => ({
      bold: () => editor.chain().focus().toggleBold().run(),
      italic: () => editor.chain().focus().toggleItalic().run(),
      underline: () => editor.chain().focus().toggleUnderline().run(),
      strike: () => editor.chain().focus().toggleStrike().run(),
      code: () => editor.chain().focus().toggleCode().run(),
      heading1: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      heading2: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      heading3: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      bulletList: () => editor.chain().focus().toggleBulletList().run(),
      orderedList: () => editor.chain().focus().toggleOrderedList().run(),
      codeBlock: () => editor.chain().focus().toggleCodeBlock().run(),
      undo: () => editor.chain().focus().undo().run(),
      redo: () => editor.chain().focus().redo().run(),
    }),
    [editor]
  )
}

function BubbleMenuContent({ editor, disabled }: BubbleMenuContentProps) {
  // Same subscription as MenuBar: re-renders only when a mark it shows flips.
  const active = useEditorState({ editor, selector: selectBubbleMarks })
  const commands = useToolbarCommands(editor)
  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-md">
      <ToolbarButton
        icon={Bold}
        onClick={commands.bold}
        disabled={disabled}
        isActive={active.bold}
        title="Bold (Cmd+B)"
      />
      <ToolbarButton
        icon={Italic}
        onClick={commands.italic}
        disabled={disabled}
        isActive={active.italic}
        title="Italic (Cmd+I)"
      />
      <ToolbarButton
        icon={UnderlineIcon}
        onClick={commands.underline}
        disabled={disabled}
        isActive={active.underline}
        title="Underline (Cmd+U)"
      />
      <ToolbarButton
        icon={Strikethrough}
        onClick={commands.strike}
        disabled={disabled}
        isActive={active.strike}
        title="Strikethrough (Cmd+Shift+S)"
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={Code}
        onClick={commands.code}
        disabled={disabled}
        isActive={active.code}
        title="Inline Code (Cmd+E)"
      />
      <LinkButton editor={editor} disabled={disabled} isActive={active.link} />
      <ToolbarDivider />
      <HeadingDropdown editor={editor} disabled={disabled} />
    </div>
  )
}

function LinkButton({
  editor,
  disabled,
  isActive,
}: {
  editor: Editor
  disabled: boolean
  isActive: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [url, setUrl] = useState('')

  const applyLink = () => {
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      const finalUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`
      editor.chain().focus().extendMarkRange('link').setLink({ href: finalUrl }).run()
    }
    setIsOpen(false)
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-7 w-7 p-0', isActive && 'bg-muted')}
          disabled={disabled}
          onClick={() => {
            setUrl((editor.getAttributes('link').href as string | undefined) || '')
            setIsOpen(true)
          }}
          title="Insert Link"
        >
          <LinkIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start" side="top" sideOffset={8}>
        <div className="flex gap-2">
          <Input
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyLink()
              }
            }}
            className="h-8 text-sm"
            autoFocus
          />
          <Button size="sm" className="h-8" onClick={applyLink}>
            {isActive ? 'Update' : 'Add'}
          </Button>
        </div>
        {isActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full text-destructive hover:text-destructive"
            onClick={() => {
              editor.chain().focus().extendMarkRange('link').unsetLink().run()
              setIsOpen(false)
            }}
          >
            Remove link
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** The block type under the selection, as the bubble menu names it. */
const selectBlockType = ({ editor: e }: { editor: Editor }) => {
  if (e.isActive('heading', { level: 1 })) return 'H1'
  if (e.isActive('heading', { level: 2 })) return 'H2'
  if (e.isActive('heading', { level: 3 })) return 'H3'
  return 'Text'
}

function HeadingDropdown({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const currentType = useEditorState({ editor, selector: selectBlockType })

  const blockTypes = [
    { label: 'Text', value: 'paragraph', icon: <Type className="size-4" /> },
    { label: 'Heading 1', value: 'h1', icon: <Heading1 className="size-4" /> },
    { label: 'Heading 2', value: 'h2', icon: <Heading2 className="size-4" /> },
    { label: 'Heading 3', value: 'h3', icon: <Heading3 className="size-4" /> },
  ]

  const handleSelect = (value: string) => {
    switch (value) {
      case 'paragraph':
        editor.chain().focus().setParagraph().run()
        break
      case 'h1':
        editor.chain().focus().toggleHeading({ level: 1 }).run()
        break
      case 'h2':
        editor.chain().focus().toggleHeading({ level: 2 }).run()
        break
      case 'h3':
        editor.chain().focus().toggleHeading({ level: 3 }).run()
        break
    }
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 gap-1 text-xs font-medium"
          disabled={disabled}
        >
          {currentType}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={8}
        avoidCollisions={false}
        disablePortal
      >
        {blockTypes.map((type) => (
          <DropdownMenuItem
            key={type.value}
            onClick={() => handleSelect(type.value)}
            className="gap-2"
          >
            {type.icon}
            {type.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface TableToolbarProps {
  editor: Editor
  disabled: boolean
}

function TableToolbar({ editor, disabled }: TableToolbarProps) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-md">
      {/* Add row above */}
      <ToolbarButton
        icon={ArrowUp}
        onClick={() => editor.chain().focus().addRowBefore().run()}
        disabled={disabled}
        title="Add row above"
      />
      {/* Add row below */}
      <ToolbarButton
        icon={ArrowDown}
        onClick={() => editor.chain().focus().addRowAfter().run()}
        disabled={disabled}
        title="Add row below"
      />
      <ToolbarDivider />
      {/* Add column left */}
      <ToolbarButton
        icon={ArrowLeft}
        onClick={() => editor.chain().focus().addColumnBefore().run()}
        disabled={disabled}
        title="Add column left"
      />
      {/* Add column right */}
      <ToolbarButton
        icon={ArrowRight}
        onClick={() => editor.chain().focus().addColumnAfter().run()}
        disabled={disabled}
        title="Add column right"
      />
      <ToolbarDivider />
      {/* Delete row */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 gap-1 text-xs font-medium text-destructive hover:text-destructive"
            disabled={disabled}
          >
            <Trash2 className="size-4" />
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" sideOffset={8}>
          <DropdownMenuItem
            onClick={() => editor.chain().focus().deleteRow().run()}
            className="gap-2"
          >
            Delete row
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => editor.chain().focus().deleteColumn().run()}
            className="gap-2"
          >
            Delete column
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => editor.chain().focus().deleteTable().run()}
            className="gap-2 text-destructive focus:text-destructive"
          >
            Delete table
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ============================================================================
// Shared Image Actions Hook (DRY - used by toolbar and context menu)
// ============================================================================

interface UseImageActionsProps {
  src: string | undefined
  editor: Editor | null
  onComplete?: () => void
}

function useImageActions({ src, editor, onComplete }: UseImageActionsProps) {
  const viewImage = useCallback(() => {
    if (src) {
      window.open(src, '_blank')
    }
    onComplete?.()
  }, [src, onComplete])

  const downloadImage = useCallback(async () => {
    if (!src) return
    try {
      const response = await fetch(src)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = src.split('/').pop() || 'image'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      window.open(src, '_blank')
    }
    onComplete?.()
  }, [src, onComplete])

  const copyImage = useCallback(async () => {
    if (!src) return
    try {
      const response = await fetch(src)
      const blob = await response.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    } catch {
      // Fallback: copy URL (may be blocked in sandboxed iframes — swallow)
      navigator.clipboard.writeText(src).catch(() => {})
    }
    onComplete?.()
  }, [src, onComplete])

  const copyLink = useCallback(() => {
    if (src) {
      navigator.clipboard.writeText(src).catch(() => {})
    }
    onComplete?.()
  }, [src, onComplete])

  const deleteImage = useCallback(() => {
    editor?.chain().focus().deleteSelection().run()
    onComplete?.()
  }, [editor, onComplete])

  return { viewImage, downloadImage, copyImage, copyLink, deleteImage }
}

// ============================================================================
// Image Toolbar (Linear-style floating menu when image is selected)
// ============================================================================

interface ImageToolbarProps {
  editor: Editor
  disabled: boolean
}

const selectImageSrc = ({ editor: e }: { editor: Editor }) =>
  e.getAttributes('resizableImage').src as string | undefined

function ImageToolbar({ editor, disabled }: ImageToolbarProps) {
  const src = useEditorState({ editor, selector: selectImageSrc })

  const { viewImage, downloadImage, copyImage, copyLink, deleteImage } = useImageActions({
    src,
    editor,
  })

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-md"
      role="toolbar"
      aria-label="Image options"
    >
      <ToolbarButton
        icon={Expand}
        onClick={viewImage}
        disabled={disabled}
        title="View image"
        aria-label="View image in new tab"
      />
      <ToolbarButton
        icon={Download}
        onClick={downloadImage}
        disabled={disabled}
        title="Download"
        aria-label="Download image"
      />
      <ToolbarButton
        icon={Copy}
        onClick={copyImage}
        disabled={disabled}
        title="Copy to clipboard"
        aria-label="Copy image to clipboard"
      />
      <ToolbarButton
        icon={Link2}
        onClick={copyLink}
        disabled={disabled}
        title="Copy link"
        aria-label="Copy image link"
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={Trash2}
        onClick={deleteImage}
        disabled={disabled}
        title="Delete"
        aria-label="Delete image"
      />
    </div>
  )
}

// ============================================================================
// Fixed Toolbar Components
// ============================================================================

interface MenuBarProps {
  editor: Editor
  disabled: boolean
  features?: EditorFeatures
  onImageUpload?: (file: File) => Promise<string>
  onVideoUpload?: (file: File) => Promise<string>
  /** 'top' is the classic bordered strip; 'bottom' is a quiet transparent row
   * of ghost icon buttons rendered below the content. Both render the same
   * feature-gated button set. */
  variant?: 'top' | 'bottom'
  /** Only meaningful for the bottom variant: when the surrounding editor is
   * borderless the consumer supplies its own horizontal padding, so the row
   * drops its own px to stay flush with the content's left edge. */
  borderless?: boolean
}

/**
 * What the fixed toolbar shows: the active marks and blocks, and whether there
 * is anything to undo or redo. The history depth answers the same question as
 * `editor.can().undo()` without building the full command chain, which this
 * selector would otherwise do on every transaction.
 */
const selectToolbarState = ({ editor: e }: { editor: Editor }) => ({
  bold: e.isActive('bold'),
  italic: e.isActive('italic'),
  link: e.isActive('link'),
  bulletList: e.isActive('bulletList'),
  orderedList: e.isActive('orderedList'),
  codeBlock: e.isActive('codeBlock'),
  heading1: e.isActive('heading', { level: 1 }),
  heading2: e.isActive('heading', { level: 2 }),
  heading3: e.isActive('heading', { level: 3 }),
  canUndo: undoDepth(e.state) > 0,
  canRedo: redoDepth(e.state) > 0,
})

function MenuBar({
  editor,
  disabled,
  features = {},
  onImageUpload,
  onVideoUpload,
  variant = 'top',
  borderless = false,
}: MenuBarProps) {
  const isBottom = variant === 'bottom'
  // Muted ghost buttons on the transparent bottom row; filled active-state on top.
  const btn = isBottom ? ('quiet' as const) : ('default' as const)
  // Subscribe to the marks/nodes the toolbar reflects so it re-renders only
  // when one of them changes, never merely because a character was typed.
  const active = useEditorState({ editor, selector: selectToolbarState })
  const commands = useToolbarCommands(editor)
  const setLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link').href
    let url = window.prompt('URL', previousUrl)

    if (url === null) return

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }

    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  const insertImage = useCallback(() => {
    if (!onImageUpload) return

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return

      try {
        const src = await onImageUpload(file)
        editor.commands.setResizableImage(await resizableImageInsertAttrs(src, file))
      } catch (error) {
        console.error('Failed to upload image:', error)
        const { toast } = await import('sonner')
        toast.error("Couldn't upload image. Try again.")
      }
    }
    input.click()
  }, [editor, onImageUpload])

  const insertVideo = useCallback(() => {
    if (!onVideoUpload) return

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = VIDEO_FILE_ACCEPT
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const src = await onVideoUpload(file)
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'video',
            attrs: {
              src,
              mimeType: resolveVideoMimeType(file.type, file.name) ?? file.type,
              title: file.name,
            },
          })
          .run()
      } catch (error) {
        console.error('Failed to upload video:', error)
        const { toast } = await import('sonner')
        toast.error("Couldn't upload video. Try again.")
      }
    }
    input.click()
  }, [editor, onVideoUpload])

  return (
    <div
      className={cn(
        'flex items-center flex-wrap',
        isBottom
          ? // Quiet transparent row sitting on the editor background. Drops its
            // own horizontal padding when borderless so the consumer's padding
            // keeps the icons flush with the content's left edge.
            cn('gap-0.5 pt-1', borderless ? 'px-0 pb-0' : 'px-3 pb-2')
          : 'gap-1 px-2 py-1.5 border-b border-input bg-muted/30'
      )}
    >
      {/* Heading buttons */}
      {features.headings && (
        <>
          <ToolbarButton
            variant={btn}
            icon={Heading1}
            onClick={commands.heading1}
            disabled={disabled}
            isActive={active.heading1}
            title="Heading 1"
          />
          <ToolbarButton
            variant={btn}
            icon={Heading2}
            onClick={commands.heading2}
            disabled={disabled}
            isActive={active.heading2}
            title="Heading 2"
          />
          <ToolbarButton
            variant={btn}
            icon={Heading3}
            onClick={commands.heading3}
            disabled={disabled}
            isActive={active.heading3}
            title="Heading 3"
          />
          <ToolbarDivider />
        </>
      )}

      {/* Basic formatting */}
      <ToolbarButton
        variant={btn}
        icon={Bold}
        onClick={commands.bold}
        disabled={disabled}
        isActive={active.bold}
        title="Bold"
      />
      <ToolbarButton
        variant={btn}
        icon={Italic}
        onClick={commands.italic}
        disabled={disabled}
        isActive={active.italic}
        title="Italic"
      />
      <ToolbarDivider />

      {/* Lists */}
      <ToolbarButton
        variant={btn}
        icon={ListBulletIcon}
        onClick={commands.bulletList}
        disabled={disabled}
        isActive={active.bulletList}
        title="Bullet List"
      />
      <ToolbarButton
        variant={btn}
        icon={ListOrdered}
        onClick={commands.orderedList}
        disabled={disabled}
        isActive={active.orderedList}
        title="Ordered List"
      />
      <ToolbarDivider />

      {/* Link */}
      <ToolbarButton
        variant={btn}
        icon={LinkIcon}
        onClick={setLink}
        disabled={disabled}
        isActive={active.link}
        title="Insert Link"
      />

      {/* Code block button */}
      {features.codeBlocks && (
        <ToolbarButton
          variant={btn}
          icon={Code2}
          onClick={commands.codeBlock}
          disabled={disabled}
          isActive={active.codeBlock}
          title="Code Block"
        />
      )}

      {/* Image button */}
      {features.images && onImageUpload && (
        <ToolbarButton
          variant={btn}
          icon={ImagePlus}
          onClick={insertImage}
          disabled={disabled}
          title="Insert Image"
        />
      )}

      {features.videos && onVideoUpload && (
        <ToolbarButton
          variant={btn}
          icon={VideoIcon}
          onClick={insertVideo}
          disabled={disabled}
          title="Insert Video"
        />
      )}

      {/* Push undo/redo to the trailing edge on the filled top strip; the quiet
          bottom row flows left-to-right (and wraps) with no spacer. */}
      {!isBottom && <div className="flex-1" />}

      {/* Undo/Redo */}
      <ToolbarButton
        variant={btn}
        icon={ArrowUturnLeftIcon}
        onClick={commands.undo}
        disabled={disabled || !active.canUndo}
        title="Undo"
      />
      <ToolbarButton
        variant={btn}
        icon={ArrowUturnRightIcon}
        onClick={commands.redo}
        disabled={disabled || !active.canRedo}
        title="Redo"
      />
    </div>
  )
}

// ============================================================================
// Read-only rendering (re-exports)
// ============================================================================

// The read-only renderer now lives in a sibling module with only light deps so
// portal reading surfaces don't pull in this editor chunk. These re-exports keep
// existing importers of this module working; NEW read-only consumers should
// import from '@/components/ui/rich-text-content' directly.
//
// `generateContentHTML` (the JSON→HTML serializer) is defined in the browser-free
// shared module `@/lib/shared/content-html`; re-exported here for existing callers.
export { generateContentHTML }
export { RichTextContent, isRichTextContent }
