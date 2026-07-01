import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { XMarkIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'

/**
 * In-editor render for an inline chat image. Reads the `{ src, alt }` off the
 * node and shows a bounded preview while composing. The wrapper is always
 * mounted (ProseMirror needs a DOM host) and stays non-editable; a node with no
 * src simply renders nothing inside it.
 */
function ConversationImageNodeView({ node, selected, deleteNode }: ReactNodeViewProps) {
  const src = node.attrs.src as string | null
  const alt = (node.attrs.alt as string | null) ?? ''
  return (
    <NodeViewWrapper className="group relative my-1 inline-block" contentEditable={false}>
      {src ? <img src={src} alt={alt} className="max-w-xs rounded-md" /> : null}
      {/* Remove control. mousedown-preventDefault so it doesn't steal the
          editor selection before the click fires. */}
      <button
        type="button"
        aria-label="Remove image"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => deleteNode()}
        className={cn(
          'absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-opacity hover:text-foreground',
          'opacity-0 group-hover:opacity-100 focus:opacity-100',
          selected && 'opacity-100'
        )}
      >
        <XMarkIcon className="size-3" />
      </button>
    </NodeViewWrapper>
  )
}

/**
 * A first-party TipTap node for an inline, removable chat image. An atom block
 * (no editable children) inserted after a paste/drop upload resolves. Serializes
 * to a plain `<img data-chat-image>` so a sent message's image round-trips
 * through any editor that has this node in its schema and renders on display
 * surfaces via the shared HTML serializer.
 */
export const ConversationImage = Node.create({
  // Serialized into stored message contentJson; the string is a data contract
  // and stays 'chatImage' until a Phase B migration rewrites existing content.
  name: 'chatImage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'img[data-chat-image]',
        getAttrs: (el) => ({
          src: (el as HTMLElement).getAttribute('src'),
          alt: (el as HTMLElement).getAttribute('alt'),
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'img',
      {
        'data-chat-image': '1',
        src: HTMLAttributes.src,
        alt: HTMLAttributes.alt,
      },
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ConversationImageNodeView)
  },
})
