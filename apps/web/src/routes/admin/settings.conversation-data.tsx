import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { redirectMoved } from '@/lib/shared/moved-route'

/** Retired path: conversation attributes and tags are Fields & tags, under Support. */
export const Route = createFileRoute('/admin/settings/conversation-data')({
  validateSearch: z.object({ tab: z.enum(['attributes', 'tags']).optional() }),
  beforeLoad: ({ location }) => redirectMoved('/admin/settings/fields', location),
})
