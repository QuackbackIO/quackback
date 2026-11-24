import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SegmentedControl } from '@/components/shared/segmented-control'
import { Label } from '@/components/ui/label'
import { FONT_OPTIONS } from '@/components/admin/settings/branding/font-options'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  CARD_STYLES,
  type BrandingFontId,
  type ButtonShape,
  type CardStyle,
  type CustomFont,
} from '@/lib/shared/theme'
import { loadBrandingFont } from '@/lib/client/hooks/use-branding-font'
import { fontDisplayName } from '@/lib/shared/theme/font-names'
import { uploadedFontFaces } from '@/lib/shared/theme/font-uploads'
import { RADIO_TILE_DOT, RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/shared/utils'
import { FontUploadDialog } from './font-upload-dialog'
import {
  CORNER_STOPS,
  fontFamilyName,
  fontOptionOf,
} from '@/lib/shared/portal-customise/font-shape-names'
export {
  CORNER_STOPS,
  cornersName,
  fontFamilyName,
  fontName,
  fontOptionOf,
} from '@/lib/shared/portal-customise/font-shape-names'

const BUTTON_SHAPES: ReadonlyArray<{ value: ButtonShape; label: string }> = [
  { value: 'pill', label: 'Pill' },
  { value: 'corners', label: 'Match corners' },
]

/** How each card style is named. */
export const CARD_STYLE_NAMES: Record<CardStyle, string> = {
  border: 'Border',
  shadow: 'Shadow',
  flat: 'Flat',
}

/** What Headings reads while titles are set in the text font. */
export const SAME_AS_TEXT = 'Same as text'

const CURRENT = 'current'
const UPLOADED = 'uploaded'
const SAME = 'same'

interface FontShapeSectionProps {
  font: string
  /** The listed (or hand-set) font headings are in; null when they follow the text font. */
  headingFont: string | null
  radius: number
  buttonShape: ButtonShape
  cardStyle: CardStyle
  /** An uploaded family; `font` is then the listed font it falls back to. */
  customFont?: CustomFont
  /** An uploaded family for headings, in place of a listed one. */
  customHeadingFont?: CustomFont
  setFont: (value: string) => void
  setUploadedFont: (font: CustomFont, fallbackValue: string) => void
  /** A listed font for headings, or null for the text font. */
  setHeadingFont: (value: string | null) => void
  setUploadedHeadingFont: (font: CustomFont) => void
  setRadius: (rem: number) => void
  setButtonShape: (shape: ButtonShape) => void
  setCardStyle: (style: CardStyle) => void
  /** Opens the upload for a family, as Import's "Upload {family}" asks. */
  uploadRequest?: { family: string; at: number } | null
}

/**
 * The portal's text font, the font of its titles and headings, how its cards
 * stand off the page, its corners, and whether buttons are pills or follow
 * the corners.
 */
export function FontShapeSection({
  font,
  headingFont,
  radius,
  buttonShape,
  cardStyle,
  customFont,
  customHeadingFont,
  setFont,
  setUploadedFont,
  setHeadingFont,
  setUploadedHeadingFont,
  setRadius,
  setButtonShape,
  setCardStyle,
  uploadRequest,
}: FontShapeSectionProps) {
  const [uploadOpen, setUploadOpen] = useState(false)
  const [headingUploadOpen, setHeadingUploadOpen] = useState(false)
  useEffect(() => {
    if (uploadRequest) setUploadOpen(true)
  }, [uploadRequest])
  const listed = fontOptionOf(font)
  const uploadedStack = customFont ? `"${customFont.family}", ${font}` : null
  // The uploaded families' faces, so each name shows in itself here too.
  const faces = [uploadedFontFaces(customFont), uploadedFontFaces(customHeadingFont)]
    .filter(Boolean)
    .join(' ')
  const offStop = !CORNER_STOPS.some((stop) => Number(stop.value) === radius)
  const corners = offStop
    ? [...CORNER_STOPS, { value: String(radius), label: `${radius}rem` }]
    : CORNER_STOPS

  return (
    <div className="space-y-4">
      {faces ? <style>{faces}</style> : null}
      <div className="space-y-1.5">
        <Label htmlFor="customise-font" className="text-[13px] font-medium">
          Text
        </Label>
        <FontSelect
          id="customise-font"
          shown={
            customFont
              ? {
                  value: UPLOADED,
                  name: `${fontDisplayName(customFont.family)}, uploaded`,
                  stack: uploadedStack ?? font,
                }
              : listed
                ? null
                : {
                    value: CURRENT,
                    name: `${fontFamilyName(font)}, your current font`,
                    stack: font,
                  }
          }
          value={customFont ? UPLOADED : (listed?.id ?? CURRENT)}
          label={listed?.name}
          stack={font}
          onPick={(id) => {
            const option = FONT_OPTIONS.find((f) => f.id === id)
            if (option) setFont(option.value)
          }}
        />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
            Upload a font
          </Button>
          <span className="text-xs text-muted-foreground">
            {customFont && listed
              ? `Falls back to ${listed.name}.`
              : 'Your licensed WOFF2, WOFF, TTF or OTF files.'}
          </span>
        </div>
        <FontUploadDialog
          // A request for another family starts the form again with its name.
          key={uploadRequest?.at ?? 0}
          initialFamily={uploadRequest?.family}
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          defaultFallback={(listed?.id ?? 'inter') as BrandingFontId}
          onUploaded={setUploadedFont}
        />
      </div>

      <HeadingsField
        font={font}
        headingFont={headingFont}
        customHeadingFont={customHeadingFont}
        setHeadingFont={setHeadingFont}
        onUpload={() => setHeadingUploadOpen(true)}
      />
      <FontUploadDialog
        headings
        open={headingUploadOpen}
        onOpenChange={setHeadingUploadOpen}
        defaultFallback={(listed?.id ?? 'inter') as BrandingFontId}
        onUploaded={(uploaded) => setUploadedHeadingFont(uploaded)}
      />

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-medium">Cards</span>
          <span className="text-xs text-muted-foreground">Posts, panels, the welcome</span>
        </div>
        <CardStyleTiles value={cardStyle} onChange={setCardStyle} />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-medium">Corners</span>
          <span className="text-xs text-muted-foreground">Cards, fields, tabs</span>
        </div>
        <SegmentedControl
          label="Corners"
          options={corners}
          value={String(radius)}
          onChange={(value) => setRadius(Number(value))}
        />
      </div>

      <div className="space-y-1.5">
        <span className="text-[13px] font-medium">Buttons</span>
        <div>
          <SegmentedControl
            label="Buttons"
            options={BUTTON_SHAPES}
            value={buttonShape}
            onChange={setButtonShape}
          />
        </div>
      </div>
    </div>
  )
}

/** The font of titles and headings: the text font until another is chosen. */
function HeadingsField({
  font,
  headingFont,
  customHeadingFont,
  setHeadingFont,
  onUpload,
}: Pick<FontShapeSectionProps, 'font' | 'headingFont' | 'customHeadingFont' | 'setHeadingFont'> & {
  onUpload: () => void
}) {
  const listed = headingFont ? fontOptionOf(headingFont) : null
  const shown = customHeadingFont
    ? {
        value: UPLOADED,
        name: `${fontDisplayName(customHeadingFont.family)}, uploaded`,
        stack: `"${customHeadingFont.family}", ${font}`,
      }
    : headingFont && !listed
      ? {
          value: CURRENT,
          name: `${fontFamilyName(headingFont)}, your current font`,
          stack: headingFont,
        }
      : null
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label htmlFor="customise-heading-font" className="text-[13px] font-medium">
          Headings
        </Label>
        <span className="text-xs text-muted-foreground">Titles and the name</span>
      </div>
      <FontSelect
        id="customise-heading-font"
        shown={shown}
        value={customHeadingFont ? UPLOADED : headingFont ? (listed?.id ?? CURRENT) : SAME}
        label={listed?.name ?? SAME_AS_TEXT}
        stack={headingFont ?? font}
        first={{ value: SAME, name: SAME_AS_TEXT, stack: font }}
        onPick={(id) => {
          if (id === SAME) return setHeadingFont(null)
          const option = FONT_OPTIONS.find((f) => f.id === id)
          if (option) setHeadingFont(option.value)
        }}
      />
      <div className="pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onUpload}>
          Upload a headings font
        </Button>
      </div>
    </div>
  )
}

