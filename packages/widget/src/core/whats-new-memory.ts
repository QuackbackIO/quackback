import type { WhatsNew } from './whats-new-card'

/**
 * What the host page remembers about the "What's new" card, per instance and
 * per visitor: the entries the visitor answered (dismissed or opened from the
 * card) and the entries the card has already announced. Read state is the
 * frame's alone; this only decides whether the card shows and whether the
 * `whats-new` event fires.
 */

type Entry = WhatsNew['entry']

interface Stored {
  /** The newest publish time the visitor answered: older entries stay hidden
   *  even when a newer one is unpublished. */
  through: string | null
  /** Answered entry ids, for entries without a readable publish time. */
  answered: string[]
  /** Entries the card has announced. */
  announced: string[]
}

/** Bound on each remembered id list. */
const MAX_IDS = 20

export interface WhatsNewMemory {
  isAnswered(scope: string, entry: Entry): boolean
  answer(scope: string, entry: Entry): void
  /** Record an announcement; true only the first time for this entry. */
  announce(scope: string, entryId: string): boolean
  /** Whether this visitor has a record on this device yet. */
  known(scope: string): boolean
  /** Start a record with this entry, and every entry published before it,
   *  counted as announced and answered without showing them: what was
   *  unread before the first visit. */
  learn(scope: string, entry: Entry | null): void
}

const time = (iso: string | null): number => (iso ? new Date(iso).getTime() : NaN)

const keep = (ids: string[], id: string): string[] =>
  [...ids.filter((x) => x !== id), id].slice(-MAX_IDS)

function parse(raw: string | null): Stored {
  const empty: Stored = { through: null, answered: [], announced: [] }
  if (!raw) return empty
  try {
    const v = JSON.parse(raw) as Partial<Stored>
    const ids = (x: unknown) =>
      Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string').slice(-MAX_IDS) : []
    return {
      through: typeof v.through === 'string' && !Number.isNaN(time(v.through)) ? v.through : null,
      answered: ids(v.answered),
      announced: ids(v.announced),
    }
  } catch {
    return empty
  }
}

export function createWhatsNewMemory(origin: string): WhatsNewMemory {
  // Used when the host page blocks storage: remembered for this page load.
  const fallback = new Map<string, Stored>()
  const key = (scope: string) => `quackback:whats-new:${origin}:${scope}`

  const stored = (scope: string): boolean => {
    try {
      if (localStorage.getItem(key(scope)) !== null) return true
    } catch {
      /* storage blocked */
    }
    return fallback.has(scope)
  }
  const read = (scope: string): Stored => {
    try {
      const raw = localStorage.getItem(key(scope))
      if (raw !== null) return parse(raw)
    } catch {
      /* storage blocked */
    }
    return fallback.get(scope) ?? parse(null)
  }
  const write = (scope: string, value: Stored): void => {
    fallback.set(scope, value)
    try {
      localStorage.setItem(key(scope), JSON.stringify(value))
    } catch {
      /* storage blocked: the fallback holds it */
    }
  }

  const answered = (m: Stored, entry: Entry): Stored => {
    const at = time(entry.publishedAt)
    const through = !Number.isNaN(at) && !(at <= time(m.through)) ? entry.publishedAt : m.through
    return { ...m, through, answered: keep(m.answered, entry.id) }
  }

  return {
    isAnswered(scope, entry) {
      const m = read(scope)
      if (m.answered.includes(entry.id)) return true
      const at = time(entry.publishedAt)
      return !Number.isNaN(at) && at <= time(m.through)
    },
    answer(scope, entry) {
      write(scope, answered(read(scope), entry))
    },
    known(scope) {
      return stored(scope)
    },
    learn(scope, entry) {
      const m = read(scope)
      write(scope, entry ? { ...answered(m, entry), announced: keep(m.announced, entry.id) } : m)
    },
    announce(scope, entryId) {
      const m = read(scope)
      if (m.announced.includes(entryId)) return false
      write(scope, { ...m, announced: keep(m.announced, entryId) })
      return true
    },
  }
}
