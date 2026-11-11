/**
 * Brand colours and fonts as variables. A field linked to the brand shows a
 * chip with the role's swatch and name ("Brand colour"), and follows the
 * brand when it changes; one whose dark mode value differs shows a half
 * swatch. A colour picked by hand is detached: it shows its hex with a
 * broken link, and "Link to {role}" goes back. Picking a brand swatch always
 * stores the role's name, never its hex. With a dark value, the popover
 * opens on the mode the canvas shows.
 *
 * FontField works the same way for the brand's fonts: a chip "Heading font ·
 * Fraunces", linked by its slot's name.
 */
import { useContext, useState, type ReactNode } from 'react'
import { LinkSlashIcon } from '@heroicons/react/16/solid'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ColourField } from '@/components/admin/settings/appearance/colour-field'
import { cn } from '@/lib/shared/utils'
import { BUNDLED_FONTS, fontStack } from '@/lib/shared/design/fonts'
import type { BundledFontId } from '@/lib/shared/design/fonts'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { CanvasModeContext } from './canvas-mode'
import { faceName, hexOf, type ColourToken, type FontToken } from './tokens'
import { PropertyTiles, Tip } from './properties-panel'
import { WORDS, linkTo } from './words'
import { Swatch } from '../swatch'

const isHex = (value: string | undefined): value is string => !!value && value.startsWith('#')

/** The role a hex is, or else the nearest, to link back to. */
export function nearestToken(hex: string, tokens: readonly ColourToken[]): ColourToken | null {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const want = hexOf(hex)
  if (!want) return null
  let best: ColourToken | null = null
  let gap = Infinity
  for (const token of tokens) {
    const has = hexOf(token.light)
    if (!has) continue
    const d = rgb(has).reduce((sum, c, i) => sum + (c - rgb(want)[i]!) ** 2, 0)
    if (d < gap) {
      gap = d
      best = token
    }
  }
  return best
}

/**
 * A colour field: a brand role or a hex, with a popover of the brand's
 * colours and a custom picker. With `dark`, the popover holds a Light and
 * Dark pair, each set apart.
 */
export function TokenField({
  id,
  label,
  value,
  inherited,
  tokens,
  onChange,
  dark,
  swatches,
}: {
  id: string
  label: string
  /** Exact colours offered under Custom, such as the logo's own. */
  swatches?: readonly string[]
  /** A role's name, a hex, or none. */
  value: string | undefined
  /** What it has from wider up, drawn muted while none is set here. */
  inherited?: string
  tokens: readonly ColourToken[]
  onChange: (value: string | undefined) => void
  /** Dark mode's own value, where dark values apply. */
  dark?: { value: string | undefined; onChange: (value: string | undefined) => void }
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'brand' | 'custom'>(isHex(value) ? 'custom' : 'brand')
  const canvasMode = useContext(CanvasModeContext)
  const [mode, setMode] = useState<'light' | 'dark'>(dark ? canvasMode : 'light')
  const shown = value ?? inherited
  const token = shown ? tokens.find((t) => t.id === shown) : undefined
  const differs = !!dark && dark.value !== undefined && dark.value !== value
  const darkToken = differs ? tokens.find((t) => t.id === dark.value) : undefined
  const darkShown = differs
    ? darkToken
      ? (darkToken.dark ?? darkToken.light)
      : dark.value
    : undefined
  const back = isHex(value) ? nearestToken(value, tokens) : null
  const editing = mode === 'dark' && dark ? dark : { value, onChange }
  const pick = (next: string | undefined) => editing.onChange(next)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <Popover
        open={open}
        onOpenChange={(next) => {
          // Each time it opens, on the colours the canvas shows.
          if (next) setMode(dark ? canvasMode : 'light')
          setOpen(next)
        }}
      >
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-label={`${label}: ${token?.name ?? shown ?? 'none'}`}
            data-token-state={token ? 'linked' : isHex(shown) ? 'detached' : 'none'}
            className={cn(
              'flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-md border border-border px-1.5 text-xs hover:bg-muted focus-ring',
              value === undefined && 'text-muted-foreground'
            )}
          >
            {token ? (
              <>
                <Swatch colour={token.light} dark={darkShown} />
                <span className="truncate">{token.name}</span>
              </>
            ) : isHex(shown) ? (
              <>
                <Swatch colour={shown} dark={darkShown} />
                <span className="font-mono text-2xs uppercase">{shown}</span>
                <LinkSlashIcon
                  className="size-3 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </>
            ) : (
              <span className="truncate">{shown ?? 'Auto'}</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-3 p-3" aria-label={label}>
          <div className="flex items-center gap-2">
            <PropertyTiles
              label={`${label}: colours`}
              value={tab}
              options={[
                ['brand', WORDS.brand],
                ['custom', WORDS.custom],
              ]}
              onChange={setTab}
            />
            {dark && (
              <PropertyTiles
                label={`${label}: mode`}
                value={mode}
                options={[
                  ['light', WORDS.light],
                  ['dark', WORDS.dark],
                ]}
                onChange={setMode}
              />
            )}
          </div>
          {tab === 'brand' ? (
            <div
              role="group"
              aria-label={`${label}: brand colours`}
              className="grid grid-cols-6 gap-1.5"
            >
              {tokens.map((t) => (
                <Tip key={t.id} text={t.name}>
                  <button
                    type="button"
                    aria-label={t.name}
                    aria-pressed={editing.value === t.id}
                    onClick={() => pick(t.id)}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-md border focus-ring',
                      editing.value === t.id
                        ? 'border-foreground'
                        : 'border-transparent hover:border-border'
                    )}
                  >
                    <Swatch colour={mode === 'dark' ? (t.dark ?? t.light) : t.light} />
                  </button>
                </Tip>
              ))}
            </div>
          ) : (
            <ColourField
              id={`${id}-${mode}-custom`}
              label={WORDS.custom}
              placeholder=""
              value={isHex(editing.value) ? editing.value : undefined}
              swatches={swatches}
              onChange={(next) => pick(next ?? undefined)}
            />
          )}
        </PopoverContent>
      </Popover>
      {back && (
        <Tip text={linkTo(back.name)}>
          <button
            type="button"
            onClick={() => onChange(back.id)}
            className="min-h-6 truncate rounded py-1 text-2xs leading-4 text-muted-foreground underline underline-offset-2 hover:text-foreground focus-ring"
          >
            {linkTo(back.name)}
          </button>
        </Tip>
      )}
    </div>
  )
}

