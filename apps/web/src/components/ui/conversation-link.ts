import Link from '@tiptap/extension-link'
import { Extension } from '@tiptap/core'

/**
 * Link config matching the post editor (open-on-click off, primary-underline
 * style) plus explicit autolink + linkOnPaste, so typed and pasted URLs become
 * clickable links — the URL recognition mainstream chat apps have.
 */
export const ConversationLink = Link.configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  HTMLAttributes: { class: 'text-primary underline' },
})

/**
 * Backspace at the trailing edge of a link strips the link mark (keeping the
 * text) instead of deleting a character — a "backspace to unlink" affordance.
 * Only fires when the char before the cursor is linked and the one after is not,
 * so it never hijacks a mid-word backspace; the cursor is restored so a second
 * backspace deletes normally.
 */
export const LinkBackspaceUnlink = Extension.create({
  name: 'linkBackspaceUnlink',
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { selection, schema } = editor.state
        if (!selection.empty) return false
        const linkType = schema.marks.link
        if (!linkType) return false
        const { $from } = selection
        const beforeLinked = !!$from.nodeBefore?.marks.some((m) => m.type === linkType)
        const afterLinked = !!$from.nodeAfter?.marks.some((m) => m.type === linkType)
        if (!beforeLinked || afterLinked) return false
        const pos = $from.pos
        return editor
          .chain()
          .extendMarkRange('link')
          .unsetLink()
          .setTextSelection(pos)
          .focus()
          .run()
      },
    }
  },
})
