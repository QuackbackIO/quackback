import {
  useEditor,
  EditorContent,
  ReactRenderer,
  type Editor,
  type JSONContent,
} from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
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
import { Emoji, emojis as defaultEmojis, type EmojiItem } from '@tiptap/extension-emoji'
import { MentionExtension } from './mention-extension'
import { QuackbackEmbed } from './quackback-embed-extension'
import { Markdown } from '@tiptap/markdown'
import { Extension } from '@tiptap/core'
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
import { computePosition, flip, shift, offset } from '@floating-ui/dom'
import DOMPurify from 'dompurify'
import { cn } from '@/lib/shared/utils'
import {
  escapeHtmlAttr,
  sanitizeUrl,
  sanitizeImageUrl,
  safePositiveInt,
  extractYoutubeId,
} from '@/lib/shared/utils/sanitize'
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
    /** When set, Enter submits (chat-send) instead of splitting the block. */
    onSubmit?: () => void
  }
) {
  const { placeholder, onImageUpload, onSubmit } = options
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
    // Always register so the schema can parse image nodes in existing content
    ResizableImage.configure({
      HTMLAttributes: {
        class: 'max-w-full h-auto rounded-lg',
      },
      allowBase64: false,
    }),
    // Always register so saved embed nodes round-trip in any editor; paste rules
    // only fire when quackbackEmbeds is enabled for this editor.
    QuackbackEmbed.configure({ enablePaste: !!features.quackbackEmbeds }),
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
    ...(features.slashMenu !== false ? [createSlashCommands(features, onImageUpload)] : []),
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

// Enter submits (chat-send); Shift+Enter inserts a line break. Registered at a
// priority above createEnterAsHardBreak and StarterKit (default 100) so, when a
// preset sets enterAsHardBreak while a consumer also passes onSubmit, Enter still
// submits rather than inserting a break. TipTap tries same-key bindings in
// descending priority order and stops at the first that returns true. ProseMirror
// runs keymap handlers before a suggestion popover's handleKeyDown, so an open
// slash/mention/emoji menu keeps Enter — we yield by returning false.
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
        'Shift-Enter': () => this.editor.commands.setHardBreak(),
      }
    },
  })
}

// Suggestion-style plugins (emoji picker, slash menu, mention) keep
// `{ active: boolean, range, query, ... }` on their plugin state. We probe
// every plugin generically rather than importing each PluginKey because
// MentionExtension constructs an anonymous key per instance and isn't reachable
// from here. Non-object states are skipped — those are unrelated plugins.
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
  onImageUpload?: (file: File) => Promise<string>
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
            // Use setResizableImage for the resizable image extension
            editor.commands.setResizableImage({ src, 'data-keep-ratio': true })
          } catch (error) {
            console.error('Failed to upload image:', error)
          }
        }
        input.click()
      },
      aliases: ['img', 'picture'],
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
}

