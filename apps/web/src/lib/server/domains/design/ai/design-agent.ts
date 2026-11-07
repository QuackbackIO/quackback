/**
 * One step of Ask AI's edit loop on the server: the model reads the request,
 * the portal now, the styling registry and what the steps before did and
 * saw, and answers with its calls (operations, styles, checks, reads,
 * finish); the operations and styles are applied to the design as Ask AI's
 * operations are, each checked. The loop itself (shared/design/agent/loop.ts)
 * runs in the builder, which draws each step's design and reads it, or in
 * the eval, which reads it from the design.
 */
import { structuredChat } from '@/lib/server/domains/ai/structured-chat'
import { logger } from '@/lib/server/logger'
import { designContext, aiCatalogue } from '@/lib/shared/design/design-context'
import type { AiPlaces, FlatOp } from '@/lib/shared/design/design-ops'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { DesignerPage } from '@/lib/shared/design/outline'
import type { DesignAiScope, UntrustedChanges } from '@/lib/shared/design/apply-changes'
import { applyStep } from '@/lib/shared/design/agent/style-ops'
import { agentStepSchema, type AgentStepAnswer } from '@/lib/shared/design/agent/step-schema'
import {
  STYLE_REGISTRY,
  registryText,
  type StyleRegistry,
} from '@/lib/shared/design/agent/style-registry'
import type { StepReply, StepRequest } from '@/lib/shared/design/agent/loop'
import { OPS_RULES, tuneText, valuesNow } from './design-ai-guide'
import { AGENT_EXAMPLES } from './design-agent-examples'
import { WEBSITE_TOOLS_TEXT } from '@/lib/shared/design/agent/website-tool'
import { languageName, viewNote } from './design-ai-view'
import {
  designAiModel,
  designUsage,
  isStructuredOutputError,
  linksGiven,
  paletteText,
  SCOPE_NAMES,
} from './design-ai'
import { BLOCK_NAMES } from '@/lib/shared/design/outline'
import { scopeNote as requestScopeNote, scopeOf } from '@/lib/shared/design/agent/router'
import type { StyleElement } from '@/lib/shared/design/style-tokens'
import { reachNote, type AiReach } from '@/lib/shared/design/ai-reach'

const log = logger.child({ module: 'design-agent' })

export { AGENT_EXAMPLES }

/** What the loop's model is told, besides the portal now. */
export function agentPrompt(input: {
  blockTypes: Parameters<typeof aiCatalogue>[0]['blockTypes']
  places: AiPlaces
  registry: StyleRegistry
}): string {
  const examples = AGENT_EXAMPLES.map(
    (example) =>
      `Example request${example.note ? ` (${example.note})` : ''}: "${example.request}"\nExample step: ${JSON.stringify(example.answer)}`
  )
  return `You change a company's customer feedback portal in a few steps. Each step you plan and act; then the builder draws the page, measures what you asked it to check, and gives you what it saw, so you can correct it. Answer each step with JSON:
- plan: one sentence: what this step does, or what it corrects and how.
- ops: operations on the design, each {op, target, key, value, says}, "" for a field an operation does not use.
- styles: an element's look in a state, each {element, state, block, property, value, says}, for what no operation sets: hover, focus and pressed states, the current menu item, a voted box, one element's fill, text colour, edge, corners or shadow, and one Home block's look (block: its type, such as roadmap; "" for every one).
- checks: what the drawn page must show once this step's changes are in, each {element, state, block, target, property, expect, value}; target is where an override went, as the override names it (part:<id>, page:<page>, block:<id>), "" for the site's look. expect: is (value the exact value), darker or lighter (value "base" to compare a state with the element at rest, "before" to compare with the page before the request), more or less (likewise), present, none, subtle (a faint shadow, or an edge or fill that barely stands off what is behind), strong, readable (text on its fill; value the least ratio, "" for 4.5), dark, light, changed. One to four checks on what the request is about; text readable where you style a fill or a text colour is checked for you.
- read: elements to read as drawn before your next step, when you need their values first.
- look: true to see a small picture of the page after this step, for a look described by feel or a picture to match.
- read_website and match_website: a website's address, or "" (Websites below).
- done: true when this step completes the request; false when you mean to look or correct next.
- reply: when done, one short sentence in plain words a non-designer understands, said as done ("The Log in button is now black."): name colours by name, never hex codes, colour roles, ids, token or setting names, scores or px values the person did not give; "" otherwise.

Prefer an operation where one does it: Theme for brand-wide colours, mode, corners, fonts, density, card style, how the menu marks the current page (menuStyle: tabs, underline, pills), how secondary buttons are drawn (secondary.style); exact values (op theme, key such as button.radius) for sizes and weights. The page's background (a colour, tint, gradient, pattern or glow behind the pages) is the background operation, never a style. A headline's accent, highlight or lighter half is a mark in its words (Marks below), never a style. Use styles for the rest. For one part, one page or phones only, use op override (below), never styles, which reach every page; a check on an override names its target, so it reads the element there; checks read the page at full width, so make none for phones only. A style colour is hex, or darker / lighter with a share (darker 15%) of what the element shows at rest, or a role: accent, text, page, surface, border, muted, support. Dark pages are set with Theme mode dark and darkBackground and darkText; a style's colours are drawn in the mode the page shows. When a check failed, correct the value, never the check; when it cannot be met, say so in reply and finish. When something cannot be done at all, make nothing for it and say so plainly. Finish by your last step.

${OPS_RULES}

${WEBSITE_TOOLS_TEXT}

${aiCatalogue({ blockTypes: input.blockTypes, places: input.places })}
Exact values (op theme, key such as headline.size): ${tuneText()}

Styling (styles, checks and read):
${registryText(input.registry)}

${examples.join('\n\n')}`
}

