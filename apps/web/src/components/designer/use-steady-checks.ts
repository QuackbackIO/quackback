import { useInsertionEffect, useRef, useState } from 'react'
import type { DesignCheck } from '@/lib/shared/design/checks'

/** What a check shows, which decides whether the list changed. */
const shownKey = (checks: readonly DesignCheck[]) =>
  JSON.stringify(
    checks.map((check) => [check.id, check.text, check.part, check.fix?.label ?? null])
  )

/**
 * The checks, the same list while what they say is the same: the checks run
 * again on every change to the design, but most changes leave them as they
 * were, and the parts that list them need not draw again. A fix still makes
 * the change the latest checks would make, whichever list it came from.
 */
export function useSteadyChecks(checks: readonly DesignCheck[]): readonly DesignCheck[] {
  const latest = useRef(checks)
  useInsertionEffect(() => {
    latest.current = checks
  })
  const key = shownKey(checks)
  // Only the words decide; the fixes reach the latest checks through `latest`.
  const [held, setHeld] = useState(() => ({ key, checks: steady(checks, () => latest.current) }))
  if (held.key === key) return held.checks
  const next = { key, checks: steady(checks, () => latest.current) }
  setHeld(next)
  return next.checks
}

/** The checks with each fix made by the check of its id in `current()`, as it is when the fix runs. */
export function steady(
  checks: readonly DesignCheck[],
  current: () => readonly DesignCheck[]
): readonly DesignCheck[] {
  return checks.map((check) => {
    const fix = check.fix
    if (!fix) return check
    return {
      ...check,
      fix: {
        label: fix.label,
        apply: (design) =>
          (current().find((each) => each.id === check.id)?.fix ?? fix).apply(design),
      },
    }
  })
}
