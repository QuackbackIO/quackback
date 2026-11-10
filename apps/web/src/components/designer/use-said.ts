import { createElement, useCallback, useState, useSyncExternalStore } from 'react'
import type { useDesignDraft } from '@/components/admin/settings/appearance/use-design-draft'
import { useUndoKeys } from '@/components/admin/settings/appearance/use-undo-keys'

/** What was said last, kept outside React so saying it renders only its live region. */
export interface Said {
  get: () => string
  subscribe: (listener: () => void) => () => void
}

function saidStore(): Said & { set: (text: string) => void } {
  let text = ''
  const listeners = new Set<() => void>()
  return {
    get: () => text,
    set(next) {
      if (next === text) return
      text = next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

/**
 * What a screen reader hears after a pick, an add, a move, an undo or a
 * redo; cleared first, so a repeat is read again. Undo and redo say what
 * they took back or put back, from the keys or the top bar. What is said
 * shows in <SaidRegion>, the one part of the builder it renders.
 */
export function useSaid(
  draft: Pick<ReturnType<typeof useDesignDraft>, 'undo' | 'redo' | 'undoLabel' | 'redoLabel'>
) {
  const [said] = useState(saidStore)
  const say = useCallback(
    (text: string) => {
      said.set('')
      requestAnimationFrame(() => said.set(text))
    },
    [said]
  )
  const undo = useCallback(() => {
    if (!draft.undoLabel) return
    say(`Undone: ${draft.undoLabel}`)
    draft.undo()
  }, [draft, say])
  const redo = useCallback(() => {
    if (!draft.redoLabel) return
    say(`Redone: ${draft.redoLabel}`)
    draft.redo()
  }, [draft, say])
  useUndoKeys(undo, redo)
  return { said: said as Said, say, undo, redo }
}

/** The builder's live region: what was said last. */
export function SaidRegion({ said }: { said: Said }) {
  const text = useSyncExternalStore(said.subscribe, said.get, () => '')
  return createElement('p', { role: 'status', className: 'sr-only' }, text)
}
