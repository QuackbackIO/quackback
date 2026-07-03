import { useState } from 'react'
import { FormattedMessage } from 'react-intl'
import { ChevronDownIcon } from '@heroicons/react/24/solid'
import { MagnifyingGlassIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import { parseMarkdownLite, type InlineSpan } from '@/components/help-center/ask-ai-text'
import type {
  AssistantActivityStatus,
  ConversationMessageCitation,
} from '@/lib/shared/conversation/types'

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

/** A single inline citation dot with a hover/focus source card (Fibi-style). */
function CitationDot({ n, citation }: { n: number; citation: ConversationMessageCitation }) {
  const source = citationHost(citation.url) || citation.title
  return (
    <span className="group relative inline-block align-[1px]">
      <a
        href={citation.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Source ${n}: ${citation.title}`}
        className="mx-0.5 inline-grid h-[18px] w-[18px] place-items-center rounded-full bg-foreground/10 text-[10.5px] font-bold tabular-nums text-muted-foreground no-underline transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground"
      >
        {n}
      </a>
      <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-30 w-56 -translate-x-1/2 translate-y-1 rounded-xl border border-border bg-popover p-3 text-left opacity-0 shadow-xl transition-all group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100">
        <span className="mb-1.5 block text-[13px] font-semibold leading-snug text-foreground">
          {citation.title}
        </span>
        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <ArrowTopRightOnSquareIcon className="h-3 w-3 shrink-0" />
          {source}
        </span>
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
}: {
  spans: InlineSpan[]
  citations: ConversationMessageCitation[]
}) {
  return (
    <>
      {spans.map((span, k) => {
        if (span.cite !== undefined) {
          const citation = citations[span.cite - 1]
          return citation ? <CitationDot key={k} n={span.cite} citation={citation} /> : null
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
}: {
  text: string
  citations: ConversationMessageCitation[]
  caret?: boolean
}) {
  const blocks = parseMarkdownLite(text)
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
              <InlineSpans spans={item} citations={citations} />
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
                <InlineSpans spans={line} citations={citations} />
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
export function AssistantSourcesTrace({ citations }: { citations: ConversationMessageCitation[] }) {
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
