import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import type { Editor, JSONContent } from '@tiptap/core'
import { QuackbackEmbed } from '@/components/ui/quackback-embed-extension'
import { ConversationImage } from '@/components/ui/conversation-image-node'
import { ConversationLink, LinkBackspaceUnlink } from '@/components/ui/conversation-link'
import {
  hasActiveSuggestion,
  createEmojiExtension,
  withLiveEditor,
} from '@/components/ui/rich-text-editor'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/shared/utils'

interface ConversationRichComposerProps {
  placeholder?: string
  disabled?: boolean
  /** Bump to clear the editor — used to reset it after a message is sent. */
  resetSignal: number
  /** Fires on every change with the plain text (for the send-gate) + the
   *  TipTap doc (persisted as contentJson). */
  onChange: (text: string, doc: JSONContent) => void
  /** Plain Enter with no suggestion popup open. */
  onSubmit: () => void
  /** Fires on every local keystroke — used for typing indicators. */
  onLocalInput?: () => void
  /** Uploads an image file and resolves to its public URL. When provided, image
   *  paste/drop is intercepted and inserted as an inline `chatImage` node. */
  uploadImage?: (file: File) => Promise<string>
  /** When provided, pasted/dropped image files are handed to the parent (e.g. an
   *  attachment tray) instead of being inlined. Takes precedence over
   *  `uploadImage`, so a composer using a tray never inlines. */
  onImageFiles?: (files: File[]) => void
  className?: string
}

/** Imperative handle so the composer's toolbar (emoji, etc.) can drive the editor. */
export interface ConversationRichComposerHandle {
  insertText: (text: string) => void
  /** Insert an already-uploaded image as an inline, removable node — used by the
   *  explicit "attach image" button so it matches paste/drop behavior. */
  insertImage: (src: string) => void
  focus: () => void
  /** Plain text of the current content: a read seam for callers that need to
   *  act on the live draft (e.g. the Copilot Format chip's empty-check and
   *  its transform-replace flow) without duplicating editor state of their
   *  own. Returns '' once the editor is destroyed or never mounted. */
  getText: () => string
  /** Replace the entire document with `text` in a single chain (select-all +
   *  insert), which TipTap collapses into one transaction, so Ctrl+Z undoes
   *  the whole replace in one step and restores the prior draft, instead of
   *  undoing a select then an insert separately. */
  replaceText: (text: string) => void
  /** Undo the last transaction: exposed so a toast action button can revert
   *  a `replaceText` (e.g. after a Format transform) without the teammate
   *  reaching for the keyboard. */
  undo: () => void
}

/**
 * A reusable, visitor-facing TipTap composer for conversations. Modeled on the
 * internal-note editor but with team @-mentions removed (visitors can't mention
 * teammates) and inline images added: pasting/dropping an image uploads it and
 * inserts a removable {@link ConversationImage} node, and pasting a Quackback link
 * becomes a live embed card.
 *
 * Enter submits, Shift+Enter inserts a line break — except while a suggestion
 * popup is open, where Enter is yielded to it. We defer via
 * hasActiveSuggestion() rather than racing the suggestion plugin's key handling.
 */
export const ConversationRichComposer = forwardRef<
  ConversationRichComposerHandle,
  ConversationRichComposerProps
