import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth } from './auth-helpers'

/** Whether Messenger has loaded on the customer's site yet; the install sheet polls it. */
export const getMessengerInstallStatusFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  const { getMessengerInstallStatus } =
    await import('@/lib/server/domains/onboarding/messenger-install')
  return getMessengerInstallStatus()
})

/** Copying the snippet switches Messenger on, so its first load already shows it. */
export const readyMessengerInstallFn = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  const { readyMessengerForInstall } =
    await import('@/lib/server/domains/onboarding/messenger-install')
  await readyMessengerForInstall()
  return { ok: true }
})

const instructionsSchema = z.object({ email: z.string().trim().email().max(320) })

/** Email the snippet to whoever edits the website. */
export const sendMessengerInstallInstructionsFn = createServerFn({ method: 'POST' })
  .validator(instructionsSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { assertInstallInstructionsAllowed, readyMessengerForInstall } =
      await import('@/lib/server/domains/onboarding/messenger-install')
    await assertInstallInstructionsAllowed(auth.principal.id, auth.principal.role)
    await readyMessengerForInstall()
    const [{ sendMessengerInstallEmail }, { buildWidgetLoaderSnippet }, { getBaseUrl }] =
      await Promise.all([
        import('@quackback/email'),
        import('@/lib/shared/widget/install-prompt'),
        import('@/lib/server/config'),
      ])
    // The address's own language when it has an account; else the language
    // of the teammate who sends it, who knows who will read it.
    const { recipientEmailLocale, recipientLocale, emailLocaleFor, requestAcceptLanguage } =
      await import('@/lib/server/email/email-locale')
    const { db, user, sql } = await import('@/lib/server/db')
    const [known] = await db
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = ${data.email.trim().toLowerCase()}`)
      .limit(1)
    const i18n = known
      ? await recipientEmailLocale({ userId: known.id })
      : await emailLocaleFor(
          await recipientLocale(
            { userId: auth.user.id },
            { acceptLanguage: await requestAcceptLanguage() }
          )
        )
    const result = await sendMessengerInstallEmail({
      to: data.email,
      i18n,
      senderName: auth.user.name || auth.user.email,
      workspaceName: auth.settings.name,
      // The short snippet: no comments for a one-line mail client to break.
      snippet: buildWidgetLoaderSnippet(getBaseUrl()),
    })
    return { sent: result.sent }
  })
