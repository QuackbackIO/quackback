/**
 * Stub for @quackback/ee-audit
 *
 * This module is used when INCLUDE_EE=false to enable tree-shaking.
 * It provides the same exports as the real package but with no-op implementations.
 */

export type AuditEventType =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.failed'
  | 'user.create'
  | 'user.update'
  | 'user.delete'
  | 'post.create'
  | 'post.update'
  | 'post.delete'
  | 'settings.update'

export interface AuditLogEntry {
  id: string
  eventType: AuditEventType
  actorId: string
  resourceId?: string
  resourceType?: string
  metadata?: Record<string, unknown>
  timestamp: Date
}

export interface AuditLog {
  id: string
  eventType: string
  actorId: string
  resourceId: string | null
  resourceType: string | null
  metadata: unknown
  createdAt: Date
}

export const auditLogs = null

export class AuditLogger {
  constructor() {
    // No-op in stub
  }

  log(_entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): void {
    // No-op - audit logging not available in this edition
  }

  async query(): Promise<AuditLogEntry[]> {
    return []
  }
}

export const AUDIT_AVAILABLE = false
