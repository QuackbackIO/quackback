import { CheckIcon, HandRaisedIcon, NoSymbolIcon } from '@heroicons/react/24/outline'
import { ChevronDownIcon } from '@heroicons/react/24/solid'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/shared/utils'
import type { ConnectorToolPolicy } from '@/lib/shared/assistant/connectors'

const OPTIONS: Array<{
  id: ConnectorToolPolicy
  label: string
  icon: typeof CheckIcon
  on: string
}> = [
  {
    id: 'always',
    label: 'Always allow',
    icon: CheckIcon,
    on: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  {
    id: 'approval',
    label: 'Needs approval',
    icon: HandRaisedIcon,
    on: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
  },
  {
    id: 'never',
    label: 'Never',
    icon: NoSymbolIcon,
    on: 'bg-red-500/10 text-red-700 dark:text-red-400',
  },
]

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
    <div
      role="radiogroup"
      aria-label={labelledBy}
      className="inline-flex shrink-0 overflow-hidden rounded-lg border border-border"
    >
      {OPTIONS.map((option, index) => {
        const Icon = option.icon
        const selected = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-label={option.label}
            aria-checked={selected}
            aria-pressed={selected}
            onClick={() => onChange(option.id)}
            className={cn(
              'grid size-[26px] w-[30px] place-items-center text-muted-foreground',
              index < OPTIONS.length - 1 && 'border-r border-border/60',
              selected && option.on
            )}
          >
            <Icon className="size-3.5" />
          </button>
        )
      })}
    </div>
  )
}

export function PolicyDefaultSelect({
  value,
  onChange,
}: {
  value: ConnectorToolPolicy
  onChange: (next: ConnectorToolPolicy) => void
}) {
  const current = OPTIONS.find((option) => option.id === value) ?? OPTIONS[0]!
  const Icon = current.icon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[13px] font-medium',
          current.id === 'approval' && 'text-amber-800 dark:text-amber-300',
          current.id === 'always' && 'text-emerald-700 dark:text-emerald-400',
          current.id === 'never' && 'text-red-700 dark:text-red-400'
        )}
      >
        <Icon className="size-3.5" />
        {current.label}
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map((option) => {
          const ItemIcon = option.icon
          return (
            <DropdownMenuItem key={option.id} onSelect={() => onChange(option.id)}>
              <ItemIcon className="size-3.5" />
              {option.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
