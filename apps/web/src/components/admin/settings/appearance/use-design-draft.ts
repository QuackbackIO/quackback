import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { portalDesignQueries } from '@/lib/client/queries/portal-design'
import {
  discardPortalDesignDraftFn,
  publishPortalDesignFn,
  restorePortalDesignVersionFn,
  savePortalDesignDraftFn,
} from '@/lib/server/functions/portal-design'
import { designChanges } from '@/lib/shared/design/diff'
import { designView } from '@/lib/shared/design/design-view'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { PortalDesignRevisionId } from '@quackback/ids'

/** How long the draft waits after a change before it saves. */
export const DRAFT_SAVE_DELAY_MS = 600

type Outcome = { ok: true } | { ok: false; message: string }

/**
 * The Appearance draft: the design being edited, saved to the server shortly
 * after each change, so leaving the page loses nothing. What the draft
 * changes is measured against what visitors see now.
 */
export function useDesignDraft() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { data } = useSuspenseQuery(portalDesignQueries.editor())
  const [design, setDesign] = useState<PortalDesign>(data.design)
  const [report, setReport] = useState(data.report)
  const [saving, setSaving] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const latest = useRef(design)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const save = useCallback(async (next: PortalDesign) => {
    setSaving(true)
    try {
      const result = await savePortalDesignDraftFn({ data: { design: next } })
      if (result.ok) {
        setReport(result.report)
        setRefusal(null)
      } else {
        setRefusal(result.message)
      }
    } finally {
      setSaving(false)
    }
  }, [])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  /** Changes the draft; it saves after a short pause. */
  const update = useCallback(
    (change: (draft: PortalDesign) => void) => {
      const next = structuredClone(latest.current)
      change(next)
      latest.current = next
      setDesign(next)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void save(next), DRAFT_SAVE_DELAY_MS)
    },
    [save]
  )

  /** Reloads the editor and the root settings after the live design moved. */
  const refresh = useCallback(async () => {
    const fresh = await queryClient.fetchQuery({ ...portalDesignQueries.editor(), staleTime: 0 })
    latest.current = fresh.design
    setDesign(fresh.design)
    setReport(fresh.report)
    setRefusal(null)
    void queryClient.invalidateQueries({ queryKey: portalDesignQueries.versions().queryKey })
    void router.invalidate()
  }, [queryClient, router])

  const discard = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    await discardPortalDesignDraftFn()
    await refresh()
  }, [refresh])

  const publish = useCallback(
    async (message?: string): Promise<Outcome> => {
      if (timer.current) {
        clearTimeout(timer.current)
        await save(latest.current)
      }
      const result = await publishPortalDesignFn({ data: { message } })
      if (!result.ok) return { ok: false, message: result.message }
      await refresh()
      return { ok: true }
    },
    [refresh, save]
  )

  const restore = useCallback(
    async (revisionId: PortalDesignRevisionId): Promise<Outcome> => {
      const result = await restorePortalDesignVersionFn({ data: { revisionId } })
      if (!result.ok) return { ok: false, message: result.message }
      await refresh()
      return { ok: true }
    },
    [refresh]
  )

  const changes = useMemo(() => designChanges(data.live, design), [data.live, design])
  const preview = useMemo(() => {
    const view = designView(design, null)
    return {
      css: `${view.themeStyles}\n${view.customCss}`,
      attributes: view.attributes,
      fontIds: view.fontIds,
    }
  }, [design])

  return {
    design,
    live: data.live,
    published: data.published,
    update,
    changes,
    report,
    refusal,
    saving,
    preview,
    discard,
    publish,
    restore,
  }
}
