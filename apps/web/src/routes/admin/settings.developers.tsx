import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { redirectMoved } from '@/lib/shared/moved-route'

/** Retired path: Developers became Agents & API. Each tab is a page of its own. */
export const Route = createFileRoute('/admin/settings/developers')({
  validateSearch: z.object({ tab: z.enum(['keys', 'webhooks', 'mcp']).optional() }),
  beforeLoad: ({ search, location }) => {
    if (search.tab === 'webhooks') redirectMoved('/admin/settings/agents/webhooks', location)
    if (search.tab === 'mcp') redirectMoved('/admin/settings/agents/assistants', location)
    redirectMoved('/admin/settings/agents/keys', location)
  },
})
