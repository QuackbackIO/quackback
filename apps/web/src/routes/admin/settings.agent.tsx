import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { redirectMoved } from '@/lib/shared/moved-route'

/** Retired path: Agent became Quackback AI, Customers. A tab opens its own page. */
export const Route = createFileRoute('/admin/settings/agent')({
  validateSearch: z.object({
    tab: z.enum(['basics', 'knowledge', 'guidance', 'actions']).optional(),
  }),
  beforeLoad: ({ search, location }) => {
    if (search.tab === 'knowledge')
      redirectMoved('/admin/settings/ai/knowledge?tab=customers', location)
    if (search.tab === 'guidance')
      redirectMoved('/admin/settings/ai/guidance?tab=customers', location)
    if (search.tab === 'actions') redirectMoved('/admin/settings/ai/actions', location)
    redirectMoved('/admin/settings/ai/customers', location)
  },
})