>(function ConversationRichComposer(
  {
    placeholder,
    disabled,
    resetSignal,
    onChange,
    onSubmit,
    onLocalInput,
    uploadImage,
    onImageFiles,
    className,
  },
  ref
) {
  // Keep callbacks fresh without tearing down + rebuilding the editor.
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onLocalInputRef = useRef(onLocalInput)
  onLocalInputRef.current = onLocalInput
  const uploadImageRef = useRef(uploadImage)
  uploadImageRef.current = uploadImage
  const onImageFilesRef = useRef(onImageFiles)
  onImageFilesRef.current = onImageFiles
  // The live TipTap editor, captured on create so the keymap can ask it whether
  // a suggestion popup is open and so paste/drop handlers can insert nodes.
  const editorRef = useRef<Editor | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      insertText: (text: string) =>
        withLiveEditor(editorRef.current, (e) => e.chain().focus().insertContent(text).run()),
      insertImage: (src: string) =>
        withLiveEditor(editorRef.current, (e) =>
          e.chain().focus().insertContent({ type: 'chatImage', attrs: { src } }).run()
        ),
      focus: () => withLiveEditor(editorRef.current, (e) => e.chain().focus().run()),
      getText: () =>
        editorRef.current && !editorRef.current.isDestroyed ? editorRef.current.getText() : '',
      replaceText: (text: string) =>
        withLiveEditor(editorRef.current, (e) =>
          e.chain().focus().selectAll().insertContent(text).run()
        ),
      undo: () => withLiveEditor(editorRef.current, (e) => e.chain().focus().undo().run()),
    }),
    []
  )

  // Uploads an image file then inserts a chatImage node at the selection.
  // Shared by the paste + drop handlers below.
  const insertUploadedImage = (file: File) => {
    const upload = uploadImageRef.current
    if (!upload) return
    upload(file)
      .then((src) => {
        // The editor can unmount during the await — guard before inserting.
        withLiveEditor(editorRef.current, (e) =>
          e.chain().insertContent({ type: 'chatImage', attrs: { src } }).run()
        )
      })
      .catch((err) => {
        console.error('[ConversationRichComposer] Image upload failed:', err)
      })
  }

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
        placeholder: placeholder ?? 'Write a reply…',
        emptyEditorClass: 'is-editor-empty',
      }),
      // Autolink typed/pasted URLs; Backspace at a link edge unlinks.
      ConversationLink,
      LinkBackspaceUnlink,
      // Pasting a Quackback post/changelog link becomes a live embed card.
      QuackbackEmbed.configure({ enablePaste: true }),
      // Inline, removable images inserted on paste/drop upload.
      ConversationImage,
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
          // A suggestion popup (emoji, embed) owns Enter while it's open.
          if (editorRef.current && hasActiveSuggestion(editorRef.current)) return false
          event.preventDefault()
          onSubmitRef.current()
          return true
        }
        return false
      },
      // Intercept image paste: hand files to the tray when `onImageFiles` is
      // set, otherwise inline them. Other paste (text, Quackback links) falls
      // through to the paste rules.
      handlePaste: (_view, event) => {
        if (!onImageFilesRef.current && !uploadImageRef.current) return false
        const images = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith('image/')
        )
        if (images.length === 0) return false
        event.preventDefault()
        if (onImageFilesRef.current) onImageFilesRef.current(images)
        else images.forEach(insertUploadedImage)
        return true
      },
      // Intercept image drop the same way. `moved` is an in-editor drag, not
      // an external file — leave those to ProseMirror.
      handleDrop: (_view, event, _slice, moved) => {
        if ((!onImageFilesRef.current && !uploadImageRef.current) || moved) return false
        const images = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
          f.type.startsWith('image/')
        )
        if (images.length === 0) return false
        event.preventDefault()
        if (onImageFilesRef.current) onImageFilesRef.current(images)
        else images.forEach(insertUploadedImage)
        return true
      },
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current(editor.getText().trim(), editor.getJSON())
      onLocalInputRef.current?.()
    },
  })

  // Keep the ref on the LIVE editor every render (same pattern as the callback
  // refs above). TipTap can recreate the editor — e.g. React StrictMode's
  // double-mount destroys the first instance — and a ref captured only in
  // onCreate would be left pointing at the destroyed one, so imperative calls
  // like insertText() would hit a null commandManager and throw.
  editorRef.current = editor

  // Clear on send (parent bumps resetSignal) and keep focus so the agent can
  // type the next message without re-clicking the composer.
  useEffect(() => {
    if (resetSignal > 0) editor?.chain().clearContent().focus().run()
  }, [resetSignal, editor])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [disabled, editor])

  // The editor grows with its content up to a cap, then scrolls inside a
  // styled ScrollArea (a thin overlay scrollbar, matching the main rich-text
  // editor) instead of the browser's chunky native one. The cap lives on the
  // scroll viewport so the bar tracks the editor, not the outer flex box.
  return (
    <ScrollArea
      className={cn('flex-1 [&_[data-slot=scroll-area-viewport]]:max-h-32', className)}
      scrollBarClassName="w-1.5"
    >
      <EditorContent editor={editor} />
    </ScrollArea>
  )
})
