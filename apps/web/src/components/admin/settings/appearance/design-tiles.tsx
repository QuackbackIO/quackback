import type { ReactNode } from 'react'
import { RADIO_TILE_DOT, RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/shared/utils'

export interface DesignTileOption<T extends string> {
  value: T
  label: string
  /** A small drawing of the choice, so each tile shows what it does. */
  drawing: ReactNode
}

/** One design choice as a row of drawn tiles. */
export function DesignTiles<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
  columns = 3,
}: {
  name: string
  label: string
  value: T
  options: ReadonlyArray<DesignTileOption<T>>
  onChange: (value: T) => void
  columns?: 2 | 3 | 4
}) {
  return (
    <div className="@container space-y-2">
      <p id={`${name}-label`} className="text-[13px] font-medium">
        {label}
      </p>
      <RadioGroup
        name={name}
        aria-labelledby={`${name}-label`}
        value={value}
        onValueChange={(next) => onChange(next as T)}
        // Two to a row in a narrow panel, so labels never run into the next tile.
        className={cn(
          'grid grid-cols-2 gap-2',
          columns === 3 && '@sm:grid-cols-3',
          columns === 4 && '@md:grid-cols-4'
        )}
      >
        {options.map((option) => {
          const selected = option.value === value
          return (
            <label
              key={option.value}
              data-slot="design-tile"
              data-selected={selected}
              className={cn(
                'flex cursor-pointer flex-col gap-2 rounded-lg border p-2 transition-colors',
                selected
                  ? // In the text colour, so it reads on any brand; an outline in forced colours.
                    'border-foreground bg-muted ring-1 ring-foreground forced-colors:outline forced-colors:outline-2'
                  : 'border-border hover:bg-muted/40'
              )}
            >
              <span
                aria-hidden="true"
                className="flex h-10 w-full items-center justify-center overflow-hidden rounded-md border border-border/60 bg-background"
              >
                {option.drawing}
              </span>
              <span className="flex items-center gap-2 text-[13px] font-medium">
                <RadioGroupItem value={option.value} className={RADIO_TILE_DOT} />
                {option.label}
              </span>
            </label>
          )
        })}
      </RadioGroup>
    </div>
  )
}