interface FontChoice {
  value: string
  name: string
  stack: string
}

/** A font picker: an entry of its own first (uploaded, or outside the list), then the listed fonts. */
function FontSelect({
  id,
  value,
  label,
  stack,
  shown,
  first,
  onPick,
}: {
  id: string
  value: string
  /** The chosen listed font's name. */
  label?: string
  /** The chosen font's stack, so its name shows in itself. */
  stack: string
  /** The chosen font when it is not a listed one. */
  shown: FontChoice | null
  /** A choice ahead of the list ("Same as text"). */
  first?: FontChoice
  onPick: (id: string) => void
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) onPick(next)
      }}
      onOpenChange={(open) => {
        // Every option shows its name in itself: load them all the first time.
        if (open) for (const f of FONT_OPTIONS) loadBrandingFont(f.id)
      }}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue>
          <span style={{ fontFamily: shown?.stack ?? stack }}>{shown?.name ?? label}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-[320px]">
        {first ? (
          <SelectItem value={first.value}>
            <span style={{ fontFamily: first.stack }}>{first.name}</span>
          </SelectItem>
        ) : null}
        {shown ? (
          <SelectItem value={shown.value}>
            <span style={{ fontFamily: shown.stack }}>{shown.name}</span>
          </SelectItem>
        ) : null}
        {(['Sans Serif', 'Serif', 'Monospace', 'System'] as const).map((category) => (
          <SelectGroup key={category}>
            <SelectLabel>{category}</SelectLabel>
            {FONT_OPTIONS.filter((f) => f.category === category).map((f) => (
              <SelectItem key={f.id} value={f.id}>
                <span style={{ fontFamily: f.value }}>{f.name}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A card style as a small picture: two cards on a page, edged, shadowed or filled. */
function CardStyleSwatch({ style }: { style: CardStyle }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-10 w-full gap-1 rounded-md bg-[#f4f4f5] p-1.5 dark:bg-[#27272a]"
    >
      {[0, 1].map((card) => (
        <span
          key={card}
          className={cn(
            'rounded-[3px]',
            style === 'flat' ? 'bg-[#dcdce0] dark:bg-[#3f3f46]' : 'bg-white dark:bg-[#18181b]',
            style === 'border' && 'border border-[#a1a1aa] dark:border-[#71717a]',
            style === 'shadow' && 'shadow-[0_1px_3px_rgba(0,0,0,0.28)]'
          )}
        />
      ))}
    </span>
  )
}

/** Visual tiles for how cards stand off the page: Border, Shadow or Flat. */
export function CardStyleTiles({
  value,
  onChange,
}: {
  value: CardStyle
  onChange: (style: CardStyle) => void
}) {
  return (
    <RadioGroup
      name="card-style"
      aria-label="Cards"
      value={value}
      onValueChange={(next) => onChange(next as CardStyle)}
      className="grid grid-cols-3 gap-2"
    >
      {CARD_STYLES.map((style) => {
        const selected = style === value
        return (
          <label
            key={style}
            data-slot="card-style-tile"
            data-selected={selected}
            className={cn(
              'flex cursor-pointer flex-col gap-2 rounded-lg border p-2 transition-colors',
              selected
                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                : 'border-border hover:bg-muted/40'
            )}
          >
            <CardStyleSwatch style={style} />
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <RadioGroupItem value={style} className={RADIO_TILE_DOT} />
              {CARD_STYLE_NAMES[style]}
            </span>
          </label>
        )
      })}
    </RadioGroup>
  )
}
