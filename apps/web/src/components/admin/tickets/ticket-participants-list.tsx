/**
 * Right-panel "Participants" tab. Lists current participants and allows adding
 * a new principal-or-contact participant with a role (watcher / collaborator /
 * cc). Add row toggles between principal and contact pickers.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TicketId, PrincipalId, ContactId, TicketParticipantId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { PrincipalPicker } from '@/components/admin/shared/principal-picker'
import { ContactPicker } from '@/components/admin/shared/contact-picker'
import { addParticipantFn, removeParticipantFn } from '@/lib/server/functions/tickets'
import { ticketQueries } from '@/lib/client/queries/tickets'
import { toast } from 'sonner'

const ROLES = ['watcher', 'collaborator', 'cc'] as const
type ParticipantRole = (typeof ROLES)[number]

export interface ParticipantRow {
  id: TicketParticipantId
  ticketId: TicketId
  principalId: PrincipalId | null
  contactId: ContactId | null
  role: ParticipantRole | string
}

export interface TicketParticipantsListProps {
  ticketId: TicketId
  participants: ParticipantRow[]
  principalNames?: Record<string, string>
  contactNames?: Record<string, string>
}

export function TicketParticipantsList({
  ticketId,
  participants,
  principalNames,
  contactNames,
}: TicketParticipantsListProps) {
  const qc = useQueryClient()
  const [kind, setKind] = useState<'principal' | 'contact'>('principal')
  const [role, setRole] = useState<ParticipantRole>('watcher')
  const [principalId, setPrincipalId] = useState<PrincipalId | null>(null)
  const [contactId, setContactId] = useState<ContactId | null>(null)

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ticketQueries.participants(ticketId).queryKey })

  const addMutation = useMutation({
    mutationFn: () =>
      addParticipantFn({
        data: {
          ticketId,
          role,
          principalId: kind === 'principal' ? principalId : null,
          contactId: kind === 'contact' ? contactId : null,
        },
      }),
    onSuccess: () => {
      setPrincipalId(null)
      setContactId(null)
      invalidate()
      toast.success('Participant added')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const removeMutation = useMutation({
    mutationFn: (participantId: TicketParticipantId) =>
      removeParticipantFn({ data: { ticketId, participantId } }),
    onSuccess: () => {
      invalidate()
      toast.success('Participant removed')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const canSubmit =
    (kind === 'principal' && principalId !== null) || (kind === 'contact' && contactId !== null)

  return (
    <div className="space-y-3 text-sm">
      {participants.length === 0 ? (
        <div className="text-xs text-muted-foreground">No participants.</div>
      ) : (
        <ul className="space-y-1">
          {participants.map((p) => {
            const label = p.principalId
              ? (principalNames?.[p.principalId] ?? p.principalId)
              : p.contactId
                ? (contactNames?.[p.contactId] ?? p.contactId)
                : '—'
            return (
              <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">
                  <span className="font-medium">{label}</span>
                  <span className="text-muted-foreground ml-1">({p.role})</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={() => removeMutation.mutate(p.id)}
                  disabled={removeMutation.isPending}
                  aria-label="Remove participant"
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="rounded border border-border/50 p-2 space-y-2">
        <div className="flex items-center gap-2">
          <Select value={kind} onValueChange={(v) => setKind(v as 'principal' | 'contact')}>
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="principal">User</SelectItem>
              <SelectItem value="contact">Contact</SelectItem>
            </SelectContent>
          </Select>
          <Select value={role} onValueChange={(v) => setRole(v as ParticipantRole)}>
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {kind === 'principal' ? (
          <PrincipalPicker value={principalId} onValueChange={setPrincipalId} />
        ) : (
          <ContactPicker value={contactId} onValueChange={setContactId} />
        )}
        <Button
          size="sm"
          className="w-full"
          disabled={!canSubmit || addMutation.isPending}
          onClick={() => addMutation.mutate()}
        >
          Add participant
        </Button>
      </div>
    </div>
  )
}
