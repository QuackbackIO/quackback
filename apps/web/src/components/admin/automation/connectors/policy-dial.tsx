import { ChevronDownIcon } from '@heroicons/react/24/solid'
import { SegmentedControl } from '@/components/shared/segmented-control'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ConnectorToolPolicy } from '@/lib/shared/assistant/connectors'

const OPTIONS: Array<{ value: ConnectorToolPolicy; label: string }> = [
  { value: 'always', label: 'Allow' },
  { value: 'approval', label: 'Ask' },
  { value: 'never', label: 'Never' },
]

/** Allow / Ask / Never for one tool. Stored values are always / approval / never. */
export function PolicyDial({
  value,
  onChange,
  labelledBy,
}: {
  value: ConnectorToolPolicy
  onChange: (next: ConnectorToolPolicy) => void
  labelledBy?: string
}) {
  return (
    <SegmentedControl
      label={labelledBy ?? 'Permission'}
      options={OPTIONS}
      value={value}
      onChange={onChange}
    />
  )
}

export function PolicyDefaultSelect({
  value,
  onChange,
}: {
  value: ConnectorToolPolicy
  onChange: (next: ConnectorToolPolicy) => void
}) {
  const current = OPTIONS.find((option) => option.value === value) ?? OPTIONS[0]!
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[13px] font-medium">
        {current.label}
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map((option) => (
          <DropdownMenuItem key={option.value} onClick={() => onChange(option.value)}>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
