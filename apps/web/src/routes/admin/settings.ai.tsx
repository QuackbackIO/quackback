import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Retired route: AI & Automation elevated to its own main-nav area. Guarded
 * on the exact path (not a prefix check) because `/admin/settings/ai/sandbox`
 * nests under this route in the tree; an unconditional redirect here would
 * fire before that child route's own redirect gets a chance to run.
 */
export const Route = createFileRoute('/admin/settings/ai')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/admin/settings/ai') {
      throw redirect({ to: '/admin/automation/assistant', replace: true })
    }
  },
})
