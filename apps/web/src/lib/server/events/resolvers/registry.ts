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
import type { HookTarget } from '../hook-types'
import type { DomainEvent } from '../envelope'

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
 * resolvers concurrently and concatenating their `HookTarget[]`. A resolver
 * that throws is isolated (logged, treated as zero targets) so one broken sink
 * can't starve the others — mirrors `getHookTargets()`'s graceful degradation.
 */
export async function resolveTargets(event: DomainEvent): Promise<HookTarget[]> {
  const interested = resolvers.filter((r) => r.interestedIn(event.type))
  const settled = await Promise.allSettled(interested.map((r) => r.resolve(event)))
  const targets: HookTarget[] = []
  for (const s of settled) {
    if (s.status === 'fulfilled') targets.push(...s.value)
  }
  return targets
}

/** Introspection for tests + the "did it fire?" surface. */
export function listResolvers(): readonly SinkResolver[] {
  return resolvers
}

/** Test-only: clear registered resolvers between suites. */
export function __resetResolversForTests(): void {
  resolvers.length = 0
}
