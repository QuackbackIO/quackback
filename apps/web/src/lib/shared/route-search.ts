/**
 * Blank leftover keys Zod omitted so TanStack cannot merge them back.
 *
 * TanStack Router builds match search as `{...parentSearch, ...validated}`.
 * A Zod object drops unknown or invalid fields instead of returning them as
 * `undefined`, so a portal leftover (`sort=trending`, `board` as a slug)
 * would otherwise survive a successful parse.
 */
export function blankOmittedSearchKeys<T extends object>(
  raw: Record<string, unknown>,
  parsed: T
): T {
  const out = { ...(parsed as Record<string, unknown>) }
  for (const key of Object.keys(raw)) {
    if (!(key in parsed)) out[key] = undefined
  }
  return out as T
}
