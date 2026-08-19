/**
 * Archive/close dispatch for cascading post deletes.
 *
 * Each tracker provider implements `archive` on its IntegrationDefinition
 * (in `<provider>/archive.ts`), closing or archiving the linked item in the
 * external tracker. This module owns the shared types, the shared HTTP error
 * helper, and the registry dispatch. All implementations handle errors
 * gracefully -- failures are warnings, not blockers.
 */

// ============================================================================
// Types
// ============================================================================

export interface ArchiveResult {
  success: boolean
  action?: 'closed' | 'archived'
  error?: string
}

export interface ArchiveContext {
  externalId: string
  externalUrl?: string | null
  accessToken: string
  integrationConfig: Record<string, unknown>
}

// ============================================================================
// Helpers
// ============================================================================

export const ARCHIVE_TIMEOUT_MS = 10_000

/** Check common HTTP error statuses; returns null if response should be processed normally. */
export async function handleErrorStatus(
  response: Response,
  platform: string,
  action: 'closed' | 'archived'
): Promise<ArchiveResult | null> {
  if (response.status === 401) {
    response.body?.cancel()
    return { success: false, error: 'Auth expired' }
  }
  if (response.status === 404) {
    response.body?.cancel()
    return { success: true, action }
  }
  if (!response.ok) {
    const text = await response.text()
    return { success: false, error: `${platform} API ${response.status}: ${text.slice(0, 200)}` }
  }
  return null
}

// ============================================================================
// Dispatch
// ============================================================================

/**
 * Archive or close a linked external issue via the provider's registered
 * `archive` capability. Returns a result indicating success or failure --
 * never throws. The registry is imported lazily: provider archive modules
 * import this module's helpers, so a static import of the registry here
 * would create a cycle.
 */
export async function archiveExternalIssue(
  integrationType: string,
  ctx: ArchiveContext
): Promise<ArchiveResult> {
  const { getIntegration } = await import('./index')
  const fn = getIntegration(integrationType)?.archive
  if (!fn) {
    return { success: false, error: `Unsupported integration type: ${integrationType}` }
  }
  try {
    return await fn(ctx)
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}
