import { createContext, useContext } from 'react'

/**
 * What a visitor typed into the feed while it loaded. The loading state and
 * the loaded feed are different trees, so the swap between them would drop
 * it: the loading state leaves it here as it unmounts and the loaded feed
 * takes it as it mounts.
 *
 * Each feed gets its own handoff, created above its Suspense boundary, so
 * input left by a feed the visitor navigated away from goes with that feed
 * and never reaches the next one. Anything not taken within a moment is stale
 * too and is dropped.
 */
interface FeedInput {
  /** The composer's title; empty when the visitor only clicked into it. */
  composeTitle?: string
  /** A search not yet applied when the loading state went. */
  search?: string
}

export interface FeedHandoff {
  handOff(input: FeedInput): void
  take<K extends keyof FeedInput>(key: K): FeedInput[K]
}

const FRESH_MS = 2000

export function createFeedHandoff(): FeedHandoff {
  let pending: (FeedInput & { at: number }) | null = null

  /** The pending input, or null once it has gone stale (dropping it then). */
  function fresh(): (FeedInput & { at: number }) | null {
    if (pending && Date.now() - pending.at > FRESH_MS) pending = null
    return pending
  }

  return {
    handOff(input) {
      // Stale input is dropped first, so new input cannot renew its timestamp.
      pending = { ...fresh(), ...input, at: Date.now() }
    },
    take(key) {
      const current = fresh()
      if (!current) return undefined
      const value = current[key]
      delete current[key]
      return value
    },
  }
}

/** Arrivals whose title a feed has opened, so a feed that mounts again leaves it. */
const openedArrivals = new WeakSet<object>()

/**
 * The title Home's Share an idea sends in the history state of its navigation
 * to the feed, the first time a feed asks for that arrival.
 */
export function takeArrivedTitle(state: unknown): string | undefined {
  if (!state || typeof state !== 'object' || openedArrivals.has(state)) return undefined
  const title = (state as { composeTitle?: unknown }).composeTitle
  if (typeof title !== 'string') return undefined
  openedArrivals.add(state)
  return title
}

export const FeedHandoffContext = createContext<FeedHandoff | null>(null)

/** This feed's handoff; null outside a portal feed, where nothing is carried. */
export function useFeedHandoff(): FeedHandoff | null {
  return useContext(FeedHandoffContext)
}
