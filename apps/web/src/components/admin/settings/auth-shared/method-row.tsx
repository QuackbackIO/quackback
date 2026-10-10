import { useId } from 'react'
import { Switch } from '@/components/ui/switch'
import { SettingRow } from '@/components/admin/settings/setting-row'

interface MethodRowProps {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
  /** Dims the row to signal it is unavailable for a structural reason (e.g. a
   *  prerequisite is off), keeping the same copy. Distinct from `disabled`,
   *  which also covers the transient busy state and only affects the switch. */
  muted?: boolean
}

/** A sign-in method: one setting row with its switch on the right. */
export function MethodRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  muted,
}: MethodRowProps) {
  const id = useId()
  return (
    <SettingRow
      label={label}
      description={description}
      htmlFor={id}
      disabled={muted}
      control={
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      }
    />
  )
}
