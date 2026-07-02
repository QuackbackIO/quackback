/**
 * `<StatusPicker />` — single ticket-status picker over `useTicketStatuses()`.
 */
import type { TicketStatusId } from '@quackback/ids'
import { useTicketStatuses } from '@/lib/client/hooks/use-tickets-queries'
import { ResourcePicker } from './resource-picker'

interface Props {
  value: TicketStatusId | null
  onValueChange: (value: TicketStatusId | null) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function StatusPicker(props: Props) {
  const { data: statuses = [], isLoading } = useTicketStatuses()
  const options = statuses.map((s) => ({
    id: s.id as TicketStatusId,
    label: s.name,
    description: s.category,
    leading: s.color ? (
      <span
        className="inline-flex h-3 w-3 rounded-full"
        style={{ backgroundColor: s.color }}
        aria-hidden
      />
    ) : null,
  }))
  return (
    <ResourcePicker<TicketStatusId>
      value={props.value}
      onValueChange={props.onValueChange}
      options={options}
      isLoading={isLoading}
      placeholder={props.placeholder ?? 'Select status…'}
      searchPlaceholder="Search statuses…"
      emptyMessage="No statuses."
      disabled={props.disabled}
      className={props.className}
    />
  )
}
