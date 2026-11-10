/**
 * How a headline's accent phrase is set apart, by its style: the portal's
 * headline and the builder's words editor draw it with the same classes.
 */
export const ACCENT_CLASS = {
  colour: 'text-[var(--qb-band-accent)]',
  highlight:
    'px-[0.08em] [box-decoration-break:clone] [background:linear-gradient(transparent_58%,var(--qb-band-highlight)_58%,var(--qb-band-highlight)_92%,transparent_92%)]',
  // A two-tone headline's lighter part, in the band's (or the page's) secondary text colour.
  muted: 'text-[var(--qb-band-muted,var(--muted-foreground))]',
} as const
