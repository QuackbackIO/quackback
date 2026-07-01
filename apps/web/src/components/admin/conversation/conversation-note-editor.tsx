import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import type { Editor, JSONContent } from '@tiptap/core'
import { TeamMentionExtension } from '@/components/ui/mention-extension'
import { QuackbackEmbed } from '@/components/ui/quackback-embed-extension'
import { ConversationLink, LinkBackspaceUnlink } from '@/components/ui/conversation-link'
import {
  hasActiveSuggestion,
  createEmojiExtension,
  withLiveEditor,
} from '@/components/ui/rich-text-editor'
import { cn } from '@/lib/shared/utils'

interface ConversationNoteEditorProps {
  placeholder?: string
  disabled?: boolean
  /** Bump to clear the editor — used to reset it after a note is sent. */
  resetSignal: number
  /** Fires on every change with the plain text (for the send-gate) + the
   *  TipTap doc (persisted as contentJson and mention-extracted server-side). */
  onChange: (text: string, doc: JSONContent) => void
  /** Plain Enter with the @-mention picker CLOSED. */
  onSubmit: () => void
  /** Pasted/dropped image files — handed to the parent to add to the note's
   *  attachment tray (notes attach images as files, not inline nodes). */
  onImageFiles?: (files: File[]) => void
  className?: string
}

/** Imperative handle so the composer's emoji picker can insert into the note. */
export interface ConversationNoteEditorHandle {
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
export const ConversationNoteEditor = forwardRef<
  ConversationNoteEditorHandle,
  ConversationNoteEditorProps
>(function ConversationNoteEditor(
  { placeholder, disabled, resetSignal, onChange, onSubmit, onImageFiles, className },
  ref
) {
  // Keep callbacks fresh without tearing down + rebuilding the editor.
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onImageFilesRef = useRef(onImageFiles)
  onImageFilesRef.current = onImageFiles
  // The live TipTap editor, captured on create so the keymap can ask it whether
  // the @-mention picker is open (matches hasActiveSuggestion's call pattern).
  const editorRef = useRef<Editor | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      insertText: (text: string) =>
        withLiveEditor(editorRef.current, (e) => e.chain().focus().insertContent(text).run()),
    }),
    []
  )

  const editor = useEditor({
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
      }),
      Placeholder.configure({
        placeholder: placeholder ?? 'Add an internal note for your team…',
        emptyEditorClass: 'is-editor-empty',
      }),
      // Autolink typed/pasted URLs; Backspace at a link edge unlinks.
      ConversationLink,
      LinkBackspaceUnlink,
      TeamMentionExtension,
      // Pasting a Quackback post/changelog link becomes a live embed card.
      QuackbackEmbed.configure({ enablePaste: true }),
      // `:`-triggered inline emoji picker (same as posts).
      createEmojiExtension(),
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
      // Pasted images go to the note's attachment tray (handed up to the
      // parent); non-image paste falls through to default handling.
      handlePaste: (_view, event) => {
        const handler = onImageFilesRef.current
        if (!handler) return false
        const images = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith('image/')
        )
        if (images.length === 0) return false
        event.preventDefault()
        handler(images)
        return true
      },
      // Dropped image files go to the tray too. `moved` is an in-editor drag,
      // not an external file — leave those to ProseMirror.
      handleDrop: (_view, event, _slice, moved) => {
        const handler = onImageFilesRef.current
        if (!handler || moved) return false
        const images = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
          f.type.startsWith('image/')
        )
        if (images.length === 0) return false
        event.preventDefault()
        handler(images)
        return true
      },
    },
    onUpdate: ({ editor }) => onChangeRef.current(editor.getText().trim(), editor.getJSON()),
  })

  // Keep the ref on the LIVE editor every render: TipTap can recreate the
  // editor (e.g. React StrictMode double-mount), leaving an onCreate-only ref
  // pointing at a destroyed instance whose commandManager is null.
  editorRef.current = editor

  // Clear on send (parent bumps resetSignal) and keep focus so the next note
  // can be typed without re-clicking the editor.
  useEffect(() => {
    if (resetSignal > 0) editor?.chain().clearContent().focus().run()
  }, [resetSignal, editor])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [disabled, editor])

  return (
    <EditorContent editor={editor} className={cn('flex-1 overflow-y-auto max-h-32', className)} />
  )
})
