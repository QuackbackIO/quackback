/**
 * Shared Ask AI client: capability probe, SSE consumption, and the answer
 * panel used by the widget Help tab and the /hc hero search.
 *
 * Consumes the versioned kb-ask.v1.* event contract. The answer is rendered
 * through the shared AssistantAnswer component, so its inline [n] citation
 * dots and hover source cards match the messenger assistant exactly. A miss
 * ('no_answer') streams a graceful reply plus related-article suggestions.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { SparklesIcon, XMarkIcon } from '@heroicons/react/24/outline'
import {
  KB_ASK_EVENTS,
  type KbAskAnswerKind,
  type KbAskFinalPayload,
  type KbAskSourceMeta,
} from '@/lib/shared/help-center/kb-ask-contract'
import { AssistantAnswer } from '@/components/shared/conversation/assistant-turn'
import type { ConversationMessageCitation } from '@/lib/shared/conversation/types'
import { parseAskAiSseBlock, readSseBlocks } from '@/lib/client/utils/sse-blocks'
import { splitByTerms } from './ask-ai-text'

// Re-exported for existing importers (the kb-ask/sandbox/copilot route tests,
// and any future non-component client code should import the lib/ module
// directly — see sse-blocks.ts's doc comment for why the implementation lives
// there instead of here).
export { parseAskAiSseBlock, readSseBlocks }

// ============================================================================
// Stream contract (kb-ask.v1.*)
// ============================================================================

// Event names and payload shapes live in the shared contract module,
// imported by this client and the server route. Existing importers keep the
// AskAiSourceMeta name.
export type AskAiSourceMeta = KbAskSourceMeta

interface AskAiStreamHandlers {
  onSources?: (sources: AskAiSourceMeta[]) => void
  onDelta?: (text: string) => void
  onFinal?: (final: KbAskFinalPayload) => void
  onError?: (code: string) => void
}

/**
 * Read a kb-ask SSE body to completion, dispatching versioned events.
 * Unknown event names are ignored so future additions stay backward
 * compatible for older clients.
 */
