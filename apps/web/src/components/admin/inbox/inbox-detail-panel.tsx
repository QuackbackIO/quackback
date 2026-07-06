import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouteContext } from '@tanstack/react-router'
import {
  ArrowTopRightOnSquareIcon,
  BuildingOffice2Icon,
  CalendarIcon,
  CheckBadgeIcon,
  ClockIcon,
  FaceSmileIcon,
  FlagIcon,
  InboxArrowDownIcon,
  SparklesIcon,
  TagIcon,
  TicketIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
import type { PrincipalId } from '@quackback/ids'
import {
  HANDOFF_REASON_LABELS,
  CONVERSATION_END_REASON_LABELS,
  type ConversationDTO,
  type AssistantInvolvementOutcome,
} from '@/lib/shared/conversation/types'
import type { InboxItemRef } from '@/lib/shared/inbox/items'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import {
  listConversationsForUserFn,
  getConversationAssistantActivityFn,
} from '@/lib/server/functions/conversation'
import { getPortalUserFn } from '@/lib/server/functions/admin'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { useMediaQuery } from '@/lib/client/hooks/use-media-query'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { formatSlaCountdown, dueCountdownTone } from '@/lib/shared/conversation/sla'
import { PriorityControl } from '@/components/admin/conversation/priority-control'
import { AssigneeControl } from '@/components/admin/conversation/assignee-control'
import { ConversationTagsEditor } from '@/components/admin/conversation/conversation-tags-editor'
import { ConversationAttributesEditor } from '@/components/admin/conversation/conversation-attributes-editor'
import { StatusControl } from '@/components/admin/conversation/status-control'
import { NoEmailBadge, CHANNEL_LABEL } from '@/components/admin/conversation/channel-badge'
import { TONE_CLASSES } from '@/components/admin/conversation/sla-chip'
import { CompanyCard } from '@/components/admin/conversation/company-card'
import { CopilotPanel } from '@/components/admin/conversation/copilot-panel'
import { usePersonBlockStatus } from '@/components/admin/users/block-person-control'
import { TicketTypeBadge, TicketStageChip } from '@/components/admin/inbox/ticket-chips'
import {
  TicketStatusControl,
  TicketAssigneeControl,
  TicketPriorityControl,
} from '@/components/admin/inbox/ticket-controls'
import { TicketLinks } from '@/components/admin/inbox/ticket-links'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DetailRow as Row, formatDate } from '@/components/shared/detail-row'
import { TimeAgo } from '@/components/ui/time-ago'
import { cn } from '@/lib/shared/utils'

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
 * A ticket's `dueAt` countdown, styled like `sla-chip.tsx`'s conversation SLA
 * chip (§2.7's "SLA due (dueAt countdown like the conversation SlaChip
 * idiom)") but reading the ticket's own bare `dueAt`/`resolvedAt` timestamps
 * directly — a ticket carries no policy/target metadata to drive the richer
 * `ConversationSlaDTO` shape. Renders nothing once resolved or with no due
 * date set, and only after mount (the label depends on "now").
 */
function TicketDueChip({ dueAt, resolvedAt }: { dueAt: string | null; resolvedAt: string | null }) {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  if (!dueAt || resolvedAt || !now) return null

  const remainingMs = new Date(dueAt).getTime() - now.getTime()
  const tone = dueCountdownTone(remainingMs)
  const overdue = tone === 'overdue'
  const abs = Math.abs(remainingMs)

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
        TONE_CLASSES[tone]
      )}
      title={`Due ${formatDate(dueAt)}`}
    >
      <ClockIcon className="h-3 w-3" aria-hidden />
      {overdue ? `${formatSlaCountdown(abs)} over` : formatSlaCountdown(abs)}
    </span>
  )
}

export interface InboxDetailPanelProps {
  /** The open item, discriminated by kind. */
  item: InboxItemRef
  /** Present for a conversation item. */
  conversation?: ConversationDTO
  /** The item's own ticket (a ticket item), OR the linked customer ticket of a
   *  plain conversation (unified inbox §2.1's one-row rule) — undefined/null
   *  when a conversation has no linked ticket. */
  ticket?: TicketDTO | null
  onChanged: () => void
  /** Navigate to another item (a previous conversation from the contact card,
   *  or the linked ticket row in Links) — a bare TypeID, either kind. */
  onSelectItem: (id: string) => void
  /** Open the (conversation-level) track-as-feedback dialog. Conversation-only. */
  onTrackAsFeedback: () => void
  /** Open the create-ticket flow, prefilled from this conversation. Shown only
   *  on a plain conversation with no linked ticket. */
  onCreateTicket: () => void
  /** Insert a Copilot answer into the reply composer or an internal note. */
  onInsertFromCopilot: (text: string, mode: 'reply' | 'note') => void
  /** Current plain text of the reply composer (P2-C.1's Format chip). */
  getComposerText: () => string
  /** Replace the reply composer's content with a Format transform's result. */
  onReplaceComposerText: (text: string) => void
}

