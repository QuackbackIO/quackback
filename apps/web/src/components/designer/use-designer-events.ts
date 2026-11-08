import { useCallback, useEffect, useRef } from 'react'
import type { useDesignDraft } from '@/components/admin/settings/appearance/use-design-draft'
import {
  designerChanged,
  designerClosed,
  designerOpened,
  designerPartPicked,
  trackBuilder,
  type ENTRIES,
} from '@/lib/client/builder-events'
import type { DesignerPage, Selection } from '@/lib/shared/design/outline'
import type { PortalDesign } from '@/lib/shared/design/schema'

/** One visit to the builder: opened from where, and how long until it closed. */
export function useDesignerVisit(entry: (typeof ENTRIES)[number]) {
  // How this visit began; it does not change within it.
  const from = useRef(entry)
  useEffect(() => {
    designerOpened(from.current)
    // Capture first, so the visit is counted before the SDK sends what it holds on the way out.
    window.addEventListener('pagehide', designerClosed, { capture: true })
    return () => {
      window.removeEventListener('pagehide', designerClosed, { capture: true })
      designerClosed()
    }
  }, [])
}

/** Counts what someone does in the builder: the page, the part, the panel, the dialogs. */
export function useDesignerEvents({
  page,
  selection,
  panel,
  design,
  versions,
  help,
}: {
  page: DesignerPage
  selection: Selection | null
  panel: 'settings' | 'ai'
  design: PortalDesign
  versions: boolean
  help: boolean
}) {
  // The design is read when a part is picked, not watched.
  const latest = useRef(design)
  latest.current = design
  const seen = useRef({ page, selection, panel })

  useEffect(() => {
    if (seen.current.page === page) return
    seen.current.page = page
    trackBuilder('designer_page_switched', { page })
  }, [page])

  useEffect(() => {
    const before = seen.current.selection
    if (before === selection) return
    seen.current.selection = selection
    if (selection) designerPartPicked(selection, latest.current)
    else if (panel === 'settings') trackBuilder('designer_panel_opened', { panel: 'overview' })
  }, [selection, panel])

  useEffect(() => {
    if (seen.current.panel === panel) return
    seen.current.panel = panel
    trackBuilder('designer_panel_opened', {
      panel: panel === 'ai' ? 'ai' : seen.current.selection ? 'settings' : 'overview',
    })
  }, [panel])

  useEffect(() => {
    if (versions) trackBuilder('designer_versions_opened', {})
  }, [versions])

  useEffect(() => {
    if (help) trackBuilder('designer_panel_opened', { panel: 'help' })
  }, [help])
}

type Draft = ReturnType<typeof useDesignDraft>

/** Where a refused change says why: under its row, and cleared once a change commits. */
interface Refusals {
  refuse: (reason: string) => void
  clear: () => void
}

/**
 * The draft's update, counting each change by the settings it changes. A
 * change the draft refuses is not counted; its reason goes to `refusals`.
 */
export function useCountedUpdate(draft: Draft, page: DesignerPage, refusals?: Refusals) {
  return useCallback(
    (change: (draft: PortalDesign) => void, label?: string) => {
      // Counted once committed, as the change made it, before the draft settles it.
      const made: { before?: PortalDesign; after?: PortalDesign } = {}
      const outcome = draft.update((next) => {
        made.before = structuredClone(next)
        change(next)
        made.after = structuredClone(next)
      }, label)
      if (outcome?.ok === false) {
        refusals?.refuse(outcome.reason)
        return outcome
      }
      refusals?.clear()
      if (made.before && made.after) designerChanged(made.before, made.after, page)
      return outcome
    },
    [draft, page, refusals]
  )
}
