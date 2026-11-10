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
      const [{ getDesignState }, { designEmailBranding }, { renderSignInEmailSample }] =
        await Promise.all([
          import('@/lib/server/domains/design/design.service'),
          import('@/lib/server/email/email-brand'),
          import('@quackback/email'),
        ])
      const state = await getDesignState()
      const doc = state?.draft ?? state?.published?.document ?? null
      if (!doc) return { ok: false, message: 'No design to show yet.' }
      const { logoUrl, brand } = designEmailBranding(doc, auth.settings.logoKey, auth.settings.name)
      const html = await renderSignInEmailSample({
        brand,
        logoUrl,
        workspaceName: auth.settings.name,
      })
      return { ok: true, html }
    } catch (err) {
      log.warn({ err }, 'sign-in email sample failed')
      return { ok: false, message: 'The email sample could not be drawn.' }
    }
  }
)
