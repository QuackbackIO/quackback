import type { LookTile } from '@/lib/shared/design/look-tile'
import { cn } from '@/lib/shared/utils'

const RADIUS = { sharp: '0px', subtle: '3px', rounded: '6px', pill: '999px' } as const

/**
 * A small drawing of a look: its page, hero band, heading face and cards, in
 * the colours the tile says (already solved so the hero letters read), with
 * the workspace's logo in the band where it has one.
 */
export function LookDrawing({ tile, logoUrl }: { tile: LookTile; logoUrl?: string | null }) {
  const { page, ink, band, bandInk, surface, heading, weight, corners, cards } = tile
  return (
    <span
      aria-hidden="true"
      className="flex h-24 w-full flex-col overflow-hidden rounded-md border border-border/60"
      style={{ background: page, color: ink }}
    >
      <span
        data-tile-band=""
        className="flex h-7 items-center gap-1 px-2"
        style={{ background: band }}
      >
        {logoUrl && <img src={logoUrl} alt="" className="size-3.5 shrink-0 object-contain" />}
        <span
          className="text-sm"
          style={{ fontFamily: heading, fontWeight: weight, color: bandInk }}
        >
          Aa
        </span>
      </span>
      <span
        className={cn('flex flex-1 flex-col px-2 pt-1.5', cards === 'list' ? 'gap-0' : 'gap-1')}
      >
        {[0, 1].map((row) => (
          <span
            key={row}
            className="h-4"
            style={{
              borderRadius: cards === 'list' ? 0 : RADIUS[corners],
              border:
                cards === 'bordered'
                  ? `1px solid color-mix(in oklab, ${ink} 20%, transparent)`
                  : undefined,
              borderBottom:
                cards === 'list'
                  ? `1px solid color-mix(in oklab, ${ink} 20%, transparent)`
                  : undefined,
              boxShadow: cards === 'raised' ? '0 1px 3px rgba(0,0,0,0.25)' : undefined,
              background: cards === 'list' ? 'transparent' : surface,
            }}
          />
        ))}
      </span>
    </span>
  )
}
