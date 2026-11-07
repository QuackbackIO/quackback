import { Suspense } from 'react'
import { Button } from '@/components/ui/button'
import { lazyWithPreload } from '@/lib/client/lazy-with-preload'
import { PORTAL_PARTS } from '@/lib/shared/design/parts'
import type { PortalDesign } from '@/lib/shared/design/schema'

type Update = (change: (draft: PortalDesign) => void) => void

/** A warning from the CSS check, with the swap that fixes it where there is one. */
export interface CssWarning {
  message: string
  line?: number
  fix?: { find: string; replace: string }
}

// The editor is the same lazy chunk the legacy theme's Advanced CSS uses.
const { Component: CustomCssEditor } = lazyWithPreload(
  () => import('@/components/admin/settings/branding/custom-css-editor'),
  'CustomCssEditor'
)

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The CSS with each fix's text swapped, the longest first and only where it is
 * the whole class name, so `.portal-nav__item` leaves `.portal-nav__item--active`.
 */
export function applyFixes(css: string, warnings: readonly CssWarning[]): string {
  const swaps = new Map(warnings.flatMap((w) => (w.fix ? [[w.fix.find, w.fix.replace]] : [])))
  return [...swaps]
    .sort(([a], [b]) => b.length - a.length)
    .reduce(
      (next, [find, replace]) =>
        next.replace(new RegExp(`${escape(find)}(?![\\w-])`, 'g'), replace),
      css
    )
}

/**
 * The workspace's own CSS, in the tenant layer over the design. It styles the
 * portal's parts by name; the check on save refuses what reaches past styling
 * and lists what may break, fixing internal class names on request.
 */
export function CssFields({
  design,
  update,
  warnings,
}: {
  design: PortalDesign
  update: Update
  warnings: readonly CssWarning[]
}) {
  const css = design.css ?? ''
  const setCss = (next: string) =>
    update((draft) => {
      if (next.trim()) draft.css = next
      else delete draft.css
    })
  const fixes = warnings.filter((warning) => warning.fix)
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Style the portal&apos;s parts by name, such as{' '}
        <code className="font-mono">[data-qb-part=&quot;post-card&quot;]</code>. Parts:{' '}
        {PORTAL_PARTS.map((part) => part.name).join(', ')}.
      </p>
      <Suspense
        fallback={
          <div className="h-[280px] animate-pulse rounded-md border border-input bg-muted/30" />
        }
      >
        <CustomCssEditor value={css} onChange={setCss} />
      </Suspense>
      {warnings.length > 0 && (
        <div className="space-y-2">
          <ul className="space-y-1 text-xs text-muted-foreground" aria-label="CSS warnings">
            {warnings.map((warning, index) => (
              <li key={`${warning.line}-${index}`}>
                {warning.line ? `Line ${warning.line}: ` : ''}
                {warning.message}
              </li>
            ))}
          </ul>
          {fixes.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setCss(applyFixes(css, fixes))}>
              Fix it for me
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
