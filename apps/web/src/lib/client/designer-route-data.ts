/**
 * What the builder's route loads before the builder opens: the draft, the
 * AI's status, and the canvas's first page. The route's loader imports this
 * one module when it runs, rather than its parts: a loader's own imports
 * ship in the entry chunk every page loads, and each lazy import adds its
 * own wrapper there too.
 */
import type { QueryClient } from '@tanstack/react-query'
import { portalDesignQueries } from '@/lib/client/queries/portal-design'
import { firstCanvasSrc } from '@/lib/shared/design/canvas-src'
import { portalPageGates, type PageGateSettings } from '@/lib/shared/design/paths'

export async function loadDesignerRoute(
  queryClient: QueryClient,
  settings: PageGateSettings | null | undefined,
  returnPath: string
): Promise<{ canvas: string | null }> {
  const [editor] = await Promise.all([
    queryClient.ensureQueryData(portalDesignQueries.editor()),
    queryClient.ensureQueryData(portalDesignQueries.aiStatus()),
  ])
  // The canvas's first page, so the browser fetches it while the builder's code still loads.
  return { canvas: firstCanvasSrc(editor.design, portalPageGates(settings, true), returnPath) }
}
