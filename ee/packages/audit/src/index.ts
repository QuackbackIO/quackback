/**
 * @quackback/ee-audit
 *
 * Enterprise Audit Logging for Quackback.
 *
 * Provides comprehensive audit trails for compliance requirements:
 * - SOC 2
 * - GDPR
 * - HIPAA
 * - ISO 27001
 *
 * Logged events include:
 * - Authentication events (login, logout, failed attempts)
 * - User management (create, update, delete, role changes)
 * - Resource access (posts, comments, boards)
 * - Admin actions (settings changes, integrations)
 * - Data exports
 *
 * @license Proprietary - See ee/LICENSE
 */

export { AuditLogger, type AuditLogEntry, type AuditEventType } from './logger'
export { auditLogs, type AuditLog } from './schema'

/**
 * Check if Audit module is available
 */
export const AUDIT_AVAILABLE = true