/** What the steps before did and saw, for the model. */
function progressText(request: StepRequest, maxSteps: number): string {
  const lines = request.turns.map((turn) => {
    const checks = turn.checks.map(
      (c) => `  ${c.ok === true ? 'met' : c.ok === false ? 'NOT MET' : 'not seen'}: ${c.saw}`
    )
    const refused = turn.refused.map((r) => `  refused: ${r.what}: ${r.reason}`)
    return [
      `Step ${turn.step + 1}: ${turn.plan}`,
      `  did: ${turn.did.length ? turn.did.join('; ') : 'nothing'}`,
      ...refused,
      ...checks,
    ].join('\n')
  })
  const reads = request.readings.map(
    (r) =>
      `${r.target}: ${Object.entries(r.values)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}`
  )
  return [
    `This is step ${request.step + 1} of at most ${maxSteps}.${request.last ? ' It is the last: finish (done true) and say plainly anything not done.' : ''}`,
    ...(lines.length ? ['So far:', ...lines] : []),
    ...(request.website?.length ? ['Websites:', ...request.website] : []),
    ...(reads.length ? [request.step === 0 ? 'As drawn now:' : 'Read as drawn:', ...reads] : []),
  ].join('\n')
}

export interface AgentStepInput {
  message: string
  design: PortalDesign
  scope: DesignAiScope
  blockId?: string
  /** An element picked on the canvas: its kind and the part it is, which "just this" names. */
  element?: { element: StyleElement; part: string | null }
  /** How far the request may reach from the pick, as the composer's chip says; every place the pick is when not given. */
  within?: AiReach
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  images?: Array<{ palette: string[]; image?: string }>
  allows: Omit<UntrustedChanges, 'links'> & {
    writesCss: boolean
  }
  page?: DesignerPage
  locale?: string
  places: AiPlaces
  gates: PortalPageGates
  request: StepRequest
  maxSteps: number
  registry?: StyleRegistry
}

