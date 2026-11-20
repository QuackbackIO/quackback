/**
 * The `send_ticket_form` block editor: the optional intro body (the shared
 * message editor) plus the "Ask for a due date" toggle, which adds an
 * optional "Needed by" date field to the form the customer fills in. Off
 * removes the key entirely, so an untouched form saves the same graph it
 * always did (workflow-graph.ts's treeToGraph only writes it when on).
 */
import { useId } from 'react'
import { useIntl } from 'react-intl'
import { Switch } from '@/components/ui/switch'
import { SettingRow } from '@/components/admin/settings/setting-row'
import { MessageEditor } from './message-editor'
import type { TreeStep } from '../../workflow-graph'

type TicketFormStep = Extract<TreeStep, { kind: 'send_ticket_form' }>

export function TicketFormEditor({
  step,
  onChange,
}: {
  step: TicketFormStep
  onChange: (step: TreeStep) => void
}) {
  const intl = useIntl()
  const askDueDateId = useId()
  const askDueDateLabel = intl.formatMessage({
    id: 'automation.workflows.ticketForm.askDueDate',
    defaultMessage: 'Ask for a due date',
  })

  const setAskDueDate = (on: boolean) => {
    const { askDueDate: _previous, ...rest } = step
    onChange(on ? { ...rest, askDueDate: true } : rest)
  }

  return (
    <div className="space-y-3">
      <MessageEditor step={step} onChange={onChange} />
      <SettingRow
        label={askDueDateLabel}
        description={intl.formatMessage({
          id: 'automation.workflows.ticketForm.askDueDateHint',
          defaultMessage:
            'Adds an optional date field so the customer can say when they need this by. Teammates can change it later.',
        })}
        htmlFor={askDueDateId}
        className="py-2"
        control={
          <Switch
            id={askDueDateId}
            aria-label={askDueDateLabel}
            checked={step.askDueDate === true}
            onCheckedChange={setAskDueDate}
          />
        }
      />
    </div>
  )
}
