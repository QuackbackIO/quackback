import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ComponentPropsWithRef,
  type CSSProperties,
  type Key,
} from 'react'
import { cn } from '@/lib/shared/utils'

/**
 * The rich-text editor behind a lazy boundary. The editor (tiptap,
 * prosemirror, highlight.js) outweighs the rest of any page that
 * renders it, so surfaces that show it only after an interaction, or below the
 * content a visitor came for, load it as its own chunk. Render it inside
 * <Suspense>, with RichTextEditorPlaceholder as the fallback.
 */
const loadRichTextEditor = () => import('./rich-text-editor')

export const LazyRichTextEditor = lazy(() =>
  loadRichTextEditor().then((m) => ({ default: m.RichTextEditor }))
)

/** Start fetching the editor ahead of the first render that needs it. */
export function preloadRichTextEditor(): void {
  void loadRichTextEditor().catch(() => {})
}

/** Holds the editor's height while its chunk loads, so the layout stays put. */
export function RichTextEditorPlaceholder({ minHeight }: { minHeight: string }) {
  return <div aria-hidden style={{ minHeight }} />
}

export interface RichTextEditorEmptyStateProps extends Omit<
  ComponentPropsWithRef<'div'>,
  'placeholder'
> {
  placeholder?: string
  disabled?: boolean
  minHeight?: string
  fill?: boolean
  borderless?: boolean
  toolbarPosition?: 'top' | 'none' | 'bottom'
}

/**
 * An empty editor drawn without the editor: its frame, placeholder and
 * toolbar row at their mounted sizes (the row stays blank). It stands in while
 * TipTap mounts and until a deferred editor is wanted, so the swap to the real
 * editor does not move the layout. It lives here, beside the lazy boundary, so
 * drawing it never loads the editor.
 */
export function RichTextEditorEmptyState({
  placeholder = 'Write something...',
  className,
  disabled = false,
  minHeight = '120px',
  fill = false,
  borderless = false,
  toolbarPosition = borderless ? 'none' : 'bottom',
  ...rest
}: RichTextEditorEmptyStateProps) {
  return (
    <div
      className={cn(
        !borderless && 'overflow-hidden rounded-md border border-input bg-background',
        disabled && 'opacity-50 cursor-not-allowed',
        fill && 'flex h-full min-h-0 flex-col',
        className
      )}
      {...rest}
    >
      {/* Toolbar rows match MenuBar's padding around its h-7 buttons. */}
      {toolbarPosition === 'top' && (
        <div aria-hidden className="px-2 py-1.5 border-b border-input bg-muted/30">
          <div className="h-7" />
        </div>
      )}
      <div
        className={cn(
          'prose prose-sm prose-neutral dark:prose-invert max-w-none cursor-text',
          'min-h-[var(--editor-min-height)]',
          borderless ? 'py-0' : 'px-3 py-2',
          fill && 'min-h-0 flex-1'
        )}
        style={{ '--editor-min-height': minHeight } as CSSProperties}
      >
        <p className="text-muted-foreground/50">{placeholder}</p>
      </div>
      {toolbarPosition === 'bottom' && (
        <div aria-hidden className={cn('pt-1', borderless ? 'pb-0' : 'px-3 pb-2')}>
          <div className="h-7" />
        </div>
      )}
    </div>
  )
}

/**
 * The editor for a composer that sits beside content people mostly read. It
 * starts as the editor's empty state, drawn at the editor's size, and mounts
 * the real editor at the first sign of writing: the pointer arriving, or a
 * press or keyboard focus, which also focus the editor once it mounts. On a
 * touch screen, where a tap must reach an already mounted editor to raise the
 * keyboard, it mounts once the composer scrolls into view. Reading the page
 * never downloads or runs the editor.
 */
export function DeferredRichTextEditor({
  editorKey,
  ...props
}: ComponentProps<typeof LazyRichTextEditor> & {
  /** Remounts the editor, once mounted, when it changes (a reset after submit). */
  editorKey?: Key
}) {
  const [wanted, setWanted] = useState(false)
  // The press or focus that mounted the editor focuses it; a reset remounts it
  // unfocused, as an always-mounted editor would be.
  const [focusFor, setFocusFor] = useState<{ key: Key | undefined } | null>(null)
  const autofocus = focusFor && focusFor.key === editorKey ? 'end' : props.autofocus
  const standInRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = standInRef.current
    if (wanted || !el || !window.matchMedia?.('(pointer: coarse)').matches) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setWanted(true)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [wanted])

  const wantFocused = () => {
    setWanted(true)
    setFocusFor((current) => current ?? { key: editorKey })
  }
  const standIn = (
    <RichTextEditorEmptyState
      ref={standInRef}
      placeholder={props.placeholder}
      className={props.className}
      disabled={props.disabled}
      minHeight={props.minHeight}
      fill={props.fill}
      borderless={props.borderless}
      toolbarPosition={props.toolbarPosition}
      role="textbox"
      aria-multiline
      aria-label={props.placeholder}
      tabIndex={0}
      onPointerEnter={() => setWanted(true)}
      onPointerDown={wantFocused}
      onFocus={wantFocused}
    />
  )
  if (!wanted) return standIn
  return (
    <Suspense fallback={standIn}>
      <LazyRichTextEditor key={editorKey} {...props} autofocus={autofocus} />
    </Suspense>
  )
}
