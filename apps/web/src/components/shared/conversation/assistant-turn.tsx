import { useMemo, useState } from 'react'
import { FormattedMessage } from 'react-intl'
import { ChevronDownIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import { MagnifyingGlassIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import { parseMarkdownLite, type InlineSpan } from '@/components/help-center/ask-ai-text'
import type {
  AssistantActivityStatus,
  ConversationMessageCitation,
} from '@/lib/shared/conversation/types'

/**
 * The render path's citation shape: every persisted citation plus the
 * leak-gate's `internal` flag, which the DB-stored `ConversationMessageCitation`
 * deliberately does NOT carry (see conversation/types.ts). Only the assistant
 * ledger (AssistantCitation) and the SSE contracts (SandboxCitation,
 * CopilotCitation) produce `internal`; this component renders whichever shape
 * a caller hands it, persisted or not, so it widens to a superset rather than
 * importing from any of those contract modules.
 */
export type RenderableCitation = ConversationMessageCitation & { internal?: boolean }

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-muted-foreground/80"
      aria-hidden
    />
  )
}

const ACTIVITY: Record<AssistantActivityStatus, { id: string; defaultMessage: string }> = {
  thinking: { id: 'widget.messenger.assistant.thinking', defaultMessage: 'Thinking…' },
  searching_kb: {
    id: 'widget.messenger.assistant.searching',
    defaultMessage: 'Searching the knowledge base…',
  },
  reviewing_conversation: {
    id: 'widget.messenger.assistant.reviewing',
    defaultMessage: 'Reviewing the conversation…',
  },
}

/** The live working trace shown while Quinn's turn runs (thinking → searching). */
export function AssistantWorkingTrace({ status }: { status: AssistantActivityStatus }) {
  const label = ACTIVITY[status]
  return (
    <div className="flex items-center gap-2 py-1" role="status" aria-live="polite">
      <Spinner />
      <span className="animate-pulse text-[13px] text-muted-foreground">
        <FormattedMessage id={label.id} defaultMessage={label.defaultMessage} />
      </span>
    </div>
  )
}

/** The host a citation link resolves to. KB citations are relative /hc/ paths,
 *  so resolve them against the current origin (where the widget and its help
 *  center are served) to show where the link actually goes. */
function citationHost(url: string): string {
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : undefined
    return new URL(url, base).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Open behaviour for a citation. Callback-driven surfaces (the help-center
 *  Ask AI) navigate in-app; without one, the dot is a new-tab link. */
export type CitationOpen = (citation: RenderableCitation) => void

const CITATION_DOT_CLASS =
  'mx-0.5 inline-grid h-[18px] w-[18px] place-items-center rounded-full bg-foreground/10 text-[10.5px] font-bold tabular-nums text-muted-foreground no-underline transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground'

// Internal-sourced citations (COPILOT-SIDEBAR-UX.md's leak-gate badge) get an
// amber tint instead of the default neutral pill. Additive: only ever applied
// when `citation.internal === true`, so every non-internal citation keeps the
// exact class list above.
const CITATION_DOT_INTERNAL_CLASS =
  'bg-amber-400/20 text-amber-700 dark:bg-amber-400/25 dark:text-amber-300 hover:bg-amber-500 hover:text-white focus-visible:bg-amber-500 focus-visible:text-white'

/** A single inline citation dot with a hover/focus source card (Fibi-style).
 *  An internal-sourced citation (`internal === true`) additionally gets an
 *  amber tint and a small lock badge — the visual half of the Copilot leak
 *  gate (COPILOT-SIDEBAR-UX.md B.4) — and its hovercard shows an "Internal"
 *  tag instead of a URL host when there is no public url. Every other
 *  citation renders exactly as before. */
function CitationDot({
  n,
  citation,
  onOpen,
}: {
  n: number
  citation: RenderableCitation
  onOpen?: CitationOpen
}) {
  const isInternal = citation.internal === true
  const hasUrl = !!citation.url
  const source = citationHost(citation.url) || citation.title
  const label = isInternal
    ? `Internal source ${n}: ${citation.title}`
    : `Source ${n}: ${citation.title}`
  const dotClass = cn(CITATION_DOT_CLASS, isInternal && CITATION_DOT_INTERNAL_CLASS)
  return (
    <span className="group relative inline-block align-[1px]">
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(citation)}
          aria-label={label}
          className={cn(dotClass, 'cursor-pointer')}
        >
          {n}
        </button>
      ) : (
        <a
          href={citation.url}
          target="_blank"
          rel="noreferrer"
          aria-label={label}
          className={dotClass}
        >
          {n}
        </a>
      )}
      {isInternal && (
        <LockClosedIcon
          aria-hidden
          className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 p-[1.5px] text-white"
        />
      )}
      <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-30 w-56 -translate-x-1/2 translate-y-1 rounded-xl border border-border bg-popover p-3 text-left opacity-0 shadow-xl transition-all group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100">
        <span className="mb-1.5 block text-[13px] font-semibold leading-snug text-foreground">
          {citation.title}
        </span>
        {isInternal && !hasUrl ? (
          <span className="flex items-center gap-1.5 text-[12px] text-amber-700 dark:text-amber-300">
            <LockClosedIcon className="h-3 w-3 shrink-0" />
            Internal
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <ArrowTopRightOnSquareIcon className="h-3 w-3 shrink-0" />
            {source}
          </span>
        )}
      </span>
    </span>
  )
}

