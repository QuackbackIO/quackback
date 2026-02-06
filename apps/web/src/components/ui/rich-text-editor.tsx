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
import Underline from '@tiptap/extension-underline'
import Youtube from '@tiptap/extension-youtube'
import { Extension } from '@tiptap/core'
import type { Range } from '@tiptap/core'
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion'
import { common, createLowlight } from 'lowlight'
import { useEffect, useCallback, useState, forwardRef, useImperativeHandle, useRef } from 'react'
import { computePosition, flip, shift, offset } from '@floating-ui/dom'
import DOMPurify from 'isomorphic-dompurify'
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
  Youtube as YoutubeIcon,
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

// Create lowlight instance with common languages
const lowlight = createLowlight(common)

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
        <div className="z-50 w-72 rounded-lg border bg-popover p-2 shadow-lg">
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">
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
        ref={containerRef}
        className="z-50 w-72 max-h-80 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
        onWheel={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {Object.entries(groupedItems).map(([group, groupItems]) => (
          <div key={group}>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
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
                    'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-sm',
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
                  <span className="flex size-8 items-center justify-center rounded-md border bg-background">
                    {item.icon}
                  </span>
                  <div className="flex-1 text-left">
                    <div className="font-medium">{item.title}</div>
                    <div className="text-xs text-muted-foreground">{item.description}</div>
                  </div>
                </button>
              )
            })}
          </div>
        ))}
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
          items: ({ query }: { query: string }) => {
            const allItems = getSlashMenuItems(features, onImageUpload)
            return filterSlashItems(allItems, query)
          },
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
                floatingEl.style.position = 'absolute'
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

