/**
 * Shared Ask AI client: capability probe, SSE consumption, and the answer
 * panel used by the widget Help tab and the /hc hero search.
 *
 * Consumes the versioned kb-ask.v1.* event contract. The answer is rendered
 * as plain text (no HTML injection surface); citations are chips resolved
 * from the sources event.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { SparklesIcon, XMarkIcon } from '@heroicons/react/24/outline'
import {
  KB_ASK_EVENTS,
  type KbAskFinalPayload,
  type KbAskSourceMeta,
} from '@/lib/shared/help-center/kb-ask-contract'
import { splitByTerms, parseMarkdownLite, type InlineSpan } from './ask-ai-text'

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

/** Parse one SSE block ("event: ...\ndata: ...") into an event, or null. */
export function parseAskAiSseBlock(block: string): { event: string; data: unknown } | null {
  const eventMatch = /^event: (.+)$/m.exec(block)
  const dataMatch = /^data: (.+)$/m.exec(block)
  if (!eventMatch || !dataMatch) return null
  try {
    return { event: eventMatch[1].trim(), data: JSON.parse(dataMatch[1]) }
  } catch {
    return null
  }
}

/**
 * Read an SSE body to completion, invoking `onBlock` for each "\n\n"-delimited
 * block (including a final unterminated one). Framing only — callers parse and
 * dispatch. Shared by the kb-ask reader and the assistant sandbox so the
 * chunk-splitting lives in one place.
 */
export async function readSseBlocks(
  body: ReadableStream<Uint8Array>,
  onBlock: (block: string) => void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep = buffer.indexOf('\n\n')
    while (sep !== -1) {
      onBlock(buffer.slice(0, sep))
      buffer = buffer.slice(sep + 2)
      sep = buffer.indexOf('\n\n')
    }
  }
  if (buffer.trim()) onBlock(buffer)
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
  /** Sources cited by the final answer, resolved to display metadata. */
  citedSources: AskAiSourceMeta[]
}

const IDLE_STATE: AskAiState = { status: 'idle', question: '', answer: '', citedSources: [] }

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

    setState({ status: 'loading', question: q, answer: '', citedSources: [] })

    let retrieved: AskAiSourceMeta[] = []
    try {
      const res = await fetch(`/api/widget/kb-ask?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        setState({ status: 'error', question: q, answer: '', citedSources: [] })
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
          if (final.answer === null) {
            setState({ status: 'no-answer', question: q, answer: '', citedSources: [] })
            return
          }
          const byId = new Map(retrieved.map((s) => [s.articleId, s]))
          const cited = final.sources.flatMap((s) => {
            const meta = byId.get(s.articleId)
            return meta ? [meta] : []
          })
          setState({ status: 'done', question: q, answer: final.answer, citedSources: cited })
        },
        onError: () => {
          setState({ status: 'error', question: q, answer: '', citedSources: [] })
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
      setState({ status: 'error', question: q, answer: '', citedSources: [] })
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
 * A Wikipedia-style inline citation: a superscript `[n]` that links to the
 * n-th cited source. Until the final sources arrive (mid-stream) or when the
 * number has no matching source, it renders as an inert marker.
 */
function CitationMark({
  n,
  citedSources,
  onSourceClick,
}: {
  n: number
  citedSources: AskAiSourceMeta[]
  onSourceClick: (source: AskAiSourceMeta) => void
}) {
  const source = citedSources[n - 1]
  if (!source) {
    return <sup className="text-[0.65em] font-medium text-muted-foreground/60">[{n}]</sup>
  }
  return (
    <sup>
      <button
        type="button"
        onClick={() => onSourceClick(source)}
        aria-label={source.title}
        className="text-[0.65em] font-semibold text-primary align-super hover:underline underline-offset-2 cursor-pointer"
      >
        [{n}]
      </button>
    </sup>
  )
}

interface InlineRenderProps {
  spans: InlineSpan[]
  citedSources: AskAiSourceMeta[]
  onSourceClick: (source: AskAiSourceMeta) => void
}

/** Render one line's inline spans: plain text, **bold**, and [n] citations. */
function InlineSpans({ spans, citedSources, onSourceClick }: InlineRenderProps) {
  return (
    <>
      {spans.map((span, k) =>
        span.cite !== undefined ? (
          <CitationMark
            key={k}
            n={span.cite}
            citedSources={citedSources}
            onSourceClick={onSourceClick}
          />
        ) : span.bold ? (
          <strong key={k}>{span.text}</strong>
        ) : (
          <span key={k}>{span.text}</span>
        )
      )}
    </>
  )
}

interface AskAiMarkdownProps {
  text: string
  citedSources: AskAiSourceMeta[]
  onSourceClick: (source: AskAiSourceMeta) => void
  /** Render a streaming caret inline at the end of the last line. */
  caret?: boolean
}

/** Thin, square typing caret that trails the streamed answer text. */
function AnswerCaret() {
  return (
    <span
      aria-hidden="true"
      className="ms-0.5 inline-block h-[1em] w-px animate-pulse bg-primary/80 align-[-0.15em]"
    />
  )
}

/**
 * Markdown-lite answer rendering: paragraphs, ordered/bullet lists, bold, and
 * inline `[n]` citation links. No raw HTML.
 */
function AskAiMarkdown({ text, citedSources, onSourceClick, caret = false }: AskAiMarkdownProps) {
  const blocks = parseMarkdownLite(text)
  const lastBlock = blocks.length - 1
  return (
    <div className="space-y-2.5 text-sm text-foreground leading-relaxed">
      {blocks.length === 0 && caret && <AnswerCaret />}
      {blocks.map((block, i) => {
        const isLast = i === lastBlock
        if (block.kind === 'list') {
          const lastItem = block.items.length - 1
          const items = block.items.map((item, j) => (
            <li key={j} className="ps-0.5">
              <InlineSpans spans={item} citedSources={citedSources} onSourceClick={onSourceClick} />
              {caret && isLast && j === lastItem && <AnswerCaret />}
            </li>
          ))
          return block.ordered ? (
            <ol key={i} className="list-decimal ps-5 space-y-1 marker:text-muted-foreground/60">
              {items}
            </ol>
          ) : (
            <ul key={i} className="list-disc ps-5 space-y-1 marker:text-muted-foreground/50">
              {items}
            </ul>
          )
        }
        const lastLine = block.lines.length - 1
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                <InlineSpans
                  spans={line}
                  citedSources={citedSources}
                  onSourceClick={onSourceClick}
                />
                {caret && isLast && j === lastLine && <AnswerCaret />}
              </span>
            ))}
          </p>
        )
      })}
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
 * question header with spinner while streaming, dismiss control, the
 * streamed answer (markdown-lite), and citation links.
 */
export function AskAiAnswerPanel({ state, onDismiss, onSourceClick }: AskAiAnswerPanelProps) {
  const intl = useIntl()
  if (state.status === 'idle') return null
  const busy = state.status === 'loading' || state.status === 'streaming'

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
        <div>
          <AskAiMarkdown
            text={state.answer}
            citedSources={state.citedSources}
            onSourceClick={onSourceClick}
            caret={state.status === 'streaming'}
          />
        </div>
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

      {state.status === 'done' && state.citedSources.length > 0 && (
        <div className="pt-2 mt-1 border-t border-border/40">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60 mb-1.5">
            <FormattedMessage id="helpAskAi.sources" defaultMessage="Sources" />
          </p>
          <ol className="space-y-0.5">
            {state.citedSources.map((source, i) => (
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
      )}
    </div>
  )
}
