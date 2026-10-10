import { useState } from 'react'
import { useMutation, useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import { AUTOSAVE } from '@/lib/client/autosave'
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
  const saveMutation = useMutation({
    meta: AUTOSAVE,
    mutationFn: (input: { stage: TicketStage; value: string }) =>
      setTicketStageLabelsFn({ data: { [input.stage]: input.value } }),
  })

  function save(stage: TicketStage) {
    const value = drafts[stage].trim()
    if (!value || value === labels[stage]) {
      // Empty is invalid; revert to the last saved label rather than reject.
      if (!value) setDrafts((d) => ({ ...d, [stage]: labels[stage] }))
      return
    }
    setSavingStage(stage)
    // Per-call rollback: each save restores only its own field, so overlapping
    // saves on the shared mutation cannot drop one another's rollback.
    saveMutation
      .mutateAsync({ stage, value })
      .then((merged) => {
        qc.setQueryData(KEY, merged)
        setDrafts(merged)
      })
      .catch(() => setDrafts((d) => ({ ...d, [stage]: labels[stage] })))
      .finally(() => setSavingStage((s) => (s === stage ? null : s)))
  }

  return (
    <SettingsCard
      title="Customer stage labels"
      description="What requesters see for each stage on the portal and Messenger."
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
