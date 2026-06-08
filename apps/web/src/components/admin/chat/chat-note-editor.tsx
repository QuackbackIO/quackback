import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import type { Editor, JSONContent } from '@tiptap/core'
import { TeamMentionExtension } from '@/components/ui/mention-extension'
import { QuackbackEmbed } from '@/components/ui/quackback-embed-extension'
import { hasActiveSuggestion } from '@/components/ui/rich-text-editor'
import { cn } from '@/lib/shared/utils'

interface ChatNoteEditorProps {
  placeholder?: string
  disabled?: boolean
  /** Bump to clear the editor — used to reset it after a note is sent. */
  resetSignal: number
  /** Fires on every change with the plain text (for the send-gate) + the
   *  TipTap doc (persisted as contentJson and mention-extracted server-side). */
  onChange: (text: string, doc: JSONContent) => void
  /** Plain Enter with the @-mention picker CLOSED. */
  onSubmit: () => void
  className?: string
}

/** Imperative handle so the composer's emoji picker can insert into the note. */
export interface ChatNoteEditorHandle {
  insertText: (text: string) => void
}

/**
 * A minimal, isolated TipTap editor for the internal-note composer — just
 * enough to support @-mention chips (reusing the shared mention picker +
 * /api/v1/mentions/suggest, scoped team-only via TeamMentionExtension since a
 * note mention is team-internal). Visitor-facing replies stay a plain textarea;
 * only notes are rich.
 *
 * Enter submits, Shift+Enter inserts a line break — except while the mention
 * picker is open, where Enter selects the highlighted teammate. We defer to the
 * picker via hasActiveSuggestion() rather than racing the suggestion plugin's
 * own key handling.
 */
export const ChatNoteEditor = forwardRef<ChatNoteEditorHandle, ChatNoteEditorProps>(
  function ChatNoteEditor(
    { placeholder, disabled, resetSignal, onChange, onSubmit, className },
    ref
  ) {
    // Keep callbacks fresh without tearing down + rebuilding the editor.
    const onSubmitRef = useRef(onSubmit)
    onSubmitRef.current = onSubmit
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    // The live TipTap editor, captured on create so the keymap can ask it whether
    // the @-mention picker is open (matches hasActiveSuggestion's call pattern).
    const editorRef = useRef<Editor | null>(null)

    useImperativeHandle(
      ref,
      () => ({
        insertText: (text: string) => {
          editorRef.current?.chain().focus().insertContent(text).run()
        },
      }),
      []
    )

    const editor = useEditor({
      editable: !disabled,
      onCreate: ({ editor }) => {
        editorRef.current = editor
      },
      extensions: [
        StarterKit.configure({ heading: false, codeBlock: false, horizontalRule: false }),
        Placeholder.configure({
          placeholder: placeholder ?? 'Add an internal note for your team…',
          emptyEditorClass: 'is-editor-empty',
        }),
        TeamMentionExtension,
        // Pasting a Quackback post/changelog link becomes a live embed card.
        QuackbackEmbed.configure({ enablePaste: true }),
      ],
      editorProps: {
        attributes: {
          class:
            'prose prose-sm prose-neutral dark:prose-invert max-w-none focus:outline-none min-h-[1.5rem] py-1',
        },
        handleKeyDown: (_view, event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            // The picker owns Enter while it's open (selects a teammate).
            if (editorRef.current && hasActiveSuggestion(editorRef.current)) return false
            event.preventDefault()
            onSubmitRef.current()
            return true
          }
          return false
        },
      },
      onUpdate: ({ editor }) => onChangeRef.current(editor.getText().trim(), editor.getJSON()),
    })

    // Clear on send (parent bumps resetSignal).
    useEffect(() => {
      if (resetSignal > 0) editor?.commands.clearContent()
    }, [resetSignal, editor])

    useEffect(() => {
      editor?.setEditable(!disabled)
    }, [disabled, editor])

    return (
      <EditorContent editor={editor} className={cn('flex-1 overflow-y-auto max-h-32', className)} />
    )
  }
)
