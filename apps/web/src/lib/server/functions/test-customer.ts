import { createServerFn } from '@tanstack/react-start'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { policyActorFromAuth, requireAuth } from './auth-helpers'

/** The Test view's "Delete test conversations": every test thread the caller can see. */
export const deleteTestConversationsFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
  const { deleteTestConversations } =
    await import('@/lib/server/domains/conversation/conversation.test-data')
  return { deleted: await deleteTestConversations(await policyActorFromAuth(auth)) }
})
