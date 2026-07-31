import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { StreamChunk } from '@tanstack/ai'
import { runAguiTurn, type AguiRunHandle } from '@/lib/client/utils/agui-run'
import { GENERIC_ERROR } from '@/lib/client/utils/http-error'
import { itemRefBody } from '@/lib/client/copilot-events'
import type { InboxItemRef } from '@/lib/shared/inbox/items'
import {
  type TransformKind,
  type TransformFinalPayload,
} from '@/lib/shared/assistant/copilot-contract'

/**
 * Shared streamed rewrite runner for Copilot answers and composer drafts, over
 * TanStack AI's AG-UI protocol: the transform kind and item ref ride
 * forwardedProps, the source text is the turn's user message, and the rewritten
 * text comes back on the terminal RUN_FINISHED.result ({ text }). Keeps its
 * external shape — `(kind, text, options?) => Promise<string | null>` — so its
 * call sites are unchanged: abort resolves to null (no toast), a failure toasts
 * and resolves to null. A new call supersedes any run still in flight (and the
 * last run is aborted on unmount). `options.language` is the `translate`
 * kind's target language; every other kind ignores it.
 */
export function useCopilotTransform(item: InboxItemRef) {
  const activeRef = useRef<AguiRunHandle | null>(null)

  useEffect(() => () => activeRef.current?.stop(), [])

  return useCallback(
    (
      transform: TransformKind,
      text: string,
      /** The `translate` kind's target language (English name, see
       *  TRANSLATE_LANGUAGES); ignored by every other kind. */
      options?: { language?: string }
    ): Promise<string | null> => {
      activeRef.current?.stop()
      return new Promise<string | null>((resolve) => {
        let finalText: string | null = null
        let ok = true
        const run = runAguiTurn({
          url: '/api/admin/assistant/transform',
          message: text,
          forwardedProps: {
            ...itemRefBody(item),
            transform,
            ...(options?.language ? { language: options.language } : {}),
          },
          onChunk: (chunk: StreamChunk) => {
            const c = chunk as { type: string; result?: unknown; message?: unknown }
            if (c.type === 'RUN_FINISHED' && c.result !== undefined) {
              finalText = (c.result as TransformFinalPayload).text || null
            } else if (c.type === 'RUN_ERROR') {
              ok = false
              toast.error((typeof c.message === 'string' && c.message) || GENERIC_ERROR)
            }
          },
          onError: (error) => {
            ok = false
            toast.error(error.message || GENERIC_ERROR)
          },
        })
        activeRef.current = run
        void run.done.finally(() => {
          if (activeRef.current === run) activeRef.current = null
          resolve(ok && finalText ? finalText : null)
        })
      })
    },
    [item]
  )
}
