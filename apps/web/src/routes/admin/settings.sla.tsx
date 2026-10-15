import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'

/** Retired path: SLA policies are a part of Hours & SLAs. */
export const Route = createFileRoute('/admin/settings/sla')({
  beforeLoad: ({ location }) => redirectMoved('/admin/settings/hours-sla', location),
})
