/**
 * The shared conversation-thread core: the virtualized list (TanStack Virtual,
 * pinned-to-newest), the older-message backfill cursor, composer-doc
 * orchestration, typing signalling, and the read-receipt write. Each surface
 * (the admin inbox thread and the visitor thread behind the portal + widget)
 * supplies its data and capabilities through parameters — auth headers, cache
 * writes, error surfacing — rather than forking the machinery.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import type { JSONContent } from '@tiptap/core'
import type { ConversationId } from '@quackback/ids'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  listConversationMessagesFn,
  markConversationReadFn,
  sendConversationTypingFn,
} from '@/lib/server/functions/conversation'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'

/** True when the composer doc carries an inline image or post embed, which makes
 *  a message worth sending even with no typed text. Walks the doc since these are
 *  block atoms at the top level (and defensively, any nesting). */
export function docHasContentNode(doc: JSONContent | null): boolean {
  if (!doc) return false
  const walk = (nodes: JSONContent[] | undefined): boolean =>
    !!nodes?.some((n) => n.type === 'chatImage' || n.type === 'quackbackEmbed' || walk(n.content))
  return walk(doc.content)
}

/**
 * Composer-doc state: the rich editor's plain text (gates send + drives
 * typing/help-search), the TipTap doc persisted as contentJson (held in a ref —
 * it changes on every keystroke), a reactive "doc carries an inline
 * image/embed" mirror so the send gate enables for a no-text message, and the
 * reset signal that clears the editor after a send.
 */
export function useComposerDoc() {
  const [text, setText] = useState('')
  const docRef = useRef<JSONContent | null>(null)
  const [hasContentNode, setHasContentNode] = useState(false)
  const [resetSignal, setResetSignal] = useState(0)

  const onChange = useCallback((nextText: string, doc: JSONContent | null) => {
    setText(nextText)
    docRef.current = doc
    setHasContentNode(docHasContentNode(doc))
  }, [])

  const clear = useCallback(() => {
    setText('')
    docRef.current = null
    setHasContentNode(false)
    setResetSignal((n) => n + 1)
  }, [])

  return { text, docRef, hasContentNode, resetSignal, onChange, clear }
}

/** Near-end slack for the tail-follow effect below: within ~a row and a half
 *  of the bottom the viewport counts as "following"; further up the user is
 *  reading history and is left alone. */
const FOLLOW_END_THRESHOLD_PX = 96

/**
 * The thread virtualizer (shared config: anchored to the newest message,
 * following appends, keyed rows so prepends hold the viewport) plus the
 * one-shot initial scroll to the bottom once the thread has loaded. A surface
 * whose deep-link jump owns the first scroll consumes the one-shot without
 * scrolling via `skipInitialScroll`.
 */
export function useThreadVirtualizer<Row extends { key: string }>({
  rows,
  scrollRef,
  estimateSize,
  loading,
  skipInitialScroll,
}: {
  rows: Row[]
  scrollRef: RefObject<HTMLDivElement | null>
  estimateSize: number
  loading: boolean
  skipInitialScroll?: () => boolean
}) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    getItemKey: (index) => rows[index].key,
    anchorTo: 'end',
    followOnAppend: true,
    overscan: 6,
  })

  // Land on the newest message once the thread has loaded. Surfaces remount
  // per conversation, so this fires once per thread.
  const didInitialScroll = useRef(false)
  const skipRef = useRef(skipInitialScroll)
  skipRef.current = skipInitialScroll
  useLayoutEffect(() => {
    if (loading || didInitialScroll.current || rows.length === 0) return
    didInitialScroll.current = true
    if (skipRef.current?.()) return
    virtualizer.scrollToEnd()
  }, [loading, rows.length, virtualizer])

  // followOnAppend only snaps to the end when the row COUNT grows, but this
  // thread also swaps tail-row keys in place with an unchanged count: typing →
  // assistant-activity → assistant-stream → the persisted message (and the
  // seen caption coming and going). A swap fires no follow, and the new row
  // starts at the estimate while the old one was measured, stranding the
  // viewport ~a row-height above the end — at which point the library's
  // keep-pinned measure adjustments disengage too (they only engage within
  // scrollEndThreshold of the end), so assistant replies stop auto-scrolling
  // entirely. Snap to the end on any tail change while the viewport is near
  // it; a reader scrolled up beyond the threshold is left alone.
  const lastRowKey = rows.length > 0 ? rows[rows.length - 1].key : null
  useLayoutEffect(() => {
    if (!didInitialScroll.current || rows.length === 0) return
    if (skipRef.current?.()) return
    if (virtualizer.getDistanceFromEnd() <= FOLLOW_END_THRESHOLD_PX) {
      virtualizer.scrollToEnd()
    }
  }, [rows.length, lastRowKey, virtualizer])

  return virtualizer
}

