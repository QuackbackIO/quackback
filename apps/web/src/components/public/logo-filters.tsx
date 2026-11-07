import {
  LIFT_TABLE,
  LIFT_UNDO,
  LOGO_FILTER,
  LUMINANCE_MATRIX,
  REVERSE_MATRIX,
  SINK_TABLE,
  SINK_UNDO,
} from '@/lib/shared/design/logo'

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
