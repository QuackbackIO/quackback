/**
 * Quackback AI in Appearance: turning a request into changes to the design
 * draft, and a website or a few words into three looks to start from. The
 * model only proposes values from the design's own lists; every change goes
 * through applyDesignChanges, so the schema and the contrast solver decide
 * what reaches the draft.
 */
import { z } from 'zod'
import { config } from '@/lib/server/config'
import { isAiClientConfigured } from '@/lib/server/domains/ai/config'
import { getChatModel } from '@/lib/server/domains/ai/models'
import { structuredChat } from '@/lib/server/domains/ai/structured-chat'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { logger } from '@/lib/server/logger'
import { editPrompt } from './design-ai-guide'
import { changeLabel } from '@/lib/shared/design/labels'
import { resolveDesign } from '@/lib/shared/design/resolve'
import { brandColour } from '@/lib/shared/design/palette'
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  applyDesignChanges,
  docText,
  scopeFields,
  type AppliedDesignChange,
  type DesignAiScope,
  type UntrustedChanges,
} from '@/lib/shared/design/apply-changes'

export { EDIT_EXAMPLES } from './design-ai-guide'

const log = logger.child({ module: 'design-ai' })

const STRUCTURED_OUTPUT_ERROR_CODES = new Set([
  'structured-output-parse-failed',
  'structured-output-validation-failed',
  'structured-output-missing-result',
])
export const isStructuredOutputError = (err: unknown) =>
  STRUCTURED_OUTPUT_ERROR_CODES.has((err as { code?: string } | null)?.code ?? '')

/** The model Appearance uses, or null when no AI is set up for this workspace. */
export function designAiModel(): string | null {
  if (!isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl)) return null
  return getChatModel('assistant')
}

/** A value from the model: JSON as asked, or the bare text it sometimes sends instead. */
export function parseValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** The design as the model reads it: rich text as plain text. */
function designSummary(doc: PortalDesign): string {
  const plain = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(plain)
    if (value && typeof value === 'object') {
      if ((value as { type?: unknown }).type === 'doc') return docText(value)
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]))
    }
    return value
  }
  return JSON.stringify(plain(doc))
}

const editSchema = z.object({
  reply: z.string().max(600),
  /** The request is about something outside the section the person picked. */
  outOfScope: z.boolean(),
  changes: z.array(z.object({ path: z.string().max(160), value: z.string().max(8000) })).max(30),
})

/** Links in what the person wrote, which the model may use. */
export function linksGiven(texts: string[]): Set<string> {
  return new Set(texts.flatMap((text) => text.match(/https?:\/\/[^\s"'<>)]+/g) ?? []))
}

/** A palette for the model: most used first, and which colour is likely the brand's. */
export function paletteText(palette: string[]): string {
  const brand = brandColour(palette)
  return `${palette.join(', ')}.${brand ? ` The brand colour, the most used colour that is not a neutral: ${brand}.` : ''}`
}

const SCOPE_NAMES: Record<Exclude<DesignAiScope, 'site'>, string> = {
  brand: 'brand settings',
  header: 'header',
  band: 'top band',
  welcome: 'welcome message',
  feed: 'feed',
  filters: 'filters',
  home: 'Home page',
}

/**
 * The model's reply when what it says happened did happen. When nothing was
 * applied the server says why, so a reply never claims a change the draft
 * does not have; the change card is what changed.
 */
function honestReply(
  answer: z.infer<typeof editSchema>,
  appliedCount: number,
  /** Changes refused for their value or path, with why; one already set is neither. */
  refused: Array<{ path: string; reason: string }>,
  outOfScope: boolean,
  scope: DesignAiScope
): string {
  const where = scope === 'site' ? 'the section picked' : `the ${SCOPE_NAMES[scope]}`
  const why = refused
    .slice(0, 3)
    .map((change) => `${changeLabel(change.path)}: ${change.reason}`)
    .join('; ')
  if (appliedCount === 0 && outOfScope) return `That is outside ${where}, so nothing changed.`
  if (appliedCount === 0 && refused.length > 0) return `Nothing changed (${why}).`
  const reply = outOfScope
    ? `${answer.reply} Part of that is outside ${where} and was left alone.`
    : answer.reply
  return refused.length > 0 ? `${reply} Left alone: ${why}.` : reply
}

function newAdjustments(before: PortalDesign, after: PortalDesign): string[] {
  const reasons = (doc: PortalDesign) =>
    new Set(resolveDesign(doc).adjustments.map((adjustment) => adjustment.reason))
  const had = reasons(before)
  return [...reasons(after)].filter((reason) => !had.has(reason))
}

export type DesignAiResult =
  | {
      ok: true
      reply: string
      design: PortalDesign
      applied: AppliedDesignChange[]
      skipped: number
      /** The request reached outside the section picked; asking about the whole site may do it. */
      outOfScope: boolean
      /** What the solver now adjusts to keep text readable that it did not before. */
      readability: string[]
    }
  | { ok: false; code: 'AI_UNAVAILABLE' | 'AI_FAILED'; message: string }

/** One request in the Appearance chat, applied to the draft as far as the design allows. */
export async function askDesignAi(input: {
  message: string
  design: PortalDesign
  scope: DesignAiScope
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  /** The main colours of an image the person attached. */
  palette?: string[]
  /** What the workspace allows: the Home blocks its pages can show, and its CSS. */
  allows: Omit<UntrustedChanges, 'links'> & { writesCss: boolean }
}): Promise<DesignAiResult> {
  const model = designAiModel()
  if (!model) {
    return {
      ok: false,
      code: 'AI_UNAVAILABLE',
      message: 'Quackback AI is not set up for this workspace.',
    }
  }
  await enforceAiTokenBudget()
  const scopeNote =
    input.scope === 'site'
      ? ''
      : `\nThe person picked the ${SCOPE_NAMES[input.scope]} in the preview. Change only these fields and what is under them: ${scopeFields(input.scope).join(', ')}. If the request is about anything else, make no changes and set outOfScope to true.`
  try {
    const answer = await structuredChat({
      model,
      systemPrompts: [
        editPrompt(input.allows.blockTypes, input.allows.writesCss) + scopeNote,
        `The design now: ${designSummary(input.design)}`,
      ],
      messages: [
        ...input.history.slice(-6),
        {
          role: 'user',
          content: input.palette?.length
            ? `${input.message}\n\nColours from the attached image: ${paletteText(input.palette)}`
            : input.message,
        },
      ],
      schema: editSchema,
      maxTokens: 1200,
    })
    const links = linksGiven([
      input.message,
      ...input.history.filter((turn) => turn.role === 'user').map((turn) => turn.content),
    ])
    const applied = applyDesignChanges(
      input.design,
      answer.changes.map((change) => ({ path: change.path, value: parseValue(change.value) })),
      input.scope,
      { ...input.allows, links }
    )
    const outOfScope =
      input.scope !== 'site' && (answer.outOfScope || applied.outOfScope.length > 0)
    return {
      ok: true,
      reply: honestReply(answer, applied.applied.length, applied.refused, outOfScope, input.scope),
      ...applied,
      outOfScope,
      readability: newAdjustments(input.design, applied.design),
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

export { designDirections, type DesignLook, type DirectionsResult } from './design-directions'
