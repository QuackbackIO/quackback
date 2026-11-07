/**
 * The looks, written one to a call, each checked and mended once. One look
 * to an answer keeps the grammar a strict answer is held to a third the size
 * of three, so a smaller model drops fewer fields, and the faithful look is
 * not pulled toward the other two. Each answer is linted for what a look
 * must have and a model can leave out; a look with gaps is asked to mend
 * only those, and the mended one is kept only if it has fewer.
 */
import { z } from 'zod'
import type { ContentPart } from '@tanstack/ai'
import { structuredChat } from '@/lib/server/domains/ai/structured-chat'
import { logger } from '@/lib/server/logger'
import { lookSchema, type Look } from './design-looks'
import { designUsage, isStructuredOutputError } from './design-ai'

const log = logger.child({ module: 'look-calls' })

export const oneLookSchema = z.object({ look: lookSchema })

/** Each call's look, in the order the looks are shown: the faithful one first. */
export const LOOK_ROLES = [
  'Write the first look, Faithful: as close to their brand as the options allow.',
  'Write the second look, quieter: their brand, calmer and more restrained than Faithful.',
  'Write the third look, bolder: their brand, louder and more striking than Faithful.',
] as const

const PAGE_NAME = /^(roadmap|changelog|help|help cent(er|re)|support|feedback)$/i

/** What a look is missing or has wrong that a model can mend, or nothing. */
export function lookLints(look: Look): string[] {
  const lints: string[] = []
  if (!look.name.trim()) lints.push('name is empty')
  if (!look.headline.trim()) lints.push('headline is empty')
  if (!look.subtitle.trim()) lints.push('subtitle is empty')
  if (!look.prompt.trim()) lints.push('prompt is empty')
  if (!look.submit.trim()) lints.push('submit is empty')
  if (look.pageWords.length < 8) lints.push('pageWords: write all eight lines')
  look.pageWords.forEach((line, i) => {
    if (!line.trim()) lints.push(`pageWords[${i}] is empty`)
    else if (i % 2 === 0 && PAGE_NAME.test(line.trim()))
      lints.push(`pageWords[${i}] "${line}" is only the page's name; write a title in their voice`)
  })
  if (
    look.homeHeadline.trim() &&
    look.homeHeadline.trim().toLowerCase() === look.headline.trim().toLowerCase()
  )
    lints.push('headline repeats homeHeadline; give the feedback page its own')
  if (
    (look.band === 'support' || look.tint === 'support' || look.action === 'support') &&
    !look.support
  )
    lints.push('the band, tint or action uses the second colour, but support is empty')
  if (
    look.accentPhrase &&
    ![look.headline, look.homeHeadline].some((h) => h.includes(look.accentPhrase))
  )
    lints.push('accentPhrase is not copied exactly from a headline')
  if (look.homeBlocks.length < 3) lints.push('homeBlocks: give Home at least three blocks')
  return lints
}

/** A brief's words without its pictures. */
const wordsOf = (content: string | ContentPart[]) =>
  typeof content === 'string' ? content : content.filter((part) => part.type === 'text')

/**
 * Three looks, one to a call, each linted and mended once, in their roles'
 * places: a look whose call fails is null, so the faithful look is never
 * another in its place. With none, the first failure is thrown.
 */
export async function writeLooks(input: {
  model: string
  systemPrompt: string
  /** Each look's brief, by its place: the faithful look, first, can be shown more. */
  content: (look: number) => string | ContentPart[]
}): Promise<Array<Look | null>> {
  const ask = (role: string, look: number, mend?: { look: Look; lints: string[] }) =>
    structuredChat({
      model: input.model,
      systemPrompts: [input.systemPrompt, role],
      messages: [
        // A mend is about the look's own fields, which need the brief's words, not its pictures.
        { role: 'user', content: mend ? wordsOf(input.content(look)) : input.content(look) },
        ...(mend
          ? [
              { role: 'assistant' as const, content: JSON.stringify({ look: mend.look }) },
              {
                role: 'user' as const,
                content: `Mend only these and keep everything else as it is: ${mend.lints.join('; ')}.`,
              },
            ]
          : []),
      ],
      schema: oneLookSchema,
      maxTokens: 5000,
      middleware: designUsage(input.model, 'look'),
    }).then((answer) => answer.look)
  const write = async (role: string, index: number) => {
    // An answer that does not fit the schema is asked for once more.
    const look = await ask(role, index).catch((err: unknown) => {
      if (!isStructuredOutputError(err)) throw err
      log.warn({ err }, 'design ai look did not fit the schema; asking again')
      return ask(role, index)
    })
    const lints = lookLints(look)
    if (!lints.length) return look
    const mended = await ask(role, index, { look, lints }).catch((err: unknown) => {
      log.warn({ err }, 'design ai could not mend a look')
      return null
    })
    // Kept only when it is better by the same check.
    return mended && lookLints(mended).length < lints.length ? mended : look
  }
  const settled = await Promise.allSettled(LOOK_ROLES.map(write))
  if (settled.every((result) => result.status === 'rejected'))
    throw (settled[0] as PromiseRejectedResult).reason
  return settled.map((result) => (result.status === 'fulfilled' ? result.value : null))
}
