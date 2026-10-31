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
import { logger } from '@/lib/server/logger'

const log = logger.child({ module: 'portal-design-ai-fn' })

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
    /** The workspace's name, which its portal shows. */
    name: settings?.name ?? null,
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

/**
 * A website's logo becomes the workspace's when it has none yet and the person
 * may change the workspace's settings, where the logo lives. Only a logo the
 * lookup is sure of is taken. Whether it was taken.
 */
async function adoptSiteLogo(site: string, mayManageSettings: boolean): Promise<boolean> {
  if (!mayManageSettings) return false
  const [{ getWorkspaceSettings }, { fetchWebsiteBranding }, { saveLogoKey }] = await Promise.all([
    import('@/lib/server/domains/settings/settings.service'),
    import('@/lib/server/content/website-branding'),
    import('@/lib/server/domains/settings/settings.media'),
  ])
  if ((await getWorkspaceSettings())?.settings?.logoKey) return false
  const branding = await fetchWebsiteBranding(site)
  if (!branding || branding.quality !== 'good') return false
  await saveLogoKey(branding.logoKey)
  log.info({ domain: branding.domain }, 'website logo adopted as the workspace logo')
  return true
}

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
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const [{ designDirections }, { readSiteSignals }, { importSiteAssets }, actions] =
      await Promise.all([
        import('@/lib/server/domains/design/ai/design-ai'),
        import('@/lib/server/domains/design/ai/site-signals'),
        import('@/lib/server/domains/design/ai/site-assets'),
        import('@/lib/server/domains/design/design.actions'),
      ])
    const [read, logoAdopted] = data.site
      ? await Promise.all([
          readSiteSignals(data.site),
          adoptSiteLogo(data.site, auth.permissions.includes(PERMISSIONS.SETTINGS_MANAGE)),
        ])
      : [null, false]
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
    const [current, allows, assets] = await Promise.all([
      actions.readDesignForEditing(),
      designAllowances(),
      // The site's wordmark and share image, stored for the looks to place.
      site ? importSiteAssets(site) : null,
    ])
    const result = await designDirections({
      design: current.design,
      name: allows.name,
      site,
      words: data.words ?? null,
      palette: data.palette ?? null,
      image: data.image ?? null,
      assets,
      allows,
    })
    return result.ok ? { ...result, logoAdopted } : result
  })
