/**
 * `<TeamPicker />` — single/multi team picker over `useTeams()`.
 */
import type { TeamId } from '@quackback/ids'
import { useTeams } from '@/lib/client/hooks/use-teams-queries'
import { ResourcePicker } from './resource-picker'

interface BaseProps {
  placeholder?: string
  className?: string
  disabled?: boolean
  includeArchived?: boolean
}

interface SingleProps extends BaseProps {
  multiple?: false
  value: TeamId | null
  onValueChange: (value: TeamId | null) => void
  allowClear?: boolean
}

interface MultiProps extends BaseProps {
  multiple: true
  value: TeamId[]
  onValueChange: (value: TeamId[]) => void
}

export function TeamPicker(props: SingleProps | MultiProps) {
  const { data: teams = [], isLoading } = useTeams({ includeArchived: props.includeArchived })

  const options = teams.map((t) => ({
    id: t.id as TeamId,
    label: t.name,
    description: t.slug,
    leading: t.color ? (
      <span
        className="inline-flex h-3 w-3 rounded-sm"
        style={{ backgroundColor: t.color }}
        aria-hidden
      />
    ) : null,
    trailing: t.shortLabel ? (
      <span className="text-xs text-muted-foreground">{t.shortLabel}</span>
    ) : null,
  }))

  if (props.multiple) {
    return (
      <ResourcePicker<TeamId>
        multiple
        value={props.value}
        onValueChange={props.onValueChange}
        options={options}
        isLoading={isLoading}
        placeholder={props.placeholder ?? 'Select teams…'}
        searchPlaceholder="Search teams…"
        emptyMessage="No teams."
        disabled={props.disabled}
        className={props.className}
      />
    )
  }
  return (
    <ResourcePicker<TeamId>
      value={props.value}
      onValueChange={props.onValueChange}
      options={options}
      isLoading={isLoading}
      placeholder={props.placeholder ?? 'Select team…'}
      searchPlaceholder="Search teams…"
      emptyMessage="No teams."
      disabled={props.disabled}
      className={props.className}
      allowClear={props.allowClear}
    />
  )
}
