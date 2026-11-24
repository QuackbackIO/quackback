import { useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ThemeModeTiles } from '@/components/admin/settings/branding/theme-mode-tiles'
import { type ThemeMode } from '@/lib/shared/theme'
import { isAutoColour, type ColourMode, type ColourRole } from '@/lib/shared/theme/colour-setters'
import type { Palette } from '@/components/admin/settings/branding/theme-css'
import { drawnNote, hexOrNull, pickedHex, roleSuggestions } from './colours'
import { ColourPicker } from './colour-picker'

export type SetColour = (
  role: ColourRole,
  mode: ColourMode,
  hex: string | null,
  options?: { dragging?: boolean }
) => void

interface ColoursSectionProps {
  themeMode: ThemeMode
  light: Palette
  dark: Palette
  setThemeMode: (mode: ThemeMode) => void
  setColour: SetColour
  /** Colours read from the brand's website (Import your brand), offered first in the picker. */
  siteColours?: string[]
}

const ROWS: Array<{ role: ColourRole; label: string; hint: string }> = [
  { role: 'primary', label: 'Main colour', hint: 'Buttons, votes and links' },
  { role: 'background', label: 'Background', hint: 'Cards, borders and header follow it' },
  { role: 'foreground', label: 'Text', hint: 'Body text' },
  { role: 'header', label: 'Header', hint: 'The bar along the top. Auto is the page' },
]

/**
 * Light, dark or the visitor's choice, then four colours. Dark colours are
 * worked out from the light ones until the admin asks to change them.
 */
export function ColoursSection({
  themeMode,
  light,
  dark,
  setThemeMode,
  setColour,
  siteColours,
}: ColoursSectionProps) {
  const [darkOpen, setDarkOpen] = useState(false)
  const modes: ColourMode[] =
    themeMode === 'light' ? ['light'] : themeMode === 'dark' ? ['dark'] : ['light']
  const showDark = themeMode === 'user' && darkOpen

  return (
    <div className="space-y-3">
      <ThemeModeTiles value={themeMode} onChange={setThemeMode} />
      {modes.map((mode) => (
        <ColourRows
          key={mode}
          mode={mode}
          palette={mode === 'light' ? light : dark}
          setColour={setColour}
          siteColours={siteColours}
        />
      ))}
      {themeMode === 'user' && !showDark ? (
        <p className="text-xs text-muted-foreground">
          Dark mode colours are worked out for you.{' '}
          <button
            type="button"
            onClick={() => setDarkOpen(true)}
            className="font-medium text-foreground underline underline-offset-2"
          >
            Change
          </button>
        </p>
      ) : null}
      {showDark ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Dark mode</p>
          <ColourRows mode="dark" palette={dark} setColour={setColour} siteColours={siteColours} />
        </div>
      ) : null}
    </div>
  )
}

function ColourRows({
  mode,
  palette,
  setColour,
  siteColours,
}: {
  mode: ColourMode
  palette: Palette
  setColour: SetColour
  siteColours?: string[]
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="divide-y divide-border">
        {ROWS.map((row) => (
          <ColourRow
            key={row.role}
            {...row}
            mode={mode}
            palette={palette}
            setColour={setColour}
            siteColours={siteColours}
          />
        ))}
      </div>
    </div>
  )
}

function ColourRow({
  role,
  label,
  hint,
  mode,
  palette,
  setColour,
  siteColours,
}: {
  role: ColourRole
  label: string
  hint: string
  mode: ColourMode
  palette: Palette
  setColour: SetColour
  siteColours?: string[]
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  // An unset header is the page: its swatch shows the page.
  const hex =
    pickedHex(palette, role) ??
    (role === 'header' ? hexOrNull(palette.background) : null) ??
    '#000000'
  const auto = role !== 'primary' && isAutoColour(palette, role, mode)
  const note = auto ? null : drawnNote(palette, role)
  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={trigger}
            type="button"
            title={hint}
            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start text-[13px] transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
          >
            <span>{label}</span>
            <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <span
                aria-hidden="true"
                className="size-4 rounded border border-border/70"
                style={{ backgroundColor: hex }}
              />
              {auto ? 'Auto' : hex}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="right"
          sideOffset={12}
          className="w-[252px] p-3"
          finalFocus={trigger}
        >
          <ColourPicker
            value={hex}
            isAuto={auto}
            allowAuto={role !== 'primary'}
            swatches={roleSuggestions(role, mode, palette, siteColours)}
            onChange={(next, options) => setColour(role, mode, next, options)}
          />
        </PopoverContent>
      </Popover>
      {note ? <p className="-mt-1 px-3 pb-2.5 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  )
}
