import { useEffect, useState, useSyncExternalStore } from 'react'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { EMPTY_DRAFT, type ComposerDraft } from './composer-draft'
import type { ComposerMode } from './composer-ai-actions'

/**
 * The reply and note drafts of one thread's composer, held outside React
 * state. The editor writes a draft on every keystroke, and a state update
 * there would re-render the whole thread around the composer. Instead, what
 * the thread draws from a draft subscribes to just the value it shows, and
 * everything else reads the latest draft when it acts.
 */
export interface ComposerDrafts {
  get(mode: ComposerMode): ComposerDraft
  set(mode: ComposerMode, next: ComposerDraft | ((prev: ComposerDraft) => ComposerDraft)): void
  subscribe(onChange: () => void): () => void
}

export function createComposerDrafts(): ComposerDrafts {
  const drafts: Record<ComposerMode, ComposerDraft> = { reply: EMPTY_DRAFT, note: EMPTY_DRAFT }
  const listeners = new Set<() => void>()
  return {
    get: (mode) => drafts[mode],
    set(mode, next) {
      const value = typeof next === 'function' ? next(drafts[mode]) : next
      if (value === drafts[mode]) return
      drafts[mode] = value
      for (const listener of listeners) listener()
    },
    subscribe(onChange) {
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
      }
    },
  }
}

export const isEmptyDraft = (draft: ComposerDraft) => isEmptyTiptapDoc(draft.json ?? undefined)

/**
 * One value drawn from a draft. The component re-renders only when the value
 * changes (compared with Object.is), so `select` should return a primitive.
 */
export function useComposerDraftValue<T>(
  drafts: ComposerDrafts,
  mode: ComposerMode,
  select: (draft: ComposerDraft) => T
): T {
  const read = () => select(drafts.get(mode))
  return useSyncExternalStore(drafts.subscribe, read, read)
}

/** A draft's markdown, updated once its changes have paused for `delayMs`. */
export function useDebouncedDraftText(
  drafts: ComposerDrafts,
  mode: ComposerMode,
  delayMs: number
): string {
  const [text, setText] = useState(() => drafts.get(mode).markdown)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setText(drafts.get(mode).markdown), delayMs)
    }
    schedule()
    const unsubscribe = drafts.subscribe(schedule)
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [drafts, mode, delayMs])
  return text
}