const SlashMenuList = forwardRef<SlashMenuListRef, SlashMenuListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const containerRef = useRef<HTMLDivElement>(null)

    const selectItem = (index: number) => {
      const item = items[index]
      if (item) {
        command(item)
      }
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
      setSelectedIndex(0)
    }, [items])

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          const newIndex = (selectedIndex - 1 + items.length) % items.length
          setSelectedIndex(newIndex)
          scrollToSelected(newIndex)
          return true
        }

        if (event.key === 'ArrowDown') {
          const newIndex = (selectedIndex + 1) % items.length
          setSelectedIndex(newIndex)
          scrollToSelected(newIndex)
          return true
        }

        if (event.key === 'Enter') {
          selectItem(selectedIndex)
          return true
        }

        return false
      },
    }))

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
                <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
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
                      <span className="flex size-6 shrink-0 items-center justify-center rounded border bg-background text-[10px]">
                        {item.icon}
                      </span>
                      <span className="truncate font-medium">{item.title}</span>
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
  onImageUpload?: (file: File) => Promise<string>
) {
  // Compute once per extension instance. Since buildExtensions() is wrapped in
  // useMemo, this only re-runs when features or onImageUpload actually changes —
  // NOT on every keystroke.
  const allItems = getSlashMenuItems(features, onImageUpload)

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

            const updatePosition = async (clientRect: (() => DOMRect | null) | null) => {
              if (!floatingEl || !clientRect) return

              const rect = clientRect()
              if (!rect) return

              // Create a virtual element for floating-ui
              const virtualEl = {
                getBoundingClientRect: () => rect,
              }

              const { x, y } = await computePosition(virtualEl, floatingEl, {
                strategy: 'fixed',
                placement: 'bottom-start',
                middleware: [offset(8), flip(), shift({ padding: 8 })],
              })

              Object.assign(floatingEl.style, {
                left: `${x}px`,
                top: `${y}px`,
              })
            }

            return {
              onStart: (props: SuggestionProps<SlashMenuItem>) => {
                component = new ReactRenderer(SlashMenuList, {
                  props: {
                    items: props.items,
                    command: (item: SlashMenuItem) => props.command(item),
                  },
                  editor: props.editor,
                })

                // Create container element
                floatingEl = document.createElement('div')
                floatingEl.style.position = 'fixed'
                floatingEl.style.zIndex = '50'
                floatingEl.style.pointerEvents = 'auto'
                floatingEl.appendChild(component.element)
                document.body.appendChild(floatingEl)

                updatePosition(props.clientRect ?? null)
              },

              onUpdate: (props: SuggestionProps<SlashMenuItem>) => {
                component?.updateProps({
                  items: props.items,
                  command: (item: SlashMenuItem) => props.command(item),
                })
                updatePosition(props.clientRect ?? null)
              },

              onKeyDown: (props: { event: KeyboardEvent }) => {
                if (props.event.key === 'Escape') {
                  return true
                }

                return component?.ref?.onKeyDown(props) ?? false
              },

              onExit: () => {
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
}

const MAX_EMOJI_RESULTS = 12

// Curated shortcodes shown the moment the user types `:`. Picked for the
// long tail of comment reactions (joy, agreement, celebration). Ordering
// here is the ordering in the dropdown.
const DEFAULT_EMOJI_SHORTCODES = [
  'smile',
  'joy',
  'heart_eyes',
  'thinking',
  'rolling_on_the_floor_laughing',
  'face_with_tears_of_joy',
  'thumbsup',
  'thumbsdown',
  'heart',
  'fire',
  'tada',
  'rocket',
] as const

function lookupEmoji(shortcode: string): EmojiItem | undefined {
  return defaultEmojis.find((e) => e.emoji && e.shortcodes.includes(shortcode))
}

function filterEmojiItems(query: string): EmojiItem[] {
  const lower = query.trim().toLowerCase()
  if (!lower) {
    // Bare `:` opens the picker with a small curated set so users can pick
    // without typing a shortcode. Falls back to defaultEmojis order if a
    // curated shortcode isn't in the bundled set.
    const defaults: EmojiItem[] = []
    for (const shortcode of DEFAULT_EMOJI_SHORTCODES) {
      const found = lookupEmoji(shortcode)
      if (found) defaults.push(found)
    }
    return defaults
  }
  const matches: EmojiItem[] = []
  for (const item of defaultEmojis) {
    if (!item.emoji) continue
    const hitsShortcode = item.shortcodes.some((s) => s.toLowerCase().includes(lower))
    const hitsTag = item.tags?.some((t) => t.toLowerCase().includes(lower)) ?? false
    if (hitsShortcode || hitsTag) {
      matches.push(item)
      if (matches.length >= MAX_EMOJI_RESULTS) break
    }
  }
  return matches
}

const EmojiSuggestionList = forwardRef<EmojiSuggestionListRef, EmojiSuggestionListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const containerRef = useRef<HTMLDivElement>(null)

    const selectItem = (index: number) => {
      const item = items[index]
      if (item) command(item)
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
      setSelectedIndex(0)
    }, [items])

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          const next = (selectedIndex - 1 + items.length) % items.length
          setSelectedIndex(next)
          scrollToSelected(next)
          return true
        }
        if (event.key === 'ArrowDown') {
          const next = (selectedIndex + 1) % items.length
          setSelectedIndex(next)
          scrollToSelected(next)
          return true
        }
        if (event.key === 'Enter') {
          selectItem(selectedIndex)
          return true
        }
        return false
      },
    }))

    if (items.length === 0) return null

    return (
      <div
        data-emoji-picker
        className="z-50 w-56 rounded-lg border bg-popover shadow-lg"
        onWheel={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div ref={containerRef} className="p-0.5">
          {items.map((item, index) => (
            <button
              key={item.name}
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
              <span className="truncate text-muted-foreground">:{item.shortcodes[0]}:</span>
            </button>
          ))}
        </div>
      </div>
    )
  }
)
EmojiSuggestionList.displayName = 'EmojiSuggestionList'

