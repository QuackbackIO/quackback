/**
 * The filters' ids, as LOGO_FILTER in lib/shared/design/logo.ts names them for
 * the design's --qb-logo-filter. Written out here so the header does not load
 * the logo measuring code; a test keeps the two the same.
 */
export const LOGO_FILTER_IDS = {
  reverse: 'qb-logo-reverse',
  lift: 'qb-logo-lift',
  sink: 'qb-logo-sink',
  ink: 'qb-logo-ink',
} as const
const LOGO_FILTER = LOGO_FILTER_IDS

/** Relative luminance weights, in sRGB as the filters work. */
const Y = [0.2126, 0.7152, 0.0722] as const
const row = (channel: number, scale: number, offset: number) =>
  [0, 1, 2].map((i) => (i === channel ? 1 : 0) + scale * Y[i]!).join(' ') + ` 0 ${offset}`

/** Each colour less twice its luminance, plus one: lightness turned over, colour kept. */
const REVERSE_MATRIX = [row(0, -2, 1), row(1, -2, 1), row(2, -2, 1), '0 0 0 1 0'].join(' ')
/** The luminance in every channel, alpha kept. */
const LUMINANCE_MATRIX = [
  Y.join(' ') + ' 0 0',
  Y.join(' ') + ' 0 0',
  Y.join(' ') + ' 0 0',
  '0 0 0 1 0',
].join(' ')
/**
 * By luminance from black to white: how far lift raises a colour (all the
 * way for black, none from mid grey up), and one less how far sink lowers it.
 * Averaged with the logo, then doubled back (less one for sink), as
 * arithmetic compositing would otherwise double the logo's alpha.
 */
const LIFT_TABLE = '1 0 0'
const SINK_TABLE = '1 1 0'
const LIFT_UNDO = '2 0 0 0 0 0 2 0 0 0 0 0 2 0 0 0 0 0 1 0'
const SINK_UNDO = '2 0 0 0 -1 0 2 0 0 -1 0 0 2 0 -1 0 0 0 1 0'

/** Moves each colour by a table of its luminance, keeping its hue (lift and sink). */
function ShiftFilter({ id, table, undo }: { id: string; table: string; undo: string }) {
  return (
    <filter id={id} colorInterpolationFilters="sRGB">
      <feColorMatrix in="SourceGraphic" type="matrix" values={LUMINANCE_MATRIX} result="y" />
      <feComponentTransfer in="y" result="shift">
        <feFuncR type="table" tableValues={table} />
        <feFuncG type="table" tableValues={table} />
        <feFuncB type="table" tableValues={table} />
      </feComponentTransfer>
      <feComposite in="SourceGraphic" in2="shift" operator="arithmetic" k2={0.5} k3={0.5} />
      <feColorMatrix type="matrix" values={undo} />
    </filter>
  )
}

/**
 * The filters a logo image is drawn through where its ink would vanish into
 * the header (the design's --qb-logo-filter names one), defined once beside it.
 */
export function LogoFilters() {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" className="absolute size-0">
      <defs>
        <filter id={LOGO_FILTER.reverse} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={REVERSE_MATRIX} />
        </filter>
        <filter id={LOGO_FILTER.ink} colorInterpolationFilters="sRGB">
          <feFlood style={{ floodColor: 'var(--qb-header-ink, currentColor)' }} result="ink" />
          <feComposite in="ink" in2="SourceAlpha" operator="in" />
        </filter>
        <ShiftFilter id={LOGO_FILTER.lift} table={LIFT_TABLE} undo={LIFT_UNDO} />
        <ShiftFilter id={LOGO_FILTER.sink} table={SINK_TABLE} undo={SINK_UNDO} />
      </defs>
    </svg>
  )
}