interface RichTextEditorProps {
  value?: string | JSONContent
  onChange?: (json: JSONContent, html: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  minHeight?: string
  borderless?: boolean
  toolbarPosition?: 'top' | 'none'
  /** Feature flags for enabling advanced features */
  features?: EditorFeatures
  /** Callback for uploading images. Returns the public URL of the uploaded image. */
  onImageUpload?: (file: File) => Promise<string>
}

// ============================================================================
// Editor Component
// ============================================================================

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write something...',
  className,
  disabled = false,
  minHeight = '120px',
  borderless = false,
  toolbarPosition = borderless ? 'none' : 'top',
  features = {},
  onImageUpload,
}: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // Enable headings if feature is enabled
        heading: features.headings ? { levels: [1, 2, 3] } : false,
        // Disable built-in code block if using CodeBlockLowlight
        codeBlock: features.codeBlocks ? false : false,
        // Enable blockquote if feature is enabled (use empty object to enable with defaults)
        blockquote: features.blockquotes ? {} : false,
        // Enable horizontal rule if feature is enabled (use empty object to enable with defaults)
        horizontalRule: features.dividers ? {} : false,
        link: false, // Disable built-in Link, we use our own configured version
      }),
      // Underline extension (always available for bubble menu)
      Underline,
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
      // Conditionally add ResizableImage extension (with selection, resize, drag-drop support)
      ...(features.images
        ? [
            ResizableImage.configure({
              HTMLAttributes: {
                class: 'max-w-full h-auto rounded-lg',
              },
              allowBase64: false,
            }),
          ]
        : []),
      // Conditionally add CodeBlockLowlight extension
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
      // Conditionally add TaskList extension
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
      // Conditionally add Table extensions
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
      // Conditionally add YouTube extension
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
      // Conditionally add slash commands (enabled by default)
      ...(features.slashMenu !== false ? [createSlashCommands(features, onImageUpload)] : []),
    ],
    content: value ?? '',
    editable: !disabled,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON(), editor.getHTML())
    },
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm prose-neutral dark:prose-invert max-w-none focus:outline-none',
          'min-h-[var(--editor-min-height)]',
          borderless ? 'py-0' : 'px-3 py-2'
        ),
        style: `--editor-min-height: ${minHeight}`,
      },
      // Handle image paste/drop
      handleDrop: features.images && onImageUpload ? handleImageDrop(onImageUpload) : undefined,
      handlePaste: features.images && onImageUpload ? handleImagePaste(onImageUpload) : undefined,
    },
  })

  // Sync external value changes
  useEffect(() => {
    if (!editor) return

    if (value === '' || value === undefined) {
      editor.commands.clearContent()
    } else if (typeof value === 'object') {
      // Only update if the content is different (compare JSON)
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

  if (!editor) {
    return null
  }

  const showToolbar = toolbarPosition !== 'none'

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={!features.images}>
        <div
          className={cn(
            'overflow-hidden',
            !borderless && 'rounded-md border border-input bg-background',
            disabled && 'opacity-50 cursor-not-allowed',
            className
          )}
          onContextMenu={handleContextMenu}
        >
          {/* Toolbar */}
          {showToolbar && (
            <MenuBar
              editor={editor}
              disabled={disabled}
              features={features}
              onImageUpload={onImageUpload}
            />
          )}

          {/* Editor content */}
          <EditorContent editor={editor} />
        </div>
      </ContextMenuTrigger>

      {/* Image context menu (shadcn/Radix - Linear-style) */}
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

      {/* Floating bubble menu on text selection */}
      {features.bubbleMenu !== false && (
        <BubbleMenu
          editor={editor}
          options={{
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

      {/* Floating table toolbar when cursor is in table */}
      {features.tables && (
        <BubbleMenu
          editor={editor}
          options={{
            placement: 'top',
          }}
          shouldShow={({ editor }) => {
            return editor.isActive('table')
          }}
        >
          <TableToolbar editor={editor} disabled={disabled} />
        </BubbleMenu>
      )}

      {/* Floating image toolbar when image is selected */}
      {features.images && (
        <BubbleMenu
          editor={editor}
          options={{
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
      onImageUpload(image).then((src) => {
        // Use resizableImage node type for resizable images
        const nodeType = schema.nodes.resizableImage || schema.nodes.image
        const node = nodeType?.create({ src, 'data-keep-ratio': true })
        if (node && coordinates) {
          const transaction = view.state.tr.insert(coordinates.pos, node)
          view.dispatch(transaction)
        }
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

      onImageUpload(file).then((src) => {
        const { schema } = view.state
        // Use resizableImage node type for resizable images
        const nodeType = schema.nodes.resizableImage || schema.nodes.image
        const node = nodeType?.create({ src, 'data-keep-ratio': true })
        if (node) {
          const transaction = view.state.tr.replaceSelectionWith(node)
          view.dispatch(transaction)
        }
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
}

function ToolbarButton({
  icon,
  onClick,
  disabled,
  isActive,
  title,
  'aria-label': ariaLabel,
}: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('h-7 w-7 p-0', isActive && 'bg-muted')}
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
      <DropdownMenuContent align="start" side="top" sideOffset={8} disablePortal>
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
      // Fallback: copy URL
      if (src) navigator.clipboard.writeText(src)
    }
    onComplete?.()
  }, [src, onComplete])

  const copyLink = useCallback(() => {
    if (src) {
      navigator.clipboard.writeText(src)
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
}

function MenuBar({ editor, disabled, features = {}, onImageUpload }: MenuBarProps) {
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
    <div className="flex items-center gap-1 flex-wrap px-2 py-1.5 border-b border-input bg-muted/30">
      {/* Heading buttons */}
      {features.headings && (
        <>
          <ToolbarButton
            icon={<Heading1 className="size-4" />}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            disabled={disabled}
            isActive={editor.isActive('heading', { level: 1 })}
            title="Heading 1"
          />
          <ToolbarButton
            icon={<Heading2 className="size-4" />}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            disabled={disabled}
            isActive={editor.isActive('heading', { level: 2 })}
            title="Heading 2"
          />
          <ToolbarButton
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
        icon={<Bold className="size-4" />}
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={disabled || !editor.can().chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title="Bold"
      />
      <ToolbarButton
        icon={<Italic className="size-4" />}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={disabled || !editor.can().chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title="Italic"
      />
      <ToolbarDivider />

      {/* Lists */}
      <ToolbarButton
        icon={<ListBulletIcon className="size-4" />}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        disabled={disabled}
        isActive={editor.isActive('bulletList')}
        title="Bullet List"
      />
      <ToolbarButton
        icon={<ListOrdered className="size-4" />}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        disabled={disabled}
        isActive={editor.isActive('orderedList')}
        title="Ordered List"
      />
      <ToolbarDivider />

      {/* Link */}
      <ToolbarButton
        icon={<LinkIcon className="size-4" />}
        onClick={setLink}
        disabled={disabled}
        isActive={editor.isActive('link')}
        title="Insert Link"
      />

      {/* Code block button */}
      {features.codeBlocks && (
        <ToolbarButton
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
          icon={<ImagePlus className="size-4" />}
          onClick={insertImage}
          disabled={disabled}
          title="Insert Image"
        />
      )}

      <div className="flex-1" />

      {/* Undo/Redo */}
      <ToolbarButton
        icon={<ArrowUturnLeftIcon className="size-4" />}
        onClick={() => editor.chain().focus().undo().run()}
        disabled={disabled || !canUndo}
        title="Undo"
      />
      <ToolbarButton
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
function generateContentHTML(content: JSONContent): string {
  // Simple recursive HTML generator for common node types
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
        return `<h${level}>${headingContent}</h${level}>`
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

      case 'listItem':
        return `<li>${node.content?.map(renderNode).join('') ?? ''}</li>`

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
        const imgHeight =
          node.attrs?.height !== undefined ? safePositiveInt(node.attrs.height, 0) : 0
        const style =
          imgWidth || imgHeight
            ? `style="${imgWidth ? `width:${imgWidth}px;` : ''}${imgHeight ? `height:${imgHeight}px;` : ''}"`
            : ''
        return `<img src="${src}" alt="${alt}" class="max-w-full h-auto rounded-lg" ${style} />`
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
  ],
  ALLOW_DATA_ATTR: false,
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['allowfullscreen', 'frameborder', 'allow'],
}

export function RichTextContent({ content, className }: RichTextContentProps) {
  // For SSR: generate HTML directly from JSON content, sanitized with DOMPurify
  if (typeof content === 'object' && content.type === 'doc') {
    const rawHtml = generateContentHTML(content)
    const html = DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG)
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

// Helper to convert TipTap JSON to plain text
export function richTextToPlainText(content: JSONContent): string {
  if (!content.content) return ''

  return content.content
    .map((node) => {
      if (node.type === 'paragraph' && node.content) {
        return node.content
          .map((child) => {
            if (child.type === 'text') return child.text || ''
            return ''
          })
          .join('')
      }
      if (node.type === 'heading' && node.content) {
        return node.content
          .map((child) => {
            if (child.type === 'text') return child.text || ''
            return ''
          })
          .join('')
      }
      if (node.type === 'bulletList' || node.type === 'orderedList') {
        return (
          node.content
            ?.map((item) => {
              if (item.type === 'listItem' && item.content) {
                return item.content
                  .map((p) => {
                    if (p.type === 'paragraph' && p.content) {
                      return p.content.map((c) => c.text || '').join('')
                    }
                    return ''
                  })
                  .join('')
              }
              return ''
            })
            .join('\n') || ''
        )
      }
      if (node.type === 'codeBlock' && node.content) {
        return node.content.map((c) => c.text || '').join('')
      }
      return ''
    })
    .join('\n')
}

// Helper to check if content is TipTap JSON
export function isRichTextContent(content: unknown): content is JSONContent {
  return (
    typeof content === 'object' &&
    content !== null &&
    'type' in content &&
    (content as JSONContent).type === 'doc'
  )
}
