import { useQuery } from '@tanstack/react-query'
import { Link, useRouteContext } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowTopRightOnSquareIcon,
  CalendarIcon,
  CheckBadgeIcon,
  CheckCircleIcon,
  FaceSmileIcon,
  FlagIcon,
  InboxArrowDownIcon,
  SparklesIcon,
  TagIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
import type { ConversationId } from '@quackback/ids'
import {
  HANDOFF_REASON_LABELS,
  type Channel,
  type ConversationDTO,
  type AssistantInvolvementOutcome,
} from '@/lib/shared/conversation/types'
import { CONVERSATION_END_REASON_LABELS } from '@/lib/shared/conversation/types'
import {
  listConversationsForUserFn,
  getConversationAssistantActivityFn,
  exportConversationTranscriptFn,
} from '@/lib/server/functions/conversation'
import { getPortalUserFn } from '@/lib/server/functions/admin'
import { useMediaQuery } from '@/lib/client/hooks/use-media-query'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { PriorityControl } from './priority-control'
import { AssigneeControl } from './assignee-control'
import { ExportTranscriptButton } from './export-transcript-button'
import { ConversationTagsEditor } from './conversation-tags-editor'
import { ConversationAttributesEditor } from './conversation-attributes-editor'
import { StatusControl } from './status-control'
import { NoEmailBadge } from './channel-badge'
import { CompanyCard } from './company-card'
import { CopilotPanel } from './copilot-panel'
import {
  BlockPersonControl,
  usePersonBlockStatus,
} from '@/components/admin/users/block-person-control'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DetailRow as Row, formatDate } from '@/components/shared/detail-row'
import { cn } from '@/lib/shared/utils'

const CHANNEL_LABEL: Record<Channel, string> = {
  messenger: 'Messenger',
  email: 'Email',
  web_form: 'Web form',
}

const RESOLVED_META = {
  label: 'Resolved',
  className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
}
// Both resolution flavours (customer-confirmed + assumed-after-inactivity) read
// as "Resolved" to the agent.
const AI_OUTCOME_META: Record<AssistantInvolvementOutcome, { label: string; className: string }> = {
  active: { label: 'Handling', className: 'bg-primary/10 text-primary' },
  handed_off: {
    label: 'Escalated',
    className: 'bg-amber-400/15 text-amber-700 dark:text-amber-300',
  },
  resolved_confirmed: RESOLVED_META,
  resolved_assumed: RESOLVED_META,
  abandoned: { label: 'Abandoned', className: 'bg-muted text-muted-foreground' },
}

function AiOutcomePill({ outcome }: { outcome: AssistantInvolvementOutcome }) {
  const meta = AI_OUTCOME_META[outcome]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        meta.className
      )}
    >
      {meta.label}
    </span>
  )
}

/**
 * The conversation detail / "Manage" panel — the inbox's right column. Mirrors
 * the feedback post-detail metadata-sidebar: a floating bordered card with a
 * "Manage" header, a separator, and icon+label/value rows, then the contact
 * summary and the visitor's other conversations as border-separated sections.
 */
