/**
 * One Ask AI run over TanStack AI's AG-UI wire (ChatClient +
 * fetchServerSentEvents, NOT ai-react: this ships to the public /hc and
 * widget bundles). useAskAi (ask-ai.tsx) loads this module on demand, so a
 * page that offers Ask AI only downloads the streaming client once a visitor
 * starts to use it.
 */
import type { Dispatch, SetStateAction } from 'react'
import { ChatClient, fetchServerSentEvents } from '@tanstack/ai-client'
import { parsePartialJSON, type StreamChunk } from '@tanstack/ai'
import type {
  KbAskFinalPayload,
  KbAskStateSnapshot,
} from '@/lib/shared/help-center/kb-ask-contract'
import { aguiFetchClient } from '@/lib/client/utils/agui-fetch'
import { blankAskAiState, type AskAiSourceMeta, type AskAiState } from './ask-ai-state'

const KB_ASK_URL = '/api/widget/kb-ask'

export interface AskAiRun {
  /** Abort the run; its stream stops updating the state. */
  stop: () => void
  /** Settles once the run has reported its outcome (or been stopped). */
  settled: Promise<void>
}

/** Stream the answer to `q` into `setState` over a fresh single-turn client. */
export function startAskAiRun(
  q: string,
  {
    getHeaders,
    setState,
  }: {
    /** Widget Bearer (or empty on the portal, which uses cookies). */
    getHeaders: () => HeadersInit | undefined
    setState: Dispatch<SetStateAction<AskAiState>>
  }
): AskAiRun {
  // Per-run accumulators. `retrieved` is the STATE_SNAPSHOT display join;
  // `raw`/`emitted` diff the answer prose out of the raw-JSON text deltas;
  // `terminal` dedupes the final/error so a stream reports its outcome once.
  let retrieved: AskAiSourceMeta[] = []
  let raw = ''
  let emitted = ''
  let terminal = false

  const applyFinal = (final: KbAskFinalPayload) => {
    // Hard failure fallback: the model could not be reached at all.
    if (final.answer === null) {
      setState(blankAskAiState(q, 'no-answer'))
      return
    }
    // Graceful miss: keep the streamed reply, offer related articles.
    if (final.kind === 'no_answer') {
      setState({
        status: 'done',
        question: q,
        answer: final.answer,
        kind: 'no_answer',
        citedSources: [],
        related: final.related ?? [],
      })
      return
    }
    const byId = new Map(retrieved.map((s) => [s.articleId, s]))
    const cited = final.sources.flatMap((s) => {
      const meta = byId.get(s.articleId)
      return meta ? [meta] : []
    })
    setState({
      status: 'done',
      question: q,
      answer: final.answer,
      kind: 'grounded',
      citedSources: cited,
      related: [],
    })
  }

  const client = new ChatClient({
    connection: fetchServerSentEvents(KB_ASK_URL, () => ({
      // Non-2xx widget envelopes become a synthetic RUN_ERROR SSE frame.
      fetchClient: aguiFetchClient(getHeaders),
    })),
    onChunk: (rawChunk: StreamChunk) => {
      const chunk = rawChunk as {
        type: string
        snapshot?: unknown
        delta?: unknown
        result?: unknown
      }
      switch (chunk.type) {
        case 'STATE_SNAPSHOT': {
          // The pre-synthesis source metadata join (citation-dot display).
          const sources = (chunk.snapshot as KbAskStateSnapshot | undefined)?.sources
          if (Array.isArray(sources)) retrieved = sources
          break
        }
        case 'TEXT_MESSAGE_CONTENT': {
          // Deltas are the raw structured JSON; surface only the growth of the
          // `answer` field so the panel streams clean prose, not the envelope.
          if (typeof chunk.delta !== 'string') break
          raw += chunk.delta
          const partial = parsePartialJSON(raw) as Record<string, unknown> | undefined
          const text = typeof partial?.answer === 'string' ? partial.answer : ''
          if (text.length > emitted.length && text.startsWith(emitted)) {
            emitted = text
            setState((prev) => ({ ...prev, status: 'streaming', answer: text }))
          }
          break
        }
        case 'RUN_FINISHED': {
          // AG-UI's standard result slot is what "finalized" means; a bare
          // RUN_FINISHED (no result) does not settle the turn.
          if (chunk.result === undefined || terminal) break
          terminal = true
          applyFinal(chunk.result as KbAskFinalPayload)
          break
        }
        case 'RUN_ERROR': {
          if (terminal) break
          terminal = true
          setState(blankAskAiState(q, 'error'))
          break
        }
      }
    },
    onError: (error: Error) => {
      // Transport failure (HTTP error, dropped stream) with no RUN_ERROR
      // frame. An abort is the caller's own stop(), not an error.
      if (terminal || error.name === 'AbortError') return
      terminal = true
      setState(blankAskAiState(q, 'error'))
    },
  })

  const settled = (async () => {
    try {
      await client.sendMessage(q)
    } catch {
      // onError already mapped the failure to the error state; sendMessage may
      // additionally reject once the run settles.
    }

    // A stream that closed without a terminal frame is a failure, not silence.
    if (!terminal) {
      setState((prev) =>
        prev.status === 'loading' || prev.status === 'streaming'
          ? { ...prev, status: 'error' }
          : prev
      )
    }
  })()

  return { stop: () => client.stop(), settled }
}
