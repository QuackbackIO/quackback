/**
 * Quackback AI in Appearance: turning a request into changes to the design
 * draft, and a website or a few words into three looks to start from. The
 * model only proposes values from the design's own lists; every change goes
 * through applyDesignChanges, so the schema and the contrast solver decide
 * what reaches the draft.
 */
import { z } from 'zod'
import type { ContentPart } from '@tanstack/ai'
import { config } from '@/lib/server/config'
import { isAiClientConfigured } from '@/lib/server/domains/ai/config'
import { getChatModel } from '@/lib/server/domains/ai/models'
import { structuredChat } from '@/lib/server/domains/ai/structured-chat'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { logger } from '@/lib/server/logger'
import { BUNDLED_FONT_IDS } from '@/lib/shared/design/options'
import { editPrompt } from './design-ai-guide'
import { changeLabel } from '@/lib/shared/design/labels'
import { applyPreset, DESIGN_PRESETS } from '@/lib/shared/design/presets'
import { resolveDesign } from '@/lib/shared/design/resolve'
import { brandColour, colourVividness } from '@/lib/shared/design/palette'
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  applyDesignChanges,
  docText,
  scopeFields,
  type AppliedDesignChange,
  type DesignAiScope,
  type UntrustedChanges,
} from '@/lib/shared/design/apply-changes'
import type { SiteSignals } from './site-signals'

export { EDIT_EXAMPLES } from './design-ai-guide'

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

/** Above this, a page background reads as a colour and drowns the brand colour on it. */
const MAX_PAGE_VIVIDNESS = 0.2

const quietPage = (background: string) =>
  !/^#[0-9a-f]{6}$/i.test(background) || colourVividness(background) <= MAX_PAGE_VIVIDNESS

/** A palette for the model: most used first, and which colour is likely the brand's. */
function paletteText(palette: string[]): string {
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

const DIRECTIONS_PROMPT = `You suggest three different starting looks for a company's customer feedback portal. Each look starts from one preset and sets the colours and fonts. Make the three clearly different from each other: in layout (the preset), in type and in colour. Pages stay quiet: a background near white, or a dark one for a dark look; the brand colour belongs on the accent and the band, never the page. Keep text readable: dark ink on a light background, or light ink on a dark one. Give each a short headline and subtitle for the feedback page, in the brand's voice, inviting ideas.

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

/** A JPEG data URL as an image part. */
function imagePart(dataUrl: string): ContentPart {
  return {
    type: 'image',
    source: {
      type: 'data',
      value: dataUrl.replace(/^data:image\/jpeg;base64,/, ''),
      mimeType: 'image/jpeg',
    },
  }
}

/** What the website says about its brand, as the model reads it. */
function siteBrief(site: SiteSignals): string {
  return [
    `Website ${site.domain}${site.title ? `, titled "${site.title}"` : ''}${site.description ? `: ${site.description}` : ''}.`,
    site.colour && `Its brand colour is ${site.colour}.`,
    site.palette.length > 1 &&
      `Its other colours, most used first: ${site.palette.slice(1).join(', ')}.`,
    site.background && `Its pages are ${site.dark ? 'dark' : 'light'}, on ${site.background}.`,
    (site.fonts.heading || site.fonts.body) &&
      `It sets headings in ${site.fonts.heading ?? site.fonts.body} and text in ${site.fonts.body ?? site.fonts.heading}; choose the closest fonts from the list.`,
  ]
    .filter(Boolean)
    .join(' ')
}

/** Three looks from a website or a few words; each a valid, solved design. */
export async function designDirections(input: {
  design: PortalDesign
  site: SiteSignals | null
  words: string | null
  /** The main colours of their logo or a screenshot. */
  palette?: string[] | null
  /** The logo or screenshot itself, as a JPEG data URL, for a model that reads images. */
  image?: string | null
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
    input.site && siteBrief(input.site),
    input.words && `In their words: ${input.words}`,
    input.palette?.length &&
      `Colours from their logo or a screenshot: ${paletteText(input.palette)}${brandColour(input.palette) ? ' Use the brand colour as the accent in the first look, as it is.' : ''} Build the looks from these.`,
    input.image &&
      'The image is their logo or a screenshot of their website. Read their brand from it: which colour leads, whether the type is serif, geometric, humanist or condensed, how heavy the headings are, how round the shapes are, and how light or dark the pages are. Make the first look as close to it as the options allow.',
  ]
    .filter(Boolean)
    .join('\n')
  try {
    const text = brief || 'Suggest three looks for a software company.'
    const ask = (withImage: boolean) =>
      structuredChat({
        model,
        systemPrompts: [DIRECTIONS_PROMPT],
        messages: [
          {
            role: 'user',
            content:
              withImage && input.image
                ? [{ type: 'text', content: text }, imagePart(input.image)]
                : text,
          },
        ],
        schema: directionsSchema,
        maxTokens: 2000,
      })
    // A model that does not read images still has the colours.
    const answer = await ask(true).catch((err: unknown) => {
      if (!input.image || isStructuredOutputError(err)) throw err
      log.warn({ err }, 'design ai could not read the image; using its colours alone')
      return ask(false)
    })
    const looks: DesignLook[] = []
    for (const look of answer.looks) {
      const preset = DESIGN_PRESETS.find((candidate) => candidate.id === look.preset)!
      const { design, applied } = applyDesignChanges(
        applyPreset(input.design, preset),
        [
          { path: 'brand.light.accent', value: look.accent },
          // The page stays quiet; a vivid background keeps the preset's.
          ...(quietPage(look.background)
            ? [{ path: 'brand.light.background', value: look.background }]
            : []),
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