/** The `:`-triggered inline emoji picker, shared with the conversation composers so
 *  reply + note get the same emoji UX as posts. */
export function createEmojiExtension() {
  return Emoji.configure({
    enableEmoticons: true,
    suggestion: {
      items: ({ query }) => filterEmojiItems(query),
      allow: ({ editor }) => !editor.isActive('codeBlock'),
      render: () => {
        let component: ReactRenderer<EmojiSuggestionListRef> | null = null
        let floatingEl: HTMLDivElement | null = null

        const updatePosition = async (clientRect: (() => DOMRect | null) | null) => {
          if (!floatingEl || !clientRect) return
          const rect = clientRect()
          if (!rect) return
          const virtualEl = { getBoundingClientRect: () => rect }
          const { x, y } = await computePosition(virtualEl, floatingEl, {
            strategy: 'fixed',
            placement: 'bottom-start',
            middleware: [offset(8), flip(), shift({ padding: 8 })],
          })
          Object.assign(floatingEl.style, { left: `${x}px`, top: `${y}px` })
        }

        return {
          onStart: (props: SuggestionProps<EmojiItem>) => {
            if (props.items.length === 0) return
            component = new ReactRenderer(EmojiSuggestionList, {
              props: {
                items: props.items,
                command: (item: EmojiItem) => props.command(item),
              },
              editor: props.editor,
            })
            floatingEl = document.createElement('div')
            floatingEl.style.position = 'fixed'
            floatingEl.style.zIndex = '50'
            floatingEl.style.pointerEvents = 'auto'
            floatingEl.appendChild(component.element)
            document.body.appendChild(floatingEl)
            updatePosition(props.clientRect ?? null)
          },
          onUpdate: (props: SuggestionProps<EmojiItem>) => {
            // No matches → tear down so a bare `:` doesn't leave a stale
            // dropdown floating.
            if (props.items.length === 0) {
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
                props: {
                  items: props.items,
                  command: (item: EmojiItem) => props.command(item),
                },
                editor: props.editor,
              })
              floatingEl = document.createElement('div')
              floatingEl.style.position = 'fixed'
              floatingEl.style.zIndex = '50'
              floatingEl.style.pointerEvents = 'auto'
              floatingEl.appendChild(component.element)
              document.body.appendChild(floatingEl)
            } else {
              component.updateProps({
                items: props.items,
                command: (item: EmojiItem) => props.command(item),
              })
            }
            updatePosition(props.clientRect ?? null)
          },
          onKeyDown: (props: { event: KeyboardEvent }) => {
            if (props.event.key === 'Escape') return true
            return component?.ref?.onKeyDown(props) ?? false
          },
          onExit: () => {
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

interface RichTextEditorProps {
  value?: string | JSONContent
  onChange?: (json: JSONContent, html: string, markdown: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  minHeight?: string
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
  /** When set, Enter submits (chat-send) instead of splitting the block and
   * Shift+Enter inserts a line break. Yields to an open slash/mention/emoji
   * popover. Pass a stable (memoized) callback so extensions aren't rebuilt. */
  onSubmit?: () => void
}

// ============================================================================
// Editor Component
// ============================================================================

function RichTextEditorBase({
  value,
  onChange,
  placeholder = 'Write something...',
  className,
  disabled = false,
  minHeight = '120px',
  borderless = false,
  toolbarPosition = borderless ? 'none' : 'bottom',
  autofocus = false,
  features = {},
  onImageUpload,
  onSubmit,
}: RichTextEditorProps) {
  // Memoize extensions keyed on individual feature flags.
  // TipTap v3's useEditor calls editor.setOptions() whenever the extensions
  // array reference changes (uses reference equality via compareOptions).
  // Rebuilding the array on every render causes setOptions→transaction→onUpdate
  // on every keystroke, resulting in 300–400 ms input violations.
  const extensions = useMemo(
    () => buildExtensions(features, { placeholder, onImageUpload, onSubmit }),

    [
      features.headings,
      features.codeBlocks,
      features.blockquotes,
      features.dividers,
      features.images,
      features.taskLists,
      features.tables,
      features.embeds,
      features.quackbackEmbeds,
      features.slashMenu,
      features.emojiPicker,
      features.enterAsHardBreak,
      features.mentions,
      onImageUpload,
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
      handleDrop: features.images && onImageUpload ? handleImageDrop(onImageUpload) : undefined,
      handlePaste: features.images && onImageUpload ? handleImagePaste(onImageUpload) : undefined,
    }),

    [features.images, onImageUpload, borderless, minHeight]
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
    onUpdate: ({ editor }) => {
      if (!onChange) return
      const json = editor.getJSON()
      lastEmittedJsonRef.current = json
      const html = editor.getHTML()
      // Only serialize to markdown when the caller declares a 3rd parameter.
      // Callers that only need json+html (widget, portal) skip the expensive
      // recursive tree-walk that @tiptap/markdown does on every keystroke.
      const markdown = onChange.length >= 3 ? (editor.getMarkdown?.() ?? '') : ''
      lastEmittedMarkdownRef.current = markdown
      onChange(json, html, markdown)
    },
    editorProps,
  })

  // Sync external value changes into the editor.
  // Skipped when the value is the exact object/string we just emitted via onUpdate.
  useEffect(() => {
    if (!editor) return

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

  // Update editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled)
    }
  }, [disabled, editor])

  // Image context menu state - stores the src of the right-clicked image
  const [contextMenuImageSrc, setContextMenuImageSrc] = useState<string | null>(null)

  // Handle right-click - check if it's on an image and store the src
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!editor || !features.images) {
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
    [editor, features.images]
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

  if (!editor) {
    // Reserve the editor's eventual height + placeholder so the surrounding
    // layout (toolbar footer, card border) doesn't jump when TipTap finishes
    // mounting. Keeping immediatelyRender=false preserves SSR safety.
    return (
      <div
        className={cn(
          !borderless && 'overflow-hidden rounded-md border border-input bg-background',
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
        aria-hidden="true"
      >
        <div
          className={cn(
            'prose prose-sm prose-neutral dark:prose-invert max-w-none',
            'min-h-[var(--editor-min-height)]',
            borderless ? 'py-0' : 'px-3 py-2',
            'text-muted-foreground'
          )}
          style={{ '--editor-min-height': minHeight } as React.CSSProperties}
        >
          {placeholder ?? ' '}
        </div>
      </div>
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={!features.images}>
        <div
          ref={containerRef}
          className={cn(
            !borderless && 'overflow-hidden rounded-md border border-input bg-background',
            disabled && 'opacity-50 cursor-not-allowed',
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
              variant="top"
            />
          )}

          <EditorContent editor={editor} />

          {toolbarPosition === 'bottom' && (
            <MenuBar
              editor={editor}
              disabled={disabled}
              features={features}
              onImageUpload={onImageUpload}
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
          options={{
            strategy: 'fixed',
            placement: 'top',
          }}
          shouldShow={({ editor, state }) => {
            // Don't show in code blocks or tables
            if (editor.isActive('codeBlock')) return false
            if (editor.isActive('table')) return false
            // Only show when text is selected
            const { from, to } = state.selection
            return from !== to
          }}
        >
          <BubbleMenuContent editor={editor} disabled={disabled} />
        </BubbleMenu>
      )}

      {features.tables && (
        <BubbleMenu
          editor={editor}
          appendTo={getBubbleMenuContainer}
          ref={bubbleMenuRef}
          options={{
            strategy: 'fixed',
            placement: 'top',
          }}
          shouldShow={({ editor }) => {
            return editor.isActive('table')
          }}
        >
          <TableToolbar editor={editor} disabled={disabled} />
        </BubbleMenu>
      )}

      {features.images && (
        <BubbleMenu
          editor={editor}
          appendTo={getBubbleMenuContainer}
          ref={bubbleMenuRef}
          options={{
            strategy: 'fixed',
            placement: 'top',
          }}
          shouldShow={({ editor }) => {
            return editor.isActive('resizableImage')
          }}
        >
          <ImageToolbar editor={editor} disabled={disabled} />
        </BubbleMenu>
      )}
    </ContextMenu>
  )
}

// Skip re-render when individual feature flags and all other props are unchanged.
// Compares features by primitive values rather than object reference so callers
// can safely pass inline objects without triggering unnecessary editor rebuilds.
export const RichTextEditor = memo(RichTextEditorBase, (prev, next) => {
  if (
    prev.value !== next.value ||
    prev.onChange !== next.onChange ||
    prev.onImageUpload !== next.onImageUpload ||
    prev.onSubmit !== next.onSubmit ||
    prev.disabled !== next.disabled ||
    prev.placeholder !== next.placeholder ||
    prev.minHeight !== next.minHeight ||
    prev.borderless !== next.borderless ||
    prev.toolbarPosition !== next.toolbarPosition ||
    prev.className !== next.className
  )
    return false
  const pf = prev.features ?? {}
  const nf = next.features ?? {}
  return (
    pf.headings === nf.headings &&
    pf.codeBlocks === nf.codeBlocks &&
    pf.blockquotes === nf.blockquotes &&
    pf.dividers === nf.dividers &&
    pf.images === nf.images &&
    pf.taskLists === nf.taskLists &&
    pf.tables === nf.tables &&
    pf.embeds === nf.embeds &&
    pf.quackbackEmbeds === nf.quackbackEmbeds &&
    pf.slashMenu === nf.slashMenu &&
    pf.emojiPicker === nf.emojiPicker &&
    pf.enterAsHardBreak === nf.enterAsHardBreak &&
    pf.mentions === nf.mentions &&
    pf.bubbleMenu === nf.bubbleMenu
  )
})

// ============================================================================
// Image Handling
// ============================================================================

/**
 * Handle image drop events in the editor.
 */
function handleImageDrop(
  onImageUpload: (file: File) => Promise<string>
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

    const images = Array.from(event.dataTransfer.files).filter((file) =>
      file.type.startsWith('image/')
    )

    if (images.length === 0) {
      return false
    }

    event.preventDefault()

    const { schema } = view.state
    const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY })

    images.forEach((image) => {
      onImageUpload(image)
        .then((src) => {
          // Use resizableImage node type for resizable images
          const nodeType = schema.nodes.resizableImage || schema.nodes.image
          const node = nodeType?.create({ src, 'data-keep-ratio': true })
          if (node && coordinates) {
            const transaction = view.state.tr.insert(coordinates.pos, node)
            view.dispatch(transaction)
          }
        })
        .catch((err) => {
          console.error('[RichTextEditor] Image drop upload failed:', err)
        })
    })

    return true
  }
}

/**
 * Handle image paste events in the editor.
 */
function handleImagePaste(
  onImageUpload: (file: File) => Promise<string>
): (view: import('@tiptap/pm/view').EditorView, event: ClipboardEvent, slice: unknown) => boolean {
  return (view, event) => {
    const items = Array.from(event.clipboardData?.items ?? [])
    const images = items.filter((item) => item.type.startsWith('image/'))

    if (images.length === 0) {
      return false
    }

    event.preventDefault()

    images.forEach((item) => {
      const file = item.getAsFile()
      if (!file) return

      onImageUpload(file)
        .then((src) => {
          const { schema } = view.state
          // Use resizableImage node type for resizable images
          const nodeType = schema.nodes.resizableImage || schema.nodes.image
          const node = nodeType?.create({ src, 'data-keep-ratio': true })
          if (node) {
            const transaction = view.state.tr.replaceSelectionWith(node)
            view.dispatch(transaction)
          }
        })
        .catch((err) => {
          console.error('[RichTextEditor] Image paste upload failed:', err)
        })
    })

    return true
  }
}

// ============================================================================
// Toolbar Components
// ============================================================================

interface ToolbarButtonProps {
  icon: React.ReactNode
  onClick: () => void
  disabled: boolean
  isActive?: boolean
  title?: string
  'aria-label'?: string
  /** 'quiet' renders a muted ghost icon on a transparent background (for the
   * bottom toolbar); 'default' keeps the filled active-state look. */
  variant?: 'default' | 'quiet'
}

function ToolbarButton({
  icon,
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
      {icon}
    </Button>
  )
}

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

function BubbleMenuContent({ editor, disabled }: BubbleMenuContentProps) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-md">
      <ToolbarButton
        icon={<Bold className="size-4" />}
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={disabled}
        isActive={editor.isActive('bold')}
        title="Bold (Cmd+B)"
      />
      <ToolbarButton
        icon={<Italic className="size-4" />}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={disabled}
        isActive={editor.isActive('italic')}
        title="Italic (Cmd+I)"
      />
      <ToolbarButton
        icon={<UnderlineIcon className="size-4" />}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        disabled={disabled}
        isActive={editor.isActive('underline')}
        title="Underline (Cmd+U)"
      />
      <ToolbarButton
        icon={<Strikethrough className="size-4" />}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        disabled={disabled}
        isActive={editor.isActive('strike')}
        title="Strikethrough (Cmd+Shift+S)"
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={<Code className="size-4" />}
        onClick={() => editor.chain().focus().toggleCode().run()}
        disabled={disabled}
        isActive={editor.isActive('code')}
        title="Inline Code (Cmd+E)"
      />
      <LinkButton editor={editor} disabled={disabled} />
      <ToolbarDivider />
      <HeadingDropdown editor={editor} disabled={disabled} />
    </div>
  )
}

function LinkButton({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [isOpen, setIsOpen] = useState(false)
  const [url, setUrl] = useState('')

  const currentUrl = editor.getAttributes('link').href as string | undefined
  const isActive = editor.isActive('link')

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
            setUrl(currentUrl || '')
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

function HeadingDropdown({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  // Determine current block type
  const getCurrentBlockType = () => {
    if (editor.isActive('heading', { level: 1 })) return 'H1'
    if (editor.isActive('heading', { level: 2 })) return 'H2'
    if (editor.isActive('heading', { level: 3 })) return 'H3'
    return 'Text'
  }

  const currentType = getCurrentBlockType()

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
        icon={<ArrowUp className="size-4" />}
        onClick={() => editor.chain().focus().addRowBefore().run()}
        disabled={disabled}
        title="Add row above"
      />
      {/* Add row below */}
      <ToolbarButton
        icon={<ArrowDown className="size-4" />}
        onClick={() => editor.chain().focus().addRowAfter().run()}
        disabled={disabled}
        title="Add row below"
      />
      <ToolbarDivider />
      {/* Add column left */}
      <ToolbarButton
        icon={<ArrowLeft className="size-4" />}
        onClick={() => editor.chain().focus().addColumnBefore().run()}
        disabled={disabled}
        title="Add column left"
      />
      {/* Add column right */}
      <ToolbarButton
        icon={<ArrowRight className="size-4" />}
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

function ImageToolbar({ editor, disabled }: ImageToolbarProps) {
  const attrs = editor.getAttributes('resizableImage')
  const src = attrs.src as string | undefined

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
        icon={<Expand className="size-4" />}
        onClick={viewImage}
        disabled={disabled}
        title="View image"
        aria-label="View image in new tab"
      />
      <ToolbarButton
        icon={<Download className="size-4" />}
        onClick={downloadImage}
        disabled={disabled}
        title="Download"
        aria-label="Download image"
      />
      <ToolbarButton
        icon={<Copy className="size-4" />}
        onClick={copyImage}
        disabled={disabled}
        title="Copy to clipboard"
        aria-label="Copy image to clipboard"
      />
      <ToolbarButton
        icon={<Link2 className="size-4" />}
        onClick={copyLink}
        disabled={disabled}
        title="Copy link"
        aria-label="Copy image link"
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={<Trash2 className="size-4" />}
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
  /** 'top' is the classic bordered strip; 'bottom' is a quiet transparent row
   * of ghost icon buttons rendered below the content. Both render the same
   * feature-gated button set. */
  variant?: 'top' | 'bottom'
  /** Only meaningful for the bottom variant: when the surrounding editor is
   * borderless the consumer supplies its own horizontal padding, so the row
   * drops its own px to stay flush with the content's left edge. */
  borderless?: boolean
}

function MenuBar({
  editor,
  disabled,
  features = {},
  onImageUpload,
  variant = 'top',
  borderless = false,
}: MenuBarProps) {
  const isBottom = variant === 'bottom'
  // Muted ghost buttons on the transparent bottom row; filled active-state on top.
  const btn = isBottom ? ('quiet' as const) : ('default' as const)
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
        // Use setResizableImage for resizable images
        editor.commands.setResizableImage({ src, 'data-keep-ratio': true })
      } catch (error) {
        console.error('Failed to upload image:', error)
      }
    }
    input.click()
  }, [editor, onImageUpload])

  const canUndo = editor.can().chain().focus().undo().run()
  const canRedo = editor.can().chain().focus().redo().run()

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
            icon={<Heading1 className="size-4" />}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            disabled={disabled}
            isActive={editor.isActive('heading', { level: 1 })}
            title="Heading 1"
          />
          <ToolbarButton
            variant={btn}
            icon={<Heading2 className="size-4" />}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            disabled={disabled}
            isActive={editor.isActive('heading', { level: 2 })}
            title="Heading 2"
          />
          <ToolbarButton
            variant={btn}
            icon={<Heading3 className="size-4" />}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            disabled={disabled}
            isActive={editor.isActive('heading', { level: 3 })}
            title="Heading 3"
          />
          <ToolbarDivider />
        </>
      )}

      {/* Basic formatting */}
      <ToolbarButton
        variant={btn}
        icon={<Bold className="size-4" />}
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={disabled || !editor.can().chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title="Bold"
      />
      <ToolbarButton
        variant={btn}
        icon={<Italic className="size-4" />}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={disabled || !editor.can().chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title="Italic"
      />
      <ToolbarDivider />

      {/* Lists */}
      <ToolbarButton
        variant={btn}
        icon={<ListBulletIcon className="size-4" />}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        disabled={disabled}
        isActive={editor.isActive('bulletList')}
        title="Bullet List"
      />
      <ToolbarButton
        variant={btn}
        icon={<ListOrdered className="size-4" />}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        disabled={disabled}
        isActive={editor.isActive('orderedList')}
        title="Ordered List"
      />
      <ToolbarDivider />

      {/* Link */}
      <ToolbarButton
        variant={btn}
        icon={<LinkIcon className="size-4" />}
        onClick={setLink}
        disabled={disabled}
        isActive={editor.isActive('link')}
        title="Insert Link"
      />

      {/* Code block button */}
      {features.codeBlocks && (
        <ToolbarButton
          variant={btn}
          icon={<Code2 className="size-4" />}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          disabled={disabled}
          isActive={editor.isActive('codeBlock')}
          title="Code Block"
        />
      )}

      {/* Image button */}
      {features.images && onImageUpload && (
        <ToolbarButton
          variant={btn}
          icon={<ImagePlus className="size-4" />}
          onClick={insertImage}
          disabled={disabled}
          title="Insert Image"
        />
      )}

      {/* Push undo/redo to the trailing edge on the filled top strip; the quiet
          bottom row flows left-to-right (and wraps) with no spacer. */}
      {!isBottom && <div className="flex-1" />}

      {/* Undo/Redo */}
      <ToolbarButton
        variant={btn}
        icon={<ArrowUturnLeftIcon className="size-4" />}
        onClick={() => editor.chain().focus().undo().run()}
        disabled={disabled || !canUndo}
        title="Undo"
      />
      <ToolbarButton
        variant={btn}
        icon={<ArrowUturnRightIcon className="size-4" />}
        onClick={() => editor.chain().focus().redo().run()}
        disabled={disabled || !canRedo}
        title="Redo"
      />
    </div>
  )
}

