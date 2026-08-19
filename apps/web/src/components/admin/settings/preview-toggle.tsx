import { cn } from '@/lib/shared/utils'
import type { SunIcon } from '@heroicons/react/24/solid'

/**
 * One segment of a live-preview toolbar toggle (light/dark, desktop/mobile).
 * Shared by the Branding and Widget settings pages so their preview chrome
 * reads as one control.
 */
export function PreviewToggleButton({
  active,
  disabled,
  onClick,
  icon: Icon,
  label,
  iconOnly,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  icon: typeof SunIcon
  label: string
  iconOnly?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
        disabled && 'opacity-40 cursor-not-allowed'
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {!iconOnly && label}
      {iconOnly && <span className="sr-only">{label}</span>}
    </button>
  )
}
