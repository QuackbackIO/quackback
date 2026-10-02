import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckIcon } from '@heroicons/react/16/solid'

type Phase = 'idle' | 'saving' | 'saved'

const SAVED_VISIBLE_MS = 2000

/**
 * Quiet save feedback for pages that save on change: "Saving…" while an
 * autosave mutation is in flight, "Saved" for a moment after the last one
 * lands, nothing otherwise. Failures show as a toast, not here.
 */
export function SaveStatus() {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<Phase>('idle')

  useEffect(() => {
    const pending = new Set<number>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated') return
      const { mutation } = event
      if (mutation.meta?.autosave !== true) return
      const { status } = mutation.state
      if (status === 'pending') {
        clearTimeout(timer)
        pending.add(mutation.mutationId)
        setPhase('saving')
        return
      }
      if (status !== 'success' && status !== 'error') return
      if (!pending.delete(mutation.mutationId) || pending.size > 0) return
      if (status === 'success') {
        setPhase('saved')
        timer = setTimeout(() => setPhase('idle'), SAVED_VISIBLE_MS)
      } else {
        setPhase('idle')
      }
    })
    return () => {
      unsubscribe()
      clearTimeout(timer)
    }
  }, [queryClient])

  return (
    <span aria-live="polite" className="text-[13px] text-muted-foreground">
      {phase === 'saving' && 'Saving…'}
      {phase === 'saved' && (
        <span className="inline-flex items-center gap-1">
          <CheckIcon className="h-3.5 w-3.5" />
          Saved
        </span>
      )}
    </span>
  )
}
