import { RADIO_TILE_DOT, RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/shared/utils'

/** The visibility vocabulary shared by Portal access, Changelog and Status. */
export const VISIBILITY_LABELS = {
  everyone: 'Everyone',
  signedIn: 'Signed-in users',
  segments: 'Specific segments',
} as const

interface VisibilityTileOption<T extends string> {
  value: T
  title: string
  description?: string
  disabled?: boolean
}

interface VisibilityTilesProps<T extends string> {
  name: string
  value: T
  onChange: (value: T) => void
  options: VisibilityTileOption<T>[]
  disabled?: boolean
  className?: string
}

/** Radio tiles: radio dot, title and a one-line description per option. */
export function VisibilityTiles<T extends string>({
  name,
  value,
  onChange,
  options,
  disabled,
  className,
}: VisibilityTilesProps<T>) {
  return (
    <RadioGroup
      name={name}
      value={value}
      onValueChange={(next) => onChange(next as T)}
      disabled={disabled}
      className={cn('gap-2.5', className)}
    >
      {options.map((option) => {
        const selected = option.value === value
        const off = disabled || option.disabled
        return (
          <label
            key={option.value}
            data-slot="visibility-tile"
            data-selected={selected}
            className={cn(
              'flex items-start gap-2.5 rounded-xl border px-3.5 py-3 transition-colors',
              selected
                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                : 'border-border hover:bg-muted/40',
              off ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
            )}
          >
            <RadioGroupItem
              value={option.value}
              disabled={off}
              className={cn('mt-0.5', RADIO_TILE_DOT)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{option.title}</span>
              {option.description && (
                <span className="mt-0.5 block text-[13px] text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
          </label>
        )
      })}
    </RadioGroup>
  )
}