// ============================================================================
// Read-Only Content Renderer (SSR Compatible)
// ============================================================================

interface RichTextContentProps {
  content: JSONContent | string
  className?: string
}

// ============================================================================
// HTML Sanitization Utilities (XSS Prevention)
// ============================================================================

// Sanitization utilities (escapeHtmlAttr, sanitizeUrl, sanitizeImageUrl,
// safePositiveInt, extractYoutubeId) are imported from @/lib/shared/utils/sanitize

// Generate HTML from TipTap JSON content for SSR
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
        // @tiptap/extension-emoji persists `{ name }` only — the Unicode char
        // is re-derived at render time from the bundled set. Sanitize-tiptap
        // keeps `emoji` if it was supplied, so we still prefer attrs.emoji
        // when present and HTML-escape for defence-in-depth.
        const rawName = String(node.attrs?.name ?? '')
        const ch = String(node.attrs?.emoji ?? lookupEmoji(rawName)?.emoji ?? '')
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

// DOMPurify config for sanitizing rendered TipTap HTML (defense-in-depth)
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'strong',
    'em',
    'u',
    's',
    'code',
    'pre',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'hr',
    'br',
    'img',
    'iframe',
    'div',
    'table',
    'tr',
    'th',
    'td',
    'input',
    'span',
  ],
  ALLOWED_ATTR: [
    'id',
    'href',
    'src',
    'alt',
    'class',
    'style',
    'target',
    'rel',
    'width',
    'height',
    'frameborder',
    'allow',
    'allowfullscreen',
    'type',
    'checked',
    'disabled',
    'data-type',
    'data-name',
    'data-principal-id',
    'data-display-name',
    'data-quackback-embed',
    'data-kind',
    'data-id',
  ],
  ALLOW_DATA_ATTR: false,
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['allowfullscreen', 'frameborder', 'allow'],
}

export function RichTextContent({ content, className }: RichTextContentProps) {
  // Generate HTML from JSON content, with DOMPurify defense-in-depth on client
  if (typeof content === 'object' && content.type === 'doc') {
    const rawHtml = generateContentHTML(content)
    // DOMPurify requires a DOM — on the server, generateContentHTML already produces
    // controlled HTML from validated JSON (content is sanitized at ingestion time)
    const html =
      typeof window !== 'undefined' ? DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG) : rawHtml
    return (
      <div
        className={cn('prose prose-neutral dark:prose-invert max-w-none', className)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  // For string content (HTML or plain text)
  if (typeof content === 'string') {
    return (
      <div className={cn('prose prose-neutral dark:prose-invert max-w-none', className)}>
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    )
  }

  return null
}

// ============================================================================
// Helpers
// ============================================================================

// Helper to check if content is TipTap JSON
export function isRichTextContent(content: unknown): content is JSONContent {
  return (
    typeof content === 'object' &&
    content !== null &&
    'type' in content &&
    (content as JSONContent).type === 'doc'
  )
}
