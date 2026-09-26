import { useMemo } from 'react'
import {
  createValueStore,
  useDebouncedStoreValue,
  useStoreValue,
  type ReadableStore,
} from '@/lib/client/value-store'
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
  const store = createValueStore<Record<ComposerMode, ComposerDraft>>({
    reply: EMPTY_DRAFT,
    note: EMPTY_DRAFT,
  })
  return {
    get: (mode) => store.get()[mode],
    set(mode, next) {
      const drafts = store.get()
      const value = typeof next === 'function' ? next(drafts[mode]) : next
      if (value === drafts[mode]) return
      store.set({ ...drafts, [mode]: value })
    },
    subscribe: store.subscribe,
  }
}

/** One mode's draft as a store of its own, stable while `drafts` and `mode` are. */
function useDraftStore(drafts: ComposerDrafts, mode: ComposerMode): ReadableStore<ComposerDraft> {
  return useMemo(
    () => ({ get: () => drafts.get(mode), subscribe: drafts.subscribe }),
    [drafts, mode]
  )
}

const selectMarkdown = (draft: ComposerDraft) => draft.markdown

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
  return useStoreValue(useDraftStore(drafts, mode), select)
}

/** A draft's markdown, updated once its changes have paused for `delayMs`. */
export function useDebouncedDraftText(
  drafts: ComposerDrafts,
  mode: ComposerMode,
  delayMs: number
): string {
  return useDebouncedStoreValue(useDraftStore(drafts, mode), selectMarkdown, delayMs)
}
