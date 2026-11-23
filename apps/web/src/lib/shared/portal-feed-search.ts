import { z } from 'zod'
import { PUBLIC_FEED_VIEWS, PUBLIC_POST_SORTS } from '@/lib/shared/types/filters'

/**
 * Search params of the portal feed (`/`). A hand-edited or stale link must
 * never fail the page: every bad value is dropped, like an unknown sort.
 */
export const portalFeedSearchSchema = z.object({
  board: z.string().optional().catch(undefined),
  search: z.string().optional().catch(undefined),
  // No schema default: the router would write it into the URL and redirect a bare
  // "/" to "/?sort=trending". An absent sort is trending wherever the feed reads it.
  sort: z.enum(PUBLIC_POST_SORTS).optional().catch('trending'),
  status: z.array(z.string()).optional().catch(undefined),
  tagIds: z.array(z.string()).optional().catch(undefined),
  minVotes: z.coerce.number().int().min(1).optional().catch(undefined),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => !Number.isNaN(new Date(s).getTime()), 'Invalid calendar date')
    .optional()
    .catch(undefined),
  responded: z.enum(['responded', 'unresponded']).optional().catch(undefined),
  // Team-only filters (rendered only for post.view_private holders; the server
  // ignores them for everyone else). URL-driven + shareable like the rest.
  owner: z.string().optional().catch(undefined),
  segmentIds: z.array(z.string()).optional().catch(undefined),
  view: z.enum(PUBLIC_FEED_VIEWS).optional().catch(undefined),
})
