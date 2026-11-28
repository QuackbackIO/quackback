/**
 * Copilot source metadata + rendering (split out of copilot-panel.tsx,
 * a pure move — see that file's header for the surface this belongs to):
 * the source-type table driving icons/labels for both the Answer-sources
 * filter popover (copilot-panel.tsx's `CopilotAskInput`) and the per-citation
 * hovercard row below, plus the citation list + row themselves.
 */
import { type MessageDescriptor } from 'react-intl'
import { useOptionalIntl } from '@/components/ui/use-optional-intl'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  LifebuoyIcon,
  LockClosedIcon,
  MapIcon,
  MegaphoneIcon,
} from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import { CitationFreshness } from '@/components/shared/conversation/assistant-turn'
import { useCopyToClipboard } from '@/lib/client/hooks/use-copy-to-clipboard'
import type { CopilotCitation } from '@/lib/shared/assistant/copilot-contract'

export type SourceType = CopilotCitation['type']

export interface SourceOption {
  type: SourceType
  /** Plural — the Answer-sources popover's filter row. */
  label: MessageDescriptor
  /** Singular — the per-citation source row's hovercard meta line. */
  rowLabel: MessageDescriptor
  subtitle?: MessageDescriptor
  icon: typeof BookOpenIcon
}

// Single source of truth for each source type's icon + labels: the popover
// filter list and the citation-row hovercard both read off this one table
// instead of keeping their own icon/label maps in sync by hand.
export const SOURCE_OPTIONS: SourceOption[] = [
  {
    type: 'article',
    label: {
      id: 'admin.inbox.copilotSources.helpCenterArticles',
      defaultMessage: 'Help center articles',
    },
    rowLabel: {
      id: 'admin.inbox.copilotSources.row.helpCenterArticle',
      defaultMessage: 'Help center article',
    },
    icon: BookOpenIcon,
  },
  {
    type: 'snippet',
    label: { id: 'admin.inbox.copilotSources.snippets', defaultMessage: 'Snippets' },
    rowLabel: { id: 'admin.inbox.copilotSources.row.snippet', defaultMessage: 'Snippet' },
    icon: DocumentTextIcon,
  },
  {
    type: 'post',
    label: { id: 'admin.inbox.copilotSources.roadmapPosts', defaultMessage: 'Roadmap posts' },
    rowLabel: { id: 'admin.inbox.copilotSources.row.roadmapPost', defaultMessage: 'Roadmap post' },
    icon: MapIcon,
  },
  {
    type: 'summary',
    label: {
      id: 'admin.inbox.copilotSources.pastConversations',
      defaultMessage: 'Past conversations',
    },
    rowLabel: {
      id: 'admin.inbox.copilotSources.row.pastConversation',
      defaultMessage: 'Past conversation',
    },
    subtitle: {
      id: 'admin.inbox.copilotSources.thisCustomersClosedConversations',
      defaultMessage: "This customer's closed conversations",
    },
    icon: ChatBubbleLeftRightIcon,
  },
  {
    type: 'ticket',
    label: { id: 'admin.inbox.copilotSources.tickets', defaultMessage: 'Tickets' },
    rowLabel: { id: 'admin.inbox.copilotSources.row.ticket', defaultMessage: 'Ticket' },
    subtitle: {
      id: 'admin.inbox.copilotSources.closedTicketResolutionSummaries',
      defaultMessage: 'Closed-ticket resolution summaries',
    },
    icon: LifebuoyIcon,
  },
  {
    type: 'changelog',
    label: { id: 'admin.inbox.copilotSources.changelog', defaultMessage: 'Changelog' },
    rowLabel: {
      id: 'admin.inbox.copilotSources.row.changelogEntry',
      defaultMessage: 'Changelog entry',
    },
    icon: MegaphoneIcon,
  },
]

const SOURCE_TYPE_META: Record<
  SourceType,
  { icon: typeof BookOpenIcon; label: MessageDescriptor }
> = Object.fromEntries(
  SOURCE_OPTIONS.map((opt) => [opt.type, { icon: opt.icon, label: opt.rowLabel }])
) as Record<SourceType, { icon: typeof BookOpenIcon; label: MessageDescriptor }>

/**
 * The Answer-sources the Copilot picker offers — every citation source type.
 * This is a per-teammate NARROWING preference (persisted in localStorage): a
 * teammate turns a source off for their own questions. Which sources actually
 * exist is workspace config the runtime enforces (it intersects this narrowing
 * with the Copilot's enabled knowledge sources), so unchecking a source the
 * workspace already disabled is a harmless no-op and the picker never needs the
 * manage-gated assistant config to render correctly. (The `assistantKnowledge`
 * feature flag that used to hide these rows retired into the per-agent config.)
 */
export function visibleSourceOptions(): SourceOption[] {
  return SOURCE_OPTIONS
}

export function CopilotSourcesList({ citations }: { citations: CopilotCitation[] }) {
  const intl = useOptionalIntl()
  return (
    <div className="ps-1">
      <p className="mb-1 text-[11px] text-muted-foreground/70">
        {intl.formatMessage(
          {
            id: 'admin.inbox.copilotSources.relevantSources',
            defaultMessage: '{count, plural, one {# relevant source} other {# relevant sources}}',
          },
          { count: citations.length }
        )}
      </p>
      <div className="flex flex-col gap-0.5">
        {citations.map((c) => (
          <CopilotSourceRow key={c.id} citation={c} />
        ))}
      </div>
    </div>
  )
}

function CopilotSourceRow({ citation }: { citation: CopilotCitation }) {
  const intl = useOptionalIntl()
  const meta = SOURCE_TYPE_META[citation.type]
  const Icon = meta.icon
  const isInternal = citation.internal === true
  const hasUrl = !!citation.url
  const { copied, copy } = useCopyToClipboard(1500)

  const copyLink = (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!citation.url) return
    void copy(citation.url)
  }

  const row = (
    <span className="group relative flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground">
      <Icon className={cn('h-3.5 w-3.5 shrink-0', isInternal && 'text-warning')} />
      <span className="truncate">{citation.title}</span>
      {isInternal && <LockClosedIcon className="h-3 w-3 shrink-0 text-warning" />}
      <span className="pointer-events-none absolute bottom-[calc(100%+6px)] start-0 z-30 w-60 -translate-y-1 rounded-xl border border-border bg-popover p-3 text-start opacity-0 shadow-xl transition-all group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <span className="mb-1 block text-[13px] font-semibold leading-snug text-foreground">
          {citation.title}
        </span>
        <span className="mb-1 block text-[11px] text-muted-foreground">
          {isInternal
            ? intl.formatMessage(
                {
                  id: 'admin.inbox.copilotSources.internalSource',
                  defaultMessage: '{source} · Internal',
                },
                { source: intl.formatMessage(meta.label) }
              )
            : intl.formatMessage(meta.label)}
        </span>
        <CitationFreshness updatedAt={citation.updatedAt} className="mb-1" />
        {hasUrl ? (
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-muted-foreground">{citation.url}</span>
            <button
              type="button"
              onClick={copyLink}
              className="pointer-events-auto shrink-0 text-[11px] text-primary hover:underline"
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </span>
        ) : (
          <span className="text-[11px] text-warning">
            {intl.formatMessage({
              id: 'admin.inbox.copilotSources.internalNotLinkable',
              defaultMessage: 'Internal · not linkable',
            })}
          </span>
        )}
      </span>
    </span>
  )

  return hasUrl ? (
    <a href={citation.url} target="_blank" rel="noreferrer" className="no-underline">
      {row}
    </a>
  ) : (
    row
  )
}
