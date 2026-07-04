import {
  BuildingOffice2Icon,
  CalendarIcon,
  ClockIcon,
  FlagIcon,
  Squares2X2Icon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import { TicketTypeBadge, TicketStageChip } from '@/components/admin/tickets/ticket-chips'
import {
  TicketStatusControl,
  TicketAssigneeControl,
  TicketPriorityControl,
} from '@/components/admin/tickets/ticket-controls'
import { TicketLinks } from '@/components/admin/tickets/ticket-links'
import { ExportTranscriptButton } from '@/components/admin/conversation/export-transcript-button'
import { exportTicketTranscriptFn } from '@/lib/server/functions/tickets'
import { Avatar } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DetailRow as Row, formatDate } from '@/components/shared/detail-row'

/**
 * The ticket's PROPERTIES panel — the right column of the workspace. Mirrors the
 * conversation detail panel: a floating bordered card with the requester summary,
 * the editable properties (status / assignee / priority / type / company), the
 * (7A-empty) Linked section, and a timeline.
 */
export function TicketDetailPanel({
  ticket,
  onChanged,
}: {
  ticket: TicketDTO
  onChanged: () => void
}) {
  const { requester, company } = ticket
  return (
    <aside className="hidden w-72 shrink-0 flex-col xl:flex">
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <div className="m-3 space-y-5 rounded-xl border border-border/20 bg-card p-4 shadow-sm">
          {/* Requester */}
          <div className="flex items-center gap-2.5">
            {requester ? (
              <>
                <Avatar
                  src={requester.avatarUrl}
                  name={requester.displayName ?? 'Requester'}
                  className="size-9 shrink-0 text-sm"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {requester.displayName ?? 'Requester'}
                  </p>
                  {company && (
                    <p className="truncate text-xs text-muted-foreground">{company.name}</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <UserCircleIcon className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">No requester</p>
              </>
            )}
          </div>

          {/* Properties */}
          <div className="space-y-4 border-t border-border/30 pt-4">
            <span className="text-sm text-muted-foreground">Properties</span>
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
            <Row icon={UserCircleIcon} label="Assignee">
              <TicketAssigneeControl ticket={ticket} onChanged={onChanged} />
            </Row>
            <Row icon={FlagIcon} label="Priority">
              <TicketPriorityControl ticket={ticket} onChanged={onChanged} />
            </Row>
            <Row icon={Squares2X2Icon} label="Type">
              <TicketTypeBadge type={ticket.type} />
            </Row>
            <Row icon={BuildingOffice2Icon} label="Company">
              <span className="truncate text-sm font-medium text-foreground">
                {company?.name ?? 'None'}
              </span>
            </Row>
          </div>

          {/* Tracker links (§4.9) */}
          <div className="space-y-2 border-t border-border/30 pt-4">
            <TicketLinks ticket={ticket} onChanged={onChanged} />
          </div>

          {/* Export */}
          <div className="border-t border-border/30 pt-4">
            <ExportTranscriptButton
              load={() => exportTicketTranscriptFn({ data: { ticketId: ticket.id } })}
            />
          </div>

          {/* Timeline */}
          <div className="space-y-3 border-t border-border/30 pt-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ClockIcon className="h-4 w-4" /> Timeline
            </p>
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
            <Row icon={CalendarIcon} label="Due">
              <span className="text-sm font-medium text-foreground">
                {ticket.dueAt ? formatDate(ticket.dueAt) : 'None'}
              </span>
            </Row>
            {ticket.resolvedAt && (
              <Row icon={CalendarIcon} label="Resolved">
                <span className="text-sm font-medium text-foreground">
                  {formatDate(ticket.resolvedAt)}
                </span>
              </Row>
            )}
          </div>
        </div>
      </ScrollArea>
    </aside>
  )
}
