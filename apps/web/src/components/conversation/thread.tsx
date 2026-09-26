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
import { useVisitorSurfaceRpc, type VisitorSurfaceRpc } from '@/lib/client/visitor-surface-rpc'
import {
  createValueStore,
  useDebouncedStoreValue,
  useStoreValue,
  type ReadableStore,
} from '@/lib/client/value-store'
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

/** What the composer holds: the editor's plain text and its TipTap doc. */
export interface ComposerDocDraft {
  /** Plain text: gates send, drives typing and help search. */
  text: string
  /** The doc, sent as contentJson. */
  doc: JSONContent | null
  /** The doc carries an inline image or embed, so it is worth sending without text. */
  hasContentNode: boolean
}

/**
 * The composer's draft, held outside React state. The editor writes it on
 * every keystroke, and a state update there would re-render the whole thread
 * around the composer. What the thread draws from the draft subscribes to just
 * that value (useComposerDocValue); everything else reads the latest draft
 * when it acts.
 */
export interface ComposerDocStore extends ReadableStore<ComposerDocDraft> {
  set(text: string, doc: JSONContent | null): void
}

function createComposerDocStore(): ComposerDocStore {
  const store = createValueStore<ComposerDocDraft>({ text: '', doc: null, hasContentNode: false })
  return {
    ...store,
    set: (text, doc) => store.set({ text, doc, hasContentNode: docHasContentNode(doc) }),
  }
}

/**
 * The composer's draft store and the reset signal that clears the editor
 * after a send (it keys the editor, so a bump remounts it empty).
 */
export function useComposerDoc() {
  const [draft] = useState(createComposerDocStore)
  const [resetSignal, setResetSignal] = useState(0)

  const clear = useCallback(() => {
    draft.set('', null)
    setResetSignal((n) => n + 1)
  }, [draft])

  return { draft, resetSignal, clear }
}

/**
 * One value drawn from the composer's draft. The component re-renders only
 * when the value changes (compared with Object.is), so `select` should return
 * a primitive.
 */
export function useComposerDocValue<T>(
  draft: ComposerDocStore,
  select: (draft: ComposerDocDraft) => T
): T {
  return useStoreValue(draft, select)
}

const selectText = (draft: ComposerDocDraft) => draft.text

/** The draft's text, updated once its changes have paused for `delayMs`. */
export function useDebouncedComposerText(draft: ComposerDocStore, delayMs: number): string {
  return useDebouncedStoreValue(draft, selectText, delayMs)
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
  onPage: (page: Awaited<ReturnType<VisitorSurfaceRpc['listConversationMessages']>>) => void
  onError?: () => void
}) {
  const { listConversationMessages } = useVisitorSurfaceRpc()
  const [loadingOlder, setLoadingOlder] = useState(false)

  const loadOlder = async () => {
    if (!conversationId || loadingOlder || messages.length === 0) return
    setLoadingOlder(true)
    try {
      const page = await listConversationMessages({
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
 *
 * `readThrough` is the caller's current read watermark. When it already covers
 * the newest message there is nothing to clear, so reopening a read thread
 * writes nothing. It is read when the newest message changes, never tracked:
 * a watermark moved back by "mark unread" must not re-mark the thread read.
 */
export function useMarkReadOnIncoming({
  conversationId,
  messages,
  whenLastFrom,
  enabled = true,
  readThrough,
  getHeaders,
  onMarked,
}: {
  conversationId: ConversationId | null
  messages: ConversationMessageDTO[]
  whenLastFrom: 'visitor' | 'agent'
  enabled?: boolean
  readThrough?: string | null
  getHeaders?: () => Record<string, string>
  onMarked?: () => void
}) {
  const lastMessage = messages.at(-1)
  const lastMessageId = lastMessage?.id
  const lastSenderType = lastMessage?.senderType
  const lastCreatedAtRef = useRef(lastMessage?.createdAt)
  lastCreatedAtRef.current = lastMessage?.createdAt
  const { markConversationRead } = useVisitorSurfaceRpc()
  const getHeadersRef = useRef(getHeaders)
  getHeadersRef.current = getHeaders
  const onMarkedRef = useRef(onMarked)
  onMarkedRef.current = onMarked
  const readThroughRef = useRef(readThrough)
  readThroughRef.current = readThrough

  useEffect(() => {
    if (!conversationId || !enabled) return
    if (lastSenderType !== whenLastFrom) return
    const through = readThroughRef.current
    const lastCreatedAt = lastCreatedAtRef.current
    if (through && lastCreatedAt && Date.parse(through) >= Date.parse(lastCreatedAt)) return
    const headers = getHeadersRef.current?.()
    void markConversationRead({
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
  const { sendConversationTyping } = useVisitorSurfaceRpc()
  return useCallback(() => {
    if (!conversationId) return
    void sendConversationTyping({
      data: { conversationId },
      ...(getHeaders ? { headers: getHeaders() } : {}),
    }).catch(() => {})
  }, [conversationId, getHeaders, sendConversationTyping])
}
