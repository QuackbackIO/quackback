import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { XMarkIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'

function UploadedVideoNodeView({ node, selected, deleteNode }: ReactNodeViewProps) {
  const src = node.attrs.src as string | null
  const title = (node.attrs.title as string | null) ?? ''
  return (
    <NodeViewWrapper className="group relative my-4" contentEditable={false}>
      {src ? (
        <video
          src={src}
          title={title}
          controls
          preload="metadata"
          playsInline
          className="max-h-[70vh] w-full rounded-lg bg-black"
        />
      ) : null}
      <button
        type="button"
        aria-label="Remove video"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => deleteNode()}
        className={cn(
          'absolute right-2 top-2 flex size-7 items-center justify-center rounded-full border border-white/30 bg-black/70 text-white shadow-sm transition-opacity hover:bg-black/90',
          'opacity-0 group-hover:opacity-100 focus:opacity-100',
          selected && 'opacity-100'
        )}
      >
        <XMarkIcon className="size-4" />
      </button>
    </NodeViewWrapper>
  )
}

/** Native uploaded-video block stored in TipTap JSON as `{ type: 'video' }`. */
export const UploadedVideo = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      mimeType: { default: 'video/mp4' },
      title: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'video[data-quackback-video]',
        getAttrs: (element) => ({
          src: (element as HTMLElement).getAttribute('src'),
          mimeType: (element as HTMLElement).getAttribute('type') || 'video/mp4',
          title: (element as HTMLElement).getAttribute('title'),
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'video',
      {
        'data-quackback-video': '1',
        src: HTMLAttributes.src,
        type: HTMLAttributes.mimeType,
        title: HTMLAttributes.title,
        controls: 'controls',
        preload: 'metadata',
        playsinline: 'playsinline',
        class: 'max-h-[70vh] w-full rounded-lg bg-black',
      },
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(UploadedVideoNodeView)
  },
})
