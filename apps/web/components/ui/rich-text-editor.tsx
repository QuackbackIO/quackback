'use client'

import { useEditor, EditorContent, type Editor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import { useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Bold, Italic, List, ListOrdered, Undo, Redo, Link as LinkIcon } from 'lucide-react'
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

      <style jsx global>{`
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

function MenuBar({
  editor,
  disabled,
  position = 'top',
}: {
  editor: Editor
  disabled: boolean
  position?: 'top' | 'bottom'
}) {
  const setLink = useCallback(() => {
    if (!editor) return

    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('URL', previousUrl)

    if (url === null) return

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  return (
    <div
      className={cn(
        'flex items-center gap-1',
        position === 'top' ? 'px-2 py-1.5 border-b border-input bg-muted/30' : 'pt-2'
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn('h-7 w-7 p-0', editor.isActive('bold') && 'bg-muted')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={disabled || !editor.can().chain().focus().toggleBold().run()}
      >
        <Bold className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn('h-7 w-7 p-0', editor.isActive('italic') && 'bg-muted')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={disabled || !editor.can().chain().focus().toggleItalic().run()}
      >
        <Italic className="h-4 w-4" />
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn('h-7 w-7 p-0', editor.isActive('bulletList') && 'bg-muted')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        disabled={disabled}
      >
        <List className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn('h-7 w-7 p-0', editor.isActive('orderedList') && 'bg-muted')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        disabled={disabled}
      >
        <ListOrdered className="h-4 w-4" />
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn('h-7 w-7 p-0', editor.isActive('link') && 'bg-muted')}
        onClick={setLink}
        disabled={disabled}
      >
        <LinkIcon className="h-4 w-4" />
      </Button>
      <div className="flex-1" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={disabled || !editor.can().chain().focus().undo().run()}
      >
        <Undo className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={disabled || !editor.can().chain().focus().redo().run()}
      >
        <Redo className="h-4 w-4" />
      </Button>
    </div>
  )
}

// Read-only content renderer
interface RichTextContentProps {
  content: JSONContent | string
  className?: string
}

export function RichTextContent({ content, className }: RichTextContentProps) {
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
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          class: 'text-primary underline',
        },
      }),
    ],
    content,
    editable: false,
    editorProps: {
      attributes: {
        class: cn('prose prose-neutral dark:prose-invert max-w-none', className),
      },
    },
  })

  // Update editor content when content prop changes
  useEffect(() => {
    if (editor && content) {
      // Only update if content has actually changed
      const currentContent = editor.getJSON()
      const newContentStr = JSON.stringify(content)
      const currentContentStr = JSON.stringify(currentContent)
      if (newContentStr !== currentContentStr) {
        editor.commands.setContent(content)
      }
    }
  }, [editor, content])

  return <EditorContent editor={editor} />
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
