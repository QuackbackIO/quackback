import { useState } from 'react'
import { Input } from '@/components/ui/input'
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
import { CornersDrawing, ModeDrawing } from './drawings'

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

      <WordsSection design={design} update={update} />
    </div>
  )
}
