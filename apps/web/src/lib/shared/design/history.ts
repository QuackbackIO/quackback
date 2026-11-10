/**
 * The builder's history: every change as a labelled step of patches, so undo
 * and redo replay exactly what changed. A quick burst of the same change,
 * such as typing, merges into one step; a group, such as a drag or an AI
 * reply, is one step however many changes it makes. A change made by hand
 * while the AI works is never part of the AI's step: the AI's step so far
 * closes, the hand's change is a step of its own, and what the AI changes
 * after it is one more step under the AI's name. Only so many steps are kept.
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

/** Who made a change: a person in the builder, or Quackback AI. */
export type Author = 'person' | 'ai'

interface Group {
  label: string
  depth: number
  patches: Patch[]
  inversePatches: Patch[]
  by: Author
}

export interface HistoryState {
  past: HistoryStep[]
  future: HistoryStep[]
  /** A group still open, whose changes become one step when it ends. */
  group: Group | null
  /** A person's group, such as a drag, opened while the AI's is open: a step of its own. */
  side: Group | null
  /** The last step pushed, and when, to merge a burst of the same change. */
  last: { label: string; at: number } | null
  /** Records a change, a person's unless said; one that changed nothing is not a step. */
  push: (label: string, patches: Patch[], inversePatches: Patch[], at?: number, by?: Author) => void
  /** Opens a group; groups nest, and the outermost names the step. */
  begin: (label: string, by?: Author) => void
  /** Closes a group, recording it as one step once the outermost ends. */
  end: (by?: Author) => void
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
    const stepOf = (group: Group): HistoryStep => ({
      label: group.label,
      patches: group.patches,
      inversePatches: group.inversePatches,
    })
    const joined = (group: Group, patches: Patch[], inversePatches: Patch[]): Group => ({
      ...group,
      patches: [...group.patches, ...patches],
      inversePatches: [...inversePatches, ...group.inversePatches],
    })
    /** Records what the AI's open group holds so far as its own step; the group stays open. */
    const cut = () => {
      const { group } = get()
      if (!group?.patches.length) return
      set({ group: { ...group, patches: [], inversePatches: [] } })
      record(stepOf(group), null)
    }
    /** Whether a change is a person's made while the AI's group is open. */
    const byHandDuringAi = (by: Author) => get().group?.by === 'ai' && by !== 'ai'
    /** Closes any open group at once, as undo and redo need a settled history. */
    const settle = () => {
      const { group, side } = get()
      if (!group && !side) return
      set({ group: null, side: null })
      for (const open of [group, side]) if (open?.patches.length) record(stepOf(open), null)
    }
    return {
      past: [],
      future: [],
      group: null,
      side: null,
      last: null,
      push: (label, patches, inversePatches, at = Date.now(), by = 'person') => {
        if (!patches.length) return
        const { group, side } = get()
        // A person's group opened while the AI worked holds their changes until it ends.
        if (by !== 'ai' && side) return set({ side: joined(side, patches, inversePatches) })
        if (byHandDuringAi(by)) {
          cut()
          return record({ label, patches, inversePatches }, at)
        }
        if (group) return set({ group: joined(group, patches, inversePatches) })
        record({ label, patches, inversePatches }, at)
      },
      begin: (label, by = 'person') => {
        const { group, side } = get()
        if (by !== 'ai' && side) return set({ side: { ...side, depth: side.depth + 1 } })
        if (byHandDuringAi(by)) {
          cut()
          return set({ side: { label, depth: 1, patches: [], inversePatches: [], by } })
        }
        set({
          group: group
            ? { ...group, depth: group.depth + 1 }
            : { label, depth: 1, patches: [], inversePatches: [], by },
        })
      },
      end: (by = 'person') => {
        const { group, side } = get()
        if (by !== 'ai' && side) {
          if (side.depth > 1) return set({ side: { ...side, depth: side.depth - 1 } })
          set({ side: null })
          if (side.patches.length) record(stepOf(side), null)
          return
        }
        if (!group) return
        if (group.depth > 1) return set({ group: { ...group, depth: group.depth - 1 } })
        set({ group: null })
        if (group.patches.length) record(stepOf(group), null)
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
      undoLabel: () => undoLabelOf(get()),
      redoLabel: () => get().future.at(-1)?.label ?? null,
      clear: (past = []) => set({ past, future: [], group: null, side: null, last: null }),
    }
  })
}

export type HistoryStore = ReturnType<typeof createHistory>

/**
 * What undo takes back, by its label: undo closes an open group first, the
 * AI's and then any person's group made meanwhile, so the last of those
 * with changes is the step it takes back; else the last step.
 */
export function undoLabelOf(state: Pick<HistoryState, 'past' | 'group' | 'side'>): string | null {
  for (const open of [state.side, state.group]) if (open?.patches.length) return open.label
  return state.past.at(-1)?.label ?? null
}
