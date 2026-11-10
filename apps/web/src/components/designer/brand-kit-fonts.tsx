/**
 * The brand's fonts as variables: a pair picked from tiles, each slot's face
 * (heading, headline, body) as a row opening a list of faces, the heading's
 * weight as tiles, and an upload of the brand's own. Fonts no pair makes,
 * such as a website's, show as Custom and stay until a pair is picked.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  OwnFont,
  requestOwnFont,
  uploadedFonts,
  type OwnFontRequest,
} from '@/components/admin/settings/appearance/fonts-section'
import { loadFontPreviews } from '@/components/admin/settings/appearance/font-previews'
import type { Update } from '@/components/admin/settings/appearance/design-update'
import { FONT_PAIRS, fontPairOf, takeFontPair } from '@/lib/shared/design/curated'
import { BUNDLED_FONTS, closestWeight, fontStack } from '@/lib/shared/design/fonts'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { cn } from '@/lib/shared/utils'
import { PropertyRow, PropertySection, PropertyTiles } from './properties/properties-panel'
import { FIND, headingWeightsOf } from './find-rows'
import { FontFaces } from './properties/token-field'
import { faceName } from './properties/tokens'
import { FONT_NAMES, THEME, WORDS } from './properties/words'

/** The id the brand kit's fonts sit under, in Theme, for a font row elsewhere to go to. */
export const THEME_FONTS_ID = 'theme-fonts'

/**
 * Brings the Brand kit's fonts into view once Theme has drawn them, or opens
 * their upload with a font's name and slot filled in, which shows itself.
 */
export function revealThemeFonts(font?: OwnFontRequest): void {
  if (font) return requestOwnFont(font)
  const reveal = (tries: number) =>
    requestAnimationFrame(() => {
      const fonts = document.getElementById(THEME_FONTS_ID)
      if (fonts) fonts.scrollIntoView({ block: 'start' })
      else if (tries > 0) reveal(tries - 1)
    })
  reveal(20)
}

type DesignFont = PortalDesign['brand']['fonts']['body']
type HeadingWeight = PortalDesign['brand']['fonts']['headingWeight']

const trigger =
  'flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-transparent px-1.5 text-start text-xs hover:border-border hover:bg-muted focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none'

