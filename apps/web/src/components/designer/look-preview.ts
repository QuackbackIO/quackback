/**
 * A design shown on the canvas for a moment in place of the draft, such as a
 * preset someone points at before choosing it. Nothing is saved: leaving the
 * choice shows the draft again.
 */
import { useMemo, useSyncExternalStore } from 'react'
import { designPreview } from '@/components/admin/settings/appearance/use-design-draft'
import type { PortalDesign } from '@/lib/shared/design/schema'

let shown: PortalDesign | null = null
const listeners = new Set<() => void>()

/** Shows a design on the canvas, or the draft again with null. */
export function previewOnCanvas(design: PortalDesign | null): void {
  if (design === shown) return
  shown = design
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** The design being tried on the canvas, or null while it shows the draft. */
export function usePreviewedDesign(): PortalDesign | null {
  return useSyncExternalStore(
    subscribe,
    () => shown,
    () => null
  )
}

/** What the canvas draws: a design being tried, else the draft's own preview. */
export function useCanvasDesign<T>(draft: T): T | ReturnType<typeof designPreview> {
  const tried = usePreviewedDesign()
  const preview = useMemo(() => (tried ? designPreview(tried) : null), [tried])
  return preview ?? draft
}
