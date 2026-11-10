import type { z } from 'zod'
import { resolveDesign } from './resolve'
import { portalDesign, type PortalDesign } from './schema'
import { withoutRetiredKeys } from './stored-design'

/** Why a design cannot be saved: the code the server refuses it with, the details, and a one-line reason. */
export type DesignCheck =
  | { ok: true; design: PortalDesign }
  | {
      ok: false
      code: 'INVALID_DESIGN' | 'UNREADABLE_DESIGN'
      /** Every problem, as the server reports them. */
      message: string
      /** The first problem in a few plain words, for the line under the control that made it. */
      reason: string
    }

/** What a schema problem asks of the person, in a few words. */
function reasonOf(issue: z.core.$ZodIssue): string {
  if (issue.code === 'too_big') {
    const max = Number(issue.maximum)
    if (issue.origin === 'string') return `Use ${max} characters or fewer`
    if (issue.origin === 'array' || issue.origin === 'set') return `Use ${max} or fewer`
    return `Use ${max} or less`
  }
  if (issue.code === 'too_small') {
    const min = Number(issue.minimum)
    if (issue.origin === 'string')
      return min <= 1 ? 'Can’t be empty' : `Use ${min} characters or more`
    if (issue.origin === 'array' || issue.origin === 'set') return `Add at least ${min}`
    return `Use ${min} or more`
  }
  // A refinement's own words are written for people.
  if (issue.code === 'custom') return issue.message
  return 'That value can’t be used'
}

/**
 * The checks every saved design passes, shared by the server's save and the
 * builder's change: the schema, then the contrast solver. The server adds
 * its own CSS check on top (validate-design.ts).
 */
export function checkDesign(input: unknown): DesignCheck {
  const parsed = portalDesign.safeParse(withoutRetiredKeys(input))
  if (!parsed.success)
    return {
      ok: false,
      code: 'INVALID_DESIGN',
      message: parsed.error.issues.map((i) => i.message).join('; '),
      reason: reasonOf(parsed.error.issues[0]!),
    }
  const { errors } = resolveDesign(parsed.data)
  if (errors.length > 0)
    return {
      ok: false,
      code: 'UNREADABLE_DESIGN',
      message: errors.join('; '),
      reason: 'Text wouldn’t be readable with this',
    }
  return { ok: true, design: parsed.data }
}