/** One step of the loop: the model's calls, applied. */
export async function agentStep(input: AgentStepInput): Promise<StepReply> {
  const model = designAiModel()
  if (!model)
    return {
      ok: false,
      code: 'AI_UNAVAILABLE',
      message: 'Quackback AI is not set up for this workspace.',
    }
  const registry = input.registry ?? STYLE_REGISTRY
  const block =
    input.scope === 'home'
      ? input.design.pages.home.blocks.find((each) => each.id === input.blockId)
      : undefined
  const within = {
    scope: input.scope,
    ...(block ? { blockId: input.blockId } : {}),
    ...(input.element ? { element: input.element } : {}),
    ...(input.scope !== 'site' && input.within ? { reach: input.within } : {}),
    ...(input.page ? { page: input.page } : {}),
  }
  // The request's own words are a hint for the model; the chip's reach is what holds.
  const reads = requestScopeNote(input.message)
  const reach =
    input.scope === 'site' ? '' : reachNote(input.within, input.page, input.element?.part)
  const scopeNote =
    input.scope === 'site'
      ? ''
      : `\nThe person picked the ${block ? `${BLOCK_NAMES[block.type]} block on Home` : SCOPE_NAMES[input.scope as keyof typeof SCOPE_NAMES]} in the preview${input.element ? '' : ': every one of them, not one in particular'}. Change only ${input.element ? 'it' : 'them'}.${reach ? ` ${reach}` : ''} match_website is not offered: it restyles the whole site; use read_website to borrow from a site.`
  const view = viewNote(input.page, input.locale)
  const attached = (input.images ?? []).filter((each) => each.palette.length > 0)
  const colours = attached.length
    ? `\n\nColours from the attached image${attached.length > 1 ? 's' : ''}: ${attached.map((each) => paletteText(each.palette)).join(' / ')}`
    : ''
  const pictures = [
    ...(input.images ?? []).flatMap((each) => (each.image ? [each.image] : [])),
    ...(input.request.capture ? [input.request.capture] : []),
    ...(input.request.picture ? [input.request.picture] : []),
  ]
  const text = `${input.message}${colours}\n\n${progressText(input.request, input.maxSteps)}${input.request.capture ? `\n${input.request.picture ? 'The image before the last' : 'The last image'} is the website as captured.` : ''}${input.request.picture ? '\nThe last image is the page as drawn after the last step.' : ''}`
  const context = designContext(input.design, {
    gates: input.gates,
    places: input.places,
    ...(input.page ? { page: input.page } : {}),
    picked: within,
    parts: !!input.element || scopeOf(input.message).one,
  })
  const ask = (withImages: boolean) =>
    structuredChat({
      model,
      systemPrompts: [
        agentPrompt({ blockTypes: input.allows.blockTypes, places: input.places, registry }),
        `The portal now:\n${context}\n${valuesNow(input.design)}${scopeNote}${view ? `\n${view}` : ''}${reads ? `\n${reads}` : ''}`,
      ],
      messages: [
        ...input.history.slice(-6),
        {
          role: 'user',
          content:
            withImages && pictures.length
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
      schema: agentStepSchema(registry),
      maxTokens: 3000,
      middleware: designUsage(model, 'edit'),
    })
  let answer: AgentStepAnswer
  try {
    answer = await ask(true)
      .catch((err: unknown) => {
        if (!isStructuredOutputError(err)) throw err
        log.warn(
          { err, step: input.request.step },
          'design agent step did not fit the schema; asking again'
        )
        return ask(true)
      })
      .catch((err: unknown) => {
        if (!isStructuredOutputError(err) || pictures.length === 0) throw err
        return ask(false)
      })
  } catch (err) {
    if (!isStructuredOutputError(err)) throw err
    log.warn({ err }, 'design agent step did not fit the schema')
    return {
      ok: false,
      code: 'AI_FAILED',
      message: 'Quackback AI could not suggest a change. Try rephrasing.',
    }
  }
  const links = linksGiven([
    input.message,
    ...input.history.filter((turn) => turn.role === 'user').map((turn) => turn.content),
  ])
  const out = applyStep(
    input.design,
    {
      gates: input.gates,
      places: input.places,
      ...(input.locale ? { locale: input.locale } : {}),
      request: input.message,
      untrusted: {
        ...input.allows,
        links,
      },
    },
    registry,
    answer.ops.map(({ op, target, key, value }): FlatOp => ({
      op,
      ...(target ? { target } : {}),
      ...(key ? { key } : {}),
      ...(value ? { value } : {}),
    })),
    answer.styles,
    within
  )
  const { design, ...outcome } = out
  const words = input.locale && input.locale !== 'en' && answer.ops.some((op) => op.op === 'words')
  // match_website restyles the whole site: never for a request about one part.
  const scoped =
    input.scope !== 'site' && answer.match_website ? { ...answer, match_website: '' } : answer
  return {
    ok: true,
    answer: scoped,
    outcome: words
      ? {
          ...outcome,
          notes: [`The words are in ${languageName(input.locale!)}, the language shown.`],
        }
      : outcome,
    design,
  }
}
