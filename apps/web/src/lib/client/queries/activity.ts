import { queryOptions } from '@tanstack/react-query'
import type { PostId, TicketId } from '@quackback/ids'
import { fetchActivityForPost } from '@/lib/server/functions/activity'
import { fetchTicketActivityFn } from '@/lib/server/functions/tickets'

/**
 * Query options factory for activity logs (posts + tickets).
 */
export const activityQueries = {
  /**
   * All activity for a single post (for Activity tab).
   */
  forPost: (postId: PostId) =>
    queryOptions({
      queryKey: ['activity', 'post', postId],
      queryFn: () => fetchActivityForPost({ data: { postId } }),
      staleTime: 15 * 1000,
    }),
  /**
   * All activity for a single ticket (admin detail panel Activity section).
   */
  forTicket: (ticketId: TicketId) =>
    queryOptions({
      queryKey: ['activity', 'ticket', ticketId],
      queryFn: () => fetchTicketActivityFn({ data: { ticketId } }),
      staleTime: 15 * 1000,
    }),
}