/** The pair as tiles, each "Aa" in its heading face over its body face. */
function PairPicker({ design, update }: { design: PortalDesign; update: Update }) {
  const [open, setOpen] = useState(false)
  const current = fontPairOf(design)
  const name = FONT_PAIRS.find((pair) => pair.id === current)?.label ?? THEME.custom
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) loadFontPreviews()
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <button id="kit-font-pair" type="button" className={trigger}>
          <span className="truncate">{name}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2" aria-label={THEME.pair}>
        <div role="radiogroup" aria-label={THEME.pair} className="grid grid-cols-3 gap-1.5">
          {FONT_PAIRS.map((pair) => {
            const heading = BUNDLED_FONTS[pair.heading]
            const body = BUNDLED_FONTS[pair.body]
            const on = pair.id === current
            return (
              <button
                key={pair.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={pair.label}
                title={
                  heading.label === body.label
                    ? heading.label
                    : `${heading.label} and ${body.label}`
                }
                onClick={() => {
                  if (!on) update((draft) => takeFontPair(draft, pair.id))
                  setOpen(false)
                }}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-md border p-2 text-start focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none',
                  on ? 'border-foreground bg-muted' : 'border-border hover:bg-muted/60'
                )}
              >
                <span className="text-lg leading-none" style={{ fontFamily: heading.stack }}>
                  Aa
                </span>
                <span
                  className="text-[11px] text-muted-foreground"
                  style={{ fontFamily: body.stack }}
                >
                  Aa
                </span>
                <span className="text-[11px] font-medium">{pair.label}</span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** One slot's face: "Aa" in it and its name, opening the faces to pick from. */
function FaceValue({
  id,
  label,
  font,
  shown,
  uploaded,
  same,
  onChange,
}: {
  id: string
  label: string
  /** The face set for the slot; none while it follows another. */
  font: DesignFont | undefined
  /** What the slot shows while it follows another. */
  shown: DesignFont
  uploaded: ReturnType<typeof uploadedFonts>
  same?: string
  onChange: (font: DesignFont | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) loadFontPreviews()
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-label={`${label}: ${font ? faceName(font) : (same ?? faceName(shown))}`}
          className={cn(trigger, !font && 'text-muted-foreground')}
        >
          <span
            aria-hidden="true"
            className="text-[13px] leading-none"
            style={{ fontFamily: fontStack(shown) }}
          >
            Aa
          </span>
          <span className="truncate">{font ? faceName(font) : (same ?? faceName(shown))}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2" aria-label={label}>
        <FontFaces
          label={label}
          value={font}
          uploaded={uploaded}
          same={same}
          onChange={(next) => {
            onChange(next)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export function BrandKitFonts({ design, update }: { design: PortalDesign; update: Update }) {
  const { fonts } = design.brand
  const uploaded = uploadedFonts(fonts)
  const weights = headingWeightsOf(design)
  // The brand's own face the last match could only draw in the nearest, until it is uploaded.
  const missed = design.brand.unmatchedFont
  const siteFont =
    missed &&
    !uploaded.some((font) => font.family.trim().toLowerCase() === missed.family.toLowerCase())
      ? missed
      : null
  return (
    <div id={THEME_FONTS_ID} className="scroll-mt-4">
      <PropertySection title={WORDS.fonts}>
        <PropertyRow label={FIND.pair.label} find={FIND.pair.id} htmlFor="kit-font-pair">
          <PairPicker design={design} update={update} />
        </PropertyRow>
        <PropertyRow
          label={FIND.headingFont.label}
          find={FIND.headingFont.id}
          htmlFor="kit-font-heading"
        >
          <FaceValue
            id="kit-font-heading"
            label={FONT_NAMES.heading}
            font={fonts.heading}
            shown={fonts.heading}
            uploaded={uploaded}
            onChange={(font) =>
              update((draft) => {
                if (!font) return
                draft.brand.fonts.heading = font
                draft.brand.fonts.headingWeight = closestWeight(
                  font,
                  draft.brand.fonts.headingWeight
                )
              })
            }
          />
        </PropertyRow>
        <PropertyRow
          label={FIND.headlineFont.label}
          find={FIND.headlineFont.id}
          htmlFor="kit-font-display"
          set={!!fonts.display}
          resetLabel={`${WORDS.reset} to ${THEME.sameAsHeading.toLowerCase()}`}
          onReset={() => update((draft) => void delete draft.brand.fonts.display)}
        >
          <FaceValue
            id="kit-font-display"
            label={FONT_NAMES.headline}
            font={fonts.display}
            shown={fonts.display ?? fonts.heading}
            uploaded={uploaded}
            same={THEME.sameAsHeading}
            onChange={(font) =>
              update((draft) => {
                if (font) draft.brand.fonts.display = font
                else delete draft.brand.fonts.display
              })
            }
          />
        </PropertyRow>
        <PropertyRow label={FIND.bodyFont.label} find={FIND.bodyFont.id} htmlFor="kit-font-body">
          <FaceValue
            id="kit-font-body"
            label={FONT_NAMES.body}
            font={fonts.body}
            shown={fonts.body}
            uploaded={uploaded}
            onChange={(font) => update((draft) => void (font && (draft.brand.fonts.body = font)))}
          />
        </PropertyRow>
        {weights.length > 1 && (
          <PropertyRow
            label={FIND.headingWeight.label}
            find={FIND.headingWeight.id}
            htmlFor="kit-heading-weight"
          >
            <PropertyTiles
              id="kit-heading-weight"
              label={THEME.headingWeight}
              value={String(fonts.headingWeight)}
              options={weights.map((weight) => [String(weight), String(weight)] as const)}
              onChange={(weight) =>
                update(
                  (draft) =>
                    void (draft.brand.fonts.headingWeight = Number(weight) as HeadingWeight)
                )
              }
            />
          </PropertyRow>
        )}
        {siteFont && (
          <Button variant="outline" size="sm" onClick={() => requestOwnFont(siteFont)}>
            Upload {siteFont.family}
          </Button>
        )}
        <OwnFont update={update} />
      </PropertySection>
    </div>
  )
}
