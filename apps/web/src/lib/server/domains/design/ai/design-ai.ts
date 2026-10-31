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
  scopeFields,
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

/** Each field the model may set, in the words a person uses for it. */
const OPTIONS_TEXT = [
  `mode (light or dark pages; auto follows the visitor's device): ${DESIGN_OPTIONS.mode.join(', ')}`,
  'brand.light.accent (the brand colour: buttons, links, the band), brand.light.background (the page), brand.light.ink (the text), brand.light.surface (cards), brand.light.raised (raised surfaces), brand.light.muted (secondary text), brand.light.border (borders): hex such as #0f766e',
  'brand.dark.background, brand.dark.ink, brand.dark.surface, brand.dark.raised, brand.dark.muted, brand.dark.border: the same roles in dark mode, hex',
  `brand.fonts.heading and brand.fonts.body (the fonts): ${BUNDLED_FONT_IDS.join(', ')}`,
  `brand.fonts.headingWeight (how bold headings are): ${DESIGN_OPTIONS.headingWeight.join(', ')}`,
  `shape.corners (the corners of cards, buttons and fields): ${DESIGN_OPTIONS.corners.join(', ')}`,
  'layout.header (where the logo and menu sit): stacked (logo above the menu), inline (logo and menu on one row), centered',
  `layout.nav (the menu style, how the current page is marked): ${DESIGN_OPTIONS.nav.join(', ')}`,
  'layout.band (the band behind the headline): none, tint (a soft tint of the brand colour), fade (a tint fading into the page), brand (the brand colour itself). A band shows only with a headline; when you add one and there is no headline, write one.',
  'layout.cards (how ideas show in the feed): bordered, raised, list (rows without cards)',
  `layout.density (the space in the feed): ${DESIGN_OPTIONS.density.join(', ')}`,
  `layout.width (the page width): ${DESIGN_OPTIONS.width.join(', ')}`,
  'layout.filters (the filter panel side): end (right), start (left)',
  `pages.feedback.defaultSort (the feed's first sort): ${DESIGN_OPTIONS.sort.join(', ')}`,
  'pages.feedback.headline.title and pages.feedback.headline.subtitle (the feedback page headline and the line under it): short plain text; an empty string removes it',
  'pages.feedback.welcome.show (the welcome message): true or false',
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
  /** The request is about something outside the section the person picked. */
  outOfScope: z.boolean(),
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

Reply with JSON: a one or two sentence reply to the person, outOfScope, and the changes as a list of { path, value }. Change only what the request is about. Never invent a field or a value outside the lists. If the request is not about the portal's look, make no changes and say so in the reply.

Example request: "Make it feel calmer and give the cards more room"
Example answer: {"reply":"I softened the corners, raised the cards and gave the feed more room.","outOfScope":false,"changes":[{"path":"shape.corners","value":"rounded"},{"path":"layout.cards","value":"raised"},{"path":"layout.density","value":"spacious"}]}

Example request: "Use our green, #0f766e, with a green band. Headline: Help us grow"
Example answer: {"reply":"The accent is now your green, with a green band behind the new headline.","outOfScope":false,"changes":[{"path":"brand.light.accent","value":"#0f766e"},{"path":"layout.band","value":"brand"},{"path":"pages.feedback.headline.title","value":"Help us grow"}]}`

const SCOPE_NAMES: Record<Exclude<DesignAiScope, 'site'>, string> = {
  brand: 'brand settings',
  header: 'header',
  band: 'top band',
  welcome: 'welcome message',
  feed: 'feed',
  filters: 'filters',
}

/**
 * The model's reply when what it says happened did happen. When nothing was
 * applied the server says why, so a reply never claims a change the draft
 * does not have; the change card is what changed.
 */
function honestReply(
  answer: z.infer<typeof editSchema>,
  appliedCount: number,
  outOfScope: boolean,
  scope: DesignAiScope
): string {
  const where = scope === 'site' ? 'the section picked' : `the ${SCOPE_NAMES[scope]}`
  if (appliedCount === 0 && outOfScope) return `That is outside ${where}, so nothing changed.`
  if (appliedCount === 0 && answer.changes.length > 0)
    return 'Nothing changed: the design does not offer that.'
  if (outOfScope) return `${answer.reply} Part of that is outside ${where} and was left alone.`
  return answer.reply
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
      : `\nThe person picked the ${SCOPE_NAMES[input.scope]} in the preview. Change only these fields: ${scopeFields(input.scope).join(', ')}. If the request is about anything else, make no changes and set outOfScope to true.`
  try {
    const answer = await structuredChat({
      model,
      systemPrompts: [EDIT_PROMPT + scopeNote, `The design now: ${designSummary(input.design)}`],
      messages: [...input.history.slice(-6), { role: 'user', content: input.message }],
      schema: editSchema,
      maxTokens: 800,
    })
    const applied = applyDesignChanges(input.design, answer.changes, input.scope)
    const outOfScope =
      input.scope !== 'site' && (answer.outOfScope || applied.outOfScope.length > 0)
    return {
      ok: true,
      reply: honestReply(answer, applied.applied.length, outOfScope, input.scope),
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
        /** The feedback page headline in the brand's voice; shown over the preset's band. */
        headline: z.string().max(80),
        subtitle: z.string().max(140),
      })
    )
    .min(1)
    .max(3),
})

const DIRECTIONS_PROMPT = `You suggest three different starting looks for a company's customer feedback portal. Each look starts from one preset and sets the colours and fonts. Make the three clearly different from each other: in layout (the preset), in type and in colour. Keep text readable: dark ink on a light background, or light ink on a dark one. Give each a short headline and subtitle for the feedback page, in the brand's voice, inviting ideas.

Presets: ${DESIGN_PRESETS.map((preset) => `${preset.id} (${preset.description})`).join('; ')}
Fonts: ${BUNDLED_FONT_IDS.join(', ')}
Colours are hex such as #0f766e.

Example answer: {"looks":[{"name":"Calm teal","description":"Soft tint, rounded cards, lots of room.","preset":"calm","accent":"#0f766e","background":"#f8fafc","ink":"#0f172a","headingFont":"nunito","bodyFont":"nunito","headline":"Help us build what's next","subtitle":"Share an idea or vote on the ones you want."},{"name":"Editorial","description":"Serif headings and a narrow column.","preset":"editorial","accent":"#b91c1c","background":"#fffdf8","ink":"#1c1917","headingFont":"fraunces","bodyFont":"inter","headline":"Ideas, considered","subtitle":"Tell us what would make your work easier."},{"name":"Bold","description":"A full-colour band and pill shapes.","preset":"bold","accent":"#e11d48","background":"#ffffff","ink":"#0a0a0a","headingFont":"poppins","bodyFont":"poppins","headline":"Got an idea? Let's hear it","subtitle":"Vote for the features you want next."}]}`

export interface DesignLook {
  name: string
  description: string
  /** The preset the look starts from. */
  preset: string
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
          { path: 'pages.feedback.headline.title', value: look.headline },
          { path: 'pages.feedback.headline.subtitle', value: look.subtitle },
        ],
        'site'
      )
      // A look whose colours the solver refused keeps the preset's, which still reads well.
      looks.push({ name: look.name, description: look.description, preset: preset.id, design })
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
