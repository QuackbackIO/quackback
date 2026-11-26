/**
 * What the host page remembers about the reply preview, per instance and per
 * visitor: the replies the visitor answered (dismissed, or opened from the
 * card) and the replies the `message` event has already reported. Read state
 * is the frame's alone; this only decides whether the card shows and whether
 * the event fires.
 */

interface Stored {
  /** Reply ids the visitor dismissed or opened from the card. */
  answered: string[]
  /** Reply ids the `message` event has reported. */
  announced: string[]
}

/** Bound on each remembered id list. */
const MAX_IDS = 50

export interface ReplyPreviewMemory {
  isAnswered(scope: string, messageId: string): boolean
  answer(scope: string, messageIds: string[]): void
  /** Record a report; true only the first time for this reply. */
  announce(scope: string, messageId: string): boolean
  /** Whether this visitor has a record on this device yet. */
  known(scope: string): boolean
  /** Start a record with these replies counted as reported, without
   *  reporting them: what was unread before the first visit. */
  learn(scope: string, messageIds: string[]): void
}

const keep = (ids: string[], add: string[]): string[] =>
  [...ids.filter((x) => !add.includes(x)), ...add].slice(-MAX_IDS)

function parse(raw: string | null): Stored {
  const empty: Stored = { answered: [], announced: [] }
  if (!raw) return empty
  try {
    const v = JSON.parse(raw) as Partial<Stored>
    const ids = (x: unknown) =>
      Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string').slice(-MAX_IDS) : []
    return { answered: ids(v.answered), announced: ids(v.announced) }
  } catch {
    return empty
  }
}

/** The storage key prefix for one instance, for a `storage` event to match. */
export const replyPreviewKeyPrefix = (origin: string) => `quackback:reply-preview:${origin}:`

export function createReplyPreviewMemory(origin: string): ReplyPreviewMemory {
  // Used when the host page blocks storage: remembered for this page load.
  const fallback = new Map<string, Stored>()
  const key = (scope: string) => `${replyPreviewKeyPrefix(origin)}${scope}`

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

  return {
    isAnswered(scope, messageId) {
      return read(scope).answered.includes(messageId)
    },
    answer(scope, messageIds) {
      const m = read(scope)
      write(scope, { ...m, answered: keep(m.answered, messageIds) })
    },
    known(scope) {
      return stored(scope)
    },
    learn(scope, messageIds) {
      const m = read(scope)
      write(scope, { ...m, announced: keep(m.announced, messageIds) })
    },
    announce(scope, messageId) {
      const m = read(scope)
      if (m.announced.includes(messageId)) return false
      write(scope, { ...m, announced: keep(m.announced, [messageId]) })
      return true
    },
  }
}
