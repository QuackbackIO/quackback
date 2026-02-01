import { useEditor, EditorContent, type Editor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { useEffect, useCallback } from 'react'
import { cn } from '@/lib/shared/utils'
import {
  Bold,
  Italic,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Code2,
  ImagePlus,
} from 'lucide-react'
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  LinkIcon,
  ListBulletIcon,
} from '@heroicons/react/24/solid'
import { Button } from './button'

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
        blockquote: false,
        horizontalRule: false,
        link: false, // Disable built-in Link, we use our own configured version
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
              case 'code':
                text = `<code>${text}</code>`
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

      case 'codeBlock': {
        const language = node.attrs?.language ?? ''
        const codeContent = node.content?.map(renderNode).join('') ?? ''
        return `<pre><code class="language-${language}">${codeContent}</code></pre>`
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
