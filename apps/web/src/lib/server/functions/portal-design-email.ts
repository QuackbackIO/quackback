/**
 * The sign-in email as visitors will get it once the draft is published, for
 * the designer's publish review. Read only: it renders, never sends.
 */
import { createServerFn } from '@tanstack/react-start'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { requireAuth } from './auth-helpers'

const log = logger.child({ module: 'portal-design-email-fn' })

export type EmailSampleResult = { ok: true; html: string } | { ok: false; message: string }

export const getSignInEmailSampleFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<EmailSampleResult> => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    try {
      const [
        { getDesignState },
        { designEmailBranding },
        { renderSignInEmailSample },
        { brandImageDeps, brandSquareSample },
      ] = await Promise.all([
        import('@/lib/server/domains/design/design.service'),
        import('@/lib/server/email/email-brand'),
        import('@quackback/email'),
        import('@/lib/server/domains/design/share-card/serve'),
      ])
      const state = await getDesignState()
      const doc = state?.draft ?? state?.published?.document ?? null
      if (!doc) return { ok: false, message: 'No design to show yet.' }
      const { logoUrl, brand, drawn, title } = designEmailBranding(
        doc,
        auth.settings.logoKey,
        auth.settings.name
      )
      // The portal draws its brand image from the published design: the draft's is drawn here.
      const header = drawn
        ? await brandSquareSample(doc, title ?? 'Quackback', drawn, brandImageDeps())
        : logoUrl
      const html = await renderSignInEmailSample({
        brand,
        logoUrl: header,
        workspaceName: auth.settings.name,
      })
      return { ok: true, html }
    } catch (err) {
      log.warn({ err }, 'sign-in email sample failed')
      return { ok: false, message: 'The email sample could not be drawn.' }
    }
  }
)

export type ShareCardSampleResult = { ok: true; src: string } | { ok: false; message: string }

/** The link preview's image as visitors will get it once the draft is published. */
export const getShareCardSampleFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ShareCardSampleResult> => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    try {
      const [{ getDesignState }, { brandImageDeps, shareCardSample }, { getWorkspaceSettings }] =
        await Promise.all([
          import('@/lib/server/domains/design/design.service'),
          import('@/lib/server/domains/design/share-card/serve'),
          import('@/lib/server/domains/settings/settings.service'),
        ])
      const [state, settings] = await Promise.all([getDesignState(), getWorkspaceSettings()])
      const doc = state?.draft ?? state?.published?.document ?? null
      if (!doc || !settings) return { ok: false, message: 'No design to show yet.' }
      return { ok: true, src: await shareCardSample(doc, settings, brandImageDeps()) }
    } catch (err) {
      log.warn({ err }, 'share card sample failed')
      return { ok: false, message: 'The link preview could not be drawn.' }
    }
  }
)