/**
 * A font field: one of the brand's fonts by its slot ("Heading font ·
 * Fraunces"). With `onChange`, the popover picks another slot; `editor`
 * holds what else the popover offers, such as changing the slot's own face
 * in the brand, with what that reaches. A value that is not a slot is a face
 * of its own, shown detached with "Link to {slot}".
 */
export function FontField({
  id,
  label,
  value,
  inherited,
  slots,
  onChange,
  editor,
}: {
  id: string
  label: string
  /** A slot's id ('heading', 'headline', 'body'), a face of its own, or none. */
  value: string | undefined
  inherited?: string
  slots: readonly FontToken[]
  onChange?: (slot: FontToken['id'] | undefined) => void
  /** More in the popover, given a way to close it once something is picked. */
  editor?: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const shown = value ?? inherited
  const slot = slots.find((s) => s.id === shown)
  const linkBack = value !== undefined && !slot && onChange ? slots[0] : undefined
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-label={`${label}: ${slot ? `${slot.name}, ${slot.face}` : (shown ?? 'none')}`}
            data-token-state={slot ? 'linked' : shown ? 'detached' : 'none'}
            className={cn(
              'flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-border px-1.5 text-xs hover:bg-muted focus-ring',
              value === undefined && 'text-muted-foreground'
            )}
          >
            <span
              aria-hidden="true"
              className="text-ui leading-none"
              style={slot ? { fontFamily: slot.stack } : undefined}
            >
              Aa
            </span>
            <span className="truncate">
              {slot ? `${slot.name} · ${slot.face}` : (shown ?? 'Auto')}
            </span>
            {!slot && shown && (
              <LinkSlashIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3 p-3" aria-label={label}>
          {onChange && (
            <div role="group" aria-label={`${label}: brand fonts`} className="space-y-0.5">
              {slots.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={value === s.id}
                  onClick={() => {
                    onChange(s.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1 text-start text-xs hover:bg-muted focus-ring',
                    value === s.id && 'bg-muted font-medium'
                  )}
                >
                  <span aria-hidden="true" style={{ fontFamily: s.stack }} className="text-[15px]">
                    Aa
                  </span>
                  {s.name}
                  <span className="ms-auto text-muted-foreground">{s.face}</span>
                </button>
              ))}
            </div>
          )}
          {editor?.(() => setOpen(false))}
        </PopoverContent>
      </Popover>
      {linkBack && onChange && (
        <Tip text={linkTo(linkBack.name)}>
          <button
            type="button"
            onClick={() => onChange(linkBack.id)}
            className="min-h-6 truncate rounded py-1 text-2xs leading-4 text-muted-foreground underline underline-offset-2 hover:text-foreground focus-ring"
          >
            {linkTo(linkBack.name)}
          </button>
        </Tip>
      )}
    </div>
  )
}

type DesignFont = PortalDesign['brand']['fonts']['body']

/**
 * The faces a brand font can be, as a list to pick from, each drawn in its
 * own face: the brand's uploaded fonts first, then the bundled ones. With
 * `same`, the first entry leaves it to another font.
 */
export function FontFaces({
  label,
  value,
  uploaded,
  same,
  onChange,
}: {
  label: string
  value: DesignFont | undefined
  uploaded: readonly Extract<DesignFont, { kind: 'uploaded' }>[]
  /** Offers leaving it to another font, named so: "Same as the heading font". */
  same?: string
  onChange: (font: DesignFont | undefined) => void
}) {
  const key = (font: DesignFont | undefined) =>
    !font ? '' : font.kind === 'bundled' ? font.id : `uploaded:${font.family}`
  const faces: DesignFont[] = [
    ...uploaded,
    ...(Object.keys(BUNDLED_FONTS) as BundledFontId[]).map((id): DesignFont => ({
      kind: 'bundled',
      id,
    })),
  ]
  const row = (font: DesignFont | undefined, name: string) => (
    <button
      key={key(font) || 'same'}
      type="button"
      aria-pressed={key(font) === key(value)}
      onClick={() => onChange(font)}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-start text-xs hover:bg-muted focus-ring',
        key(font) === key(value) && 'bg-muted font-medium'
      )}
    >
      <span
        aria-hidden="true"
        className="w-6 text-sm"
        style={font ? { fontFamily: fontStack(font) } : undefined}
      >
        Aa
      </span>
      {name}
    </button>
  )
  return (
    <div role="group" aria-label={label} className="max-h-56 space-y-0.5 overflow-y-auto">
      {same && row(undefined, same)}
      {faces.map((font) => row(font, faceName(font)))}
    </div>
  )
}
