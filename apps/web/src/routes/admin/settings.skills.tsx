import { createFileRoute } from '@tanstack/react-router'
import { redirectMoved } from '@/lib/shared/moved-route'

/** Retired path: skills are the Procedures tab of Quackback AI, Guidance. */
export const Route = createFileRoute('/admin/settings/skills')({
  beforeLoad: ({ location }) =>
    redirectMoved('/admin/settings/ai/guidance?tab=procedures', location),
})
