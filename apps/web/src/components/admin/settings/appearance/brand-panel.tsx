import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SettingRow } from '@/components/admin/settings/setting-row'
import { getWordmarkUploadUrlFn } from '@/lib/server/functions/uploads'
import { designAssetUrl } from '@/lib/shared/design/design-view'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { normaliseColor } from '@/lib/shared/design/color'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { oklchToHex } from '@/lib/shared/theme/colors'
import { applyPreset } from '@/lib/shared/design/presets'
import { DesignTiles } from './design-tiles'
import { WordsSection } from './words-section'
import { FontsSection } from './fonts-section'
import { PresetGallery } from './preset-gallery'
import { ImageSlot } from './image-slot'
import {
  ButtonsDrawing,
  CornersDrawing,
  LogoDrawing,
  ModeDrawing,
  TypeStyleDrawing,
} from './drawings'

type Palette = PortalDesign['brand']['light']
type PaletteKey = keyof Palette
type Update = (change: (draft: PortalDesign) => void) => void

const MAIN_COLOURS: Array<{ key: PaletteKey; label: string }> = [
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Background' },
  { key: 'ink', label: 'Text' },
]
const MORE_COLOURS: Array<{ key: 'surface' | 'raised' | 'muted' | 'border'; label: string }> = [
  { key: 'surface', label: 'Cards' },
  { key: 'raised', label: 'Raised surfaces' },
  { key: 'muted', label: 'Secondary text' },
  { key: 'border', label: 'Borders' },
]
type Fonts = PortalDesign['brand']['fonts']
type TypeStyle = 'quiet' | 'confident' | 'display' | 'poster'

/** Headline size, tracking and case together, as four looks a person can see. */
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

const LOGO_LABELS: Record<PortalDesign['brand']['logo']['display'], string> = {
  mark_and_name: 'Logo and name',
  mark: 'Logo',
  wordmark: 'Wordmark',
  name: 'Name',
}

const presignWordmark = async (file: File) =>
  getWordmarkUploadUrlFn({
    data: { filename: file.name, contentType: file.type, fileSize: file.size },
  })

const toHex = (value: string | undefined) =>
  value ? (value.startsWith('#') ? value : oklchToHex(value)) : '#ffffff'

/** A colour as a picker and its value; a typed value applies once it parses. */
function ColourField({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string
  label: string
  value: string | undefined
  placeholder?: string
  onChange: (value: string | undefined) => void
}) {
  const [text, setText] = useState(value ?? '')
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    setText(value ?? '')
  }
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-32 shrink-0 text-[13px]">
        {label}
      </label>
      <input
        type="color"
        aria-label={`${label} picker`}
        value={toHex(value ?? placeholder)}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-10 shrink-0 cursor-pointer rounded-field border border-border bg-transparent"
      />
      <Input
        id={id}
        value={text}
        placeholder={placeholder ? 'Automatic' : undefined}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          if (next.trim() === '' && placeholder !== undefined) onChange(undefined)
          const colour = normaliseColor(next.trim())
          if (colour) onChange(colour)
        }}
        className="h-8 font-mono text-xs"
      />
    </div>
  )
}

