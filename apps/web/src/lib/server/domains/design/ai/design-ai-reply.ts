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
import { z } from 'zod'
import { structuredChat } from '@/lib/server/domains/ai/structured-chat'
import { createUsageLoggingMiddleware } from '@/lib/server/domains/ai/usage-middleware'
import { logger } from '@/lib/server/logger'

const log = logger.child({ module: 'design-ai-reply' })

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
): {
  reply: string
  notes: string[]
  /** The server's own English line for nothing changed, which a request in another language needs in its own. */
  server?: true
} {
  const { done, refused, already } = result
  // In another language, the model's own line, in the person's words, where it can be
  // true: some of it applied, or the model itself said the request was outside.
  const own = !english && answer.reply.trim() ? oneSentence(answer.reply) : null
  const why = plainReasons(refused.map((each) => each.reason))
  const narrowed = reach === 'page' ? 'this page' : reach === 'one' ? 'this one' : null
  const leftOut = result.outOfScope.length > 0
  const server = (reply: string) => ({ reply, notes: [], server: true as const })
  if (done.length === 0 && (outOfScope || (leftOut && !narrowed)))
    return own && answer.outOfScope
      ? { reply: own, notes: [] }
      : server(`That is outside ${where}, so nothing changed.`)
  if (done.length === 0 && leftOut)
    return server(`That reaches beyond ${narrowed}, so nothing changed.`)
  if (done.length === 0 && refused.length > 0)
    return server(why ? `Nothing changed: ${why}.` : 'Nothing changed: I could not do that here.')
  if (done.length === 0 && already.length > 0)
    return server('Nothing changed: it is already like that.')
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

/** What the model is told when the server's own line must be said in the request's language. */
export const REQUEST_LANGUAGE_PROMPT =
  'Write the line in the language the request is written in, with the same meaning: one short, plain sentence that names the part as the request does. Add nothing the line does not say.'

const inLanguage = z.object({ reply: z.string().max(300) })

/**
 * The server's own line for nothing changed, said in the language of a request
 * written in another: the model's reply would claim the change it asked for,
 * which never landed. Said in English where the line cannot be put into it.
 */
export async function inRequestLanguage(input: {
  model: string
  request: string
  line: string
  signal?: AbortSignal
}): Promise<string> {
  try {
    const answer = await structuredChat({
      model: input.model,
      systemPrompts: [REQUEST_LANGUAGE_PROMPT],
      messages: [{ role: 'user', content: `Request: ${input.request}\nLine: ${input.line}` }],
      schema: inLanguage,
      maxTokens: 200,
      middleware: [
        createUsageLoggingMiddleware({
          pipelineStep: 'design',
          model: input.model,
          metadata: { call: 'edit' },
        }),
      ],
      ...(input.signal ? { signal: input.signal } : {}),
    })
    return oneSentence(answer.reply.trim()) || input.line
  } catch (err) {
    log.warn({ err }, 'the design ai reply stayed in English')
    return input.line
  }
}
