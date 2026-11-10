import { useId } from 'react'
import { onRadioKeys } from '@/components/admin/settings/appearance/radio-keys'
import { languageName } from '@/components/admin/settings/appearance/language-picker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { CanvasVisitor } from '@/lib/shared/design/designer-frame'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { cn } from '@/lib/shared/utils'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/shared/i18n'
import type { CanvasZoom } from './designer-canvas'
import { PropertyRow, PropertyTiles } from './properties/properties-panel'
import { THEME, WORDS } from './properties/words'

const ZOOMS: Array<readonly [CanvasZoom, string, string]> = [
  ['fit', 'Fit', 'Fit to the window'],
  [0.5, '50', '50%'],
  [0.75, '75', '75%'],
  [1, '100', '100%'],
]

/** The canvas's zoom beside the device switch: Fit, 50, 75 or 100. One Tab stop, the arrows pick. */
export function ZoomControl({
  zoom,
  onZoom,
}: {
  zoom: CanvasZoom
  onZoom: (zoom: CanvasZoom) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Zoom"
      onKeyDown={onRadioKeys}
      className="flex rounded-lg bg-muted p-0.5"
    >
      {ZOOMS.map(([value, short, name]) => (
        <button
          key={String(value)}
          type="button"
          role="radio"
          aria-checked={zoom === value}
          aria-label={name}
          tabIndex={zoom === value ? 0 : -1}
          onClick={() => onZoom(value)}
          className={cn(
            'h-7 rounded-md px-1.5 text-xs tabular-nums text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground',
            zoom === value &&
              'bg-background text-foreground shadow-sm forced-colors:outline forced-colors:outline-1'
          )}
        >
          {short}
        </button>
      ))}
    </div>
  )
}

/**
 * How the page is shown while editing, which changes nothing in the design:
 * light or dark when visitors choose, signed out or in, and language; and
 * the keyboard shortcuts.
 */
export function ViewOptions({
  mode,
  theme,
  onTheme,
  locale,
  onLocale,
  visitor,
  onVisitor,
  onKeys,
}: {
  mode: PortalDesign['mode']
  theme: 'light' | 'dark'
  onTheme: (theme: 'light' | 'dark') => void
  locale: SupportedLocale
  onLocale: (locale: SupportedLocale) => void
  visitor: CanvasVisitor
  onVisitor: (visitor: CanvasVisitor) => void
  /** Lists the builder's keyboard shortcuts. */
  onKeys: () => void
}) {
  const id = useId()
  return (
    <section aria-labelledby={`${id}-view`} className="space-y-1 text-[13px]">
      <h3 id={`${id}-view`} title={THEME.viewHelp} className="text-xs font-semibold">
        Viewing the page
      </h3>
      {mode === 'auto' && (
        <PropertyRow label={THEME.previewAs} source={THEME.autoHelp}>
          <PropertyTiles
            label={THEME.previewAs}
            value={theme}
            options={[
              ['light', WORDS.light],
              ['dark', WORDS.dark],
            ]}
            onChange={onTheme}
          />
        </PropertyRow>
      )}
      <PropertyRow label={THEME.visitor}>
        <PropertyTiles
          label={THEME.visitor}
          value={visitor}
          options={[
            ['out', THEME.signedOut],
            ['in', THEME.signedIn],
          ]}
          onChange={onVisitor}
        />
      </PropertyRow>
      <PropertyRow label={THEME.language} htmlFor={`${id}-language`}>
        <Select value={locale} onValueChange={(next) => onLocale(next as SupportedLocale)}>
          <SelectTrigger id={`${id}-language`} size="sm" className="h-7 min-w-0 flex-1 text-xs">
            <SelectValue>{(value: string) => languageName(value as SupportedLocale)}</SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {SUPPORTED_LOCALES.map((each) => (
              <SelectItem key={each} value={each}>
                {languageName(each)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropertyRow>
      <button
        type="button"
        onClick={onKeys}
        className="mt-1 inline-flex min-h-6 items-center rounded-sm text-xs text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground"
      >
        {THEME.keyboardShortcuts}
      </button>
    </section>
  )
}
