import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import type { Editor, JSONContent } from '@tiptap/core'
import { QuackbackEmbed } from '@/components/ui/quackback-embed-extension'
import { ChatImage } from '@/components/ui/chat-image-node'
import { hasActiveSuggestion } from '@/components/ui/rich-text-editor'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/shared/utils'

interface ChatRichComposerProps {
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
  className?: string
}

/** Imperative handle so the composer's toolbar (emoji, etc.) can drive the editor. */
export interface ChatRichComposerHandle {
  insertText: (text: string) => void
  /** Insert an already-uploaded image as an inline, removable node — used by the
   *  explicit "attach image" button so it matches paste/drop behavior. */
  insertImage: (src: string) => void
  focus: () => void
}

/**
 * A reusable, visitor-facing TipTap composer for chat. Modeled on the
 * internal-note editor but with team @-mentions removed (visitors can't mention
 * teammates) and inline images added: pasting/dropping an image uploads it and
 * inserts a removable {@link ChatImage} node, and pasting a Quackback link
 * becomes a live embed card.
 *
 * Enter submits, Shift+Enter inserts a line break — except while a suggestion
 * popup is open, where Enter is yielded to it. We defer via
 * hasActiveSuggestion() rather than racing the suggestion plugin's key handling.
 */
export const ChatRichComposer = forwardRef<ChatRichComposerHandle, ChatRichComposerProps>(
  function ChatRichComposer(
    {
      placeholder,
      disabled,
      resetSignal,
      onChange,
      onSubmit,
      onLocalInput,
      uploadImage,
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
    // The live TipTap editor, captured on create so the keymap can ask it whether
    // a suggestion popup is open and so paste/drop handlers can insert nodes.
    const editorRef = useRef<Editor | null>(null)

    useImperativeHandle(
      ref,
      () => ({
        insertText: (text: string) => {
          editorRef.current?.chain().focus().insertContent(text).run()
        },
        insertImage: (src: string) => {
          editorRef.current
            ?.chain()
            .focus()
            .insertContent({ type: 'chatImage', attrs: { src } })
            .run()
        },
        focus: () => {
          editorRef.current?.chain().focus().run()
        },
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
          editorRef.current?.chain().insertContent({ type: 'chatImage', attrs: { src } }).run()
        })
        .catch((err) => {
          console.error('[ChatRichComposer] Image upload failed:', err)
        })
    }

    const editor = useEditor({
      editable: !disabled,
      onCreate: ({ editor }) => {
        editorRef.current = editor
      },
      extensions: [
        StarterKit.configure({ heading: false, codeBlock: false, horizontalRule: false }),
        Placeholder.configure({
          placeholder: placeholder ?? 'Write a reply…',
          emptyEditorClass: 'is-editor-empty',
        }),
        // Pasting a Quackback post/changelog link becomes a live embed card.
        QuackbackEmbed.configure({ enablePaste: true }),
        // Inline, removable images inserted on paste/drop upload.
        ChatImage,
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
        // Intercept image paste so it uploads + inserts a chatImage; let any
        // other paste (text, Quackback links) fall through to the paste rules.
        handlePaste: (_view, event) => {
          if (!uploadImageRef.current) return false
          const images = Array.from(event.clipboardData?.files ?? []).filter((f) =>
            f.type.startsWith('image/')
          )
          if (images.length === 0) return false
          event.preventDefault()
          images.forEach(insertUploadedImage)
          return true
        },
        // Intercept image drop the same way. `moved` is an in-editor drag, not
        // an external file — leave those to ProseMirror.
        handleDrop: (_view, event, _slice, moved) => {
          if (!uploadImageRef.current || moved) return false
          const images = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
            f.type.startsWith('image/')
          )
          if (images.length === 0) return false
          event.preventDefault()
          images.forEach(insertUploadedImage)
          return true
        },
      },
      onUpdate: ({ editor }) => {
        onChangeRef.current(editor.getText().trim(), editor.getJSON())
        onLocalInputRef.current?.()
      },
    })

    // Clear on send (parent bumps resetSignal).
    useEffect(() => {
      if (resetSignal > 0) editor?.commands.clearContent()
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
  }
)
