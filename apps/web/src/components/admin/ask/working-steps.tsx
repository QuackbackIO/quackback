import { useIntl } from 'react-intl'
import type { AssistantActivityStatus } from '@/lib/shared/conversation/types'

export function WorkingSteps({
  steps,
  busy,
  answering,
}: {
  steps: AssistantActivityStatus[]
  busy: boolean
  answering: boolean
}) {
  const intl = useIntl()
  if (!steps.length) return null
  const labels: Record<AssistantActivityStatus, string> = {
    thinking: intl.formatMessage({ id: 'ask.chat.thinking', defaultMessage: 'Thinking…' }),
    searching_kb: intl.formatMessage({ id: 'ask.chat.searching', defaultMessage: 'Searching' }),
    reviewing_conversation: intl.formatMessage({
      id: 'ask.chat.reviewing',
      defaultMessage: 'Reviewing context',
    }),
  }
  const list = (
    <ol className="space-y-1.5 text-sm text-muted-foreground">
      {steps.map((step, index) => (
        <li key={step} className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-flex size-4 items-center justify-center">
            {!busy || answering || index < steps.length - 1 ? '✓' : '·'}
          </span>
          {labels[step]}
        </li>
      ))}
    </ol>
  )
  return answering || !busy ? (
    <details className="text-sm text-muted-foreground">
      <summary className="cursor-pointer">
        {intl.formatMessage(
          {
            id: 'ask.chat.steps',
            defaultMessage: 'Worked through {count, plural, one {# step} other {# steps}}',
          },
          { count: steps.length }
        )}
      </summary>
      <div className="pt-3">{list}</div>
    </details>
  ) : (
    <div role="status">{list}</div>
  )
}
