import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'

/**
 * MCP settings are the Assistants page of Agents & API. Keep this path so
 * bookmarks and the old e2e URL land there.
 */
export const Route = createFileRoute('/admin/settings/mcp')({
  beforeLoad: ({ location }) => redirectMoved('/admin/settings/agents/assistants', location),
})
