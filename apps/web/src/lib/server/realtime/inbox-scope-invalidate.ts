/**
 * Telling open inbox streams that a teammate's scope changed.
 *
 * Each inbox stream caches its subscriber's view keys and team ids
 * (inbox-scope-gate.ts) and also listens on that subscriber's own scope
 * channel. A write that changes someone's role, a role's keys or someone's
 * team memberships publishes here, after its transaction commits, so the
 * stream reloads at once instead of at the 60 second backstop. Publishing
 * before the commit would let the reload read the old rows.
 *
 * The signal carries no data: it only says "reload". A lost signal costs the
 * backstop, nothing more.
 */
import type { PrincipalId } from '@quackback/ids'
import { publish } from './pubsub'

/** The channel one teammate's inbox stream hears scope changes on. */
export function inboxScopeChannel(principalId: PrincipalId | string): string {
  return `principal:${principalId}`
}

/** Fire-and-forget: ask each principal's open inbox streams to reload their scope. */
export function publishInboxScopeChanged(principalIds: Iterable<PrincipalId | string>): void {
  for (const id of new Set(principalIds)) {
    publish(inboxScopeChannel(id), { kind: 'inbox_scope_changed' })
  }
}
