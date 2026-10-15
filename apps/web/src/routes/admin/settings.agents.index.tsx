import { createFileRoute, redirect } from '@tanstack/react-router'
import { adminPageHead } from '@/lib/client/admin-head'

/** The module has no page of its own: it opens on its first page. */
export const Route = createFileRoute('/admin/settings/agents/')({
  head: adminPageHead('Agents and API settings'),
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/agents/assistants', replace: true })
  },
})
