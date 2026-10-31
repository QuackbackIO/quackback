import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { Tune } from '@/lib/shared/design/tune'
import { ColourField, toHex } from './colour-field'

type Update = (change: (draft: PortalDesign) => void) => void
type Group = keyof Tune

/** A number a person types: blank is automatic, and it is held within its bounds. */
function NumberField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  id: string
  label: string
  value: number | undefined
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number | undefined) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-32 shrink-0 text-[13px]">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value ?? ''}
        placeholder="Automatic"
        onChange={(event) => {
          const text = event.target.value
          if (text === '') return onChange(undefined)
          const number = Number(text)
          if (Number.isFinite(number)) onChange(Math.min(max, Math.max(min, number)))
        }}
        className="h-8 flex-1"
      />
      {unit && <span className="w-6 text-xs text-muted-foreground">{unit}</span>}
    </div>
  )
}

/**
 * Exact values under the choices above: a brand's headline size and weight,
 * its buttons' height and corners, and so on. Each field left blank keeps
 * what the choices give. Quackback AI fills them from a brand's website.
 */
export function TuneSection({ design, update }: { design: PortalDesign; update: Update }) {
  const tune = design.tune ?? {}
  const [open, setOpen] = useState(Object.keys(tune).length > 0)
  const set =
    <G extends Group>(group: G, key: string) =>
    (value: unknown) =>
      update((draft) => {
        const next = { ...(draft.tune ?? {}) } as Record<
          string,
          Record<string, unknown> | undefined
        >
        const fields = { ...(next[group] ?? {}) }
        if (value === undefined) delete fields[key]
        else fields[key] = value
        if (Object.keys(fields).length) next[group] = fields
        else delete next[group]
        if (Object.keys(next).length) draft.tune = next as Tune
        else delete draft.tune
      })
  const hex = (value: string | undefined) => (value ? toHex(value) : undefined)

  if (!open)
    return (
      <section className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium">Exact values</p>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Fine-tune
        </Button>
      </section>
    )
  return (
    <section id="design-section-tune" className="space-y-5">
      <p className="text-[13px] font-medium">Exact values</p>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Headline</p>
        <NumberField
          id="tune-headline-size"
          label="Size"
          unit="px"
          min={10}
          max={200}
          value={tune.headline?.size}
          onChange={set('headline', 'size')}
        />
        <NumberField
          id="tune-headline-weight"
          label="Weight"
          min={100}
          max={900}
          step={100}
          value={tune.headline?.weight}
          onChange={set('headline', 'weight')}
        />
        <NumberField
          id="tune-headline-tracking"
          label="Letter spacing"
          unit="em"
          min={-0.1}
          max={0.3}
          step={0.005}
          value={tune.headline?.tracking}
          onChange={set('headline', 'tracking')}
        />
        <NumberField
          id="tune-headline-leading"
          label="Line height"
          min={0.8}
          max={2.2}
          step={0.05}
          value={tune.headline?.leading}
          onChange={set('headline', 'leading')}
        />
        <ColourField
          id="tune-headline-colour"
          label="Colour"
          placeholder=""
          value={tune.headline?.colour}
          onChange={(value) => set('headline', 'colour')(hex(value))}
        />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Section headings</p>
        <NumberField
          id="tune-heading-size"
          label="Size"
          unit="px"
          min={10}
          max={200}
          value={tune.heading?.size}
          onChange={set('heading', 'size')}
        />
        <NumberField
          id="tune-heading-weight"
          label="Weight"
          min={100}
          max={900}
          step={100}
          value={tune.heading?.weight}
          onChange={set('heading', 'weight')}
        />
        <ColourField
          id="tune-heading-colour"
          label="Colour"
          placeholder=""
          value={tune.heading?.colour}
          onChange={(value) => set('heading', 'colour')(hex(value))}
        />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Buttons</p>
        <NumberField
          id="tune-button-radius"
          label="Corners"
          unit="px"
          min={0}
          max={999}
          value={tune.button?.radius}
          onChange={set('button', 'radius')}
        />
        <NumberField
          id="tune-button-height"
          label="Height"
          unit="px"
          min={24}
          max={72}
          value={tune.button?.height}
          onChange={set('button', 'height')}
        />
        <ColourField
          id="tune-button-fill"
          label="Fill"
          placeholder=""
          value={tune.button?.fill}
          onChange={(value) => set('button', 'fill')(hex(value))}
        />
        <ColourField
          id="tune-button-ink"
          label="Label"
          placeholder=""
          value={tune.button?.ink}
          onChange={(value) => set('button', 'ink')(hex(value))}
        />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Cards</p>
        <NumberField
          id="tune-card-radius"
          label="Corners"
          unit="px"
          min={0}
          max={48}
          value={tune.card?.radius}
          onChange={set('card', 'radius')}
        />
        <NumberField
          id="tune-card-border"
          label="Edge"
          unit="px"
          min={0}
          max={4}
          value={tune.card?.border}
          onChange={set('card', 'border')}
        />
        <div className="flex items-center gap-2">
          <label htmlFor="tune-card-shadow" className="w-32 shrink-0 text-[13px]">
            Shadow
          </label>
          <Select
            value={tune.card?.shadow ?? 'auto'}
            onValueChange={(value) => set('card', 'shadow')(value === 'auto' ? undefined : value)}
          >
            <SelectTrigger id="tune-card-shadow" className="h-8 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic</SelectItem>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="soft">Soft</SelectItem>
              <SelectItem value="lifted">Lifted</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={() => update((draft) => void delete draft.tune)}>
        Clear exact values
      </Button>
    </section>
  )
}
