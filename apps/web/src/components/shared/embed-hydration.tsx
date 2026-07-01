import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { isValidTypeId } from '@quackback/ids'
import { isValidArticleSlug } from '@/lib/shared/embeds/parse-embed-url'
import { QuackbackEmbedCard, type EmbedOpenMode } from '@/components/shared/quackback-embed-card'

interface EmbedTarget {
  el: HTMLElement
  kind: 'post' | 'changelog' | 'article'
  id: string
}

/**
 * Hydrates Quackback link embeds inside a static rich-text surface.
 *
 * Display surfaces render saved content as static HTML (`generateContentHTML`
 * → `dangerouslySetInnerHTML`), not a live editor, so an embed node serializes
 * to an inert `<div data-quackback-embed data-kind data-id>` placeholder. This
 * wrapper mirrors {@link MentionHoverCardOverlay}: it owns the container `div`,
 * scans it for placeholders after each render, and portals a live
 * {@link QuackbackEmbedCard} into each one. A malformed placeholder (missing or
 * foreign kind/id) is simply skipped, so an embed never breaks the page.
 */
export function EmbedHydration({
  children,
  className,
  openMode,
  onOpenInModal,
  getAuthHeaders,
}: {
  children: ReactNode
  className?: string
  /** How hydrated embed cards open their target — forwarded to every card. The
   *  default (same-tab navigation) suits display surfaces; conversation surfaces pass
   *  `newTab` (widget) or `modal` (admin). */
  openMode?: EmbedOpenMode
  /** Opens a post in place; required when `openMode` is `modal`. */
  onOpenInModal?: (postId: string) => void
  /**
   * Called at request time to supply auth headers. The widget passes
   * `getWidgetAuthHeaders` here so the embed preview fetch and vote mutation
   * both carry the visitor's Bearer token. Portal and admin surfaces omit
   * this; cookie-based auth continues to work unchanged.
   */
  getAuthHeaders?: () => Record<string, string>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [targets, setTargets] = useState<EmbedTarget[]>([])

  // Re-scan whenever the rendered content changes. Surfaces pass a fresh
  // `RichTextContent` element when their content changes, which re-runs
  // `dangerouslySetInnerHTML` and produces new placeholder elements; the new
  // `children` reference re-fires this effect so portals retarget. We never
  // mutate the placeholders ourselves here, so there's no observer loop.
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const found: EmbedTarget[] = []
    root.querySelectorAll<HTMLElement>('[data-quackback-embed]').forEach((el) => {
      const kind = el.getAttribute('data-kind')
      const id = el.getAttribute('data-id')
      // Re-validate kind AND the id (defense in depth): a stray placeholder that
      // ever slipped past the write sanitizer can't trigger a lookup with a junk
      // id. post/changelog ids are TypeIDs; an article id is a help-center slug.
      if (!id) return
      const valid =
        kind === 'article'
          ? isValidArticleSlug(id)
          : (kind === 'post' || kind === 'changelog') && isValidTypeId(id, kind)
      if (valid) found.push({ el, kind: kind as EmbedTarget['kind'], id })
    })
    setTargets(found)
  }, [children])

  return (
    <div ref={containerRef} className={className} data-slot="embed-hydration">
      {children}
      {targets.map((t, i) =>
        createPortal(
          <QuackbackEmbedCard
            kind={t.kind}
            id={t.id}
            openMode={openMode}
            onOpenInModal={onOpenInModal}
            getAuthHeaders={getAuthHeaders}
          />,
          t.el,
          `${t.kind}:${t.id}:${i}`
        )
      )}
    </div>
  )
}
