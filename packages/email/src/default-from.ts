/**
 * Optional override for the platform default From.
 *
 * The package default is `EMAIL_FROM`. A pooled process installs a resolver
 * that reads the active workspace's registry `email.from`. Self-host never
 * installs one, so behaviour stays the env read.
 */
let resolver: (() => string | null | undefined) | null = null

export function setDefaultFromResolver(fn: () => string | null | undefined): void {
  resolver = fn
}

export function resetDefaultFromResolver(): void {
  resolver = null
}

/** The resolver's answer, or null to fall through to EMAIL_FROM. */
export function resolvedDefaultFrom(): string | null {
  const value = resolver?.()
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
