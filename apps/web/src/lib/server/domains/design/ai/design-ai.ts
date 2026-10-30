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
import { DESIGN_OPTIONS, BUNDLED_FONT_IDS } from '@/lib/shared/design/options'
import { applyPreset, DESIGN_PRESETS } from '@/lib/shared/design/presets'
import { resolveDesign } from '@/lib/shared/design/resolve'
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  applyDesignChanges,
  DESIGN_AI_PATHS,
  type AppliedDesignChange,
  type DesignAiScope,
} from '@/lib/shared/design/apply-changes'
import type { SiteSignals } from './site-signals'

const log = logger.child({ module: 'design-ai' })

const STRUCTURED_OUTPUT_ERROR_CODES = new Set([
  'structured-output-parse-failed',
  'structured-output-validation-failed',
  'structured-output-missing-result',
])
const isStructuredOutputError = (err: unknown) =>
  STRUCTURED_OUTPUT_ERROR_CODES.has((err as { code?: string } | null)?.code ?? '')

/** The model Appearance uses, or null when no AI is set up for this workspace. */
export function designAiModel(): string | null {
  if (!isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl)) return null
  return getChatModel('assistant')
}

const OPTIONS_TEXT = [
  `mode: ${DESIGN_OPTIONS.mode.join(', ')}`,
  `shape.corners: ${DESIGN_OPTIONS.corners.join(', ')}`,
  `brand.fonts.heading and brand.fonts.body: ${BUNDLED_FONT_IDS.join(', ')}`,
  `brand.fonts.headingWeight: ${DESIGN_OPTIONS.headingWeight.join(', ')}`,
  `layout.header: ${DESIGN_OPTIONS.header.join(', ')}`,
  `layout.nav: ${DESIGN_OPTIONS.nav.join(', ')}`,
  `layout.band: ${DESIGN_OPTIONS.band.join(', ')}`,
  `layout.cards: ${DESIGN_OPTIONS.cards.join(', ')}`,
  `layout.density: ${DESIGN_OPTIONS.density.join(', ')}`,
  `layout.width: ${DESIGN_OPTIONS.width.join(', ')}`,
  `layout.filters: ${DESIGN_OPTIONS.filters.join(', ')} (end is the right in left-to-right languages)`,
  `pages.feedback.defaultSort: ${DESIGN_OPTIONS.sort.join(', ')}`,
  'brand.light.* and brand.dark.* colours: hex such as #0f766e',
  'pages.feedback.headline.title and .subtitle: short plain text; pages.feedback.welcome.show: true or false',
].join('\n')

/** The design fields the model sees: everything it may change, nothing else. */
function designSummary(doc: PortalDesign) {
  const font = (f: PortalDesign['brand']['fonts']['body']) =>
    f.kind === 'bundled' ? f.id : f.fallback
  return JSON.stringify({
    mode: doc.mode,
    brand: {
      light: doc.brand.light,
      dark: doc.brand.dark ?? {},
      fonts: {
        heading: font(doc.brand.fonts.heading),
        body: font(doc.brand.fonts.body),
        headingWeight: doc.brand.fonts.headingWeight,
      },
    },
    shape: doc.shape,
    layout: doc.layout,
    pages: {
      feedback: {
        headline: doc.pages.feedback.headline,
        welcome: { show: doc.pages.feedback.welcome.show },
        defaultSort: doc.pages.feedback.defaultSort,
      },
    },
  })
}

const editSchema = z.object({
  reply: z.string().max(600),
  changes: z
    .array(
      z.object({
        path: z.enum(DESIGN_AI_PATHS),
        value: z.union([z.string().max(280), z.number(), z.boolean()]),
      })
    )
    .max(20),
})

