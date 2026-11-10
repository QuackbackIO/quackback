/**
 * Server functions for Quackback AI in Appearance. Each needs the branding
 * permission. A request's changes land in the draft at once, with no apply
 * step; nothing reaches visitors until a person publishes.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { DESIGN_AI_SCOPES } from '@/lib/shared/design/apply-changes'
import { AI_REACHES } from '@/lib/shared/design/ai-reach'
import { BLOCK_ID } from '@/lib/shared/design/schema'
import { STYLE_ELEMENT_NAMES, type StyleElement } from '@/lib/shared/design/style-tokens'
import { PART_ID } from '@/lib/shared/design/style-overrides'
import { PAGE_NAMES, type DesignerPage } from '@/lib/shared/design/outline'
import { SUPPORTED_LOCALES } from '@/lib/shared/i18n'
import { requireAuth } from './auth-helpers'

const hexColour = z.string().regex(/^#[0-9a-f]{6}$/i)

/** An element picked on the canvas: its kind, and the part it is (null for one of many). */
const elementPick = z.object({
  element: z.enum(STYLE_ELEMENT_NAMES as [StyleElement, ...StyleElement[]]),
  part: z.string().max(96).regex(PART_ID).nullable(),
})

export const getPortalDesignAiStatusFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  const { designAiModel } = await import('@/lib/server/domains/design/ai/design-ai')
  return { available: designAiModel() !== null }
})

/** Most images one chat message carries. */
const MAX_CHAT_IMAGES = 4

/** One attached image: its colours, and the picture downscaled to a JPEG. */
const chatImage = z.object({
  palette: z.array(hexColour).max(6),
  image: z
    .string()
    .max(700_000)
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)
    .optional(),
})

export const askPortalDesignAiFn = createServerFn({ method: 'POST' })
  .validator(
    z
      .object({
        /** Empty when images were sent with nothing else. A brand match from screenshots streams from /api/admin/design/brand-match. */
        message: z.string().trim().max(2000),
        /** Up to four attached images: their colours, and each picture where the model reads images. */
        images: z.array(chatImage).max(MAX_CHAT_IMAGES).optional(),
        scope: z.enum(DESIGN_AI_SCOPES),
        /** A Home block picked in the designer, narrowing a Home request to it. */
        blockId: z.string().regex(BLOCK_ID).optional(),
        /** An element picked on the canvas, which "just this" names. */
        element: elementPick.optional(),
        /** How far the request may reach from the pick, as the composer's chip says: just it, the page shown, or everywhere it is. */
        within: z.enum(AI_REACHES).optional(),
        history: z
          .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) }))
          .max(12),
        /** The page on the designer's canvas and the language it shows. */
        page: z.enum(Object.keys(PAGE_NAMES) as [DesignerPage, ...DesignerPage[]]).optional(),
        locale: z.enum(SUPPORTED_LOCALES).optional(),
      })
      .refine((input) => input.message || input.images?.length, 'Say something or add an image')
  )
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const [{ askDesignAi }, actions, { designAuthor }] = await Promise.all([
      import('@/lib/server/domains/design/ai/design-ai'),
      import('@/lib/server/domains/design/design.actions'),
      import('@/lib/server/domains/design/design-author'),
    ])
    const { designAllowances } = await import('@/lib/server/domains/design/design-allowances')
    const { listDesignerPlaces } = await import('@/lib/server/domains/design/designer-places')
    const [current, allows, places] = await Promise.all([
      actions.readDraftForChange(),
      designAllowances(),
      listDesignerPlaces(),
    ])
    // The builder's Stop ends the request: the model call ends, and nothing is saved after it.
    const signal = getRequest().signal
    // Boards, roadmaps and help topics by name, so a request can name them.
    const result = await askDesignAi({
      ...data,
      design: current.design,
      allows,
      gates: allows.gates,
      places,
      signal,
    }).catch((err: unknown) => {
      if (signal.aborted) return STOPPED
      throw err
    })
    if (!result.ok || result.applied.length === 0) return result
    if (signal.aborted) return STOPPED
    const saved = await actions.saveDesignDraft(
      result.design,
      { ...(await designAuthor(auth)), via: 'ai' },
      current.revision
    )
    if (!saved.ok) return movedOn(saved)
    return { ...result, report: saved.report, revision: saved.revision }
  })

/** What the steps before did and saw, as the builder sends it back each step. */
const loopTurn = z.object({
  step: z.number().int().min(0).max(8),
  plan: z.string().max(400),
  did: z.array(z.string().max(300)).max(40),
  refused: z.array(z.object({ what: z.string().max(300), reason: z.string().max(400) })).max(20),
  checks: z.array(z.object({ ok: z.boolean().nullable(), saw: z.string().max(400) })).max(24),
})

/**
 * One step of Ask AI's edit loop: the model's operations and styles for this
 * step, applied to the draft and saved, with what it asked the builder to
 * check and read. The builder runs the loop (shared/design/agent/loop.ts):
 * it draws each step's draft, reads it, and sends what it saw to the next.
 */
