/**
 * Quackback AI in Appearance: turning a request into changes to the design
 * draft, and a few words or an image into three looks to start from. The
 * model only proposes values from the design's own lists; every change goes
 * through applyDesignChanges, so the schema and the contrast solver decide
 * what reaches the draft.
 */
import { plainWords } from '@/lib/shared/design/colour-names'
import { z } from 'zod'
import { isAiClientConfigured } from '@/lib/server/domains/ai/config'
import { getChatModel } from '@/lib/server/domains/ai/models'
import { structuredChat } from '@/lib/server/domains/ai/structured-chat'
import { createUsageLoggingMiddleware } from '@/lib/server/domains/ai/usage-middleware'
import { aiAllowanceNow } from '@/lib/server/domains/settings/tier-enforce'
import { logger } from '@/lib/server/logger'
import { opsPrompt, valuesNow } from './design-ai-guide'
import { BLOCK_NAMES, type DesignerPage } from '@/lib/shared/design/outline'
import { viewNote, writtenInEnglish } from './design-ai-view'
import { honestReply, inRequestLanguage, newAdjustments, wordsNote } from './design-ai-reply'
import { brandColour } from '@/lib/shared/design/palette'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { designContext } from '@/lib/shared/design/design-context'
import { scopeNote as requestScopeNote, scopeOf } from '@/lib/shared/design/agent/router'
import type { StyleElement } from '@/lib/shared/design/style-tokens'
import {
  alsoNotes,
  reachClause,
  reachNote,
  withReach,
  type AiReach,
} from '@/lib/shared/design/ai-reach'
import { applyOps, OP_KINDS, type AiPlaces } from '@/lib/shared/design/design-ops'
import type {
  AppliedDesignChange,
  DesignAiScope,
  UntrustedChanges,
} from '@/lib/shared/design/apply-changes'

export { OPS_EXAMPLES } from './design-ai-guide'

const log = logger.child({ module: 'design-ai' })

const STRUCTURED_OUTPUT_ERROR_CODES = new Set([
  'structured-output-parse-failed',
  'structured-output-validation-failed',
  'structured-output-missing-result',
])
export const isStructuredOutputError = (err: unknown) =>
  STRUCTURED_OUTPUT_ERROR_CODES.has((err as { code?: string } | null)?.code ?? '')

/**
 * Why Quackback AI cannot run in this allowance window, or null when it can.
 * Said as a refusal a person can act on, since a thrown limit reads as a glitch.
 */
export async function allowanceRefusal(): Promise<{
  ok: false
  code: 'AI_LIMIT'
  message: string
} | null> {
  const allowance = await aiAllowanceNow()
  if (allowance.credits === 'available') return null
  const back = allowance.resetsAt
    ? `; it comes back on ${new Date(allowance.resetsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`
    : ''
  const used =
    allowance.credits === 'none'
      ? 'Quackback AI is not on this plan.'
      : `Quackback AI has used this ${allowance.trial ? 'trial’s' : 'month’s'} allowance${back}.`
  return {
    ok: false,
    code: 'AI_LIMIT',
    message: `${used} Every setting still works.`,
  }
}

/** Every call Appearance makes counts against the workspace's AI allowance. */
export const designUsage = (
  model: string,
  call: 'edit' | 'look' | 'hero' | 'shots' | 'elements' | 'roles'
) => [createUsageLoggingMiddleware({ pipelineStep: 'design', model, metadata: { call } })]

/** The model Appearance uses, or null when no AI is set up for this workspace. */
export function designAiModel(): string | null {
  if (!isAiClientConfigured()) return null
  return getChatModel('design')
}

/** A value from the model: JSON as asked, or the bare text it sometimes sends instead. */
export function parseValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/**
 * The answer: a reply, whether the request reached outside what was picked,
 * and operations, flat and every field a string so the grammar a strict
 * answer is held to stays small.
 */
export const editSchema = z.object({
  reply: z.string().max(600),
  /** The request is about something outside the part the person picked. */
  outOfScope: z.boolean(),
  ops: z
    .array(
      z.object({
        op: z.enum(OP_KINDS),
        target: z.string().max(160),
        key: z.string().max(80),
        value: z.string().max(8000),
        /** What the operation does, in words that follow "I changed". */
        says: z.string().max(160),
      })
    )
    .max(20),
})

