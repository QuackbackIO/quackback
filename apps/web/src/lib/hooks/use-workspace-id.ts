/**
 * Hook to get the workspace ID from route context.
 * Only available in cloud multi-tenant mode.
 */

import { useRouteContext } from '@tanstack/react-router'
import type { RequestContext } from '@/lib/tenant'

/**
 * Get the workspace ID from route context.
 * Returns the workspace ID for cloud tenants, undefined otherwise.
 *
 * Note: This is only populated in multi-tenant cloud mode when a tenant
 * has been successfully resolved from the request domain.
 */
export function useWorkspaceId(): string | undefined {
  const context = useRouteContext({ from: '__root__' })
  const requestContext = context.requestContext as RequestContext | undefined

  if (requestContext?.type === 'tenant') {
    return requestContext.workspaceId
  }

  return undefined
}
