/**
 * Re-exports from the shared integration apps service.
 * The link/unlink/query logic is integration-type agnostic.
 */
export {
  linkTicketToPost,
  unlinkTicketFromPost,
  getLinkedPosts,
  type LinkTicketInput,
  type LinkTicketResult,
  type LinkedPost,
} from '@/lib/server/integrations/apps/service'
