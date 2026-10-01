import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'

/** Retired path: AI performance is the AI section of Analytics. */
export const Route = createFileRoute('/admin/automation/performance')({
  beforeLoad: () => redirectMoved('/admin/analytics?section=ai', {}),
})
