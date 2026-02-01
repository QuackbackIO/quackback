import { useEditor, EditorContent, type Editor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import { useEffect, useCallback } from 'react'
import { cn } from '@/lib/shared/utils'
import { Bold, Italic, ListOrdered } from 'lucide-react'
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  LinkIcon,
  ListBulletIcon,
} from '@heroicons/react/24/solid'
import { Button } from './button'

interface RichTextEditorProps {
  value?: string | JSONContent
  onChange?: (json: JSONContent, html: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  minHeight?: string
  borderless?: boolean
  toolbarPosition?: 'top' | 'bottom' | 'none'
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write something...',
  className,
  disabled = false,
  minHeight = '120px',
  borderless = false,
  toolbarPosition = borderless ? 'none' : 'top',
}: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
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
        <MenuBar editor={editor} disabled={disabled} position="top" />
      )}

      {/* Editor content */}
      <EditorContent editor={editor} />

      {/* Toolbar - bottom position */}
      {showToolbar && toolbarPosition === 'bottom' && (
        <MenuBar editor={editor} disabled={disabled} position="bottom" />
      )}

      <style>{`
        .tiptap p.is-editor-empty:first-child::before {
          color: color-mix(in oklch, var(--muted-foreground), transparent 50%);
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }
      `}</style>
    </div>
  )
}

interface ToolbarButtonProps {
  icon: React.ReactNode
  onClick: () => void
  disabled: boolean
  isActive?: boolean
}

function ToolbarButton({ icon, onClick, disabled, isActive }: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('h-7 w-7 p-0', isActive && 'bg-muted')}
      onClick={onClick}
      disabled={disabled}
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
}

function MenuBar({ editor, disabled, position = 'top' }: MenuBarProps) {
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

  const canUndo = editor.can().chain().focus().undo().run()
  const canRedo = editor.can().chain().focus().redo().run()

  return (
    <div
      className={cn(
        'flex items-center gap-1',
        position === 'top' ? 'px-2 py-1.5 border-b border-input bg-muted/30' : 'pt-2'
      )}
    >
      <ToolbarButton
        icon={<Bold className="size-4" />}
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={disabled || !editor.can().chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
      />
      <ToolbarButton
        icon={<Italic className="size-4" />}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={disabled || !editor.can().chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={<ListBulletIcon className="size-4" />}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        disabled={disabled}
        isActive={editor.isActive('bulletList')}
      />
      <ToolbarButton
        icon={<ListOrdered className="size-4" />}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        disabled={disabled}
        isActive={editor.isActive('orderedList')}
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={<LinkIcon className="size-4" />}
        onClick={setLink}
        disabled={disabled}
        isActive={editor.isActive('link')}
      />
      <div className="flex-1" />
      <ToolbarButton
        icon={<ArrowUturnLeftIcon className="size-4" />}
        onClick={() => editor.chain().focus().undo().run()}
        disabled={disabled || !canUndo}
      />
      <ToolbarButton
        icon={<ArrowUturnRightIcon className="size-4" />}
        onClick={() => editor.chain().focus().redo().run()}
        disabled={disabled || !canRedo}
      />
    </div>
  )
}

// Read-only content renderer - SSR compatible
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
