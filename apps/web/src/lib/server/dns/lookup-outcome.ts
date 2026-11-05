/**
 * Reading a failed DNS lookup: an answer that nothing is published at the
 * name, or no answer at all.
 *
 * The difference decides whether a check may take something away. A name that
 * answers with nothing is the zone's own word that a record is gone; a
 * nameserver that timed out, failed or refused has said nothing about the
 * record, and the next lookup may well find it where it was.
 *
 * A module of its own, apart from the resolver, so a test that replaces the
 * resolver still reads failures the way production does.
 */

/** Lookup failures that mean "nothing is published here", not "we could not ask". */
const NO_ANSWER = new Set(['ENODATA', 'ENOTFOUND', 'NOTFOUND', 'ENONAME'])

/**
 * Whether a lookup failure is the zone answering that the name holds nothing
 * (no such name, or no records of the type asked). Anything else, including a
 * failure with no code, is a lookup that went unanswered.
 */
export function isNoAnswer(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' && NO_ANSWER.has(code)
}
