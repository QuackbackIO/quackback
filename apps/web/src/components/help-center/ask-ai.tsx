/**
 * Shared Ask AI client: capability probe, answer state, and the answer
 * panel used by the widget Help tab and the /hc hero search.
 *
 * The answer streams over TanStack AI's AG-UI wire (ask-ai-run.ts, loaded on
 * demand so the streaming client downloads only once a visitor starts an Ask
 * AI interaction). It is rendered through the shared AssistantAnswer
 * component, so its inline [n] citation dots and hover source cards match the
 * messenger assistant exactly. A miss ('no_answer') streams a graceful reply
 * plus related-article suggestions.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { SparklesIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { AssistantAnswer } from '@/components/shared/conversation/assistant-turn'
import type { ConversationMessageCitation } from '@/lib/shared/conversation/types'
import { splitByTerms } from './ask-ai-text'
import { IDLE_STATE, blankAskAiState, type AskAiSourceMeta, type AskAiState } from './ask-ai-state'
import type { AskAiRun } from './ask-ai-run'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import { hcArticlePath } from '@/lib/shared/help-center-url'

// Existing importers keep the AskAiSourceMeta name.
export type { AskAiSourceMeta } from './ask-ai-state'

// ============================================================================
// Hooks
// ============================================================================

/**
 * Whether Ask AI can be offered: the flag is on AND a model is configured.
 * Backed by the kb-ask capability probe (404 when flags are off).
 */
export function useAskAiAvailable(
  enabled = true,
  options?: { getHeaders?: () => HeadersInit; sessionVersion?: number }
): boolean {
  const query = useQuery({
    queryKey: ['kb-ask', 'capability', options?.sessionVersion ?? 'anon'] as const,
    queryFn: async () => {
      const res = await fetch('/api/widget/kb-ask', {
        headers: options?.getHeaders?.(),
      })
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

/** Public help-center article path. */
function articleHref(source: AskAiSourceMeta): string {
  return hcArticlePath({
    locale: DEFAULT_LOCALE,
    urlId: source.urlId,
    slug: source.slug,
  })
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

type AskAiRunModule = typeof import('./ask-ai-run')

let askAiRunLoad: Promise<AskAiRunModule> | undefined

/**
 * Download the Ask AI streaming client. Idempotent: surfaces call it as a
 * visitor starts an Ask AI interaction (focus, typing), so the first answer
 * does not wait on the download.
 */
export function preloadAskAi(): Promise<AskAiRunModule> {
  askAiRunLoad ??= import('./ask-ai-run').catch((error: unknown) => {
    // A failed download is retried by the next call.
    askAiRunLoad = undefined
    throw error
  })
  return askAiRunLoad
}

/** Drive one Ask AI question at a time; re-asking aborts the previous run. */
export function useAskAi(options?: { getHeaders?: () => HeadersInit }) {
  const getHeadersRef = useRef(options?.getHeaders)
  getHeadersRef.current = options?.getHeaders
  const [state, setState] = useState<AskAiState>(IDLE_STATE)
  const runRef = useRef<AskAiRun | null>(null)
  // Bumped by every ask and reset: only the latest ask may start a run or
  // write the state, even while it waits on the streaming client.
  const generationRef = useRef(0)

  const reset = useCallback(() => {
    generationRef.current++
    runRef.current?.stop()
    runRef.current = null
    setState(IDLE_STATE)
  }, [])

  const ask = useCallback(async (question: string) => {
    const q = question.trim()
    if (!q) return

    // A fresh single-turn client per ask: re-asking aborts the previous run and
    // starts a new thread (each question is independent: no history carries).
    runRef.current?.stop()
    runRef.current = null
    const generation = ++generationRef.current
    const isLatest = () => generation === generationRef.current

    setState(blankAskAiState(q, 'loading'))

    let runModule: AskAiRunModule
    try {
      runModule = await preloadAskAi()
    } catch {
      if (isLatest()) setState(blankAskAiState(q, 'error'))
      return
    }
    if (!isLatest()) return

    const run = runModule.startAskAiRun(q, {
      getHeaders: () => getHeadersRef.current?.(),
      setState: (update) => {
        if (isLatest()) setState(update)
      },
    })
    runRef.current = run
    await run.settled
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
  /** Widget Bearer (or empty on the portal, which uses cookies). */
  getHeaders?: () => HeadersInit
  /** Widget session — reset an open answer when identity changes. */
  sessionVersion?: number
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
  getHeaders,
  sessionVersion,
}: AskAiSearchControllerOptions) {
  const { state: askAiState, ask: askAi, reset: resetAskAi } = useAskAi({ getHeaders })
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

  // Logout / identify must not leave the previous visitor's cited titles up.
  useEffect(() => {
    resetAskAi()
    setSelectedIndex(-1)
  }, [sessionVersion, resetAskAi])

  // A visitor typing while Ask AI is offered may ask next: have the client ready.
  useEffect(() => {
    if (hasAskRow) preloadAskAi().catch(() => {})
  }, [hasAskRow])

  /** Download the streaming client ahead of an ask (e.g. on search focus). */
  const warmAskAi = useCallback(() => {
    if (askAiAvailable) preloadAskAi().catch(() => {})
  }, [askAiAvailable])

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
    warmAskAi,
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
