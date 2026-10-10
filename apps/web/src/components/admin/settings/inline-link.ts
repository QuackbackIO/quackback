/**
 * The one inline link style in settings and automation: foreground text with a
 * muted underline that firms up on hover. The brand colour fails contrast on
 * white, so a link never relies on it. Callers add their own size.
 */
export const INLINE_LINK =
  'font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground'
