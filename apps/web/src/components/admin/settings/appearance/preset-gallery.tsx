import { BUNDLED_FONTS } from '@/lib/shared/design/fonts'
import type { DesignPreset } from '@/lib/shared/design/presets'
import { cn } from '@/lib/shared/utils'

const RADIUS = { sharp: '0px', subtle: '3px', rounded: '6px', pill: '999px' } as const

/** A small drawing of a look: its page, band, heading face and cards. */
export function LookDrawing({ look }: { look: DesignPreset['look'] }) {
  const { brand, shape, layout, mode } = look
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
