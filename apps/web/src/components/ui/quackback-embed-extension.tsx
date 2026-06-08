import { Node, nodePasteRule } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { XMarkIcon } from '@heroicons/react/24/solid'
import { POST_URL_PASTE_RE, CHANGELOG_URL_PASTE_RE } from '@/lib/shared/embeds/parse-embed-url'
import { QuackbackEmbedCard } from '@/components/shared/quackback-embed-card'
import { cn } from '@/lib/shared/utils'

export interface QuackbackEmbedOptions {
  /** When true, pasting a post/changelog URL converts it into an embed node.
   * Off by default so the node is always in the schema (existing content
   * round-trips) but paste only fires on editors that opt in. */
  enablePaste: boolean
}

/**
 * In-editor render for a Quackback link embed. Reads the `{ kind, id }` off the
 * node and defers to the shared, viewer-scoped {@link QuackbackEmbedCard}. The
 * wrapper is always mounted (ProseMirror needs a DOM host) and stays
 * non-editable; an empty node simply renders nothing inside it.
 */
function QuackbackEmbedNodeView({ node, selected, deleteNode }: ReactNodeViewProps) {
  const kind = node.attrs.kind as 'post' | 'changelog' | null
  const id = node.attrs.id as string | null
  return (
    <NodeViewWrapper
      className={cn(
        'quackback-embed-nodeview group relative my-2 inline-block max-w-full rounded-md',
        selected && 'ring-2 ring-ring ring-offset-1'
      )}
      contentEditable={false}
    >
      {/* Inert preview while composing — no live voting, no navigation. */}
      {kind && id ? <QuackbackEmbedCard kind={kind} id={id} interactive={false} /> : null}
      {/* Remove control. mousedown-preventDefault so it doesn't steal the
          editor selection before the click fires. */}
      <button
        type="button"
        aria-label="Remove embed"
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
 * A first-party TipTap node for embedding Quackback posts / changelog entries.
 * An atom block (no editable children) that paste rules create from a pasted
 * URL. Serializes to `<div data-quackback-embed data-kind data-id>` so saved
 * content round-trips through any editor that has this node in its schema.
 */
export const QuackbackEmbed = Node.create<QuackbackEmbedOptions>({
  name: 'quackbackEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { enablePaste: false }
  },

  addAttributes() {
    return {
      kind: { default: null },
      id: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-quackback-embed]',
        getAttrs: (el) => ({
          kind: (el as HTMLElement).getAttribute('data-kind'),
          id: (el as HTMLElement).getAttribute('data-id'),
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      {
        'data-quackback-embed': '1',
        'data-kind': HTMLAttributes.kind,
        'data-id': HTMLAttributes.id,
      },
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(QuackbackEmbedNodeView)
  },

  addPasteRules() {
    if (!this.options.enablePaste) return []
    return [
      nodePasteRule({
        find: POST_URL_PASTE_RE,
        type: this.type,
        getAttributes: (match) => ({ kind: 'post', id: match[1] }),
      }),
      nodePasteRule({
        find: CHANGELOG_URL_PASTE_RE,
        type: this.type,
        getAttributes: (match) => ({ kind: 'changelog', id: match[1] }),
      }),
    ]
  },
})
