import { useState } from 'react'
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TICKET_STAGES } from '@/lib/shared/db-types'
import type { TicketStage } from '@/lib/shared/db-types'
import { setTicketStageLabelsFn } from '@/lib/server/functions/tickets'
import { ticketStageLabelsQuery } from './queries'

/** Short helper under each input so admins know where the label surfaces. */
const STAGE_HINT: Record<TicketStage, string> = {
  received: 'Just submitted, not picked up yet',
  in_progress: 'A teammate is working on it',
  awaiting_requester: 'Waiting on the requester to reply',
  resolved: 'Marked done',
}

const KEY = ticketStageLabelsQuery.queryKey

export function StageLabelsCard() {
  const qc = useQueryClient()
  const { data: labels } = useSuspenseQuery(ticketStageLabelsQuery)
  const [drafts, setDrafts] = useState<Record<TicketStage, string>>(labels)
  const [savingStage, setSavingStage] = useState<TicketStage | null>(null)

  async function save(stage: TicketStage) {
    const value = drafts[stage].trim()
    if (!value || value === labels[stage]) {
      // Empty is invalid; revert to the last saved label rather than reject.
      if (!value) setDrafts((d) => ({ ...d, [stage]: labels[stage] }))
      return
    }
    setSavingStage(stage)
    try {
      const merged = await setTicketStageLabelsFn({ data: { [stage]: value } })
      qc.setQueryData(KEY, merged)
      setDrafts(merged)
    } catch (error) {
      setDrafts((d) => ({ ...d, [stage]: labels[stage] }))
      toast.error(error instanceof Error ? error.message : 'Failed to save label')
    } finally {
      setSavingStage(null)
    }
  }

  return (
    <SettingsCard
      title="Customer stage labels"
      description="What requesters see for each stage across the portal and Messenger. Internal statuses map to one of these four stages."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {TICKET_STAGES.map((stage) => (
          <div key={stage} className="space-y-1.5">
            <Label htmlFor={`stage-label-${stage}`}>{STAGE_HINT[stage]}</Label>
            <Input
              id={`stage-label-${stage}`}
              value={drafts[stage]}
              maxLength={60}
              disabled={savingStage === stage}
              onChange={(e) => setDrafts((d) => ({ ...d, [stage]: e.target.value }))}
              onBlur={() => save(stage)}
            />
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}
