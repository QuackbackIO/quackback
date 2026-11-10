import { onRadioKeys, radioTabIndex } from '@/components/admin/settings/appearance/radio-keys'
import { cn } from '@/lib/shared/utils'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { DesignTiles } from './design-tiles'
import { TypeStyleDrawing } from './drawings'

type Update = (change: (draft: PortalDesign) => void) => void

type Fonts = PortalDesign['brand']['fonts']
type TypeStyle = 'quiet' | 'confident' | 'display' | 'poster'

/**
 * Headline size, tracking and case together, as four looks a person can see,
 * and each on its own when the design mixes them otherwise.
 */
const TYPE_STYLES: Record<TypeStyle, Pick<Fonts, 'scale' | 'tracking' | 'headlineCase'>> = {
  quiet: { scale: 'standard', tracking: 'normal', headlineCase: 'sentence' },
  confident: { scale: 'large', tracking: 'tight', headlineCase: 'sentence' },
  display: { scale: 'display', tracking: 'tight', headlineCase: 'sentence' },
  poster: { scale: 'display', tracking: 'tight', headlineCase: 'upper' },
}

/** The type style a design's choices make, or none when they make no single one. */
function typeStyle(fonts: Fonts): TypeStyle | '' {
  const current = {
    scale: fonts.scale ?? 'standard',
    tracking: fonts.tracking ?? 'normal',
    headlineCase: fonts.headlineCase ?? 'sentence',
  }
  const found = (Object.keys(TYPE_STYLES) as TypeStyle[]).find((style) =>
    (Object.keys(current) as Array<keyof typeof current>).every(
      (key) => TYPE_STYLES[style][key] === current[key]
    )
  )
  return found ?? ''
}

/**
 * Headline size, tracking and case together, as four looks a person can see,
 * and each on its own when the design mixes them otherwise.
 */
export function TypeStyleControls({ design, update }: { design: PortalDesign; update: Update }) {
  return (
    <>
      <DesignTiles<TypeStyle | ''>
        name="design-type-style"
        label="Type style"
        value={typeStyle(design.brand.fonts)}
        columns={4}
        onChange={(style) =>
          style && update((draft) => void Object.assign(draft.brand.fonts, TYPE_STYLES[style]))
        }
        options={(Object.keys(TYPE_STYLES) as TypeStyle[]).map((style) => ({
          value: style,
          label: style[0].toUpperCase() + style.slice(1),
          drawing: <TypeStyleDrawing style={style} />,
        }))}
      />
      {/* A mix no tile makes, such as from a brand's website, shows each part of it. */}
      {typeStyle(design.brand.fonts) === '' && (
        <HeadlineTypeChoices design={design} update={update} />
      )}
    </>
  )
}

/** One of a few named choices, as a row of buttons. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<[T, string]>
  onChange: (value: T) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-[13px]">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        onKeyDown={onRadioKeys}
        className="flex flex-wrap gap-1.5"
      >
        {options.map(([option, name], index) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            tabIndex={radioTabIndex(
              value === option,
              !options.some(([each]) => each === value),
              index
            )}
            onClick={() => onChange(option)}
            className={cn(
              'h-8 rounded-md border px-2.5 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none',
              value === option
                ? 'border-foreground/60 bg-muted font-medium forced-colors:outline forced-colors:outline-2'
                : 'border-border hover:bg-muted'
            )}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  )
}

const SCALE_NAMES = { standard: 'Standard', large: 'Large', display: 'Display' } as const
const TRACKING_NAMES = { normal: 'Normal', tight: 'Tight' } as const
const CASE_NAMES = { sentence: 'As written', upper: 'Capitals' } as const

/** The headline's size, spacing and case, each on its own. */
export function HeadlineTypeChoices({ design, update }: { design: PortalDesign; update: Update }) {
  const fonts = design.brand.fonts
  return (
    <div className="space-y-2">
      <Choice
        label="Size"
        value={fonts.scale ?? 'standard'}
        options={DESIGN_OPTIONS.typeScale.map((scale) => [scale, SCALE_NAMES[scale]])}
        onChange={(scale) => update((draft) => void (draft.brand.fonts.scale = scale))}
      />
      <Choice
        label="Spacing"
        value={fonts.tracking ?? 'normal'}
        options={DESIGN_OPTIONS.tracking.map((tracking) => [tracking, TRACKING_NAMES[tracking]])}
        onChange={(tracking) => update((draft) => void (draft.brand.fonts.tracking = tracking))}
      />
      <Choice
        label="Capitals"
        value={fonts.headlineCase ?? 'sentence'}
        options={DESIGN_OPTIONS.textCase.map((textCase) => [textCase, CASE_NAMES[textCase]])}
        onChange={(textCase) => update((draft) => void (draft.brand.fonts.headlineCase = textCase))}
      />
    </div>
  )
}
