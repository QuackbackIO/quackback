import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { SUPPORTED_LOCALES } from '@/lib/shared/i18n'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { policyActorFromAuth, requireAuth } from './auth-helpers'

const mintSchema = z.object({ locale: z.enum(SUPPORTED_LOCALES) })

/** A single-use token that signs a widget frame in as the caller's test customer. */
export const mintTestCustomerTokenFn = createServerFn({ method: 'POST' })
  .validator(mintSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    const { mintTestCustomerToken } = await import('@/lib/server/test-customer')
    return mintTestCustomerToken(auth.principal.id, data.locale)
  })

/** The same token as a portal link, for a second device to open from a QR code. */
export const mintTestCustomerPhoneLinkFn = createServerFn({ method: 'POST' })
  .validator(mintSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    const { mintTestCustomerToken } = await import('@/lib/server/test-customer')
    const { getBaseUrl } = await import('@/lib/server/config')
    const { token, expiresAt } = await mintTestCustomerToken(auth.principal.id, data.locale)
    const url = new URL('/try-messenger', getBaseUrl())
    url.searchParams.set('ott', token)
    // Not a secret: lets the phone tell an expired code from a used one.
    url.searchParams.set('exp', String(Date.parse(expiresAt)))
    return { url: url.toString(), token, expiresAt }
  })

/** Whether the phone code on screen still waits to be scanned; once not, the sheet shows a new one. */
export const getTestCustomerPhoneLinkStatusFn = createServerFn({ method: 'POST' })
  .validator(z.object({ token: z.string().max(100) }))
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    const { isTestCustomerTokenPending } = await import('@/lib/server/test-customer')
    return { pending: await isTestCustomerTokenPending(auth.principal.id, data.token) }
  })

/** What the "Try Messenger" sheet shows beside the frame. */
export const getTestCustomerOverviewFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
  const { latestTestConversationId } = await import('@/lib/server/test-customer')
  const { testEmailAlias } =
    await import('@/lib/server/domains/conversation/conversation.email-channel')
  const { currentMailSlug } =
    await import('@/lib/server/domains/conversation/conversation.mail-slug')
  return {
    conversationId: await latestTestConversationId(auth.principal.id),
    // The caller's own test alias: mail to it lands as their test customer.
    testEmailAddress: testEmailAlias(auth.principal.id, currentMailSlug()),
  }
})

/** The Test view's "Delete test conversations": every test thread the caller can see. */
export const deleteTestConversationsFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
  const { deleteTestConversations } =
    await import('@/lib/server/domains/conversation/conversation.test-data')
  return { deleted: await deleteTestConversations(await policyActorFromAuth(auth)) }
})
