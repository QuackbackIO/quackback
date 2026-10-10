import { RADIO_TILE_DOT, RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/shared/utils'
import type { ThemeMode } from '@/lib/shared/theme'

const OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'user', label: 'Visitor chooses' },
]

function Swatch({ mode }: { mode: ThemeMode }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-full overflow-hidden rounded-md border border-border/60"
    >
      {mode !== 'dark' && <span className="flex-1 bg-white" />}
      {mode !== 'light' && <span className="flex-1 bg-neutral-900" />}
    </span>
  )
}

/** Visual tiles for the portal theme mode: Light, Dark, or the visitor's own choice. */
export function ThemeModeTiles({
  value,
  onChange,
}: {
  value: ThemeMode
  onChange: (mode: ThemeMode) => void
}) {
  return (
    <RadioGroup
      name="theme-mode"
      value={value}
      onValueChange={(next) => onChange(next as ThemeMode)}
      className="grid grid-cols-3 gap-2"
    >
      {OPTIONS.map((option) => {
        const selected = option.value === value
        return (
          <label
            key={option.value}
            data-slot="theme-mode-tile"
            data-selected={selected}
            className={cn(
              'flex cursor-pointer flex-col gap-2 rounded-lg border p-2 transition-colors',
              selected
                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                : 'border-border hover:bg-muted/40'
            )}
          >
            <Swatch mode={option.value} />
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <RadioGroupItem value={option.value} className={RADIO_TILE_DOT} />
              {option.label}
            </span>
          </label>
        )
      })}
    </RadioGroup>
  )
}
