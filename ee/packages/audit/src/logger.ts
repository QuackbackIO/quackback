/**
 * Audit Logger Service
 *
 * Provides a simple API for logging auditable events.
 */

import type { AuditEventCategory, NewAuditLog } from './schema'

export type AuditEventType =
  // Auth events
  | 'auth.login'
  | 'auth.logout'
  | 'auth.login_failed'
  | 'auth.password_reset'
  | 'auth.mfa_enabled'
  | 'auth.mfa_disabled'
  | 'auth.sso_login'
  // User events
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'user.invited'
  | 'user.role_changed'
  // Team events
  | 'team.member_added'
  | 'team.member_removed'
  | 'team.member_role_changed'
  // Post events
  | 'post.created'
  | 'post.updated'
  | 'post.deleted'
  | 'post.status_changed'
  // Comment events
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted'
  // Board events
  | 'board.created'
  | 'board.updated'
  | 'board.deleted'
  // Settings events
  | 'settings.updated'
  | 'settings.branding_changed'
  | 'settings.auth_config_changed'
  // Integration events
  | 'integration.connected'
  | 'integration.disconnected'
  | 'integration.config_changed'
  // Export events
  | 'export.started'
  | 'export.completed'
  | 'export.failed'
  // Admin events
  | 'admin.license_updated'
  | 'admin.scim_token_generated'
  | 'admin.sso_configured'

export interface AuditLogEntry {
  /** Event type (e.g., 'auth.login', 'user.created') */
  event: AuditEventType
  /** Actor performing the action */
  actor?: {
    id?: string
    email?: string
    name?: string
    ip?: string
    userAgent?: string
  }
  /** Target resource */
  resource?: {
    type: string
    id: string
    name?: string
  }
  /** Human-readable description */
  description?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
  /** For updates: previous state */
  previousState?: Record<string, unknown>
  /** For updates: new state */
  newState?: Record<string, unknown>
  /** Whether the action succeeded */
  success?: boolean
  /** Error message if failed */
  errorMessage?: string
}

/**
 * Parse event type into category and action
 */
function parseEventType(event: AuditEventType): { category: AuditEventCategory; action: string } {
  const [category, action] = event.split('.') as [AuditEventCategory, string]
  return { category, action }
}

/**
 * Audit Logger
 *
 * Use this class to log auditable events.
 *
 * @example
 * ```ts
 * const logger = new AuditLogger(db)
 *
 * await logger.log({
 *   event: 'auth.login',
 *   actor: { id: user.id, email: user.email },
 *   description: 'User logged in successfully',
 * })
 * ```
 */
export class AuditLogger {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private db: any) {}

  /**
   * Log an audit event
   */
  async log(entry: AuditLogEntry): Promise<void> {
    const { category, action } = parseEventType(entry.event)

    const _logEntry: Omit<NewAuditLog, 'id'> = {
      timestamp: new Date(),
      category,
      action,
      description: entry.description,
      actorId: entry.actor?.id,
      actorEmail: entry.actor?.email,
      actorName: entry.actor?.name,
      actorIp: entry.actor?.ip,
      actorUserAgent: entry.actor?.userAgent,
      resourceType: entry.resource?.type,
      resourceId: entry.resource?.id,
      resourceName: entry.resource?.name,
      metadata: entry.metadata,
      previousState: entry.previousState,
      newState: entry.newState,
      success: entry.success !== false ? 'success' : 'failure',
      errorMessage: entry.errorMessage,
    }

    // TODO: Insert into database
    // const { auditLogs } = await import('./schema')
    // await this.db.insert(auditLogs).values({ id: createId('audit'), ...logEntry })

    // For now, just log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log('[AUDIT]', entry.event, entry.description)
    }
  }

  /**
   * Query audit logs
   */
  async query(_options: {
    startDate?: Date
    endDate?: Date
    actorId?: string
    category?: AuditEventCategory
    resourceType?: string
    resourceId?: string
    limit?: number
    offset?: number
  }) {
    // TODO: Implement query
    throw new Error('Audit log query not yet implemented')
  }
}
