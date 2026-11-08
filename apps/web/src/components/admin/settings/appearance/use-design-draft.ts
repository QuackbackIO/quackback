import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useStore } from 'zustand'
import { portalDesignQueries } from '@/lib/client/queries/portal-design'
import {
  discardPortalDesignDraftFn,
  publishPortalDesignFn,
  restorePortalDesignVersionFn,
  savePortalDesignDraftFn,
} from '@/lib/server/functions/portal-design'
import { designChanges } from '@/lib/shared/design/diff'
import { checkDesign } from '@/lib/shared/design/check-design'
import { changeLabel } from '@/lib/shared/design/labels'
import { designView } from '@/lib/shared/design/design-view'
import { createHistory, patchesBetween, type Author } from '@/lib/shared/design/history'
import { releaseOverrides } from '@/lib/shared/design/overrides'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { PortalDesignRevisionId } from '@quackback/ids'
import type { DraftLastChange } from '@/lib/server/domains/design/draft-last-change'
import type { PortalAddress } from '@/lib/shared/design/portal-address'

/** How long the draft waits after a change before it saves. */
export const DRAFT_SAVE_DELAY_MS = 600

/** Changes this close together, such as typing, undo as one step. */
export const UNDO_MERGE_MS = 1000

/** How many steps undo remembers. */
const UNDO_LIMIT = 100

type Outcome = { ok: true } | { ok: false; message: string }
/** A change's outcome: committed, or refused before it reached the draft, with why in a line. */
export type ChangeOutcome = { ok: true } | { ok: false; reason: string }
/** A publish's outcome: where the portal is now live. */
type PublishOutcome = { ok: true; address?: PortalAddress } | { ok: false; message: string }

/**
 * The Appearance draft: the design being edited, saved to the server shortly
 * after each change, so leaving the page loses nothing. What the draft
 * changes is measured against what visitors see now.
 *
 * Each save names the draft revision it was made against, and saves run one
 * at a time. When someone else changed the draft in between, the save is
 * refused and nothing more saves until the person chooses to load the other
 * changes or keep their own.
 *
 * A change runs the checks the server's save runs before it is committed, so
 * a state the server would refuse never reaches the draft; the caller gets
 * the reason in a line to show under its control. Should the server still
 * refuse a save, that same document is never sent again, publishing waits,
 * and the person can go back to the last saved draft in one step.
 */