export function ConversationDetailPanel({
  conversation,
  onChanged,
  onSelectConversation,
  onEndConversation,
  onTrackAsFeedback,
  onInsertFromCopilot,
}: {
  conversation: ConversationDTO
  onChanged: () => void
  onSelectConversation: (id: ConversationId) => void
  /** Open the end-conversation reason dialog. */
  onEndConversation: () => void
  /** Open the (conversation-level) track-as-feedback dialog. */
  onTrackAsFeedback: () => void
  /** Insert a Copilot answer into the reply composer or an internal note
   *  (agent-conversation-thread.tsx's insertFromCopilot). Only read when the
   *  Copilot tab actually renders. */
  onInsertFromCopilot: (text: string, mode: 'reply' | 'note') => void
}) {
  const { settings } = useRouteContext({ from: '/admin' }) as {
    settings?: { featureFlags?: FeatureFlags } | null
  }
  const flags = settings?.featureFlags
  const hasCopilotPermission = usePermission(PERMISSIONS.COPILOT_USE)
  const showCopilotTab = !!flags?.assistantCopilot && hasCopilotPermission
  const visitorPrincipalId = conversation.visitor.principalId
  const name = conversation.visitor.displayName ?? 'Visitor'
  const { blocked: visitorBlocked } = usePersonBlockStatus(visitorPrincipalId)
  // The panel is `hidden xl:flex`; only fetch its data when it's actually shown
  // so smaller viewports don't pay for an invisible sidebar.
  const isVisible = useMediaQuery('(min-width: 1280px)')

  const { data: detail } = useQuery({
    queryKey: ['admin', 'inbox', 'visitor', visitorPrincipalId],
    queryFn: () => getPortalUserFn({ data: { principalId: visitorPrincipalId } }),
    enabled: isVisible && !!visitorPrincipalId,
    staleTime: 60_000,
  })
  const { data: history } = useQuery({
    queryKey: ['admin', 'inbox', 'user-conversations', visitorPrincipalId],
    queryFn: () => listConversationsForUserFn({ data: { principalId: visitorPrincipalId } }),
    enabled: isVisible && !!visitorPrincipalId,
    staleTime: 30_000,
  })
  const { data: aiActivity } = useQuery({
    queryKey: ['admin', 'inbox', 'assistant-activity', conversation.id],
    queryFn: () =>
      getConversationAssistantActivityFn({ data: { conversationId: conversation.id } }),
    enabled: isVisible,
    staleTime: 30_000,
  })

  const email = detail?.email ?? conversation.visitorEmail
  const previous = (history?.conversations ?? []).filter((c) => c.id !== conversation.id)
  // `detail` is non-null only for identified portal users, so it doubles as the
  // identified-vs-anonymous signal (anonymous visitors aren't portal users).
  const isIdentified = !!detail
  // Total threads for this visitor (the history page includes the current one);
  // append "+" when there are more than one page.
  const convoCount = history?.conversations.length ?? 0
  const convoMore = history?.hasMore ?? false
  const firstSeen = detail?.createdAt ?? conversation.createdAt
  const isClosed = conversation.status === 'closed'
  // A closed thread shows its outcome in place of the End button (only when a
  // reason was actually recorded — pre-feature closes have none).
  const endReasonLabel = conversation.endReason
    ? CONVERSATION_END_REASON_LABELS[conversation.endReason]
    : null

  // Details = the pre-existing card content, unchanged. Kept as a variable so
  // both the flag-off path (byte-identical to before) and the tabbed path
  // render the exact same JSX.
  const detailsBody = (
    <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
      {/* Force Radix's inner viewport wrapper (display:table by default, which
          grows to content width and defeats truncate) to block so children are
          constrained to the panel width and long text clips with an ellipsis. */}
      <div className="m-3 space-y-5 rounded-xl border border-border/20 bg-card p-4 shadow-sm">
        {/* Contact — surfaced first so an agent sees who they're talking to
              before the management controls. Links into the admin user profile
              for identified visitors (anonymous ones aren't portal users). */}
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <Avatar
              src={conversation.visitor.avatarUrl}
              name={name}
              className="size-9 shrink-0 text-sm"
            />
            <div className="min-w-0">
              {isIdentified ? (
                <Link
                  to="/admin/users"
                  search={{ selected: visitorPrincipalId }}
                  className="flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  <span className="truncate">{name}</span>
                  {detail?.emailVerified && (
                    <CheckBadgeIcon
                      className="h-3.5 w-3.5 shrink-0 text-primary"
                      title="Verified email"
                    />
                  )}
                </Link>
              ) : (
                <p className="truncate text-sm font-medium">{name}</p>
              )}
              {email ? (
                <p className="truncate text-xs text-muted-foreground">
                  {email}
                  {!detail?.email && conversation.visitorEmail && (
                    <span className="ml-1 text-muted-foreground/50">(in conversation)</span>
                  )}
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  Anonymous <NoEmailBadge />
                </p>
              )}
              {visitorBlocked && (
                <Badge variant="destructive" className="mt-1 text-[10px]">
                  Blocked
                </Badge>
              )}
            </div>
          </div>

          {/* Segments (identified visitors only). */}
          {detail && detail.segments.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {detail.segments.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ backgroundColor: `${s.color}1a`, color: s.color }}
                >
                  {s.name}
                </span>
              ))}
            </div>
          )}

          {/* Portal activity (identified visitors only). */}
          {detail && (
            <div className="grid grid-cols-3 gap-1 text-center">
              {[
                { label: 'Posts', value: detail.postCount },
                { label: 'Comments', value: detail.commentCount },
                { label: 'Votes', value: detail.voteCount },
              ].map((s) => (
                <div key={s.label} className="rounded-md bg-muted/40 py-1.5">
                  <p className="text-sm font-semibold">{s.value}</p>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Conversation count + first-seen, available for anyone. */}
          <div className="space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Conversations</span>
              <span className="font-medium text-foreground">
                {convoCount}
                {convoMore ? '+' : ''}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">First seen</span>
              <span className="font-medium text-foreground">{formatDate(firstSeen)}</span>
            </div>
          </div>
        </div>

        {/* Company context (plan / MRR); renders nothing when unset. */}
        {visitorPrincipalId && <CompanyCard principalId={visitorPrincipalId} enabled={isVisible} />}

        {/* Manage */}
        <div className="space-y-4 border-t border-border/30 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Manage</span>
          </div>
          <div className="border-t border-border/30" />
          {/* End conversation — prominent, near the top of Manage. Once closed,
                the End button is replaced by the recorded outcome. */}
          {isClosed ? (
            endReasonLabel && (
              <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
                <CheckCircleIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">Ended:</span>
                <span className="font-medium text-foreground">{endReasonLabel}</span>
              </div>
            )
          ) : (
            <Button type="button" variant="outline" className="w-full" onClick={onEndConversation}>
              <CheckCircleIcon className="h-4 w-4" /> End conversation
            </Button>
          )}
          <Row label="Status">
            <StatusControl
              conversationId={conversation.id}
              status={conversation.status}
              snoozedUntil={conversation.snoozedUntil}
              onChanged={onChanged}
            />
          </Row>
          <Row icon={FlagIcon} label="Priority">
            <PriorityControl
              conversationId={conversation.id}
              value={conversation.priority}
              onChanged={onChanged}
            />
          </Row>
          <Row icon={UserCircleIcon} label="Assignee">
            <AssigneeControl
              conversationId={conversation.id}
              assignedAgent={conversation.assignedAgent}
              onChanged={onChanged}
            />
          </Row>
          <Row icon={TagIcon} label="Tags" align="start">
            <div className="flex flex-wrap justify-end gap-1">
              <ConversationTagsEditor conversationId={conversation.id} tags={conversation.tags} />
            </div>
          </Row>
          <ExportTranscriptButton
            load={() =>
              exportConversationTranscriptFn({ data: { conversationId: conversation.id } })
            }
          />
          <Row icon={InboxArrowDownIcon} label="Channel">
            <span className="text-sm font-medium text-foreground">
              {CHANNEL_LABEL[conversation.channel]}
            </span>
          </Row>
          <Row icon={CalendarIcon} label="Created">
            <span className="text-sm font-medium text-foreground">
              {formatDate(conversation.createdAt)}
            </span>
          </Row>
          {conversation.csatRating != null && (
            <Row icon={FaceSmileIcon} label="CSAT">
              <span className="text-sm text-amber-500">
                {'★'.repeat(conversation.csatRating)}
                <span className="text-muted-foreground/40">
                  {'★'.repeat(Math.max(0, 5 - conversation.csatRating))}
                </span>
              </span>
            </Row>
          )}
          {/* Block / Unblock the person on the other side of the conversation
                — rejects their future messages and re-registration. */}
          {visitorPrincipalId && (
            <BlockPersonControl
              principalId={visitorPrincipalId}
              personName={conversation.visitor.displayName}
              className="w-full"
            />
          )}
        </div>

        {/* Attributes — typed inline editors for the admin-defined registry;
              renders nothing while no definitions exist. */}
        <ConversationAttributesEditor
          conversationId={conversation.id}
          customAttributes={conversation.customAttributes}
          onChanged={onChanged}
          enabled={isVisible}
        />

        {/* Quinn AI activity — outcome, escalation reason, sources, CSAT. */}
        {aiActivity && (
          <div className="space-y-2.5 border-t border-border/30 pt-4">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <SparklesIcon className="h-4 w-4" /> Quinn AI
              </p>
              <AiOutcomePill outcome={aiActivity.outcome} />
            </div>
            {aiActivity.outcome === 'handed_off' && aiActivity.handoffReason && (
              <p className="text-xs text-muted-foreground">
                Escalated —{' '}
                {HANDOFF_REASON_LABELS[aiActivity.handoffReason] ?? aiActivity.handoffReason}
              </p>
            )}
            {aiActivity.rating != null && (
              <Row icon={FaceSmileIcon} label="AI CSAT">
                <span className="text-sm text-foreground">{aiActivity.rating}/5</span>
              </Row>
            )}
            {aiActivity.sources.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">Sources used</p>
                {aiActivity.sources.map((s) => (
                  <a
                    key={s.id}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs text-muted-foreground no-underline hover:text-foreground"
                  >
                    <ArrowTopRightOnSquareIcon className="h-3 w-3 shrink-0" />
                    <span className="truncate">{s.title || s.url}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Previous conversations */}
        {previous.length > 0 && (
          <div className="space-y-1.5 border-t border-border/30 pt-4">
            <p className="text-xs font-medium text-muted-foreground">Previous conversations</p>
            {previous.slice(0, 8).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectConversation(c.id)}
                className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
              >
                <span className="block w-full min-w-0 truncate text-xs text-foreground/90">
                  {c.subject ?? c.lastMessagePreview ?? 'Conversation'}
                </span>
                <span className="block w-full min-w-0 truncate text-[10px] capitalize text-muted-foreground">
                  {c.status} · {formatDistanceToNow(new Date(c.lastMessageAt), { addSuffix: true })}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Track as feedback — conversation-level, pinned to the bottom of the
              panel (below Previous conversations) so it reads as a wrap-up action. */}
        <div className="border-t border-border/30 pt-4">
          <Button type="button" variant="outline" className="w-full" onClick={onTrackAsFeedback}>
            <ArrowTopRightOnSquareIcon className="h-4 w-4" /> Track as feedback
          </Button>
        </div>
      </div>
    </ScrollArea>
  )

  // Flag off (or no permission): no Tabs wrapper at all — byte-identical to
  // the pre-Copilot panel.
  if (!showCopilotTab) {
    return <aside className="hidden w-72 shrink-0 flex-col xl:flex">{detailsBody}</aside>
  }

  return (
    <aside className="hidden w-72 shrink-0 flex-col xl:flex">
      <Tabs defaultValue="details" className="min-h-0 flex-1 gap-0">
        <TabsList className="m-3 mb-0 self-start">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="copilot">
            <SparklesIcon className="h-3.5 w-3.5" />
            Copilot
          </TabsTrigger>
        </TabsList>
        {/* Both tabs stay mounted (forceMount + CSS-hide instead of Radix's
            default unmount-on-inactive) so Details keeps its scroll position
            and the Copilot thread survives switching tabs within the same
            conversation view — it only resets when the conversation itself
            changes (the whole subtree remounts via `key={selectedId}`). */}
        <TabsContent
          value="details"
          forceMount
          className="min-h-0 flex-1 data-[state=inactive]:hidden"
        >
          {detailsBody}
        </TabsContent>
        <TabsContent
          value="copilot"
          forceMount
          className="min-h-0 flex-1 data-[state=inactive]:hidden"
        >
          <CopilotPanel
            conversationId={conversation.id}
            flags={flags}
            onInsert={onInsertFromCopilot}
          />
        </TabsContent>
      </Tabs>
    </aside>
  )
}
