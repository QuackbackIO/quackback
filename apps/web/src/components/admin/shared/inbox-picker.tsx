/**
 * `<InboxPicker />` — single/multi inbox picker.
 */
import type { InboxId } from '@quackback/ids'
import { useInboxes } from '@/lib/client/hooks/use-inboxes-queries'
import { ResourcePicker } from './resource-picker'

interface BaseProps {
  placeholder?: string
  className?: string
  disabled?: boolean
  includeArchived?: boolean
}

interface SingleProps extends BaseProps {
  multiple?: false
  value: InboxId | null
  onValueChange: (value: InboxId | null) => void
  allowClear?: boolean
}

interface MultiProps extends BaseProps {
  multiple: true
  value: InboxId[]
  onValueChange: (value: InboxId[]) => void
}

export function InboxPicker(props: SingleProps | MultiProps) {
  const { data: inboxes = [], isLoading } = useInboxes({
    includeArchived: props.includeArchived,
  })

  const options = inboxes.map((i) => ({
    id: i.id as InboxId,
    label: i.name,
    description: i.slug,
  }))

  if (props.multiple) {
    return (
      <ResourcePicker<InboxId>
        multiple
        value={props.value}
        onValueChange={props.onValueChange}
        options={options}
        isLoading={isLoading}
        placeholder={props.placeholder ?? 'Select inboxes…'}
        searchPlaceholder="Search inboxes…"
        emptyMessage="No inboxes."
        disabled={props.disabled}
        className={props.className}
      />
    )
  }
  return (
    <ResourcePicker<InboxId>
      value={props.value}
      onValueChange={props.onValueChange}
      options={options}
      isLoading={isLoading}
      placeholder={props.placeholder ?? 'Select inbox…'}
      searchPlaceholder="Search inboxes…"
      emptyMessage="No inboxes."
      disabled={props.disabled}
      className={props.className}
      allowClear={props.allowClear}
    />
  )
}
