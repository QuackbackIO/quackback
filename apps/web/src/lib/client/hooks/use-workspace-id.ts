/**
 * Hook to get the workspace ID from route context.
 * Returns undefined for self-hosted mode.
 */

/**
 * Get the workspace ID from route context.
 * Returns undefined for self-hosted deployments.
 */
export function useWorkspaceId(): string | undefined {
  return undefined
}