/** A streaming caret trailing the answer while it's still arriving. */
function AnswerCaret() {
  return (
    <span
      aria-hidden
      className="ms-0.5 inline-block h-[1em] w-px animate-pulse bg-primary/80 align-[-0.15em]"
    />
  )
}

/** Render one line's inline spans: plain text, **bold**, and [n] citation dots.
 *  A `[n]` with no resolved citation (still streaming) renders as nothing. */
function InlineSpans({
  spans,
  citations,
  onOpen,
}: {
  spans: InlineSpan[]
  citations: RenderableCitation[]
  onOpen?: CitationOpen
}) {
  return (
    <>
      {spans.map((span, k) => {
        if (span.cite !== undefined) {
          const citation = citations[span.cite - 1]
          return citation ? (
            <CitationDot key={k} n={span.cite} citation={citation} onOpen={onOpen} />
          ) : null
        }
        return span.bold ? <strong key={k}>{span.text}</strong> : <span key={k}>{span.text}</span>
      })}
    </>
  )
}

/**
 * Quinn's answer rendered as markdown-lite (paragraphs, ordered/bullet lists,
 * bold) with inline `[n]` citation dots — the same parser the Help Center's Ask
 * AI uses, so the two AI surfaces render identically. No raw HTML.
 */
export function AssistantAnswer({
  text,
  citations,
  caret = false,
  onCitationOpen,
}: {
  text: string
  citations: RenderableCitation[]
  caret?: boolean
  /** When set, citation dots become in-app buttons instead of new-tab links. */
  onCitationOpen?: CitationOpen
}) {
  const blocks = useMemo(() => parseMarkdownLite(text), [text])
  const lastBlock = blocks.length - 1
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.length === 0 && caret && <AnswerCaret />}
      {blocks.map((block, i) => {
        const isLast = i === lastBlock
        if (block.kind === 'list') {
          const lastItem = block.items.length - 1
          const items = block.items.map((item, j) => (
            <li key={j} className="ps-0.5">
              <InlineSpans spans={item} citations={citations} onOpen={onCitationOpen} />
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
                <InlineSpans spans={line} citations={citations} onOpen={onCitationOpen} />
                {caret && isLast && j === lastLine && <AnswerCaret />}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}

/** Quinn's answer as it streams, before the persisted message row lands.
 *  Citations resolve on the final message, so [n] markers render as nothing yet. */
export function AssistantStreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-start">
      <div className="max-w-[85%] rounded-2xl bg-muted px-3.5 py-2.5 text-foreground">
        <AssistantAnswer text={text} citations={[]} caret />
      </div>
    </div>
  )
}

/** Collapsed "Searched the knowledge base · N sources" trace on a grounded reply. */
export function AssistantSourcesTrace({ citations }: { citations: RenderableCitation[] }) {
  const [open, setOpen] = useState(false)
  if (citations.length === 0) return null
  return (
    <div className="mb-1 flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[12px] text-muted-foreground/70 transition-colors hover:text-muted-foreground"
      >
        <MagnifyingGlassIcon className="h-3 w-3" />
        <FormattedMessage
          id="widget.messenger.assistant.searched"
          defaultMessage="Searched the knowledge base · {count, plural, one {# source} other {# sources}}"
          values={{ count: citations.length }}
        />
        <ChevronDownIcon className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="flex flex-col gap-1 ps-4">
          {citations.map((c, i) => (
            <li key={c.id}>
              <a
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-[12px] text-muted-foreground no-underline hover:text-foreground"
              >
                <span className="tabular-nums text-muted-foreground/40">{i + 1}</span>
                {c.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
