/**
 * The builder's side of Ask AI's edit loop: each step asks the server for
 * the model's operations and styles (applied to the draft and saved), shows
 * the new draft, draws it in the off-screen check frame, reads what the step
 * said to check (forced hover and focus included, style-reader.ts) and hands
 * what it saw to the next step. Without a check frame it reads the design
 * itself (static-reading.ts), so the loop still checks, less exactly.
 */
import {
  runEditLoop,
  type LoopBudget,
  type LoopDeps,
  type LoopResult,
  type StepReply,
} from '@/lib/shared/design/agent/loop'
import { staticReadings } from '@/lib/shared/design/agent/static-reading'
import {
  placeOf,
  STYLE_REGISTRY,
  type StyleRegistry,
  type StyleTarget,
} from '@/lib/shared/design/agent/style-registry'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { AiElementPick, DesignAiScope } from '@/lib/shared/design/apply-changes'
import type { AiReach } from '@/lib/shared/design/ai-reach'
import type { DesignerPage } from '@/lib/shared/design/outline'
import type { SupportedLocale } from '@/lib/shared/i18n'
import type { CheckFrame } from './check-frame'
import { capturePreview } from './preview-capture'
import { readDrawn } from './style-reader'

/** What one step's request to the server carries besides the step itself. */
export interface EditLoopRequest {
  message: string
  scope: DesignAiScope
  blockId?: string
  /** An element picked on the canvas, which "just this" names. */
  element?: AiElementPick
  /** How far the request may reach from the pick, as the composer's chip says. */
  within?: AiReach
  images?: Array<{ palette: string[]; image?: string }>
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  page?: DesignerPage
  locale?: SupportedLocale
}

/** The server's answer to one step, as designAgentStepFn returns it. */
export type ServerStep =
  | (Extract<StepReply, { ok: true }> & { report: unknown; revision: string })
  | { ok: false; code: string; message: string }

export interface EditLoopDeps {
  /** One step on the server. */
  step: (
    body: EditLoopRequest & {
      step: Parameters<Parameters<typeof runEditLoop>[0]['deps']['step']>[0]
      maxSteps: number
    }
  ) => Promise<ServerStep>
  /** Shows a step's saved draft in the builder, inside the request's one undo step. */
  adopt: (design: PortalDesign, report: unknown, revision: string) => void
  /** Opens the off-screen check frame on a design; none reads the design itself. */
  open?: (design: PortalDesign) => Promise<CheckFrame<PortalDesign>>
  /** The CSS the frame writes for a design, which says when it has drawn it. */
  previewCss: (design: PortalDesign) => string
  progress?: (line: string) => void
  picture?: (frame: HTMLIFrameElement | null) => Promise<string | null>
  /** read_website, on the server: the site's facts and a capture. */
  readWebsite?: LoopDeps['readWebsite']
  /** match_website: the brand match on a site, saved to the draft; its design after. */
  matchWebsite?: LoopDeps['matchWebsite']
}

/** Runs a request through the loop from the builder. */
export async function runBuilderEditLoop(
  input: EditLoopRequest & {
    design: PortalDesign
    targets: StyleTarget[]
    budget: LoopBudget
    /** The person's Stop: no step starts after it, and what applied stays. */
    signal?: AbortSignal
  },
  deps: EditLoopDeps,
  registry: StyleRegistry = STYLE_REGISTRY
): Promise<LoopResult> {
  const original = input.design
  let current = original
  const { design: _design, targets, budget, signal, ...request } = input
  // The frame opens while the first step is asked; reading waits for it.
  const opening: Promise<CheckFrame<PortalDesign> | null> = deps.open
    ? deps.open(original).catch(() => null)
    : Promise.resolve(null)
  let frame: CheckFrame<PortalDesign> | null = null
  const ready = async () => (frame = await opening)
  const shows = (design: PortalDesign) => {
    frame?.show(design)
  }
  try {
    return await runEditLoop({
      registry,
      design: original,
      targets,
      budget,
      pick: { scope: request.scope, ...(request.page ? { page: request.page } : {}) },
      ...(signal ? { signal } : {}),
      deps: {
        progress: deps.progress,
        step: async (step) => {
          const reply = await deps.step({ ...request, step, maxSteps: budget.steps })
          if (!reply.ok) return reply
          if (reply.outcome.applied.length > 0 && reply.report)
            deps.adopt(reply.design, reply.report, reply.revision)
          current = reply.design
          return { ok: true, answer: reply.answer, outcome: reply.outcome, design: reply.design }
        },
        read: async (all, which) => {
          const design = which === 'before' ? original : current
          // An element where an override went may be on a page the preview does not show:
          // it is read from the design.
          const placed = staticReadings(
            design,
            registry,
            all.filter((t) => placeOf(t))
          )
          const want = all.filter((t) => !placeOf(t))
          if (!want.length) return placed
          const open = await ready()
          if (!open) return { ...staticReadings(design, registry, want), ...placed }
          shows(design)
          try {
            return {
              ...(await readDrawn(open.frame, registry, want, deps.previewCss(design))),
              ...placed,
            }
          } catch {
            return { ...staticReadings(design, registry, want), ...placed }
          } finally {
            if (which === 'before' && current !== original) shows(current)
          }
        },
        ...(deps.readWebsite && { readWebsite: deps.readWebsite }),
        ...(deps.matchWebsite && {
          matchWebsite: async (url: string) => {
            const matched = await deps.matchWebsite!(url)
            if (matched.design) current = matched.design
            return matched
          },
        }),
        picture: async () => {
          const open = await ready()
          if (!open) return null
          shows(current)
          await readDrawn(open.frame, registry, [], deps.previewCss(current)).catch(() => null)
          return (deps.picture ?? capturePreview)(open.frame())
        },
      },
    })
  } finally {
    void opening.then((opened) => opened?.close())
  }
}
