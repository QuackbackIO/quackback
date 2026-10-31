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
          band === 'brand' && 'bg-primary',
          band === 'support' && 'bg-foreground/45',
          band === 'blend' && 'bg-gradient-to-r from-primary to-foreground/30'
        )}
      />
      <span className="mx-auto mt-1 h-1.5 w-8 rounded-sm bg-foreground/20" />
    </span>
  )
}

/** Bars for a feed's order: rising for trending, falling for top, a dot on the newest. */
export function SortDrawing({ sort }: { sort: 'trending' | 'top' | 'new' }) {
  const heights = sort === 'top' ? ['h-5', 'h-3.5', 'h-2'] : ['h-2', 'h-3.5', 'h-5']
  if (sort === 'new')
    return (
      <span className="flex w-12 flex-col gap-1">
        {[0, 1, 2].map((row) => (
          <span key={row} className="flex items-center gap-1">
            <span
              className={cn('size-1.5 rounded-full', row === 0 ? 'bg-primary' : 'bg-transparent')}
            />
            <span className="h-1.5 flex-1 rounded-sm bg-foreground/30" />
          </span>
        ))}
      </span>
    )
  return (
    <span className="flex items-end gap-1">
      {heights.map((height, index) => (
        <span key={index} className={cn('w-2 rounded-sm bg-foreground/35', height)} />
      ))}
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

export function BlendDrawing({ blend }: { blend: NonNullable<Layout['blend']> }) {
  return blend === 'mesh' ? (
    <span className="h-5 w-14 rounded-sm bg-[radial-gradient(circle_at_75%_30%,var(--primary),transparent_55%),radial-gradient(circle_at_95%_90%,color-mix(in_oklch,var(--foreground)_35%,transparent),transparent_55%)]" />
  ) : (
    <span className="h-5 w-14 rounded-sm bg-gradient-to-r from-primary to-foreground/30" />
  )
}

export function AlignDrawing({ align }: { align: NonNullable<Layout['bandAlign']> }) {
  return (
    <span className={cn('flex w-12 flex-col gap-1', align === 'centre' && 'items-center')}>
      <span className="h-2 w-9 rounded-sm bg-foreground/45" />
      <span className="h-1.5 w-6 rounded-sm bg-foreground/25" />
    </span>
  )
}

export function BandShapeDrawing({ shape }: { shape: NonNullable<Layout['bandShape']> }) {
  return (
    <span className={cn('flex h-full w-full items-center', shape === 'inset' && 'px-1.5')}>
      <span
        className={cn(
          'flex h-6 w-full items-center bg-primary/70 px-1.5',
          shape === 'inset' && 'rounded-md'
        )}
      >
        <span
          className={cn(
            'h-2 w-6 rounded-sm',
            shape === 'panel' ? 'h-4 w-8 bg-background' : 'bg-background/80'
          )}
        />
      </span>
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

const BUTTON_CLASS: Record<NonNullable<PortalDesign['shape']['buttons']>, string> = {
  match: 'rounded-[3px] border border-dashed border-primary/60 bg-transparent',
  square: 'rounded-none bg-primary',
  rounded: 'rounded-md bg-primary',
  pill: 'rounded-full bg-primary',
}

export function ButtonsDrawing({
  buttons,
}: {
  buttons: NonNullable<PortalDesign['shape']['buttons']>
}) {
  return <span className={cn('h-4 w-10', BUTTON_CLASS[buttons])} />
}

export function StatusDrawing({ status }: { status: NonNullable<Layout['status']> }) {
  const colours = ['bg-warning', 'bg-primary', 'bg-success']
  if (status === 'pill')
    return (
      <span className="flex gap-1">
        {['bg-warning/25', 'bg-success/25'].map((tint) => (
          <span key={tint} className={cn('h-2.5 w-5 rounded-sm', tint)} />
        ))}
      </span>
    )
  return (
    <span className="flex gap-1.5">
      {colours.map((colour, index) => (
        <span
          key={colour}
          className={cn(
            'size-2 rounded-full',
            status === 'ink' && 'bg-foreground/70',
            status === 'colour' && colour,
            status === 'brand' && ['bg-primary', 'bg-primary/60', 'bg-foreground/50'][index]
          )}
        />
      ))}
    </span>
  )
}

export function TypeStyleDrawing({
  style,
}: {
  style: 'quiet' | 'confident' | 'display' | 'poster'
}) {
  return (
    <span
      className={cn(
        'font-semibold leading-none text-foreground/80',
        style === 'quiet' && 'text-[11px]',
        style === 'confident' && 'text-sm tracking-tight',
        style === 'display' && 'text-lg font-bold tracking-tighter',
        style === 'poster' && 'text-base font-extrabold uppercase tracking-tighter'
      )}
    >
      {style === 'poster' ? 'AA' : 'Aa'}
    </span>
  )
}

export function LogoDrawing({ display }: { display: PortalDesign['brand']['logo']['display'] }) {
  const mark = <span className="size-3 shrink-0 rounded-sm bg-primary" />
  const name = <span className="h-1.5 w-7 rounded-sm bg-foreground/40" />
  if (display === 'mark') return mark
  if (display === 'wordmark') return <span className="h-3 w-12 rounded-sm bg-foreground/70" />
  if (display === 'name')
    return <span className="text-[11px] font-bold tracking-tight text-foreground/80">Name</span>
  return (
    <span className="flex items-center gap-1">
      {mark}
      {name}
    </span>
  )
}

export function ComposerPlaceDrawing({ place }: { place: 'band' | 'block' }) {
  return (
    <span className="flex h-full w-full flex-col">
      <span className={cn('flex h-5 w-full items-end px-1.5', place === 'band' && 'bg-primary/25')}>
        {place === 'band' && <span className="mb-1 h-1.5 w-8 rounded-full bg-background" />}
      </span>
      <span className="mt-1 flex gap-1 px-1.5">
        {place === 'block' && <span className="h-2 w-6 rounded-sm border border-foreground/40" />}
        <span className="h-2 flex-1 rounded-sm bg-foreground/20" />
      </span>
    </span>
  )
}
