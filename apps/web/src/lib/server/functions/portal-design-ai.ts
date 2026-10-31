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

/**
 * What Quackback AI may bring into this workspace's design: Home blocks for
 * the pages it has, and CSS the check passes on a plan with custom CSS.
 */
async function designAllowances() {
  const [
    { getWorkspaceSettings },
    { portalPageGates },
    { homeBlockTypes },
    { lintDesignCss },
    { assertTierFeature },
  ] = await Promise.all([
    import('@/lib/server/domains/settings/settings.service'),
    import('@/lib/shared/design/paths'),
    import('@/lib/shared/design/home'),
    import('@/lib/server/domains/design/css-lint'),
    import('@/lib/server/domains/settings/tier-enforce'),
  ])
  const settings = await getWorkspaceSettings()
  const cssOnPlan = await assertTierFeature('customCss', 'Custom CSS').then(
    () => true,
    () => false
  )
  const { config } = await import('@/lib/server/config')
  const writesCss = !!config.portalDesignAiCss
  return {
    blockTypes: homeBlockTypes(portalPageGates(settings, true)),
    writesCss,
    checkCss: (css: string) => {
      if (!writesCss) return 'Quackback AI does not write CSS'
      if (!cssOnPlan) return 'custom CSS is not on this plan'
      const [error] = lintDesignCss(css).errors
      return error ? `${error.line ? `line ${error.line}, ` : ''}${error.message}` : null
    },
  }
}

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
    const [current, allows] = await Promise.all([
      actions.readDesignForEditing(),
      designAllowances(),
    ])
    const result = await askDesignAi({ ...data, design: current.design, allows })
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
        /** The logo or screenshot, downscaled to a JPEG, for a model that reads images. */
        image: z
          .string()
          .max(700_000)
          .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)
          .optional(),
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
    const read = data.site ? await readSiteSignals(data.site) : null
    const site = read?.ok ? read.signals : null
    if (read && !read.ok && !data.words && !data.palette) {
      return {
        ok: false as const,
        code: 'SITE_UNREADABLE' as const,
        message:
          read.reason === 'blocked'
            ? 'That website blocks automated visits. Start from a screenshot of it instead.'
            : 'That website could not be read. Check the address, or describe your brand instead.',
      }
    }
    const [current, allows, { getWorkspaceSettings }] = await Promise.all([
      actions.readDesignForEditing(),
      designAllowances(),
      import('@/lib/server/domains/settings/settings.service'),
    ])
    return designDirections({
      design: current.design,
      name: (await getWorkspaceSettings())?.name ?? null,
      site,
      words: data.words ?? null,
      palette: data.palette ?? null,
      image: data.image ?? null,
      allows,
    })
  })
