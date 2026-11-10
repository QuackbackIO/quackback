/**
 * What Ask AI says back for one call, said only of what happened: the
 * model's reply where every operation applied, else built from what did,
 * and the server's own words where nothing did. Also the notes beside it.
 */
import { plainReasons } from '@/lib/shared/design/colour-names'
import { oneSentence, type AiReach } from '@/lib/shared/design/ai-reach'
import type { FlatOp, OpsOutcome } from '@/lib/shared/design/design-ops'
import { resolveDesign } from '@/lib/shared/design/resolve'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { OpsAnswer } from './design-ai-guide'
import { languageName } from './design-ai-view'

const opKey = (op: FlatOp) => JSON.stringify([op.op, op.target ?? '', op.key ?? '', op.value ?? ''])

/**
 * The reply, said only of what happened, in one sentence. The model writes
 * its reply before its operations are checked, so when any did not apply
 * the reply is built from the ones that did, by their labels, and when none
 * did the server says why: a reply never claims a change the draft does not
 * have. What was left alone, and why, is said under Show changes.
 */
export function honestReply(
  answer: OpsAnswer,
  result: OpsOutcome,
  outOfScope: boolean,
  /** What was picked, such as "the hero". */
  where: string,
  /** How far the request could reach, when narrower than everywhere the pick is. */
  reach: AiReach | undefined,
  /** Whether the request is in English, which the server's own words are. */
  english = true
): { reply: string; notes: string[] } {
  const { done, refused, already } = result
  // In another language, the model's own line, in the person's words, where it can be
  // true: some of it applied, or the model itself said the request was outside.
  const own = !english && answer.reply.trim() ? oneSentence(answer.reply) : null
  const why = plainReasons(refused.map((each) => each.reason))
  const narrowed = reach === 'page' ? 'this page' : reach === 'one' ? 'this one' : null
  const leftOut = result.outOfScope.length > 0
  if (done.length === 0 && (outOfScope || (leftOut && !narrowed)))
    return {
      reply: own && answer.outOfScope ? own : `That is outside ${where}, so nothing changed.`,
      notes: [],
    }
  if (done.length === 0 && leftOut)
    return { reply: `That reaches beyond ${narrowed}, so nothing changed.`, notes: [] }
  if (done.length === 0 && refused.length > 0)
    return {
      reply: why ? `Nothing changed: ${why}.` : 'Nothing changed: I could not do that here.',
      notes: [],
    }
  if (done.length === 0 && already.length > 0)
    return { reply: 'Nothing changed: it is already like that.', notes: [] }
  const applied = new Set(done.map((each) => opKey(each.op)))
  const said = answer.ops.every((each) => applied.has(opKey(each)))
    ? oneSentence(answer.reply)
    : own
      ? own
      : `I changed ${done
          .map((each) => {
            const says = answer.ops.find((op) => opKey(op) === opKey(each.op))?.says?.trim()
            const words = says || each.label
            return `${words.charAt(0).toLowerCase()}${words.slice(1)}`
          })
          .join(', ')}.`
  const notes = [
    ...(leftOut
      ? [
          narrowed
            ? `Part of that reaches beyond ${narrowed} and was left alone.`
            : `Part of that is outside ${where} and was left alone.`,
        ]
      : []),
    ...(refused.length === 0
      ? []
      : [why ? `I left the rest: ${why}.` : 'I could not do the rest here.']),
  ]
  return { reply: said, notes }
}

export function newAdjustments(before: PortalDesign, after: PortalDesign): string[] {
  const reasons = (doc: PortalDesign) =>
    new Set(resolveDesign(doc).adjustments.map((adjustment) => adjustment.reason))
  const had = reasons(before)
  return [...reasons(after)].filter((reason) => !had.has(reason))
}

/** Words written in a language other than English, said so the person knows which. */
export function wordsNote(result: OpsOutcome, locale: string | undefined): string {
  if (!locale || locale === 'en') return ''
  const wrote = result.done.some(
    ({ op }) => op.op === 'words' || (op.op === 'set' && ['heading', 'body'].includes(op.key ?? ''))
  )
  return wrote ? `The words are in ${languageName(locale)}, the language shown.` : ''
}
