/**
 * Identity / admin-plane event declarations (WO-6a). These are NEW event types
 * that never existed in the legacy EVENT_TYPES union — they emit directly via
 * emit() from their domain services, not through the legacy dispatch* path. Most
 * are audit-relevant (exposure.audit: true), so emit() writes the audit_log row
 * in the same transaction as the mutation.
 *
 * This is the first slice of coverage for the ~30 previously-silent entity
 * families; the remaining families (boards, tags, companies, segments, teams,
 * moderation, ...) follow the same pattern in WO-6b/6c.
 */
import { decl } from './helpers'

const S = 'workspace'

export const apiKeyCreated = decl('apikey.created', 'api_key', { audit: true }, S)
export const apiKeyDeleted = decl('apikey.deleted', 'api_key', { audit: true }, S)
export const settingsUpdated = decl('settings.updated', 'settings', { audit: true }, S)
