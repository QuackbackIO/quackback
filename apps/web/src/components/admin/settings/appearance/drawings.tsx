/**
 * Small drawings for the design tiles. Each shows the choice itself: the
 * corner, the spacing, the card style, the menu style, the width or the
 * filter side.
 */
import { cn } from '@/lib/shared/utils'
import type { PortalDesign } from '@/lib/shared/design/schema'

type Layout = PortalDesign['layout']

export function ModeDrawing({ mode }: { mode: PortalDesign['mode'] }) {
  return (
    <span className="flex h-full w-full">
      {mode !== 'dark' && <span className="flex-1 bg-white" />}
      {mode !== 'light' && <span className="flex-1 bg-neutral-900" />}
    </span>
  )
}

const CORNER_CLASS: Record<PortalDesign['shape']['corners'], string> = {
  sharp: 'rounded-none',
  subtle: 'rounded-[3px]',
  rounded: 'rounded-md',
  pill: 'rounded-full',
}

export function CornersDrawing({ corners }: { corners: PortalDesign['shape']['corners'] }) {
  return <span className={cn('h-5 w-12 border-2 border-foreground/60', CORNER_CLASS[corners])} />
}

const DENSITY_GAP: Record<Layout['density'], string> = {
  compact: 'gap-0.5',
  comfortable: 'gap-1',
  spacious: 'gap-1.5',
}

export function DensityDrawing({ density }: { density: Layout['density'] }) {
  return (
    <span className={cn('flex w-12 flex-col', DENSITY_GAP[density])}>
      {[0, 1, 2].map((row) => (
        <span key={row} className="h-1.5 rounded-sm bg-foreground/40" />
      ))}
    </span>
  )
}

export function CardsDrawing({ cards }: { cards: Layout['cards'] }) {
  return (
    <span className={cn('flex w-14 flex-col', cards === 'list' ? 'gap-0' : 'gap-1')}>
      {[0, 1].map((row) => (
        <span
          key={row}
          className={cn(
            'h-3 bg-background',
            cards === 'bordered' && 'rounded-sm border border-foreground/40',
            cards === 'raised' && 'rounded-sm shadow-[0_1px_3px_rgba(0,0,0,0.35)]',
            cards === 'list' && 'border-b border-foreground/40'
          )}
        />
      ))}
    </span>
  )
}

const WIDTH_CLASS: Record<Layout['width'], string> = {
  narrow: 'w-7',
  default: 'w-10',
  wide: 'w-14',
}

export function WidthDrawing({ width }: { width: Layout['width'] }) {
  return <span className={cn('h-5 rounded-sm bg-foreground/30', WIDTH_CLASS[width])} />
}

export function NavDrawing({ nav }: { nav: Layout['nav'] }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className={cn(
          'h-2.5 w-5',
          nav === 'tabs' && 'rounded-sm bg-foreground/25',
          nav === 'pills' && 'rounded-full bg-primary/40',
          nav === 'underline' && 'border-b-2 border-primary'
        )}
      />
      <span className="h-1.5 w-4 rounded-sm bg-foreground/20" />
      <span className="h-1.5 w-4 rounded-sm bg-foreground/20" />
    </span>
  )
}

export function HeaderDrawing({ header }: { header: Layout['header'] }) {
  const logo = <span className="size-2.5 shrink-0 rounded-sm bg-foreground/50" />
  const menu = (
    <span className="flex gap-0.5">
      <span className="h-1.5 w-3 rounded-sm bg-foreground/30" />
      <span className="h-1.5 w-3 rounded-sm bg-foreground/30" />
    </span>
  )
  if (header === 'inline')
    return (
      <span className="flex w-14 items-center gap-1.5">
        {logo}
        {menu}
      </span>
    )
  return (
    <span className={cn('flex w-14 flex-col gap-1', header === 'centered' && 'items-center')}>
      {logo}
      {menu}
    </span>
  )
}

export function BandDrawing({ band }: { band: Layout['band'] }) {
  return (
    <span className="flex h-full w-full flex-col">
      <span
        className={cn(
          'h-4 w-full',
          band === 'tint' && 'bg-primary/20',
          band === 'fade' && 'bg-gradient-to-b from-primary/25 to-transparent',
          band === 'brand' && 'bg-primary'
        )}
      />
      <span className="mx-auto mt-1 h-1.5 w-8 rounded-sm bg-foreground/20" />
    </span>
  )
}

export function FiltersDrawing({ filters }: { filters: Layout['filters'] }) {
  return (
    <span className={cn('flex w-14 gap-1', filters === 'start' && 'flex-row-reverse')}>
      <span className="h-6 flex-1 rounded-sm bg-foreground/20" />
      <span className="h-6 w-4 rounded-sm border border-foreground/40" />
    </span>
  )
}
