import { cn } from '@/lib/shared/utils'

/**
 * A colour as a small square, the builder's one swatch. Its edge is drawn in
 * the text colour, faint, so a dark colour stays visible in dark mode and a
 * light one in light mode. No colour, or transparent, shows a hatched fill;
 * with `dark`, it is split corner to corner, light and dark.
 */
export function Swatch({
  colour,
  dark,
  className,
}: {
  colour: string | undefined
  dark?: string
  className?: string
}) {
  const none = !colour || colour === 'transparent'
  return (
    <span
      aria-hidden="true"
      data-swatch={dark ? 'half' : 'whole'}
      className={cn(
        'size-3.5 shrink-0 rounded-sm border border-foreground/25',
        none &&
          'bg-[repeating-linear-gradient(45deg,var(--muted)_0_3px,var(--background)_3px_6px)]',
        className
      )}
      style={
        none
          ? undefined
          : { background: dark ? `linear-gradient(135deg, ${colour} 50%, ${dark} 50%)` : colour }
      }
    />
  )
}