/**
 * The unified inbox detail panel (UNIFIED-INBOX-SPEC.md §2.7): one panel for
 * both a conversation and a ticket selection (a plain conversation, a
 * conversation with a linked customer ticket, or a standalone ticket of any
 * type), assembled from the existing per-kind pieces. Section order: Contact
 * (requester principal, hidden for back_office/tracker), Ticket card (ticket
 * properties + the create-ticket empty slot), Properties, Attributes
 * (conversation-only), Links, Quinn activity (conversation-only). Details/
 * Copilot tabs unchanged from the pre-M5 conversation-only panel.
 */
export function InboxDetailPanel({
  item,
  conversation,
  ticket,
  onChanged,
  onSelectItem,
  onTrackAsFeedback,
  onCreateTicket,
  onInsertFromCopilot,
  getComposerText,
  onReplaceComposerText,
}: InboxDetailPanelProps) {
  const { settings } = useRouteContext({ from: '/admin' }) as {
    settings?: { featureFlags?: FeatureFlags } | null
  }
  const flags = settings?.featureFlags
  const hasCopilotPermission = usePermission(PERMISSIONS.COPILOT_USE)
  const showCopilotTab = !!flags?.assistantCopilot && hasCopilotPermission

  const isTicketItem = item.kind === 'ticket'
  // back_office/tracker tickets have no requester concept at all (§2.7) — the
  // Contact card is hidden entirely rather than rendered empty.
  const isBackOfficeOrTracker =
    isTicketItem && (ticket?.type === 'back_office' || ticket?.type === 'tracker')

  // The requester principal, generalized across kinds: a conversation's
  // visitor, or a (customer) ticket's requester.
  const principalId: PrincipalId | undefined = isTicketItem
    ? (ticket?.requester?.principalId ?? undefined)
    : conversation?.visitor.principalId
  const principalName = isTicketItem
    ? (ticket?.requester?.displayName ?? 'Requester')
    : (conversation?.visitor.displayName ?? 'Visitor')
  const principalAvatarUrl = isTicketItem
    ? (ticket?.requester?.avatarUrl ?? null)
    : (conversation?.visitor.avatarUrl ?? null)
  const { blocked: contactBlocked } = usePersonBlockStatus(principalId)

  // The panel is `hidden xl:flex`; only fetch its data when it's actually shown
  // so smaller viewports don't pay for an invisible sidebar.
  const isVisible = useMediaQuery('(min-width: 1280px)')

  const { data: detail } = useQuery({
    queryKey: conversationKeys.agentContactDetail(principalId),
    queryFn: () => getPortalUserFn({ data: { principalId: principalId as PrincipalId } }),
    enabled: isVisible && !!principalId,
    staleTime: 60_000,
  })
  const { data: history } = useQuery({
    queryKey: conversationKeys.agentUserConversationsFor(principalId),
    queryFn: () =>
      listConversationsForUserFn({ data: { principalId: principalId as PrincipalId } }),
    enabled: isVisible && !!principalId,
    staleTime: 30_000,
  })
  const { data: aiActivity } = useQuery({
    queryKey: conversationKeys.agentAssistantActivity(conversation?.id),
    queryFn: () =>
      getConversationAssistantActivityFn({ data: { conversationId: conversation!.id } }),
    enabled: isVisible && !isTicketItem && !!conversation,
    staleTime: 30_000,
  })

  const email = detail?.email ?? (isTicketItem ? null : (conversation?.visitorEmail ?? null))
  const currentConversationId = !isTicketItem ? conversation?.id : undefined
  const previous = (history?.conversations ?? []).filter((c) => c.id !== currentConversationId)
  // `detail` is non-null only for identified portal users, so it doubles as the
  // identified-vs-anonymous signal (anonymous visitors aren't portal users).
  const isIdentified = !!detail
  const convoCount = history?.conversations.length ?? 0
  const convoMore = history?.hasMore ?? false
  const firstSeen = detail?.createdAt ?? conversation?.createdAt
  const isClosedConversation = !isTicketItem && conversation?.status === 'closed'
  const endReasonLabel =
    !isTicketItem && conversation?.endReason
      ? CONVERSATION_END_REASON_LABELS[conversation.endReason]
      : null

  const showTickets = flags?.supportTickets ?? false
  // A conversation with no ticket in scope gets the create-ticket empty slot
  // instead of the populated Ticket card.
  const showCreateTicketSlot = !isTicketItem && !ticket && showTickets

  const detailsBody = (
    <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
      {/* Force Radix's inner viewport wrapper (display:table by default, which
          grows to content width and defeats truncate) to block so children are
          constrained to the panel width and long text clips with an ellipsis. */}
      <div className="m-3 space-y-5 rounded-xl border border-border/20 bg-card p-4 shadow-sm">
        {/* 1. Contact — the requester principal. Hidden entirely for
              back_office/tracker tickets (no requester concept). */}
        {!isBackOfficeOrTracker && (
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <Avatar
                src={principalAvatarUrl}
                name={principalName}
                className="size-9 shrink-0 text-sm"
              />
              <div className="min-w-0">
                {principalId && isIdentified ? (
                  <Link
                    to="/admin/users"
                    search={{ selected: principalId }}
                    className="flex items-center gap-1 text-sm font-medium hover:underline"
                  >
                    <span className="truncate">{principalName}</span>
                    {detail?.emailVerified && (
                      <CheckBadgeIcon
                        className="h-3.5 w-3.5 shrink-0 text-primary"
                        title="Verified email"
                      />
                    )}
                  </Link>
                ) : (
                  <p className="truncate text-sm font-medium">
                    {principalId ? principalName : 'No requester'}
                  </p>
                )}
                {principalId ? (
                  email ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {email}
                      {!detail?.email && !isTicketItem && conversation?.visitorEmail && (
                        <span className="ml-1 text-muted-foreground/50">(in conversation)</span>
                      )}
                    </p>
                  ) : (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      Anonymous <NoEmailBadge />
                    </p>
                  )
                ) : null}
                {contactBlocked && (
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

            {principalId && (
              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Conversations</span>
                  <span className="font-medium text-foreground">
                    {convoCount}
                    {convoMore ? '+' : ''}
                  </span>
                </div>
                {firstSeen && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">First seen</span>
                    <span className="font-medium text-foreground">{formatDate(firstSeen)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Company context (plan / MRR); renders nothing when unset. */}
            {principalId && <CompanyCard principalId={principalId} enabled={isVisible} />}

            {/* Previous conversations (this principal's other threads). */}
            {previous.length > 0 && (
              <div className="space-y-1.5 border-t border-border/30 pt-3">
                <p className="text-xs font-medium text-muted-foreground">Previous conversations</p>
                {previous.slice(0, 8).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onSelectItem(c.id)}
                    className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
                  >
                    <span className="block w-full min-w-0 truncate text-xs text-foreground/90">
                      {c.subject ?? c.lastMessagePreview ?? 'Conversation'}
                    </span>
                    <span className="block w-full min-w-0 truncate text-[10px] capitalize text-muted-foreground">
                      {c.status} · <TimeAgo date={c.lastMessageAt} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 2. Ticket card — populated when the item is or links a ticket;
              otherwise the create-ticket empty slot. */}
        {ticket ? (
          <div className="space-y-3 border-t border-border/30 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Ticket</span>
              <TicketTypeBadge type={ticket.type} />
            </div>
            <div className="border-t border-border/30" />
            <Row label="Status">
              <TicketStatusControl ticket={ticket} onChanged={onChanged} />
            </Row>
            <Row label="Stage">
              {ticket.stage.slot ? (
                <TicketStageChip stage={ticket.stage} />
              ) : (
                <span className="text-xs text-muted-foreground">Internal only</span>
              )}
            </Row>
            {ticket.dueAt && !ticket.resolvedAt && (
              <Row icon={ClockIcon} label="Due">
                <TicketDueChip dueAt={ticket.dueAt} resolvedAt={ticket.resolvedAt} />
              </Row>
            )}
            <Row icon={CalendarIcon} label="Opened">
              <span className="text-sm font-medium text-foreground">
                {formatDate(ticket.createdAt)}
              </span>
            </Row>
            <Row icon={CalendarIcon} label="First response">
              <span className="text-sm font-medium text-foreground">
                {ticket.firstResponseAt ? formatDate(ticket.firstResponseAt) : 'Not yet'}
              </span>
            </Row>
            {ticket.resolvedAt && (
              <Row icon={CalendarIcon} label="Resolved">
                <span className="text-sm font-medium text-foreground">
                  {formatDate(ticket.resolvedAt)}
                </span>
              </Row>
            )}
            {/* Ticket custom attributes — the same registry as conversations,
                  targeted at this ticket. */}
            <ConversationAttributesEditor
              target={{ ticketId: ticket.id }}
              customAttributes={ticket.customAttributes}
              onChanged={onChanged}
              enabled={isVisible}
            />
          </div>
        ) : (
          showCreateTicketSlot && (
            <div className="border-t border-border/30 pt-4">
              <Button type="button" variant="outline" className="w-full" onClick={onCreateTicket}>
                <TicketIcon className="h-4 w-4" /> Create ticket
              </Button>
            </div>
          )
        )}

        {/* 3. Properties. Conversation rows keep today's controls; ticket
              rows use the ticket controls. Tags are conversation-only. The
              ticket's own status lives in the Ticket card above, so it is not
              repeated here. */}
        <div className="space-y-4 border-t border-border/30 pt-4">
          <span className="text-sm text-muted-foreground">Properties</span>
          <div className="border-t border-border/30" />
          {!isTicketItem && conversation && (
            <>
              {isClosedConversation && endReasonLabel && (
                <Row label="Ended">
                  <span className="text-sm font-medium text-foreground">{endReasonLabel}</span>
                </Row>
              )}
              <Row label="Status">
                <StatusControl
                  conversationId={conversation.id}
                  status={conversation.status}
                  snoozedUntil={conversation.snoozedUntil}
                  onChanged={onChanged}
                />
              </Row>
            </>
          )}
          <Row icon={FlagIcon} label="Priority">
            {isTicketItem && ticket ? (
              <TicketPriorityControl ticket={ticket} onChanged={onChanged} />
            ) : (
              conversation && (
                <PriorityControl
                  conversationId={conversation.id}
                  value={conversation.priority}
                  onChanged={onChanged}
                />
              )
            )}
          </Row>
          <Row icon={UserCircleIcon} label="Assignee">
            {isTicketItem && ticket ? (
              <TicketAssigneeControl ticket={ticket} onChanged={onChanged} />
            ) : (
              conversation && (
                <AssigneeControl
                  conversationId={conversation.id}
                  assignedAgent={conversation.assignedAgent}
                  onChanged={onChanged}
                />
              )
            )}
          </Row>
          {!isTicketItem && conversation && (
            <Row icon={TagIcon} label="Tags" align="start">
              <div className="flex flex-wrap justify-end gap-1">
                <ConversationTagsEditor conversationId={conversation.id} tags={conversation.tags} />
              </div>
            </Row>
          )}
          {ticket && (
            <Row icon={BuildingOffice2Icon} label="Company">
              <span className="truncate text-sm font-medium text-foreground">
                {ticket.company?.name ?? 'None'}
              </span>
            </Row>
          )}
          {!isTicketItem && conversation && (
            <Row icon={InboxArrowDownIcon} label="Channel">
              <span className="text-sm font-medium text-foreground">
                {CHANNEL_LABEL[conversation.channel]}
              </span>
            </Row>
          )}
          <Row icon={CalendarIcon} label="Created">
            <span className="text-sm font-medium text-foreground">
              {formatDate(isTicketItem ? ticket!.createdAt : conversation!.createdAt)}
            </span>
          </Row>
          {ticket && (
            <Row label="Reference">
              <span className="font-mono text-sm font-medium text-foreground">
                {ticket.reference}
              </span>
            </Row>
          )}
          {!isTicketItem && conversation?.csatRating != null && (
            <Row icon={FaceSmileIcon} label="CSAT">
              <span className="text-sm text-amber-500">
                {'★'.repeat(conversation.csatRating)}
                <span className="text-muted-foreground/40">
                  {'★'.repeat(Math.max(0, 5 - conversation.csatRating))}
                </span>
              </span>
            </Row>
          )}
        </div>

        {/* 4. Attributes (conversation-only; a ticket's attributes live in
              the Ticket card above, targeted at the ticket instead). */}
        {!isTicketItem && conversation && (
          <ConversationAttributesEditor
            target={{ conversationId: conversation.id }}
            customAttributes={conversation.customAttributes}
            onChanged={onChanged}
            enabled={isVisible}
          />
        )}

        {/* 5. Links. */}
        {isTicketItem && ticket && (
          <div className="space-y-2 border-t border-border/30 pt-4">
            <TicketLinks ticket={ticket} onChanged={onChanged} />
          </div>
        )}
        {!isTicketItem && conversation && (
          <div className="space-y-2 border-t border-border/30 pt-4">
            {ticket && (
              <Row label="Ticket">
                <button
                  type="button"
                  onClick={() => onSelectItem(ticket.id)}
                  className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <span className="font-mono text-xs">{ticket.reference}</span>
                  <span className="truncate">{ticket.status.name}</span>
                </button>
              </Row>
            )}
            {/* Track as feedback — conversation-level (kept here per §2.7's
                  Links section). */}
            <Button type="button" variant="outline" className="w-full" onClick={onTrackAsFeedback}>
              <ArrowTopRightOnSquareIcon className="h-4 w-4" /> Track as feedback
            </Button>
          </div>
        )}

        {/* 6. Quinn AI activity — conversation-only. */}
        {!isTicketItem && aiActivity && (
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
            item view — it only resets when the item itself changes (the
            whole subtree remounts via `key={selectedId}`). */}
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
            item={item}
            flags={flags}
            onInsert={onInsertFromCopilot}
            getComposerText={getComposerText}
            onReplaceComposerText={onReplaceComposerText}
          />
        </TabsContent>
      </Tabs>
    </aside>
  )
}
