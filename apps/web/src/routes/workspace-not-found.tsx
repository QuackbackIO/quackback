import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceNotFoundPage } from '@/components/workspace-not-found'

/**
 * Workspace Not Found Route
 *
 * Fallback route for when auth routes redirect here due to missing settings.
 * Uses the shared WorkspaceNotFoundPage component for consistency.
 */
export const Route = createFileRoute('/workspace-not-found')({
  component: WorkspaceNotFoundPage,
})
