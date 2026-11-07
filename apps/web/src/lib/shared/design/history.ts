/**
 * The builder's history: every change as a labelled step of patches, so undo
 * and redo replay exactly what changed. A quick burst of the same change,
 * such as typing, merges into one step; a group, such as a drag or an AI
 * reply, is one step however many changes it makes. Only so many steps are
 * kept.
 */
import { createStore } from 'zustand/vanilla'
import { enablePatches, Immer, type Draft, type Patch } from 'immer'

enablePatches()
// Its own instance: the builder's drafts stay open to change, whatever else uses immer.
const immer = new Immer({ autoFreeze: false })

export type { Patch }

/** One step: what it is called, the patches that make it and those that take it back. */
export interface HistoryStep {
  label: string
  patches: Patch[]
  inversePatches: Patch[]
}

/** How many steps are kept unless told otherwise. */
export const HISTORY_LIMIT = 100

/**
 * The next document after a change, with its patches and the patches that
 * take it back. What the recipe returns is ignored, so a helper that returns
 * a value never stands in for the document.
 */
export function change<T>(doc: T, recipe: (draft: Draft<T>) => unknown): [T, Patch[], Patch[]] {
  return immer.produceWithPatches(doc, (draft: Draft<T>) => {
    recipe(draft)
  }) as [T, Patch[], Patch[]]
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Makes a draft equal to a target, touching only what differs. */
function reconcile(draft: Record<string, unknown> | unknown[], target: typeof draft): void {
  const into = draft as Record<string, unknown>
  const from = target as Record<string, unknown>
  if (!Array.isArray(draft))
    for (const key of Object.keys(into)) if (!(key in from)) delete into[key]
  for (const key of Object.keys(from)) {
    const was = into[key]
    const now = from[key]
    if (Object.is(was, now)) continue
    const bothLists = Array.isArray(was) && Array.isArray(now) && was.length === now.length
    if (bothLists || (isPlain(was) && isPlain(now))) reconcile(was as never, now as never)
    else into[key] = now
  }
}

/** The patches between two whole documents, such as a design an AI reply saved, and their inverse. */
export function patchesBetween<T extends object>(before: T, after: T): [Patch[], Patch[]] {
  const [, patches, inverse] = change(before, (draft) =>
    reconcile(draft as never, after as unknown as Record<string, unknown>)
  )
  return [patches, inverse]
}

const apply = <T>(doc: T, patches: Patch[]): T => immer.applyPatches(doc as object, patches) as T

interface Group {
  label: string
  depth: number
  patches: Patch[]
  inversePatches: Patch[]
}

export interface HistoryState {
  past: HistoryStep[]
  future: HistoryStep[]
  /** A group still open, whose changes become one step when it ends. */
  group: Group | null
  /** The last step pushed, and when, to merge a burst of the same change. */
  last: { label: string; at: number } | null
  /** Records a change; one that changed nothing is not a step. */
  push: (label: string, patches: Patch[], inversePatches: Patch[], at?: number) => void
  /** Opens a group; groups nest, and the outermost names the step. */
  begin: (label: string) => void
  /** Closes a group, recording it as one step once the outermost ends. */
  end: () => void
  /** Takes back the last step from a document, or null with nothing to undo. */
  undo: <T>(doc: T) => { doc: T; label: string } | null
  /** Puts back the last step undone, or null with nothing to redo. */
  redo: <T>(doc: T) => { doc: T; label: string } | null
  undoLabel: () => string | null
  redoLabel: () => string | null
  /** Forgets every step, or starts again from the steps given. */
  clear: (past?: HistoryStep[]) => void
}

/** A history store, merging the same change within `mergeMs` and keeping `limit` steps. */
export function createHistory({
  limit = HISTORY_LIMIT,
  mergeMs = 0,
}: { limit?: number; mergeMs?: number } = {}) {
  return createStore<HistoryState>()((set, get) => {
    /** Adds a step; one made by hand merges into a quick run of the same change. */
    const record = (step: HistoryStep, at: number | null) => {
      const { past, last } = get()
      const top = past.at(-1)
      const merge =
        at !== null && mergeMs > 0 && top && last?.label === step.label && at - last.at < mergeMs
      const next = merge
        ? [
            ...past.slice(0, -1),
            {
              label: step.label,
              patches: [...top.patches, ...step.patches],
              inversePatches: [...step.inversePatches, ...top.inversePatches],
            },
          ]
        : [...past, step]
      set({
        past: next.slice(-limit),
        future: [],
        last: at === null ? null : { label: step.label, at },
      })
    }
    /** Closes any open group at once, as undo and redo need a settled history. */
    const settle = () => {
      const { group } = get()
      if (!group) return
      set({ group: null })
      if (group.patches.length)
        record(
          { label: group.label, patches: group.patches, inversePatches: group.inversePatches },
          null
        )
    }
    return {
      past: [],
      future: [],
      group: null,
      last: null,
      push: (label, patches, inversePatches, at = Date.now()) => {
        if (!patches.length) return
        const { group } = get()
        if (group)
          return set({
            group: {
              ...group,
              patches: [...group.patches, ...patches],
              inversePatches: [...inversePatches, ...group.inversePatches],
            },
          })
        record({ label, patches, inversePatches }, at)
      },
      begin: (label) => {
        const { group } = get()
        set({
          group: group
            ? { ...group, depth: group.depth + 1 }
            : { label, depth: 1, patches: [], inversePatches: [] },
        })
      },
      end: () => {
        const { group } = get()
        if (!group) return
        if (group.depth > 1) return set({ group: { ...group, depth: group.depth - 1 } })
        settle()
      },
      undo: (doc) => {
        settle()
        const step = get().past.at(-1)
        if (!step) return null
        set(({ past, future }) => ({
          past: past.slice(0, -1),
          future: [...future, step],
          last: null,
        }))
        return { doc: apply(doc, step.inversePatches), label: step.label }
      },
      redo: (doc) => {
        settle()
        const step = get().future.at(-1)
        if (!step) return null
        set(({ past, future }) => ({
          past: [...past, step],
          future: future.slice(0, -1),
          last: null,
        }))
        return { doc: apply(doc, step.patches), label: step.label }
      },
      undoLabel: () => get().past.at(-1)?.label ?? null,
      redoLabel: () => get().future.at(-1)?.label ?? null,
      clear: (past = []) => set({ past, future: [], group: null, last: null }),
    }
  })
}

export type HistoryStore = ReturnType<typeof createHistory>
