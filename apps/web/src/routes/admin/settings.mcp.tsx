import { createFileRoute, redirect } from '@tanstack/react-router'
import { adminPageHead } from '@/lib/client/admin-head'

/**
 * MCP settings moved onto the Developers page. Keep this path so bookmarks
 * and the old e2e URL land on the MCP tab.
 */
export const Route = createFileRoute('/admin/settings/mcp')({
  head: adminPageHead('MCP settings'),
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/developers', search: { tab: 'mcp' } })
  },
})
