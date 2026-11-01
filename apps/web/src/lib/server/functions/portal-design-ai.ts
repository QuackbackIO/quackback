/**
 * Server functions for Quackback AI in Appearance. Each needs the branding
 * permission. A request's changes land in the draft at once, with no apply
 * step; nothing reaches visitors until a person publishes.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { DESIGN_AI_SCOPES } from '@/lib/shared/design/apply-changes'
import { requireAuth } from './auth-helpers'

const hexColour = z.string().regex(/^#[0-9a-f]{6}$/i)

export const getPortalDesignAiStatusFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  const { designAiModel } = await import('@/lib/server/domains/design/ai/design-ai')
  return { available: designAiModel() !== null }
})

export const askPortalDesignAiFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      message: z.string().trim().min(1).max(2000),
      palette: z.array(hexColour).max(6).optional(),
      scope: z.enum(DESIGN_AI_SCOPES),
      history: z
        .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) }))
        .max(12),
    })
  )
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const [{ askDesignAi }, actions, { designAuthor }] = await Promise.all([
      import('@/lib/server/domains/design/ai/design-ai'),
      import('@/lib/server/domains/design/design.actions'),
      import('@/lib/server/domains/design/design-author'),
    ])
    const current = await actions.readDesignForEditing()
    const result = await askDesignAi({ ...data, design: current.design })
    if (!result.ok || result.applied.length === 0) return result
    const saved = await actions.saveDesignDraft(result.design, await designAuthor(auth))
    if (!saved.ok) return saved
    return { ...result, report: saved.report }
  })

export const portalDesignDirectionsFn = createServerFn({ method: 'POST' })
  .validator(
    z
      .object({
        site: z.string().trim().max(2048).optional(),
        words: z.string().trim().max(500).optional(),
        palette: z.array(hexColour).min(1).max(6).optional(),
      })
      .refine(
        (input) => input.site || input.words || input.palette,
        'Give a website, a few words or an image'
      )
  )
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const [{ designDirections }, { readSiteSignals }, actions] = await Promise.all([
      import('@/lib/server/domains/design/ai/design-ai'),
      import('@/lib/server/domains/design/ai/site-signals'),
      import('@/lib/server/domains/design/design.actions'),
    ])
    const site = data.site ? await readSiteSignals(data.site) : null
    if (data.site && !site && !data.words && !data.palette) {
      return {
        ok: false as const,
        code: 'SITE_UNREADABLE' as const,
        message:
          'That website could not be read. Check the address, or describe your brand instead.',
      }
    }
    const current = await actions.readDesignForEditing()
    return designDirections({
      design: current.design,
      site,
      words: data.words ?? null,
      palette: data.palette ?? null,
    })
  })