const EDIT_PROMPT = `You change the look of a customer feedback portal. You may set only these fields, to only these values:
${OPTIONS_TEXT}

Reply with JSON: a one or two sentence reply to the person, and the changes as a list of { path, value }. Change only what the request is about. Never invent a field or a value outside the lists. If the request is not about the portal's look, make no changes and say so in the reply.

Example request: "Make it feel calmer and give the cards more room"
Example answer: {"reply":"I softened the corners, raised the cards and gave the feed more room.","changes":[{"path":"shape.corners","value":"rounded"},{"path":"layout.cards","value":"raised"},{"path":"layout.density","value":"spacious"}]}

Example request: "Use our green, #0f766e"
Example answer: {"reply":"The accent is now your green.","changes":[{"path":"brand.light.accent","value":"#0f766e"}]}`

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
      : `\nThe person picked the ${input.scope} section: change only that section.`
  try {
    const answer = await structuredChat({
      model,
      systemPrompts: [EDIT_PROMPT + scopeNote, `The design now: ${designSummary(input.design)}`],
      messages: [...input.history.slice(-6), { role: 'user', content: input.message }],
      schema: editSchema,
      maxTokens: 800,
    })
    const applied = applyDesignChanges(input.design, answer.changes, input.scope)
    return {
      ok: true,
      reply: answer.reply,
      ...applied,
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

const PRESET_IDS = DESIGN_PRESETS.map((preset) => preset.id) as [string, ...string[]]

const directionsSchema = z.object({
  looks: z
    .array(
      z.object({
        name: z.string().max(40),
        description: z.string().max(120),
        preset: z.enum(PRESET_IDS),
        accent: z.string().max(32),
        background: z.string().max(32),
        ink: z.string().max(32),
        headingFont: z.enum(BUNDLED_FONT_IDS),
        bodyFont: z.enum(BUNDLED_FONT_IDS),
      })
    )
    .min(1)
    .max(3),
})

const DIRECTIONS_PROMPT = `You suggest three different starting looks for a company's customer feedback portal. Each look starts from one preset and sets the colours and fonts. Make the three clearly different from each other: in layout (the preset), in type and in colour. Keep text readable: dark ink on a light background, or light ink on a dark one.

Presets: ${DESIGN_PRESETS.map((preset) => `${preset.id} (${preset.description})`).join('; ')}
Fonts: ${BUNDLED_FONT_IDS.join(', ')}
Colours are hex such as #0f766e.

Example answer: {"looks":[{"name":"Calm teal","description":"Soft tint, rounded cards, lots of room.","preset":"calm","accent":"#0f766e","background":"#f8fafc","ink":"#0f172a","headingFont":"nunito","bodyFont":"nunito"},{"name":"Editorial","description":"Serif headings and a narrow column.","preset":"editorial","accent":"#b91c1c","background":"#fffdf8","ink":"#1c1917","headingFont":"fraunces","bodyFont":"inter"},{"name":"Bold","description":"A full-colour band and pill shapes.","preset":"bold","accent":"#e11d48","background":"#ffffff","ink":"#0a0a0a","headingFont":"poppins","bodyFont":"poppins"}]}`

export interface DesignLook {
  name: string
  description: string
  design: PortalDesign
}

export type DirectionsResult =
  | { ok: true; looks: DesignLook[] }
  | { ok: false; code: 'AI_UNAVAILABLE' | 'AI_FAILED'; message: string }

/** Three looks from a website or a few words; each a valid, solved design. */
export async function designDirections(input: {
  design: PortalDesign
  site: SiteSignals | null
  words: string | null
}): Promise<DirectionsResult> {
  const model = designAiModel()
  if (!model) {
    return {
      ok: false,
      code: 'AI_UNAVAILABLE',
      message: 'Quackback AI is not set up for this workspace.',
    }
  }
  await enforceAiTokenBudget()
  const brief = [
    input.site &&
      `Website ${input.site.domain}${input.site.title ? `, titled "${input.site.title}"` : ''}${
        input.site.description ? `: ${input.site.description}` : ''
      }${input.site.colour ? `. Its brand colour is ${input.site.colour}.` : '.'}`,
    input.words && `In their words: ${input.words}`,
  ]
    .filter(Boolean)
    .join('\n')
  try {
    const answer = await structuredChat({
      model,
      systemPrompts: [DIRECTIONS_PROMPT],
      messages: [{ role: 'user', content: brief || 'Suggest three looks for a software company.' }],
      schema: directionsSchema,
      maxTokens: 900,
    })
    const looks: DesignLook[] = []
    for (const look of answer.looks) {
      const preset = DESIGN_PRESETS.find((candidate) => candidate.id === look.preset)!
      const { design, applied } = applyDesignChanges(
        applyPreset(input.design, preset),
        [
          { path: 'brand.light.accent', value: look.accent },
          { path: 'brand.light.background', value: look.background },
          { path: 'brand.light.ink', value: look.ink },
          { path: 'brand.fonts.heading', value: look.headingFont },
          { path: 'brand.fonts.body', value: look.bodyFont },
        ],
        'site'
      )
      // A look whose colours the solver refused keeps the preset's, which still reads well.
      looks.push({ name: look.name, description: look.description, design })
      if (applied.length === 0) log.info({ look: look.name }, 'design look kept its preset colours')
    }
    return { ok: true, looks }
  } catch (err) {
    if (!isStructuredOutputError(err)) throw err
    log.warn({ err }, 'design ai directions did not fit the schema')
    return {
      ok: false,
      code: 'AI_FAILED',
      message: 'Quackback AI could not suggest looks. Try again.',
    }
  }
}
