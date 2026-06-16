/**
 * Right-panel "Properties" tab for a ticket. Inline editors for assignee,
 * status, priority, visibility, inbox, organization, requester contact, and
 * subject. Every mutation passes `expectedUpdatedAt` from the cached ticket
 * for optimistic-concurrency.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  TicketId,
  PrincipalId,
  TicketStatusId,
  InboxId,
  OrganizationId,
  ContactId,
  TeamId,
} from '@quackback/ids'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { PrincipalPicker } from '@/components/admin/shared/principal-picker'
import { StatusPicker } from '@/components/admin/shared/status-picker'
import { InboxPicker } from '@/components/admin/shared/inbox-picker'
import { OrgPicker } from '@/components/admin/shared/org-picker'
import { ContactPicker } from '@/components/admin/shared/contact-picker'
import { TeamPicker } from '@/components/admin/shared/team-picker'
import {
  assignTicketFn,
  transitionTicketStatusFn,
  updateTicketFn,
} from '@/lib/server/functions/tickets'
import { ticketQueries } from '@/lib/client/queries/tickets'
import { toast } from 'sonner'

export interface TicketPropertiesPanelProps {
  ticket: {
    id: TicketId
    subject: string
    statusId: TicketStatusId | null
    priority: string
    visibilityScope: string
    primaryTeamId: TeamId | null
    inboxId: InboxId | null
    organizationId: OrganizationId | null
    requesterContactId: ContactId | null
    assigneePrincipalId: PrincipalId | null
    updatedAt: Date | string
  }
}

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
const VISIBILITY = ['team', 'org', 'shared', 'private'] as const
const VISIBILITY_LABELS: Record<(typeof VISIBILITY)[number], string> = {
  team: 'Team',
  org: 'Organization',
  shared: 'Shared',
  private: 'Private',
}

export function TicketPropertiesPanel({ ticket }: TicketPropertiesPanelProps) {
  const qc = useQueryClient()
  const [editingSubject, setEditingSubject] = useState(false)
  const [subjectDraft, setSubjectDraft] = useState(ticket.subject)

  const expectedUpdatedAt = () => {
    const latest = qc.getQueryData<{ updatedAt: Date | string }>(
      ticketQueries.detail(ticket.id).queryKey
    )
    return new Date(latest?.updatedAt ?? ticket.updatedAt).toISOString()
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ticketQueries.detail(ticket.id).queryKey })
    qc.invalidateQueries({ queryKey: ['tickets', 'list'] })
  }

  const onErr = (e: Error) => {
    if (/conflict|stale/i.test(e.message)) {
      toast.error('Ticket changed — refresh', {
        action: { label: 'Refresh', onClick: invalidate },
      })
    } else {
      toast.error(e.message)
    }
  }

  const assignMutation = useMutation({
    mutationFn: (assigneePrincipalId: PrincipalId | null) =>
      assignTicketFn({
        data: { ticketId: ticket.id, expectedUpdatedAt: expectedUpdatedAt(), assigneePrincipalId },
      }),
    onSuccess: (updated) => {
      qc.setQueryData(ticketQueries.detail(ticket.id).queryKey, updated)
      invalidate()
      toast.success('Assignee updated')
    },
    onError: onErr,
  })

  const statusMutation = useMutation({
    mutationFn: (statusId: TicketStatusId) =>
      transitionTicketStatusFn({
        data: { ticketId: ticket.id, expectedUpdatedAt: expectedUpdatedAt(), statusId },
      }),
    onSuccess: (updated) => {
      qc.setQueryData(ticketQueries.detail(ticket.id).queryKey, updated)
      invalidate()
      toast.success('Status updated')
    },
    onError: onErr,
  })

  const updateMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateTicketFn>[0]['data']) =>
      updateTicketFn({ data: { ...patch, expectedUpdatedAt: expectedUpdatedAt() } }),
    onSuccess: (updated) => {
      qc.setQueryData(ticketQueries.detail(ticket.id).queryKey, updated)
      invalidate()
      toast.success('Ticket updated')
    },
    onError: onErr,
  })

  return (
    <div className="space-y-4 text-sm">
      <Section label="Subject">
        {editingSubject ? (
          <div className="flex gap-1">
            <Input
              value={subjectDraft}
              onChange={(e) => setSubjectDraft(e.target.value)}
              className="h-8"
            />
            <Button
              size="sm"
              onClick={() => {
                updateMutation.mutate({
                  ticketId: ticket.id,
                  expectedUpdatedAt: expectedUpdatedAt(),
                  subject: subjectDraft,
                })
                setEditingSubject(false)
              }}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSubjectDraft(ticket.subject)
                setEditingSubject(false)
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <button
            onClick={() => setEditingSubject(true)}
            className="text-left w-full hover:underline"
          >
            {ticket.subject}
          </button>
        )}
      </Section>

      <Section label="Assignee">
        <PrincipalPicker
          value={ticket.assigneePrincipalId}
          onValueChange={(id) => assignMutation.mutate(id)}
          allowUnassigned
        />
      </Section>

      <Section label="Status">
        <StatusPicker
          value={ticket.statusId}
          onValueChange={(id) => id && statusMutation.mutate(id)}
        />
      </Section>

      <Section label="Priority">
        <Select
          value={ticket.priority}
          onValueChange={(v) =>
            updateMutation.mutate({
              ticketId: ticket.id,
              expectedUpdatedAt: expectedUpdatedAt(),
              priority: v as (typeof PRIORITIES)[number],
            })
          }
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>

      <Section label="Visibility">
        <Select
          value={ticket.visibilityScope}
          onValueChange={(v) =>
            updateMutation.mutate({
              ticketId: ticket.id,
              expectedUpdatedAt: expectedUpdatedAt(),
              visibilityScope: v as (typeof VISIBILITY)[number],
            })
          }
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VISIBILITY.map((v) => (
              <SelectItem key={v} value={v}>
                {VISIBILITY_LABELS[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>

      <Section label="Inbox">
        <InboxPicker
          value={ticket.inboxId}
          onValueChange={(id) =>
            updateMutation.mutate({
              ticketId: ticket.id,
              expectedUpdatedAt: expectedUpdatedAt(),
              inboxId: id ?? null,
            })
          }
          allowClear
        />
      </Section>

      <Section label="Primary team">
        <TeamPicker
          value={ticket.primaryTeamId}
          onValueChange={(id) =>
            updateMutation.mutate({
              ticketId: ticket.id,
              expectedUpdatedAt: expectedUpdatedAt(),
              primaryTeamId: id ?? null,
            })
          }
          allowClear
        />
      </Section>

      <Section label="Organization">
        <OrgPicker
          value={ticket.organizationId}
          onValueChange={(id) =>
            updateMutation.mutate({
              ticketId: ticket.id,
              expectedUpdatedAt: expectedUpdatedAt(),
              organizationId: id ?? null,
            })
          }
          allowClear
        />
      </Section>

      <Section label="Requester contact">
        <ContactPicker
          value={ticket.requesterContactId}
          onValueChange={(id) =>
            updateMutation.mutate({
              ticketId: ticket.id,
              expectedUpdatedAt: expectedUpdatedAt(),
              requesterContactId: id ?? null,
            })
          }
          allowClear
        />
      </Section>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        {label}
      </div>
      {children}
    </div>
  )
}