/** The Brand tab: the logo, mode, colours, fonts and corners. */
export function BrandPanel({
  design,
  update,
  logoUrl = null,
}: {
  design: PortalDesign
  update: Update
  /** The workspace logo, which Settings › General owns for the portal, the admin and email. */
  logoUrl?: string | null
}) {
  const [moreColours, setMoreColours] = useState(false)
  const { light, dark } = design.brand

  return (
    <div className="space-y-6">
      <PresetGallery
        onApply={(preset) => update((draft) => Object.assign(draft, applyPreset(draft, preset)))}
      />
      <div className="flex items-center gap-3">
        <span className="w-32 shrink-0 text-[13px] font-medium">Logo</span>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="size-8 rounded-md border border-border object-contain"
          />
        ) : (
          <span className="text-[13px] text-muted-foreground">None</span>
        )}
        <Button variant="ghost" size="sm" className="ms-auto" asChild>
          <Link to="/admin/settings/general">Change in General</Link>
        </Button>
      </div>
      <DesignTiles
        name="design-logo"
        label="Header shows"
        value={design.brand.logo.display}
        columns={4}
        onChange={(display) => update((draft) => void (draft.brand.logo.display = display))}
        options={DESIGN_OPTIONS.logoDisplay.map((display) => ({
          value: display,
          label: LOGO_LABELS[display],
          drawing: <LogoDrawing display={display} />,
        }))}
      />
      {design.brand.logo.display === 'wordmark' && (
        <div className="space-y-2">
          {(['light', 'dark'] as const).map((mode) => {
            const file = design.brand.logo.wordmark[mode]
            return (
              <ImageSlot
                key={mode}
                label={mode === 'light' ? 'Wordmark' : 'On dark'}
                url={file ? designAssetUrl(file.key) : null}
                accept="image/svg+xml,image/png,image/jpeg,image/webp"
                presign={presignWordmark}
                onUploaded={(key) =>
                  update((draft) => void (draft.brand.logo.wordmark[mode] = { key }))
                }
                onRemove={() => update((draft) => void (draft.brand.logo.wordmark[mode] = null))}
              />
            )
          })}
        </div>
      )}
      <DesignTiles
        name="design-mode"
        label="Mode"
        value={design.mode}
        onChange={(mode) => update((draft) => void (draft.mode = mode))}
        options={[
          { value: 'light', label: 'Light', drawing: <ModeDrawing mode="light" /> },
          { value: 'dark', label: 'Dark', drawing: <ModeDrawing mode="dark" /> },
          { value: 'auto', label: 'Visitor chooses', drawing: <ModeDrawing mode="auto" /> },
        ]}
      />

      <section className="space-y-2">
        <p className="text-[13px] font-medium">Colours</p>
        {MAIN_COLOURS.map(({ key, label }) => (
          <ColourField
            key={key}
            id={`colour-${key}`}
            label={label}
            value={light[key]}
            onChange={(value) => value && update((draft) => void (draft.brand.light[key] = value))}
          />
        ))}
        <ColourField
          id="colour-support"
          label="Second colour"
          value={light.support}
          placeholder={light.accent}
          onChange={(value) =>
            update((draft) => {
              if (value) draft.brand.light.support = value
              else delete draft.brand.light.support
            })
          }
        />
        {moreColours &&
          MORE_COLOURS.map(({ key, label }) => (
            <ColourField
              key={key}
              id={`colour-${key}`}
              label={label}
              value={light[key]}
              placeholder={light.background}
              onChange={(value) =>
                update((draft) => {
                  if (value) draft.brand.light[key] = value
                  else delete draft.brand.light[key]
                })
              }
            />
          ))}
        <Button
          variant="ghost"
          size="sm"
          className="-ms-2"
          onClick={() => setMoreColours((open) => !open)}
        >
          {moreColours ? 'Fewer colours' : 'More colours'}
        </Button>
      </section>

      {design.mode !== 'light' && (
        <section className="space-y-2">
          <p className="text-[13px] font-medium">Dark colours</p>
          {(['background', 'ink'] as const).map((key) => (
            <ColourField
              key={key}
              id={`colour-dark-${key}`}
              label={key === 'ink' ? 'Text' : 'Background'}
              value={dark?.[key]}
              placeholder="#0a0a0a"
              onChange={(value) =>
                update((draft) => {
                  draft.brand.dark = { ...draft.brand.dark }
                  if (value) draft.brand.dark[key] = value
                  else delete draft.brand.dark[key]
                })
              }
            />
          ))}
        </section>
      )}

      <FontsSection design={design} update={update} />

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
      <SettingRow
        label="Menu and buttons in capitals"
        htmlFor="design-label-case"
        control={
          <Switch
            id="design-label-case"
            checked={design.brand.fonts.labelCase === 'upper'}
            onCheckedChange={(upper) =>
              update((draft) => void (draft.brand.fonts.labelCase = upper ? 'upper' : 'sentence'))
            }
          />
        }
      />

      <DesignTiles
        name="design-corners"
        label="Corners"
        value={design.shape.corners}
        columns={4}
        onChange={(corners) => update((draft) => void (draft.shape.corners = corners))}
        options={DESIGN_OPTIONS.corners.map((corners) => ({
          value: corners,
          label: corners[0].toUpperCase() + corners.slice(1),
          drawing: <CornersDrawing corners={corners} />,
        }))}
      />
      <DesignTiles
        name="design-buttons"
        label="Buttons"
        value={design.shape.buttons ?? 'match'}
        columns={4}
        onChange={(buttons) => update((draft) => void (draft.shape.buttons = buttons))}
        options={DESIGN_OPTIONS.buttons.map((buttons) => ({
          value: buttons,
          label: buttons === 'match' ? 'Like corners' : buttons[0].toUpperCase() + buttons.slice(1),
          drawing: <ButtonsDrawing buttons={buttons} />,
        }))}
      />

      <WordsSection design={design} update={update} />
    </div>
  )
}
