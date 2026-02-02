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
import Image from '@tiptap/extension-image'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import Underline from '@tiptap/extension-underline'
import { Extension } from '@tiptap/core'
import type { Range } from '@tiptap/core'
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion'
import { common, createLowlight } from 'lowlight'
import { useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import { computePosition, flip, shift, offset } from '@floating-ui/dom'
import { cn } from '@/lib/shared/utils'
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
            editor.chain().focus().setImage({ src }).run()
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

    const selectItem = (index: number) => {
      const item = items[index]
      if (item) {
        command(item)
      }
    }

    // Reset selection when items change
    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev - 1 + items.length) % items.length)
          return true
        }

        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length)
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
      <div className="z-50 w-72 max-h-80 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
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
                  onClick={() => selectItem(currentIndex)}
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
  toolbarPosition?: 'top' | 'bottom' | 'none'
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
      // Conditionally add Image extension
      ...(features.images
        ? [
            Image.configure({
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

  if (!editor) {
    return null
  }

  const showToolbar = toolbarPosition !== 'none'

  return (
    <div
      className={cn(
        'overflow-hidden',
        !borderless && 'rounded-md border border-input bg-background',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      {/* Toolbar - top position */}
      {showToolbar && toolbarPosition === 'top' && (
        <MenuBar
          editor={editor}
          disabled={disabled}
          position="top"
          features={features}
          onImageUpload={onImageUpload}
        />
      )}

      {/* Editor content */}
      <EditorContent editor={editor} />

      {/* Floating bubble menu on text selection */}
      {features.bubbleMenu !== false && (
        <BubbleMenu
          editor={editor}
          options={{
            placement: 'top',
          }}
          shouldShow={({ editor, state }) => {
            // Don't show in code blocks
            if (editor.isActive('codeBlock')) return false
            // Only show when text is selected
            const { from, to } = state.selection
            return from !== to
          }}
        >
          <BubbleMenuContent editor={editor} disabled={disabled} />
        </BubbleMenu>
      )}

      {/* Toolbar - bottom position */}
      {showToolbar && toolbarPosition === 'bottom' && (
        <MenuBar
          editor={editor}
          disabled={disabled}
          position="bottom"
          features={features}
          onImageUpload={onImageUpload}
        />
      )}

      <style>{`
        .tiptap p.is-editor-empty:first-child::before {
          color: color-mix(in oklch, var(--muted-foreground), transparent 50%);
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }

        /* Code block syntax highlighting */
        .tiptap pre {
          background: var(--muted);
          border-radius: 0.5rem;
          padding: 1rem;
          overflow-x: auto;
        }

        .tiptap pre code {
          background: none;
          color: inherit;
          font-size: 0.875rem;
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
          padding: 0;
        }

        /* Inline code */
        .tiptap code:not(pre code) {
          background: var(--muted);
          padding: 0.125rem 0.25rem;
          border-radius: 0.25rem;
          font-size: 0.875em;
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        }

        /* Task list */
        .tiptap ul[data-type="taskList"] {
          list-style: none;
          padding-left: 0;
        }

        .tiptap ul[data-type="taskList"] li {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
        }

        .tiptap ul[data-type="taskList"] li > label {
          flex-shrink: 0;
          margin-top: 0.25rem;
        }

        .tiptap ul[data-type="taskList"] li > label input[type="checkbox"] {
          cursor: pointer;
          width: 1rem;
          height: 1rem;
          accent-color: var(--primary);
        }

        .tiptap ul[data-type="taskList"] li > div {
          flex: 1;
        }

        /* Blockquote */
        .tiptap blockquote {
          border-left: 4px solid var(--border);
          padding-left: 1rem;
          margin-left: 0;
          font-style: italic;
          color: var(--muted-foreground);
        }

        /* Horizontal rule */
        .tiptap hr {
          border: none;
          border-top: 1px solid var(--border);
          margin: 1.5rem 0;
        }

        /* Tables */
        .tiptap table {
          border-collapse: collapse;
          width: 100%;
          margin: 1rem 0;
        }

        .tiptap th,
        .tiptap td {
          border: 1px solid var(--border);
          padding: 0.5rem;
          text-align: left;
          min-width: 100px;
        }

        .tiptap th {
          background: color-mix(in oklch, var(--muted), transparent 50%);
          font-weight: 600;
        }

        .tiptap .selectedCell {
          background: color-mix(in oklch, var(--primary), transparent 85%);
        }

        /* Syntax highlighting colors */
        .hljs-keyword,
        .hljs-selector-tag,
        .hljs-built_in { color: var(--syntax-keyword, #c792ea); }
        .hljs-string,
        .hljs-attr { color: var(--syntax-string, #c3e88d); }
        .hljs-number,
        .hljs-literal { color: var(--syntax-number, #f78c6c); }
        .hljs-comment { color: var(--syntax-comment, #546e7a); }
        .hljs-function,
        .hljs-title { color: var(--syntax-function, #82aaff); }
        .hljs-variable,
        .hljs-template-variable { color: var(--syntax-variable, #f07178); }
        .hljs-type,
        .hljs-class { color: var(--syntax-type, #ffcb6b); }
      `}</style>
    </div>
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
        const node = schema.nodes.image?.create({ src })
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
        const node = schema.nodes.image?.create({ src })
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
}

function ToolbarButton({ icon, onClick, disabled, isActive, title }: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('h-7 w-7 p-0', isActive && 'bg-muted')}
      onClick={onClick}
      disabled={disabled}
      title={title}
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

// ============================================================================
// Fixed Toolbar Components
// ============================================================================

interface MenuBarProps {
  editor: Editor
  disabled: boolean
  position?: 'top' | 'bottom'
  features?: EditorFeatures
  onImageUpload?: (file: File) => Promise<string>
}

function MenuBar({
  editor,
  disabled,
  position = 'top',
  features = {},
  onImageUpload,
}: MenuBarProps) {
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
        editor.chain().focus().setImage({ src }).run()
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
        'flex items-center gap-1 flex-wrap',
        position === 'top' ? 'px-2 py-1.5 border-b border-input bg-muted/30' : 'pt-2'
      )}
    >
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
        const level = node.attrs?.level ?? 1
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
                const href = mark.attrs?.href ?? ''
                text = `<a href="${href}" class="text-primary underline" target="_blank" rel="noopener noreferrer">${text}</a>`
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
        const language = node.attrs?.language ?? ''
        const codeContent = node.content?.map(renderNode).join('') ?? ''
        return `<pre class="not-prose rounded-lg bg-muted p-4 overflow-x-auto"><code class="language-${language}">${codeContent}</code></pre>`
      }

      case 'image': {
        const src = node.attrs?.src ?? ''
        const alt = node.attrs?.alt ?? ''
        return `<img src="${src}" alt="${alt}" class="max-w-full h-auto rounded-lg" />`
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

export function RichTextContent({ content, className }: RichTextContentProps) {
  // For SSR: generate HTML directly from JSON content
  if (typeof content === 'object' && content.type === 'doc') {
    const html = generateContentHTML(content)
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
