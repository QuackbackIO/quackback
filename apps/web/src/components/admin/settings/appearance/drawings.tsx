/**
 * Small drawings for the hero's tiles. Each shows the choice itself: the
 * hero's fill, where its image sits, and its art.
 */
import { cn } from '@/lib/shared/utils'
import type { PortalDesign } from '@/lib/shared/design/schema'

type Layout = PortalDesign['layout']

export function BandDrawing({ band }: { band: Layout['hero'] }) {
  return (
    <span className="flex h-full w-full flex-col">
      <span
        className={cn(
          'h-4 w-full',
          band === 'tint' && 'bg-primary/20',
          band === 'fade' && 'bg-gradient-to-b from-primary/25 to-transparent',
          band === 'brand' && 'bg-primary',
          band === 'support' && 'bg-foreground/45',
          band === 'blend' && 'bg-gradient-to-r from-primary to-foreground/30'
        )}
      />
      <span className="mx-auto mt-1 h-1.5 w-8 rounded-sm bg-foreground/20" />
    </span>
  )
}

export function ImagePlaceDrawing({ place }: { place: NonNullable<Layout['imagePlace']> }) {
  const words = <span className="h-1.5 w-5 rounded-sm bg-foreground/50" />
  if (place === 'side')
    return (
      <span className="flex w-14 items-center gap-1">
        {words}
        <span className="h-6 flex-1 rounded-sm bg-foreground/25" />
      </span>
    )
  return (
    <span
      className={cn(
        'relative flex h-7 w-14 items-start justify-start overflow-hidden rounded-sm p-1',
        place === 'cover' && 'bg-foreground/25',
        place === 'pattern' &&
          'bg-[radial-gradient(circle,color-mix(in_oklch,var(--foreground)_30%,transparent)_1px,transparent_1.5px)] bg-[length:5px_5px]'
      )}
    >
      {words}
      {place === 'edge' && <span className="absolute inset-x-0 bottom-0 h-2 bg-foreground/30" />}
    </span>
  )
}

export function BandArtDrawing({ art }: { art: NonNullable<Layout['heroArt']> }) {
  const tile: Partial<Record<typeof art, string>> = {
    dots: 'bg-[radial-gradient(circle,color-mix(in_oklch,var(--primary)_55%,transparent)_1.2px,transparent_1.6px)] bg-[length:7px_7px]',
    grid: 'bg-[linear-gradient(color-mix(in_oklch,var(--primary)_35%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_oklch,var(--primary)_35%,transparent)_1px,transparent_1px)] bg-[length:8px_8px]',
    lines:
      'bg-[repeating-linear-gradient(45deg,color-mix(in_oklch,var(--primary)_35%,transparent)_0_1px,transparent_1px_5px)]',
    petals:
      'bg-[radial-gradient(ellipse_3px_1.5px,color-mix(in_oklch,var(--primary)_50%,transparent)_80%,transparent)] bg-[length:10px_9px]',
    confetti:
      'bg-[radial-gradient(circle,color-mix(in_oklch,var(--primary)_60%,transparent)_1px,transparent_1.5px),radial-gradient(circle,color-mix(in_oklch,var(--foreground)_35%,transparent)_1px,transparent_1.5px)] bg-[length:9px_9px,13px_11px]',
  }
  return (
    <span
      className={cn('relative block h-7 w-14 overflow-hidden rounded-sm bg-primary/10', tile[art])}
    >
      {art === 'hills' && (
        <span className="absolute inset-x-0 bottom-0 h-3 rounded-t-[100%] bg-primary/60" />
      )}
      {art === 'waves' && (
        <span className="absolute inset-x-0 bottom-0 h-2.5 bg-[radial-gradient(circle_at_50%_0,transparent_4px,color-mix(in_oklch,var(--primary)_55%,transparent)_4.5px)] bg-[length:10px_10px]" />
      )}
    </span>
  )
}