export async function readAskAiStream(
  body: ReadableStream<Uint8Array>,
  handlers: AskAiStreamHandlers
): Promise<void> {
  await readSseBlocks(body, (block) => {
    const parsed = parseAskAiSseBlock(block)
    if (!parsed) return
    switch (parsed.event) {
      case KB_ASK_EVENTS.sources:
        handlers.onSources?.((parsed.data as { sources: AskAiSourceMeta[] }).sources)
        break
      case KB_ASK_EVENTS.delta:
        handlers.onDelta?.((parsed.data as { text: string }).text)
        break
      case KB_ASK_EVENTS.final:
        handlers.onFinal?.(parsed.data as KbAskFinalPayload)
        break
      case KB_ASK_EVENTS.error:
        handlers.onError?.((parsed.data as { code: string }).code)
        break
    }
  })
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Whether Ask AI can be offered: the flag is on AND a model is configured.
 * Backed by the kb-ask capability probe (404 when flags are off).
 */
export function useAskAiAvailable(enabled = true): boolean {
  const query = useQuery({
    queryKey: ['kb-ask', 'capability'],
    queryFn: async () => {
      const res = await fetch('/api/widget/kb-ask')
      if (!res.ok) return false
      const json = (await res.json()) as { data?: { enabled?: boolean } }
      return json.data?.enabled === true
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  return query.data === true
}

type AskAiStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'no-answer' | 'error'

interface AskAiState {
  status: AskAiStatus
  question: string
  answer: string
  /** 'grounded' cites sources; 'no_answer' offers related suggestions. */
  kind: KbAskAnswerKind
  /** Sources cited by a grounded answer, resolved to display metadata. */
  citedSources: AskAiSourceMeta[]
  /** Related near-miss articles suggested on a no_answer. */
  related: AskAiSourceMeta[]
}

const IDLE_STATE: AskAiState = {
  status: 'idle',
  question: '',
  answer: '',
  kind: 'grounded',
  citedSources: [],
  related: [],
}

/** In-app two-segment help-center article path (category + article slug). */
function articleHref(source: AskAiSourceMeta): string {
  return `/hc/articles/${source.categorySlug}/${source.slug}`
}

/** Present cited sources as the shared assistant citation shape so the answer
 *  renders with the same inline citation dots the messenger uses. */
function toCitations(sources: AskAiSourceMeta[]): ConversationMessageCitation[] {
  return sources.map((s) => ({
    type: 'article',
    id: s.articleId,
    title: s.title,
    url: articleHref(s),
  }))
}

/** Drive one Ask AI question at a time; re-asking aborts the previous run. */
export function useAskAi() {
  const [state, setState] = useState<AskAiState>(IDLE_STATE)
  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState(IDLE_STATE)
  }, [])

  const ask = useCallback(async (question: string) => {
    const q = question.trim()
    if (!q) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // A result-less state (loading, error, hard no-answer): the answer/source
    // fields are all empty and unread until a terminal event replaces them.
    const blank = (status: AskAiStatus): AskAiState => ({
      status,
      question: q,
      answer: '',
      kind: 'grounded',
      citedSources: [],
      related: [],
    })

    setState(blank('loading'))

    let retrieved: AskAiSourceMeta[] = []
    try {
      const res = await fetch(`/api/widget/kb-ask?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        setState(blank('error'))
        return
      }

      await readAskAiStream(res.body, {
        onSources: (sources) => {
          retrieved = sources
        },
        onDelta: (text) => {
          setState((prev) => ({
            ...prev,
            status: 'streaming',
            answer: prev.answer + text,
          }))
        },
        onFinal: (final) => {
          // Hard failure fallback: the model could not be reached at all.
          if (final.answer === null) {
            setState(blank('no-answer'))
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
        },
        onError: () => {
          setState(blank('error'))
        },
      })

      // A stream that closed without a terminal event is a failure, not
      // silence.
      setState((prev) =>
        prev.status === 'loading' || prev.status === 'streaming'
          ? { ...prev, status: 'error' }
          : prev
      )
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setState(blank('error'))
    }
  }, [])

  return { state, ask, reset }
}

export interface AskAiSearchControllerOptions {
  /** The surface's current (uncontrolled) query text. */
  query: string
  /** Whether the Ask AI affordance may be offered (probe + surface gate). */
  askAiAvailable: boolean
  /** How many plain search results are listed under the ask row. */
  resultCount: number
  /** Open the search result at `index` (0-based over the plain results). */
  onSelectResult: (index: number) => void
  /** Clear the surface's query (second Escape). */
  onClearQuery: () => void
  /** Surface hook fired when an ask starts (e.g. close the dropdown). */
  onAsk?: () => void
  /** Surface hook fired when the answer panel is dismissed (e.g. reopen the
   *  dropdown for the current query). */
  onDismiss?: () => void
}

/**
 * The shared search-with-Ask-AI controller behind the widget Help tab and
 * the /hc hero search: one Ask AI run, the keyboard selection over
 * [ask row, ...results], and the keydown state machine (Escape dismisses
 * the answer then clears the query; Enter re-asks, opens the selection, or
 * asks; ArrowUp/Down clamp over the option list). Rendering stays with the
 * surface.
 */
export function useAskAiSearchController({
  query,
  askAiAvailable,
  resultCount,
  onSelectResult,
  onClearQuery,
  onAsk,
  onDismiss,
}: AskAiSearchControllerOptions) {
  const { state: askAiState, ask: askAi, reset: resetAskAi } = useAskAi()
  // Keyboard selection over [ask-ai row, ...results]; -1 = nothing selected.
  const [selectedIndex, setSelectedIndex] = useState(-1)

  const hasAskRow = askAiAvailable && !!query.trim()
  const answerOpen = askAiState.status !== 'idle'
  const askRowOffset = hasAskRow ? 1 : 0
  const optionCount = askRowOffset + resultCount

  // Editing the query returns to autocomplete mode and clears selection.
  useEffect(() => {
    resetAskAi()
    setSelectedIndex(-1)
  }, [query, resetAskAi])

  const triggerAsk = useCallback(() => {
    if (!hasAskRow) return
    setSelectedIndex(-1)
    onAsk?.()
    void askAi(query)
  }, [hasAskRow, onAsk, askAi, query])

  const dismissAnswer = useCallback(() => {
    resetAskAi()
    onDismiss?.()
  }, [resetAskAi, onDismiss])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        // Dismiss the answer panel first; a second Escape clears the query.
        if (answerOpen) {
          e.preventDefault()
          dismissAnswer()
        } else if (query) {
          e.preventDefault()
          onClearQuery()
        }
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (answerOpen) {
          // Enter again re-asks the current query.
          triggerAsk()
          return
        }
        const resultIdx = selectedIndex - askRowOffset
        if (selectedIndex >= askRowOffset && resultIdx < resultCount) {
          onSelectResult(resultIdx)
        } else {
          triggerAsk()
        }
        return
      }
      if (answerOpen) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, optionCount - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, -1))
      }
    },
    [
      answerOpen,
      dismissAnswer,
      query,
      onClearQuery,
      triggerAsk,
      selectedIndex,
      askRowOffset,
      resultCount,
      onSelectResult,
      optionCount,
    ]
  )

  return {
    askAiState,
    selectedIndex,
    hasAskRow,
    answerOpen,
    askRowOffset,
    triggerAsk,
    dismissAnswer,
    handleKeyDown,
  }
}

// ============================================================================
// Presentation
// ============================================================================

/** Query-term highlighting for autocomplete rows. Text nodes only. */
export function HighlightedText({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitByTerms(text, query).map((seg, i) =>
        seg.match ? (
          <mark key={i} className="bg-transparent font-semibold text-primary">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  )
}

/**
 * A numbered list of articles under the answer: cited "Sources" for a grounded
 * reply, or "Related articles" suggestions for a no-answer miss.
 */
function SourceList({
  titleId,
  titleDefault,
  sources,
  onSourceClick,
}: {
  titleId: string
  titleDefault: string
  sources: AskAiSourceMeta[]
  onSourceClick: (source: AskAiSourceMeta) => void
}) {
  if (sources.length === 0) return null
  return (
    <div className="pt-2 mt-1 border-t border-border/40">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60 mb-1.5">
        <FormattedMessage id={titleId} defaultMessage={titleDefault} />
      </p>
      <ol className="space-y-0.5">
        {sources.map((source, i) => (
          <li key={source.articleId}>
            <button
              type="button"
              onClick={() => onSourceClick(source)}
              className="group flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-start hover:bg-muted/50 transition-colors cursor-pointer"
            >
              <span className="shrink-0 text-xs font-semibold text-primary tabular-nums">
                {i + 1}.
              </span>
              <span className="min-w-0 flex-1 text-sm text-foreground line-clamp-1 group-hover:text-primary group-hover:underline underline-offset-2">
                {source.title}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

interface AskAiRowProps {
  query: string
  onSelect: () => void
  /** Keyboard-selection styling (arrow keys). */
  highlighted?: boolean
}

/** The pinned "Ask AI about ..." row shown first in autocomplete results. */
export function AskAiRow({ query, onSelect, highlighted = false }: AskAiRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-highlighted={highlighted || undefined}
      className={`group flex w-full items-center gap-2.5 px-3 py-2.5 text-start transition-colors cursor-pointer rounded-lg ${
        highlighted ? 'bg-primary/10' : 'hover:bg-muted/40'
      }`}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
        <SparklesIcon className="w-4 h-4 text-primary" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">
          <FormattedMessage
            id="helpAskAi.rowTitle"
            defaultMessage='Ask AI about "{query}"'
            values={{ query }}
          />
        </span>
        <span className="block text-xs text-muted-foreground/70 line-clamp-1">
          <FormattedMessage
            id="helpAskAi.rowSubtitle"
            defaultMessage="Use AI to answer your question in seconds"
          />
        </span>
      </span>
    </button>
  )
}

interface AskAiAnswerPanelProps {
  state: AskAiState
  onDismiss: () => void
  onSourceClick: (source: AskAiSourceMeta) => void
}

/**
 * The in-place answer panel that replaces the autocomplete results:
 * question header with spinner while streaming, dismiss control, the streamed
 * answer with the shared assistant citation dots, and the source/related list.
 */
export function AskAiAnswerPanel({ state, onDismiss, onSourceClick }: AskAiAnswerPanelProps) {
  const intl = useIntl()
  if (state.status === 'idle') return null
  const busy = state.status === 'loading' || state.status === 'streaming'

  // Resolve a clicked citation dot back to its article metadata for in-app nav.
  const sourceById = new Map<string, AskAiSourceMeta>(
    [...state.citedSources, ...state.related].map((s) => [s.articleId, s])
  )
  const openCitation = (citation: ConversationMessageCitation) => {
    const source = sourceById.get(citation.id)
    if (source) onSourceClick(source)
  }

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 px-3.5 py-3 space-y-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15">
          <SparklesIcon className="w-3 h-3 text-primary" />
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium text-foreground">{state.question}</p>
        {busy && (
          <span className="mt-0.5 size-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-transparent" />
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label={intl.formatMessage({ id: 'helpAskAi.dismiss', defaultMessage: 'Dismiss' })}
          className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      {state.status === 'loading' && (
        <p className="text-xs text-muted-foreground/60 animate-pulse">
          <FormattedMessage id="helpAskAi.thinking" defaultMessage="Finding an answer..." />
        </p>
      )}

      {(state.status === 'streaming' || state.status === 'done') && (
        <AssistantAnswer
          text={state.answer}
          citations={toCitations(state.citedSources)}
          caret={state.status === 'streaming'}
          onCitationOpen={openCitation}
        />
      )}

      {state.status === 'no-answer' && (
        <p className="text-sm text-muted-foreground">
          <FormattedMessage
            id="helpAskAi.noAnswer"
            defaultMessage="Sorry, we couldn't find any information about that in our help articles. Try rephrasing your question or browse the articles."
          />
        </p>
      )}

      {state.status === 'error' && (
        <p className="text-sm text-muted-foreground">
          <FormattedMessage
            id="helpAskAi.error"
            defaultMessage="We couldn't generate an answer right now. Please try again."
          />
        </p>
      )}

      {state.status === 'done' && state.kind === 'grounded' && (
        <SourceList
          titleId="helpAskAi.sources"
          titleDefault="Sources"
          sources={state.citedSources}
          onSourceClick={onSourceClick}
        />
      )}

      {state.status === 'done' && state.kind === 'no_answer' && (
        <SourceList
          titleId="helpAskAi.related"
          titleDefault="Related articles"
          sources={state.related}
          onSourceClick={onSourceClick}
        />
      )}
    </div>
  )
}