export const designAgentStepFn = createServerFn({ method: 'POST' })
  .validator(
    z
      .object({
        message: z.string().trim().max(2000),
        images: z.array(chatImage).max(MAX_CHAT_IMAGES).optional(),
        scope: z.enum(DESIGN_AI_SCOPES),
        blockId: z.string().regex(BLOCK_ID).optional(),
        /** An element picked on the canvas, which "just this" names. */
        element: elementPick.optional(),
        /** How far the request may reach from the pick, as the composer's chip says: just it, the page shown, or everywhere it is. */
        within: z.enum(AI_REACHES).optional(),
        history: z
          .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) }))
          .max(12),
        page: z.enum(Object.keys(PAGE_NAMES) as [DesignerPage, ...DesignerPage[]]).optional(),
        locale: z.enum(SUPPORTED_LOCALES).optional(),
        step: z.object({
          step: z.number().int().min(0).max(8),
          turns: z.array(loopTurn).max(8),
          readings: z
            .array(
              z.object({
                target: z.string().max(120),
                values: z.record(z.string().max(40), z.string().max(300)),
              })
            )
            .max(12),
          picture: z
            .string()
            .max(700_000)
            .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)
            .nullable(),
          last: z.boolean(),
          /** The website tools' results so far, as the loop says them. */
          website: z.array(z.string().max(8000)).max(6).optional(),
          /** A capture of a website read, for the model to see. */
          capture: z
            .string()
            .max(700_000)
            .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)
            .nullable()
            .optional(),
        }),
        maxSteps: z.number().int().min(1).max(8),
      })
      .refine((input) => input.message || input.images?.length, 'Say something or add an image')
  )
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const [{ allowanceRefusal }, { agentStep }, actions, { designAuthor }] = await Promise.all([
      import('@/lib/server/domains/design/ai/design-ai'),
      import('@/lib/server/domains/design/ai/design-agent'),
      import('@/lib/server/domains/design/design.actions'),
      import('@/lib/server/domains/design/design-author'),
    ])
    const limited = await allowanceRefusal()
    if (limited) return limited
    const { designAllowances } = await import('@/lib/server/domains/design/design-allowances')
    const { listDesignerPlaces } = await import('@/lib/server/domains/design/designer-places')
    const { storedSiteImages } = await import('@/lib/server/domains/design/site/website-reading')
    const [current, allows, places, files] = await Promise.all([
      actions.readDraftForChange(),
      designAllowances(),
      listDesignerPlaces(),
      // The website images read_website stored, which the model may place by their keys.
      storedSiteImages(),
    ])
    const { step, maxSteps, ...rest } = data
    // The builder's Stop ends the step: the model call ends, and nothing is saved after it.
    const signal = getRequest().signal
    const reply = await agentStep({
      ...rest,
      design: current.design,
      allows: { ...allows, files },
      gates: allows.gates,
      places,
      request: step,
      maxSteps,
      signal,
    }).catch((err: unknown) => {
      if (signal.aborted) return STOPPED
      throw err
    })
    if (!reply.ok) return reply
    if (reply.outcome.applied.length === 0)
      return { ...reply, revision: current.revision, report: null }
    if (signal.aborted) return STOPPED
    const saved = await actions.saveDesignDraft(
      reply.design,
      { ...(await designAuthor(auth)), via: 'ai' },
      current.revision
    )
    if (!saved.ok) return movedOn(saved)
    return { ...reply, report: saved.report, revision: saved.revision }
  })

/** A request the builder stopped: nothing more is saved, and no one is waiting for the answer. */
const STOPPED = { ok: false as const, code: 'STOPPED' as const, message: 'Stopped.' }

/**
 * A save refused because the draft moved while the request was worked on,
 * such as by a change made meanwhile, said so a person can ask again.
 */
function movedOn<T extends { ok: false; code: string; message: string }>(refusal: T): T {
  return refusal.code === 'REVISION_MISMATCH'
    ? {
        ...refusal,
        message: 'The draft changed while this was worked on, so nothing changed. Ask again.',
      }
    : refusal
}

/** A screenshot or brand image, downscaled to a JPEG, for a model that reads images. */
const jpegImage = z
  .string()
  .max(700_000)
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)

/**
 * Screenshots read for what their pixels cannot say: the brand's name, a crop
 * box around its mark, and which images a banner covers or a pop-up dims.
 * Nothing changes in the draft.
 */
export const readBrandShotsFn = createServerFn({ method: 'POST' })
  .validator(z.object({ images: z.array(jpegImage).min(1).max(3) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const [{ designAiModel, allowanceRefusal }, { readShots }] = await Promise.all([
      import('@/lib/server/domains/design/ai/design-ai'),
      import('@/lib/server/domains/design/ai/shot-read'),
    ])
    const model = designAiModel()
    if (!model) return { ok: true as const, read: null }
    const limited = await allowanceRefusal()
    if (limited) return limited
    return { ok: true as const, read: await readShots(model, data.images) }
  })
