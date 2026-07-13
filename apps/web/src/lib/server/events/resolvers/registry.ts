/**
 * Sink resolver registry (EVENTING-V2 §2.4 / WO-2) — replaces the monolithic
 * `getHookTargets()` if-ladder. Each sink kind registers a matcher + a resolver;
 * `resolveTargets` is a dumb loop over them. Sink-owned storage stays sink-owned
 * (the resolvers, added in WO-8, each query their own tables). Adding a new sink
 * category becomes a `registerResolver` call — no edit to a central function.
 *
 * The layer beneath — `HookTarget`, `HookHandler` / `registerHook` / `getHook`,
 * `hook_deliveries`, `safeFetch` — is reused verbatim.
 */
import { logger } from '@/lib/server/logger'
import type { HookTarget } from '../hook-types'
import type { DomainEvent } from '../envelope'

const log = logger.child({ component: 'resolver-registry' })

export interface SinkResolver {
  /** 'webhook' | 'notification' | 'integration' | 'workflow' | 'ai' | 'summary' | 'feedback_pipeline' | ... */
  sink: string
  /** Cheap pre-filter, usually catalogue-derived, to skip whole sinks. */
  interestedIn(type: string): boolean
  /** Sink-owned query over sink-owned storage. */
  resolve(event: DomainEvent): Promise<HookTarget[]>
}

const resolvers: SinkResolver[] = []

export function registerResolver(r: SinkResolver): void {
  resolvers.push(r)
}

/**
 * Resolve every target for an event by fanning it across the interested
 * resolvers concurrently and concatenating their `HookTarget[]`.
 *
 * Default mode is all-or-retry: if any interested sink cannot determine its
 * targets, reject so the relay leaves the event unpublished and retries it —
 * treating a failure as an empty target set would permanently acknowledge an
 * undelivered event. `bestEffort` inverts that for the relay's bounded-retry
 * fallback: a failing resolver is logged and contributes zero targets so the
 * healthy sinks still deliver (used only after the strict path has exhausted
 * its retry budget — see relay.ts).
 */
export async function resolveTargets(
  event: DomainEvent,
  opts: { bestEffort?: boolean } = {}
): Promise<HookTarget[]> {
  const interested = resolvers.filter((r) => r.interestedIn(event.type))
  if (opts.bestEffort) {
    const settled = await Promise.allSettled(interested.map((r) => r.resolve(event)))
    const targets: HookTarget[] = []
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') {
        targets.push(...s.value)
      } else {
        log.error(
          { err: s.reason, sink: interested[i].sink, type: event.type },
          'resolver failed in best-effort fan-out — its targets are dropped for this event'
        )
      }
    })
    return targets
  }
  const resolved = await Promise.all(
    interested.map(async (resolver) => {
      try {
        return await resolver.resolve(event)
      } catch (cause) {
        throw new Error(`Failed to resolve ${resolver.sink} targets`, { cause })
      }
    })
  )
  return resolved.flat()
}

/** Introspection for tests + the "did it fire?" surface. */
export function listResolvers(): readonly SinkResolver[] {
  return resolvers
}

/** Test-only: clear registered resolvers between suites. */
export function __resetResolversForTests(): void {
  resolvers.length = 0
}