/** Links in what the person wrote, which the model may use: web addresses, and emails as mailto links. */
export function linksGiven(texts: string[]): Set<string> {
  return new Set(
    texts.flatMap((text) => [
      ...(text.match(/https?:\/\/[^\s"'<>)]+/g) ?? []),
      ...(text.match(/(?<![\w./:-])(?:mailto:)?[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []).map(
        (email) => (email.startsWith('mailto:') ? email : `mailto:${email}`)
      ),
    ])
  )
}

/** A palette for the model: most used first, and which colour is likely the brand's. */
export function paletteText(palette: string[]): string {
  const brand = brandColour(palette)
  return `${palette.join(', ')}.${brand ? ` The brand colour, the most used colour that is not a neutral: ${brand}.` : ''}`
}

/** The Home block picked, by its name, when one is. */
function pickedBlock(design: PortalDesign, blockId: string | undefined): string | null {
  const block = design.pages.home.blocks.find((each) => each.id === blockId)
  return block ? `${BLOCK_NAMES[block.type]} block on Home` : null
}

export const SCOPE_NAMES: Record<Exclude<DesignAiScope, 'site'>, string> = {
  brand: 'site styles',
  header: 'header',
  band: 'hero',
  welcome: 'welcome message',
  feed: 'feed',
  filters: 'filters',
  home: 'Home page',
  headline: 'headline',
  heading: 'section headings',
  menu: 'menu',
  button: 'buttons',
  card: 'cards',
  vote: 'vote boxes',
  field: 'fields',
  logo: 'logo',
  status: 'status labels and tags',
  subtitle: 'subtitle',
  link: 'links',
  secondary: 'secondary buttons',
  body: 'body text',
  roadmap: 'Roadmap page',
  changelog: 'Changelog page',
  help: 'Help Center page',
  post: 'Post page',
  support: 'Support page',
}

export type DesignAiResult =
  | {
      ok: true
      reply: string
      design: PortalDesign
      applied: AppliedDesignChange[]
      skipped: number
      /** The request names something outside the part picked; asking about the whole site may do it. */
      outOfScope: boolean
      /** What was left alone and why, and what else a change reaches, for Show changes. */
      notes?: string[]
      /** What the solver now adjusts to keep text readable that it did not before. */
      readability: string[]
    }
  | { ok: false; code: 'AI_UNAVAILABLE' | 'AI_FAILED' | 'AI_LIMIT'; message: string }

/** One request in the Appearance chat, applied to the draft as far as the design allows. */
export async function askDesignAi(input: {
  message: string
  design: PortalDesign
  scope: DesignAiScope
  /** A Home block picked in the designer, which narrows a Home request to that block. */
  blockId?: string
  /** An element picked on the canvas: its kind and the part it is, which "just this" names. */
  element?: { element: StyleElement; part: string | null }
  /** How far the request may reach from the pick, as the composer's chip says; every place the pick is when not given. */
  within?: AiReach
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  /** The images the person attached: each one's main colours, and the picture itself (a JPEG data URL) for a model that reads images. */
  images?: Array<{ palette: string[]; image?: string }>
  /** What the workspace allows: the Home blocks its pages can show, and its CSS. */
  allows: Omit<UntrustedChanges, 'links'> & { writesCss: boolean }
  /** The page on the designer's canvas, and the language it shows. */
  page?: DesignerPage
  locale?: string
  /** The workspace's boards, roadmaps and help topics, which settings name; none when not given. */
  places?: AiPlaces
  /** The pages the portal has; every one when not given. */
  gates?: PortalPageGates
  /** The builder's Stop: the model call ends with it. */
  signal?: AbortSignal
}): Promise<DesignAiResult> {
  const model = designAiModel()
  if (!model) {
    return {
      ok: false,
      code: 'AI_UNAVAILABLE',
      message: 'Quackback AI is not set up for this workspace.',
    }
  }
  const limited = await allowanceRefusal()
  if (limited) return limited
  const places = input.places ?? NO_PLACES
  const gates = input.gates ?? EVERY_PAGE
  const block = input.scope === 'home' ? pickedBlock(input.design, input.blockId) : null
  const reachTo = input.scope === 'site' ? undefined : input.within
  const within = {
    scope: input.scope,
    ...(block ? { blockId: input.blockId } : {}),
    ...(input.element ? { element: input.element } : {}),
    ...(reachTo ? { reach: reachTo } : {}),
    ...(input.page ? { page: input.page } : {}),
  }
  const picked = block ?? SCOPE_NAMES[input.scope as 'home']
  const reach = reachNote(reachTo, input.page, input.element?.part)
  const scopeNote =
    input.scope === 'site'
      ? ''
      : `\nThe person picked the ${picked} in the preview. Change only it.${reach ? ` ${reach}` : ''} If the request is about anything else, make no operations for that part and set outOfScope to true.`
  const view = viewNote(input.page, input.locale)
  // The request's own words are a hint for the model; the chip's reach is what holds.
  const reads = requestScopeNote(input.message)
  const attached = (input.images ?? []).filter((attachment) => attachment.palette.length > 0)
  const text =
    attached.length === 0
      ? input.message
      : attached.length === 1
        ? `${input.message}\n\nColours from the attached image: ${paletteText(attached[0]!.palette)}`
        : `${input.message}\n\nColours from the attached images:\n${attached
            .map((attachment, index) => `image ${index + 1}: ${paletteText(attachment.palette)}`)
            .join('\n')}`
  const pictures = (input.images ?? []).flatMap((attachment) =>
    attachment.image ? [attachment.image] : []
  )
  const context = designContext(input.design, {
    gates,
    places,
    ...(input.page ? { page: input.page } : {}),
    ...(input.locale ? { locale: input.locale } : {}),
    picked: within,
    parts: !!input.element || scopeOf(input.message).one,
  })
  const ask = (withImage: boolean) =>
    structuredChat({
      model,
      systemPrompts: [
        opsPrompt({
          blockTypes: input.allows.blockTypes,
          writesCss: input.allows.writesCss,
          places,
        }),
        `The portal now:\n${context}\n${valuesNow(input.design)}${scopeNote}${view ? `\n${view}` : ''}${reads ? `\n${reads}` : ''}`,
      ],
      messages: [
        ...input.history.slice(-6),
        {
          role: 'user',
          // The picture itself where one is attached, so "match this" can be read from it.
          content:
            withImage && pictures.length > 0
              ? [
                  { type: 'text', content: text },
                  ...pictures.map((picture) => ({
                    type: 'image' as const,
                    source: {
                      type: 'data' as const,
                      value: picture.replace(/^data:image\/jpeg;base64,/, ''),
                      mimeType: 'image/jpeg',
                    },
                  })),
                ]
              : text,
        },
      ],
      schema: editSchema,
      // A change to match a picture can take many operations.
      maxTokens: 4000,
      middleware: designUsage(model, 'edit'),
      ...(input.signal ? { signal: input.signal } : {}),
    })
  try {
    // An answer that does not fit is asked for once more, then without the
    // picture, which still leaves its colours.
    const answer = await ask(true)
      .catch((err: unknown) => {
        if (!isStructuredOutputError(err)) throw err
        log.warn({ err }, 'design ai answer did not fit the schema; asking again')
        return ask(true)
      })
      .catch((err: unknown) => {
        if (!isStructuredOutputError(err) || pictures.length === 0) throw err
        return ask(false)
      })
    const links = linksGiven([
      input.message,
      ...input.history.filter((turn) => turn.role === 'user').map((turn) => turn.content),
    ])
    const result = applyOps(
      input.design,
      {
        gates,
        places,
        ...(input.locale ? { locale: input.locale } : {}),
        request: input.message,
        untrusted: { ...input.allows, links },
      },
      // The fields the model left empty are left out.
      answer.ops.map(({ op, target, key, value }) => ({
        op,
        ...(target ? { target } : {}),
        ...(key ? { key } : {}),
        ...(value ? { value } : {}),
      })),
      within
    )
    // Asking about the whole site is offered only when the request names something
    // outside the pick: all of it went elsewhere, or the model read it so and part of
    // it was left out. A request about the pick itself never offers it.
    const leftOut = result.outOfScope.length > 0
    const nothing = result.done.length === 0
    const outOfScope =
      input.scope !== 'site' &&
      (answer.outOfScope
        ? leftOut || nothing
        : leftOut && nothing && (!reachTo || reachTo === 'every'))
    const english = writtenInEnglish(input.message)
    const said = honestReply(
      answer,
      result,
      outOfScope,
      input.scope === 'site' ? 'the section picked' : `the ${picked}`,
      reachTo,
      english
    )
    // Nothing changed, said by the server: in the request's own language where it is not English.
    if (said.server && !english)
      said.reply = await inRequestLanguage({
        model,
        request: input.message,
        line: said.reply,
        ...(input.signal ? { signal: input.signal } : {}),
      })
    const clause = reachClause(result.design, result.applied, {
      scope: input.scope,
      ...(input.page ? { page: input.page } : {}),
    })
    const words = wordsNote(result, input.locale)
    return {
      ok: true,
      reply: plainWords(result.done.length ? withReach(said.reply, clause) : said.reply),
      design: result.design,
      applied: result.applied,
      skipped: result.refused.length + result.outOfScope.length,
      outOfScope,
      notes: [...said.notes, ...alsoNotes(result.applied, input.scope), ...(words ? [words] : [])],
      readability: newAdjustments(input.design, result.design),
    }
  } catch (err) {
    if (!isStructuredOutputError(err)) throw err
    log.warn({ err }, 'design ai answer did not fit the schema')
    return {
      ok: false,
      code: 'AI_FAILED',
      message: 'Quackback AI could not suggest a change. Try rephrasing.',
    }
  }
}

const NO_PLACES: AiPlaces = { boards: [], roadmaps: [], categories: [] }
const EVERY_PAGE: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

export { designDirections, type DesignLook, type DirectionsResult } from './design-directions'
