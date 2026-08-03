/**
 * Right-panel "Activity" tab. Renders the ticket's audit timeline pulled via
 * `ticketQueries.activity()`. Each row turns the stored audit event and
 * metadata into a readable product summary instead of exposing raw JSON/IDs.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import type { TicketId } from '@quackback/ids'
import { ticketQueries } from '@/lib/client/queries/tickets'
import { TimeAgo } from '@/components/ui/time-ago'
import { Badge } from '@/components/ui/badge'
import {
  ArrowRight,
  CheckCircle2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Route,
  Settings2,
  Share2,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  UserX,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'

export interface TicketActivityTimelineProps {
  ticketId: TicketId
  principalNames?: Record<string, string>
}

interface ActivityRow {
  id: string
  principalId: string | null
  type: string
  metadata: unknown
  createdAt: Date | string
  actorName?: string | null
  actorAvatarUrl?: string | null
}

interface ActivityDisplay {
  icon: LucideIcon
  title: string
  detail?: ReactNode
}

interface ChangeSummary {
  key: string
  label: string
  from: string | null
  to: string | null
}

const FIELD_LABELS: Record<string, string> = {
  description: 'Description',
  descriptionJson: 'Description',
  descriptionText: 'Description',
  subject: 'Subject',
  priority: 'Priority',
  visibilityScope: 'Visibility',
  primaryTeamId: 'Primary team',
  assigneePrincipalId: 'Assignee',
  assigneeTeamId: 'Assignee team',
  organizationId: 'Organization',
  requesterContactId: 'Requester contact',
  inboxId: 'Inbox',
}

const FIELD_ACTIONS: Record<string, string> = {
  description: 'updated the description',
  descriptionJson: 'updated the description',
  descriptionText: 'updated the description',
  subject: 'changed the subject',
  priority: 'changed priority',
  visibilityScope: 'changed visibility',
  primaryTeamId: 'changed primary team',
  assigneePrincipalId: 'changed assignee',
  assigneeTeamId: 'changed assignee team',
  organizationId: 'changed organization',
  requesterContactId: 'changed requester contact',
  inboxId: 'changed inbox',
}

const CATEGORY_LABELS: Record<string, string> = {
  open: 'Open',
  pending: 'Pending',
  on_hold: 'On hold',
  solved: 'Solved',
  closed: 'Closed',
}

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

const VISIBILITY_LABELS: Record<string, string> = {
  team: 'Team',
  org: 'Organization',
  shared: 'Shared',
  private: 'Private',
}

const CHANNEL_LABELS: Record<string, string> = {
  api: 'API',
  email: 'Email',
  widget: 'Widget',
  portal: 'Portal',
  github: 'GitHub',
}

const AUDIENCE_LABELS: Record<string, string> = {
  public: 'Public reply',
  internal: 'Internal note',
  shared_team: 'Shared-team note',
}

const AUDIENCE_ACTIONS: Record<string, string> = {
  public: 'posted a public reply',
  internal: 'posted an internal note',
  shared_team: 'posted a shared-team note',
}

const PARTICIPANT_ROLE_LABELS: Record<string, string> = {
  watcher: 'Watcher',
  collaborator: 'Collaborator',
  cc: 'CC',
}

const ACCESS_LABELS: Record<string, string> = {
  read: 'Read access',
  comment: 'Comment access',
  full: 'Full access',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function actorLabel(row: ActivityRow, principalNames?: Record<string, string>): string {
  const name = row.actorName?.trim()
  if (name) return name
  if (row.principalId && principalNames?.[row.principalId]) return principalNames[row.principalId]
  return row.principalId ? 'Someone' : 'System'
}

function titleCaseToken(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function truncate(value: string, max = 80): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).trimEnd()}...`
}

function isOpaqueIdentifier(value: string): boolean {
  return /^[a-z]+_[a-z0-9]{8,}$/i.test(value) || /^[0-9a-f-]{24,}$/i.test(value)
}

function formatKnownValue(field: string, value: string): string {
  if (field === 'priority') return PRIORITY_LABELS[value] ?? titleCaseToken(value)
  if (field === 'visibilityScope') return VISIBILITY_LABELS[value] ?? titleCaseToken(value)
  if (field === 'category' || field === 'statusCategory') {
    return CATEGORY_LABELS[value] ?? titleCaseToken(value)
  }
  if (field === 'channel') return CHANNEL_LABELS[value] ?? titleCaseToken(value)
  if (field === 'audience') return AUDIENCE_LABELS[value] ?? titleCaseToken(value)
  if (field === 'accessLevel') return ACCESS_LABELS[value] ?? titleCaseToken(value)
  if (field === 'role') return PARTICIPANT_ROLE_LABELS[value] ?? titleCaseToken(value)
  return value
}

function formatChangeValue(field: string, value: unknown): string | null {
  if (value == null || value === '') return 'None'
  if (field === 'description' || field === 'descriptionJson' || field === 'descriptionText') {
    return null
  }
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled'
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return 'Empty'
  if (field.endsWith('Id') || isOpaqueIdentifier(trimmed)) return null

  return truncate(formatKnownValue(field, trimmed))
}

function formatEventType(type: string): string {
  return titleCaseToken(type.split('.').join(' '))
}

function detailPill(value: string) {
  return (
    <Badge variant="subtle" className="max-w-full whitespace-normal break-words px-1.5 py-0">
      {value}
    </Badge>
  )
}

function ChangeLine({ change }: { change: ChangeSummary }) {
  const hasValues = change.from !== null || change.to !== null

  if (!hasValues) {
    return <span>{change.label} changed</span>
  }

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1">
      <span>{change.label}:</span>
      {change.from && detailPill(change.from)}
      <ArrowRight className="size-3 shrink-0 text-muted-foreground/70" />
      {change.to && detailPill(change.to)}
    </span>
  )
}

function ChangeList({ changes }: { changes: ChangeSummary[] }) {
  if (changes.length === 0) return null

  return (
    <div className="mt-1.5 space-y-1 text-xs leading-5 text-muted-foreground">
      {changes.map((change) => (
        <div key={change.key}>
          <ChangeLine change={change} />
        </div>
      ))}
    </div>
  )
}

function SummaryPills({ items }: { items: Array<string | null | undefined> }) {
  const visible = items.filter((item): item is string => Boolean(item))
  if (visible.length === 0) return null

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {visible.map((item) => (
        <Badge key={item} variant="outline" className="px-1.5 py-0 text-[11px]">
          {item}
        </Badge>
      ))}
    </div>
  )
}

function collapseDiffKey(field: string): string {
  return field === 'descriptionJson' || field === 'descriptionText' ? 'description' : field
}

function summarizeDiff(metadata: unknown): ChangeSummary[] {
  if (!isRecord(metadata) || !isRecord(metadata.diff)) return []

  const changes: ChangeSummary[] = []
  const seen = new Set<string>()

  for (const [field, rawChange] of Object.entries(metadata.diff)) {
    if (!isRecord(rawChange)) continue
    const key = collapseDiffKey(field)
    if (seen.has(key)) continue
    seen.add(key)

    changes.push({
      key,
      label: FIELD_LABELS[key] ?? titleCaseToken(key),
      from: formatChangeValue(key, rawChange.from),
      to: formatChangeValue(key, rawChange.to),
    })
  }

  return changes
}

function updatedDisplay(row: ActivityRow, actor: string): ActivityDisplay {
  const changes = summarizeDiff(row.metadata)
  if (changes.length === 0) {
    return { icon: Pencil, title: `${actor} updated this ticket` }
  }

  if (changes.length === 1) {
    const action = FIELD_ACTIONS[changes[0].key] ?? `changed ${changes[0].label.toLowerCase()}`
    return {
      icon: Pencil,
      title: `${actor} ${action}`,
      detail: <ChangeList changes={changes} />,
    }
  }

  return {
    icon: Pencil,
    title: `${actor} updated ${changes.length} fields`,
    detail: <ChangeList changes={changes} />,
  }
}

function nestedRecord(metadata: unknown, key: string): Record<string, unknown> | null {
  return isRecord(metadata) && isRecord(metadata[key]) ? metadata[key] : null
}

function stringMeta(metadata: unknown, key: string): string | null {
  if (!isRecord(metadata)) return null
  const value = metadata[key]
  return typeof value === 'string' ? value : null
}

function statusChangeDetail(metadata: unknown) {
  const from = nestedRecord(metadata, 'from')
  const to = nestedRecord(metadata, 'to')
  const fromCategory = typeof from?.category === 'string' ? from.category : null
  const toCategory = typeof to?.category === 'string' ? to.category : null

  if (!fromCategory && !toCategory) return null

  return (
    <ChangeList
      changes={[
        {
          key: 'status',
          label: 'Status',
          from: fromCategory ? formatKnownValue('category', fromCategory) : 'None',
          to: toCategory ? formatKnownValue('category', toCategory) : 'None',
        },
      ]}
    />
  )
}

function assignmentDetail(metadata: unknown) {
  const to = nestedRecord(metadata, 'to')
  const from = nestedRecord(metadata, 'from')
  const next = to
    ? [to.principalId ? 'person' : null, to.teamId ? 'team' : null].filter(Boolean).join(' and ')
    : ''
  const previous = from?.principalId || from?.teamId ? 'Previously assigned' : null

  return (
    <SummaryPills
      items={[next ? `Assigned to ${next}` : null, previous, next ? null : 'No assignee']}
    />
  )
}

function routedDetail(metadata: unknown) {
  if (!isRecord(metadata)) return null
  return (
    <SummaryPills
      items={[
        metadata.ruleId ? 'Matched routing rule' : null,
        metadata.inboxId ? 'Set inbox' : null,
        metadata.primaryTeamId ? 'Set team' : null,
        metadata.assigneePrincipalId ? 'Assigned person' : null,
      ]}
    />
  )
}

function activityDisplay(row: ActivityRow, actor: string): ActivityDisplay {
  const metadata = row.metadata

  switch (row.type) {
    case 'ticket.created': {
      const statusCategory = stringMeta(metadata, 'statusCategory')
      const priority = stringMeta(metadata, 'priority')
      const channel = stringMeta(metadata, 'channel')
      return {
        icon: Plus,
        title: `${actor} created this ticket`,
        detail: (
          <SummaryPills
            items={[
              statusCategory ? formatKnownValue('statusCategory', statusCategory) : null,
              priority ? formatKnownValue('priority', priority) : null,
              channel ? formatKnownValue('channel', channel) : null,
            ]}
          />
        ),
      }
    }
    case 'ticket.routed':
      return { icon: Route, title: `${actor} routed this ticket`, detail: routedDetail(metadata) }
    case 'ticket.updated':
      return updatedDisplay(row, actor)
    case 'ticket.assigned':
      return {
        icon: UserCheck,
        title: `${actor} assigned this ticket`,
        detail: assignmentDetail(metadata),
      }
    case 'ticket.unassigned':
      return { icon: UserMinus, title: `${actor} removed the assignee` }
    case 'ticket.status_changed':
      return {
        icon: CheckCircle2,
        title: `${actor} changed status`,
        detail: statusChangeDetail(metadata),
      }
    case 'ticket.deleted':
      return { icon: Trash2, title: `${actor} deleted this ticket` }
    case 'ticket.restored':
      return { icon: RotateCcw, title: `${actor} restored this ticket` }
    case 'thread.added': {
      const audience = stringMeta(metadata, 'audience')
      const label = audience ? (AUDIENCE_LABELS[audience] ?? titleCaseToken(audience)) : 'Reply'
      const action = audience
        ? (AUDIENCE_ACTIONS[audience] ?? `posted ${label.toLowerCase()}`)
        : 'posted a reply'
      return {
        icon: MessageSquare,
        title: `${actor} ${action}`,
        detail: <SummaryPills items={[label]} />,
      }
    }
    case 'thread.edited':
      return { icon: Pencil, title: `${actor} edited a reply` }
    case 'thread.deleted':
      return { icon: Trash2, title: `${actor} deleted a reply` }
    case 'participant.added': {
      const role = stringMeta(metadata, 'role')
      return {
        icon: UserPlus,
        title: `${actor} added a participant`,
        detail: (
          <SummaryPills
            items={[
              role ? formatKnownValue('role', role) : null,
              isRecord(metadata) && metadata.principalId ? 'User' : null,
              isRecord(metadata) && metadata.contactId ? 'Contact' : null,
            ]}
          />
        ),
      }
    }
    case 'participant.removed':
      return { icon: UserX, title: `${actor} removed a participant` }
    case 'ticket.shared': {
      const access = stringMeta(metadata, 'accessLevel')
      return {
        icon: Share2,
        title: `${actor} shared this ticket with a team`,
        detail: <SummaryPills items={[access ? formatKnownValue('accessLevel', access) : null]} />,
      }
    }
    case 'ticket.unshared':
      return { icon: Share2, title: `${actor} removed a team share` }
    case 'attachment.added': {
      const filename = stringMeta(metadata, 'filename')
      return {
        icon: Paperclip,
        title: `${actor} added an attachment`,
        detail: filename ? (
          <div className="mt-1.5 text-xs text-muted-foreground break-words">
            {truncate(filename, 120)}
          </div>
        ) : null,
      }
    }
    case 'attachment.removed':
      return { icon: Paperclip, title: `${actor} removed an attachment` }
    default:
      return {
        icon: Settings2,
        title: `${actor} recorded ${formatEventType(row.type)}`,
      }
  }
}

export function TicketActivityTimeline({ ticketId, principalNames }: TicketActivityTimelineProps) {
  const { data } = useSuspenseQuery(ticketQueries.activity(ticketId, { limit: 100 }))
  const activity = data as ActivityRow[]

  if (activity.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/60 px-3 py-8 text-center">
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      </div>
    )
  }

  return (
    <ol className="divide-y divide-border/60">
      {activity.map((row) => {
        const actor = actorLabel(row, principalNames)
        const display = activityDisplay(row, actor)
        const Icon = display.icon

        return (
          <li key={row.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/40">
              <Icon className="size-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-5 text-foreground break-words">{display.title}</p>
              <TimeAgo
                date={row.createdAt}
                className="mt-0.5 block text-[11px] leading-4 text-muted-foreground"
              />
              {display.detail}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