export function useDesignDraft() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { data } = useSuspenseQuery(portalDesignQueries.editor())
  const [design, setDesign] = useState<PortalDesign>(data.design)
  const [report, setReport] = useState(data.report)
  const [saving, setSaving] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  // Who changed the draft under this person, and when, while a conflict is open.
  const [conflictChange, setConflictChange] = useState<DraftLastChange | null>(null)
  // A save that could not reach the server; it is tried again until it does.
  const [failed, setFailed] = useState(false)
  const retry = useRef<{ timer: ReturnType<typeof setTimeout> | null; wait: number }>({
    timer: null,
    wait: 1000,
  })
  const latest = useRef(design)
  // The last document the server saved, which going back after a refusal returns to.
  const accepted = useRef(data.design)
  // The document the server last refused, as sent, and why; it is never sent again.
  const refused = useRef<{ doc: string; message: string } | null>(null)
  // The last document known to pass the checks, so each change checks only what it makes.
  const passed = useRef<PortalDesign | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Undo and redo: each change as labelled patches, a burst of the same change as one step.
  const [history] = useState(() => createHistory({ limit: UNDO_LIMIT, mergeMs: UNDO_MERGE_MS }))
  const undoLabel = useStore(history, (state) => state.past.at(-1)?.label ?? null)
  const redoLabel = useStore(history, (state) => state.future.at(-1)?.label ?? null)
  const forget = useCallback(() => history.getState().clear(), [history])

  // The draft revision the next save is made against, and whether saving waits on a choice.
  const revision = useRef(data.revision)
  const blocked = useRef(false)

  // The save under way, so a reader on the server can wait for it; each waits for the one before.
  // A step that fails never breaks the chain: the next save still runs.
  const inflight = useRef<Promise<void>>(Promise.resolve())
  const save = useCallback((next: PortalDesign): Promise<void> => {
    const run = inflight.current.then(async () => {
      if (blocked.current) return
      const sent = refused.current ? JSON.stringify(next) : null
      if (refused.current && sent === refused.current.doc) return
      setSaving(true)
      try {
        const result = await savePortalDesignDraftFn({
          data: { design: next, revision: revision.current },
        })
        setFailed(false)
        retry.current.wait = 1000
        if (result.ok) {
          revision.current = result.revision
          accepted.current = next
          refused.current = null
          setReport(result.report)
          setRefusal(null)
        } else if (result.code === 'REVISION_MISMATCH') {
          blocked.current = true
          setConflict(true)
          setConflictChange(result.lastChange ?? null)
        } else {
          refused.current = { doc: sent ?? JSON.stringify(next), message: result.message }
          setRefusal(result.message)
        }
      } catch {
        // Unreachable for now, such as offline: try again, waiting longer each time.
        setFailed(true)
        if (retry.current.timer) clearTimeout(retry.current.timer)
        const wait = retry.current.wait
        retry.current.wait = Math.min(wait * 2, 30_000)
        retry.current.timer = setTimeout(() => {
          retry.current.timer = null
          void save(latest.current)
        }, wait)
      } finally {
        setSaving(false)
      }
    })
    inflight.current = run.catch(() => {})
    return inflight.current
  }, [])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (retry.current.timer) clearTimeout(retry.current.timer)
    },
    []
  )

  // Leaving with a change not yet saved asks first.
  const unsaved = useRef(false)
  unsaved.current = saving || failed || conflict
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!timer.current && !unsaved.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  /** Shows a design and saves it after a short pause. */
  const commit = useCallback(
    (next: PortalDesign) => {
      latest.current = next
      setDesign(next)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        void save(latest.current)
      }, DRAFT_SAVE_DELAY_MS)
    },
    [save]
  )

  /**
   * Changes the draft; it saves after a short pause, and undo can take it back,
   * named for what changed unless a name is given.
   */
  const update = useCallback(
    (change: (draft: PortalDesign) => void, label?: string, by?: Author): ChangeOutcome => {
      // A plain copy, not a proxy: the builder's changes may copy parts of what they are handed.
      const before = latest.current
      const next = structuredClone(before)
      change(next)
      // A choice picked again counts: the exact value it competes with goes, in the same step.
      releaseOverrides(before, next)
      // What the server would refuse is never committed, unless the draft already fails without it.
      const checked = checkDesign(next)
      if (checked.ok) passed.current = next
      else if (passed.current === before || checkDesign(before).ok) {
        passed.current = before
        return { ok: false, reason: checked.reason }
      }
      const [patches, inverse] = patchesBetween(before, next)
      history.getState().push(label ?? nameOfChange(before, next), patches, inverse, undefined, by)
      commit(next)
      return { ok: true }
    },
    [commit, history]
  )

  /**
   * Shows a whole design the builder made, such as a revision the brand
   * match's check tries, as a step under the label, and saves it. Its exact
   * values stay as they are: nothing is released, unlike a change picked.
   */
  const replace = useCallback(
    (next: PortalDesign, label?: string, by?: Author) => {
      const [patches, inverse] = patchesBetween(latest.current, next)
      if (!patches.length) return
      const name = label ?? nameOfChange(latest.current, next)
      history.getState().push(name, patches, inverse, undefined, by)
      commit(next)
    },
    [commit, history]
  )

  /** After a refused save: back to the draft the server last saved, as an undo step, and saved. */
  const recover = useCallback(() => {
    refused.current = null
    setRefusal(null)
    replace(accepted.current, 'Back to last saved')
  }, [replace])

  /** Takes back the last change, whoever made it. */
  const undo = useCallback(() => {
    const back = history.getState().undo(latest.current)
    if (back) commit(back.doc)
  }, [commit, history])

  /** Puts back the last change undo took back. */
  const redo = useCallback(() => {
    const again = history.getState().redo(latest.current)
    if (again) commit(again.doc)
  }, [commit, history])

  /**
   * Makes the changes until `end` one step, under one label, such as a drag
   * or an AI reply. Groups nest; the outermost names the step. The AI's
   * group says so, so a change made by hand meanwhile is a step of its own.
   */
  const begin = useCallback(
    (label: string, by?: Author) => history.getState().begin(label, by),
    [history]
  )
  const end = useCallback((by?: Author) => history.getState().end(by), [history])

  /** Saves a change still waiting on its pause, or waits for the save under way. */
  const flush = useCallback(async () => {
    if (!timer.current) return inflight.current
    clearTimeout(timer.current)
    timer.current = null
    await save(latest.current)
  }, [save])

  /** The editor as the server has it now, with the draft revision it is at. */
  const fetchEditor = useCallback(
    () => queryClient.fetchQuery({ ...portalDesignQueries.editor(), staleTime: 0 }),
    [queryClient]
  )

  /**
   * Takes a design the server already saved as the draft, such as Quackback
   * AI's, at the revision that save returned; the next save is made against it.
   */
  const adopt = useCallback(
    (next: PortalDesign, nextReport?: typeof report, label?: string, nextRevision?: string) => {
      // A step of its own, never merged into the one before, named for what it changed.
      const [patches, inverse] = patchesBetween(latest.current, next)
      const name = label ?? nameOfChange(latest.current, next)
      // Quackback AI's, so a change made by hand meanwhile never joins its step.
      history.getState().begin(name, 'ai')
      history.getState().push(name, patches, inverse, undefined, 'ai')
      history.getState().end('ai')
      latest.current = next
      // The server saved it already.
      accepted.current = next
      refused.current = null
      setRefusal(null)
      setDesign(next)
      if (nextReport) setReport(nextReport)
      if (nextRevision) revision.current = nextRevision
      else
        inflight.current = inflight.current
          .then(async () => {
            revision.current = (await fetchEditor()).revision
          })
          .catch(() => {})
    },
    [fetchEditor, history]
  )

  /** Reads what visitors see again after a change made outside the draft, such as a new logo. */
  const refreshLive = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: portalDesignQueries.editor().queryKey })
    await router.invalidate()
  }, [queryClient, router])

  /** Reloads the editor and the root settings after the live design moved. */
  const refresh = useCallback(async () => {
    // A change waiting to save would save the old draft over the fresh one.
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const fresh = await fetchEditor()
    latest.current = fresh.design
    accepted.current = fresh.design
    refused.current = null
    revision.current = fresh.revision
    blocked.current = false
    forget()
    setConflict(false)
    setConflictChange(null)
    setDesign(fresh.design)
    setReport(fresh.report)
    setRefusal(null)
    void queryClient.invalidateQueries({ queryKey: portalDesignQueries.versions().queryKey })
    void router.invalidate()
  }, [fetchEditor, forget, queryClient, router])

  /** After a conflict: replaces this draft with the one someone else saved. */
  const loadTheirs = useCallback(() => refresh(), [refresh])

  /** After a conflict: saves this draft over the one someone else saved. */
  const keepMine = useCallback(async () => {
    revision.current = (await fetchEditor()).revision
    blocked.current = false
    setConflict(false)
    setConflictChange(null)
    await save(latest.current)
  }, [fetchEditor, save])

  /** Discards the draft; undo brings it back as the draft. */
  const discard = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    await inflight.current
    const before = latest.current
    await discardPortalDesignDraftFn()
    await refresh()
    const [patches, inverse] = patchesBetween(before, latest.current)
    history.getState().clear([{ label: 'Discard draft', patches, inversePatches: inverse }])
  }, [refresh, history])

  /** Publishes the draft as reviewed: a draft that moved since, or one in conflict, is refused. */
  const publish = useCallback(
    async (
      message?: string,
      options: { workspaceLogo?: boolean } = {}
    ): Promise<PublishOutcome> => {
      await flush()
      if (blocked.current)
        return { ok: false, message: 'Choose whose changes to keep first, then publish.' }
      if (refused.current) return { ok: false, message: refused.current.message }
      const result = await publishPortalDesignFn({
        data: {
          message,
          revision: revision.current,
          workspaceLogo: options.workspaceLogo === true,
        },
      })
      if (!result.ok)
        return {
          ok: false,
          message:
            result.code === 'REVISION_MISMATCH'
              ? 'The draft changed while you reviewed it. Review it again, then publish.'
              : result.message,
        }
      await refresh()
      return { ok: true, address: result.address }
    },
    [refresh, flush]
  )

  const restore = useCallback(
    async (revisionId: PortalDesignRevisionId): Promise<Outcome> => {
      await flush()
      const result = await restorePortalDesignVersionFn({ data: { revisionId } })
      if (!result.ok) return { ok: false, message: result.message }
      await refresh()
      return { ok: true }
    },
    [refresh, flush]
  )

  const changes = useMemo(() => designChanges(data.live, design), [data.live, design])
  // The preview follows a step behind fast typing, so drawing it never holds up a keystroke.
  const shownDesign = useDeferredValue(design)
  const preview = useMemo(() => designPreview(shownDesign), [shownDesign])

  // The same object while nothing in it changes, so what reads the draft renders only when it does.
  return useMemo(
    () => ({
      design,
      live: data.live,
      published: data.published,
      /** Whether this person may publish, or only edit the draft. */
      canPublish: data.canPublish,
      update,
      replace,
      flush,
      adopt,
      refreshLive,
      changes,
      report,
      refusal,
      recover,
      conflict,
      /** Who changed the draft and when, while a conflict is open, if known. */
      conflictChange,
      /** A save could not reach the server and is being tried again. */
      failed,
      loadTheirs,
      keepMine,
      undo,
      redo,
      begin,
      end,
      /** What undo and redo would take back or put back, or null when there is nothing. */
      undoLabel,
      redoLabel,
      saving,
      preview,
      discard,
      publish,
      restore,
    }),
    [
      design,
      data.live,
      data.published,
      data.canPublish,
      update,
      replace,
      flush,
      adopt,
      refreshLive,
      changes,
      report,
      refusal,
      recover,
      conflict,
      conflictChange,
      failed,
      loadTheirs,
      keepMine,
      undo,
      redo,
      begin,
      end,
      undoLabel,
      redoLabel,
      saving,
      preview,
      discard,
      publish,
      restore,
    ]
  )
}

/** A change named for what it changed, such as "Brand colour", or by its first part when it changed several. */
export function nameOfChange(before: PortalDesign, after: PortalDesign): string {
  const changed = [
    ...new Set(designChanges(before, after).map((change) => changeLabel(change.path))),
  ]
  if (!changed.length) return 'Change'
  return changed.length === 1 ? changed[0]! : `${changed[0]} and ${changed.length - 1} more`
}

/** A design as the preview frame takes it, resolved with the code the server uses. */
export function designPreview(design: PortalDesign) {
  const view = designView(design, null)
  return {
    css: `${view.themeStyles}\n${view.customCss}`,
    attributes: view.attributes,
    fontIds: view.fontIds,
    headline: view.feedback.headline,
    home: view.home,
    titles: view.titles,
    nav: view.nav,
    copy: view.feedback.copy,
    logo: view.logo,
    statusColours: view.statusColours,
    bandImage: view.bandImage,
  }
}
