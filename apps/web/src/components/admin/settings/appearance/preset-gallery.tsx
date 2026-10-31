import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { BUNDLED_FONTS } from '@/lib/shared/design/fonts'
import { DESIGN_PRESETS, type DesignPreset } from '@/lib/shared/design/presets'
import { cn } from '@/lib/shared/utils'

const RADIUS = { sharp: '0px', subtle: '3px', rounded: '6px', pill: '999px' } as const

/** A small drawing of a preset: its page, band, heading face and cards. */
function PresetDrawing({ preset }: { preset: DesignPreset }) {
  const { brand, shape, layout, mode } = preset.look
  const page = mode === 'dark' ? (brand.dark?.background ?? '#0a0a0a') : brand.light.background
  const ink = mode === 'dark' ? (brand.dark?.ink ?? '#fafafa') : brand.light.ink
  const heading = brand.fonts.heading.kind === 'bundled' ? brand.fonts.heading.id : 'inter'
  const band =
    layout.band === 'brand'
      ? brand.light.accent
      : layout.band === 'none'
        ? 'transparent'
        : `color-mix(in oklab, ${brand.light.accent} 18%, ${page})`
  return (
    <span
      aria-hidden="true"
      className="flex h-24 w-full flex-col overflow-hidden rounded-md border border-border/60"
      style={{ background: page, color: ink }}
    >
      <span className="h-7 px-2 pt-1.5" style={{ background: band }}>
        <span
          className="text-sm"
          style={{
            fontFamily: BUNDLED_FONTS[heading].stack,
            fontWeight: brand.fonts.headingWeight,
            color: layout.band === 'brand' ? '#ffffff' : ink,
          }}
        >
          Aa
        </span>
      </span>
      <span
        className={cn(
          'flex flex-1 flex-col px-2 pt-1.5',
          layout.cards === 'list' ? 'gap-0' : 'gap-1'
        )}
      >
        {[0, 1].map((row) => (
          <span
            key={row}
            className="h-4"
            style={{
              borderRadius: layout.cards === 'list' ? 0 : RADIUS[shape.corners],
              border: layout.cards === 'bordered' ? `1px solid ${ink}33` : undefined,
              borderBottom: layout.cards === 'list' ? `1px solid ${ink}33` : undefined,
              boxShadow: layout.cards === 'raised' ? '0 1px 3px rgba(0,0,0,0.25)' : undefined,
              background: layout.cards === 'list' ? 'transparent' : (brand.light.surface ?? page),
            }}
          />
        ))}
      </span>
    </span>
  )
}

/** Starting looks; picking one changes the draft's look at once. */
export function PresetGallery({ onApply }: { onApply: (preset: DesignPreset) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Start from a preset
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Presets</DialogTitle>
            <DialogDescription>
              A preset changes colours, fonts, corners and layout in your draft.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {DESIGN_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  onApply(preset)
                  setOpen(false)
                }}
                className="flex flex-col gap-2 rounded-lg border border-border p-2 text-start transition-colors hover:bg-muted/40"
              >
                <PresetDrawing preset={preset} />
                <span className="text-[13px] font-medium">{preset.label}</span>
                <span className="text-xs text-muted-foreground">{preset.description}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
