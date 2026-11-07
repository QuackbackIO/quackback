import { useContext, type CSSProperties } from 'react'
import { StatusColourContext } from '@/components/ui/status-badge'

/**
 * A tag's chip, marked as the status markers are: tinted with its colour, in
 * the brand's colours where the design maps them, and plain where the design
 * draws statuses in the ink. Its text stays in the ink, which reads on it.
 */
export const TAG_TINT =
  '[background:color-mix(in_oklch,var(--qb-tag)_14%,transparent)] text-foreground [[data-qb-status=ink]_&]:[background:var(--muted)]'

/** The same chip's edge, where it has one. */
export const TAG_EDGE =
  '[border-color:color-mix(in_oklch,var(--qb-tag)_28%,transparent)] [[data-qb-status=ink]_&]:[border-color:var(--border)]'

/** Each tag's colour as this page shows it, for its chip's style. */
export function useTagStyle(): (colour: string | null | undefined) => CSSProperties {
  const shown = useContext(StatusColourContext)
  return (colour) =>
    ({ '--qb-tag': colour ? shown(colour) : 'var(--muted-foreground)' }) as CSSProperties
}
