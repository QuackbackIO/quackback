import { lazy } from 'react'

/**
 * The rich-text editor behind a lazy boundary. The editor (tiptap,
 * prosemirror, highlight.js, emoji data) outweighs the rest of any page that
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