/**
 * The virtualized thread viewport: each row is absolutely positioned at its
 * measured offset within a spacer sized to the total height (the TanStack
 * Virtual conversation pattern); measureElement re-pins after late-loading
 * images grow a row.
 */
export function ThreadViewport<Row extends { key: string }>({
  virtualizer,
  rows,
  renderRow,
  viewportRef,
  rowClassName,
  className,
  scrollBarClassName,
}: {
  virtualizer: Virtualizer<HTMLDivElement, Element>
  rows: Row[]
  renderRow: (row: Row) => ReactNode
  viewportRef: RefObject<HTMLDivElement | null>
  /** Padding around each row (surface-specific spacing). */
  rowClassName: string
  className?: string
  scrollBarClassName?: string
}) {
  return (
    <ScrollArea
      className={className}
      viewportRef={viewportRef}
      scrollBarClassName={scrollBarClassName}
    >
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((vi) => (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={virtualizer.measureElement}
            className="absolute inset-x-0 top-0"
            style={{ transform: `translateY(${vi.start}px)` }}
          >
            <div className={rowClassName}>{renderRow(rows[vi.index])}</div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

/**
 * The older-message backfill cursor (keyset = oldest loaded message id). The
 * surface applies the fetched page to its own thread cache via `onPage` and
 * surfaces failures via `onError` (the visitor surfaces stay silent).
 */
export function useOlderMessages({
  conversationId,
  messages,
  getHeaders,
  onPage,
  onError,
}: {
  conversationId: ConversationId | null
  messages: ConversationMessageDTO[]
  getHeaders?: () => Record<string, string>
  onPage: (page: Awaited<ReturnType<typeof listConversationMessagesFn>>) => void
  onError?: () => void
}) {
  const [loadingOlder, setLoadingOlder] = useState(false)

  const loadOlder = async () => {
    if (!conversationId || loadingOlder || messages.length === 0) return
    setLoadingOlder(true)
    try {
      const page = await listConversationMessagesFn({
        data: { conversationId, before: messages[0].id },
        ...(getHeaders ? { headers: getHeaders() } : {}),
      })
      onPage(page)
    } catch {
      onError?.()
    } finally {
      setLoadingOlder(false)
    }
  }

  return { loadingOlder, loadOlder }
}

/**
 * Clear the caller's unread state when the newest message comes from the other
 * side (`whenLastFrom`) — opening + reading marks read, not only replying, and
 * a surface's own outbound sends never trigger a write. Keyed on the last
 * message id so benign array re-creation doesn't re-fire it.
 */
export function useMarkReadOnIncoming({
  conversationId,
  messages,
  whenLastFrom,
  enabled = true,
  getHeaders,
  onMarked,
}: {
  conversationId: ConversationId | null
  messages: ConversationMessageDTO[]
  whenLastFrom: 'visitor' | 'agent'
  enabled?: boolean
  getHeaders?: () => Record<string, string>
  onMarked?: () => void
}) {
  const lastMessage = messages.at(-1)
  const lastMessageId = lastMessage?.id
  const lastSenderType = lastMessage?.senderType
  const getHeadersRef = useRef(getHeaders)
  getHeadersRef.current = getHeaders
  const onMarkedRef = useRef(onMarked)
  onMarkedRef.current = onMarked

  useEffect(() => {
    if (!conversationId || !enabled) return
    if (lastSenderType !== whenLastFrom) return
    const headers = getHeadersRef.current?.()
    void markConversationReadFn({
      data: { conversationId },
      ...(headers ? { headers } : {}),
    })
      .then(() => onMarkedRef.current?.())
      .catch(() => {})
    // lastSenderType is derived from lastMessageId (same message, same sender).
  }, [conversationId, lastMessageId, enabled, whenLastFrom, lastSenderType])
}

/** Throttled-typing sender for the composer (wired into useConversationTyping). */
export function useTypingSender(
  conversationId: ConversationId | null,
  getHeaders?: () => Record<string, string>
) {
  return useCallback(() => {
    if (!conversationId) return
    void sendConversationTypingFn({
      data: { conversationId },
      ...(getHeaders ? { headers: getHeaders() } : {}),
    }).catch(() => {})
  }, [conversationId, getHeaders])
}
