import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'

/** Retired path: office hours are a part of Hours & SLAs. */
export const Route = createFileRoute('/admin/settings/office-hours')({
  beforeLoad: ({ location }) => redirectMoved('/admin/settings/hours-sla', location),
})
