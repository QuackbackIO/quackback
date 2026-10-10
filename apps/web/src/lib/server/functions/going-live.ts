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
    const result = await sendMessengerInstallEmail({
      to: data.email,
      senderName: auth.user.name || auth.user.email,
      workspaceName: auth.settings.name,
      // The short snippet: no comments for a one-line mail client to break.
      snippet: buildWidgetLoaderSnippet(getBaseUrl()),
    })
    return { sent: result.sent }
  })
