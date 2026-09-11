import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * MCP settings moved onto the Developers page. Keep this path so bookmarks
 * and the old e2e URL land on the MCP tab.
 */
export const Route = createFileRoute('/admin/settings/mcp')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/developers', search: { tab: 'mcp' } })
  },
})
