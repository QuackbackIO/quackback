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
import { DESIGN_OPTIONS, BUNDLED_FONT_IDS, BLOCK_WIDTHS } from '@/lib/shared/design/options'
import type { HomeBlockType } from '@/lib/shared/design/home'
import { PORTAL_PARTS } from '@/lib/shared/design/parts'
import { changeLabel } from '@/lib/shared/design/labels'
import { applyPreset, DESIGN_PRESETS } from '@/lib/shared/design/presets'
import { resolveDesign } from '@/lib/shared/design/resolve'
import { colourVividness, mostVivid } from '@/lib/shared/design/palette'
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

/** The design document's fields, in the words a person uses for them. */
function fieldGuide(blockTypes: readonly HomeBlockType[], writesCss: boolean): string {
  const widths = (Object.keys(BLOCK_WIDTHS) as HomeBlockType[])
    .map((type) => `${type} (${BLOCK_WIDTHS[type].join(', ')})`)
    .join('; ')
  return [
    `mode: ${DESIGN_OPTIONS.mode.join(', ')} (auto follows the visitor's device)`,
    'brand.light.accent (buttons, links, the band), brand.light.background (the page), brand.light.ink (text), brand.light.surface (cards), brand.light.raised (raised surfaces), brand.light.muted (secondary text), brand.light.border: hex such as #0f766e. brand.dark.*: the same roles in dark mode, without accent. null clears an optional colour.',
    `brand.fonts.heading and brand.fonts.body: ${BUNDLED_FONT_IDS.join(', ')}. brand.fonts.headingWeight: ${DESIGN_OPTIONS.headingWeight.join(', ')}`,
    'brand.logo.display: mark_and_name, mark, wordmark (the logo files themselves are uploaded in Settings)',
    `shape.corners: ${DESIGN_OPTIONS.corners.join(', ')}`,
    'layout.header: stacked (logo above the menu), inline (one row), centered',
    `layout.nav (how the menu marks the current page): ${DESIGN_OPTIONS.nav.join(', ')}`,
    'layout.band (behind a page headline): none, tint, fade, brand. It shows only with a headline; when you add one and there is no headline, write one.',
    `layout.cards: ${DESIGN_OPTIONS.cards.join(', ')}. layout.density: ${DESIGN_OPTIONS.density.join(', ')}. layout.width: ${DESIGN_OPTIONS.width.join(', ')}. layout.filters: end (right), start (left)`,
    'pages.feedback.headline.title and .subtitle: text by language, such as {"en":"Help us grow","de":"Hilf uns wachsen"}. Plain text sets English; an empty string removes it.',
    'pages.feedback.welcome: {show, body}: the message above the feed; body is plain text, a blank line between paragraphs. When you turn it on with no text, write some.',
    `pages.feedback.defaultSort: ${DESIGN_OPTIONS.sort.join(', ')}`,
    'pages.feedback.copy.prompt (the composer prompt, 60 characters), .submit (its button, 24), .emptyTitle (the empty feed, 60): text by language, like the headline. Leave them out to use the chosen word.',
    'pages.home.headline: like the feedback headline, for Home.',
    `pages.home.blocks: Home's blocks in order on a six-column grid, at most 12: [{"type":..., "width":...}]. Types with their widths: ${widths}. Options: ideas {sort, count 3 or 5}, updates {count 2 to 4}, welcome {body: plain text}, links {title, links: [{label, url}]} with only links the person gave. This workspace can show: ${blockTypes.join(', ')}.`,
    'nav.home: {on, tab, label}: Home at / (on) and whether it has its own menu tab (tab). With Home off, the first menu page opens at /.',
    'nav.items: the menu in order. Pages: {"type": feedback, roadmap, changelog, help, support or status, "shown": true or false, "label": optional}. Links: {"type":"link","id","label","url","newTab"}, only links the person gave. With Home off, show at least one page.',
    `vocabulary.post (what visitors post): ${DESIGN_OPTIONS.postWord.join(', ')}. vocabulary.board (what groups them): ${DESIGN_OPTIONS.boardWord.join(', ')}.`,
    writesCss &&
      `css: the workspace's own CSS, styling the portal's parts by name, [data-qb-part="post-card"]. Parts: ${PORTAL_PARTS.map((part) => part.name).join(', ')}. Only for what no field above can do; no url() or @import.`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Examples of answers, kept valid against the design by the tests. */
export const EDIT_EXAMPLES = [
  {
    request: 'Make it feel calmer and give the cards more room',
    answer: {
      reply: 'I rounded the corners fully, raised the cards and gave the feed more room.',
      outOfScope: false,
      changes: [
        { path: 'shape.corners', value: '"pill"' },
        { path: 'layout.cards', value: '"raised"' },
        { path: 'layout.density', value: '"spacious"' },
      ],
    },
  },
  {
    request: 'Make us a Home page: a welcome, then status next to the composer, then our top ideas',
    answer: {
      reply: 'Home is on, with a welcome, status beside the composer and your top ideas.',
      outOfScope: false,
      changes: [
        { path: 'nav.home.on', value: 'true' },
        { path: 'pages.home.headline.title', value: '"Welcome to our community"' },
        {
          path: 'pages.home.blocks',
          value:
            '[{"type":"welcome","width":"full","body":"Share an idea, see what is coming and find help."},{"type":"composer","width":"two_thirds"},{"type":"status","width":"third"},{"type":"ideas","width":"full","sort":"top","count":5}]',
        },
      ],
    },
  },
  {
    request:
      'We call them feature requests, sorted into categories. Hide the changelog from the menu.',
    answer: {
      reply: 'Visitors now post feature requests in categories, and the changelog is off the menu.',
      outOfScope: false,
      changes: [
        { path: 'vocabulary.post', value: '"feature_request"' },
        { path: 'vocabulary.board', value: '"category"' },
        {
          path: 'nav.items',
          value:
            '[{"type":"feedback","shown":true},{"type":"roadmap","shown":true},{"type":"changelog","shown":false},{"type":"help","shown":true},{"type":"support","shown":true},{"type":"status","shown":true}]',
        },
      ],
    },
  },
] as const

function editPrompt(blockTypes: readonly HomeBlockType[], writesCss: boolean): string {
  return `You design a company's customer feedback portal by changing its design document. You may set any field below, by its dotted path, to any value it takes; numbers index lists (pages.home.blocks.0.width). To replace a list or a whole part, set its path to the whole new value.

${fieldGuide(blockTypes, writesCss)}

Reply with JSON: a one or two sentence reply to the person, outOfScope, and the changes as a list of {path, value}, where value is the new value written as JSON: "text" in quotes, a number, true or false, null, an object or a list. Change only what the request is about. Never invent a link, an uploaded file or a field. If the request is not about the portal, make no changes and say so.

${EDIT_EXAMPLES.map((example) => `Example request: "${example.request}"\nExample answer: ${JSON.stringify(example.answer)}`).join('\n\n')}`
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
  const vivid = mostVivid(palette)
  return `most used first: ${palette.join(', ')}.${vivid ? ` The most vivid, likely the brand colour: ${vivid}.` : ''}`
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
            ? `${input.message}\n\nColours from the attached image, ${paletteText(input.palette)}`
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
      `Colours from their logo or a screenshot, ${paletteText(input.palette)} Build the looks from these.`,
  ]
    .filter(Boolean)
    .join('\n')
  try {
    const answer = await structuredChat({
      model,
      systemPrompts: [DIRECTIONS_PROMPT],
      messages: [{ role: 'user', content: brief || 'Suggest three looks for a software company.' }],
      schema: directionsSchema,
      maxTokens: 2000,
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
