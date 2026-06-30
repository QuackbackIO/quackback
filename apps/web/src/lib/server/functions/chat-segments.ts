/**
 * Server functions for the support-inbox "Segments" left-nav group. Reads the
 * existing segments + membership tables (populated by the segments domain) and
 * returns per-segment OPEN-conversation counts. Admin/member only — like the
 * rest of the inbox.
 */
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { listSegmentsWithConversationCounts } from '@/lib/server/domains/chat/chat-segment.service'

/** Non-deleted segments with their open-conversation counts (drives the inbox nav). */
export const fetchInboxSegmentsWithCountsFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    return listSegmentsWithConversationCounts()
  }
)
