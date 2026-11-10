/**
 * Optional override for the platform default From.
 *
 * The package default is `EMAIL_FROM`. The app installs a resolver that reads
 * the active workspace's registry `email.from`. With no workspace scope
 * (self-host, and pooled sends outside a scope) the resolver returns null
 * and this falls through to `EMAIL_FROM`.
 */
let resolver: (() => string | null | undefined) | null = null
let shared: (() => boolean) | null = null

export function setDefaultFromResolver(fn: () => string | null | undefined): void {
  resolver = fn
}

/**
 * Tell the package whether this server's `EMAIL_FROM` is a platform's, shared
 * by many workspaces, rather than one install's own. A shared address never
 * speaks for a workspace under the platform's name, even on a send the
 * resolver has no From for.
 */
export function setDefaultFromShared(fn: () => boolean): void {
  shared = fn
}

export function resetDefaultFromResolver(): void {
  resolver = null
  shared = null
}

/**
 * Whether the default From belongs to a platform rather than to this install:
 * the resolver supplied it, or the server said its `EMAIL_FROM` is shared.
 */
export function defaultFromIsShared(): boolean {
  return shared?.() === true || resolvedDefaultFrom() !== null
}

/** The resolver's answer, or null to fall through to EMAIL_FROM. */
export function resolvedDefaultFrom(): string | null {
  const value = resolver?.()
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
