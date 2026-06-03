/**
 * CSV export for the audit-log table.
 *
 * The 0070_audit_log_observability migration added request_id (indexed
 * for cross-event forensics), actor_type, and auth_method. These must
 * appear in the CSV export — the export is the operator's primary
 * offline-forensics tool, so leaving the new columns out keeps them
 * effectively invisible.
 */
import { describe, it, expect } from 'vitest'
import { rowsToCsv } from '../audit-log-page'
import type { AuditEventRow } from '@/lib/server/functions/audit-log'

function row(overrides: Partial<AuditEventRow> = {}): AuditEventRow {
  return {
    id: 'audit_1',
    occurredAt: '2026-05-20T10:30:00.000Z',
    actorUserId: null,
    actorEmail: 'demo@example.com',
    actorRole: 'admin',
    actorIp: '127.0.0.1',
    actorUserAgent: 'Mozilla/5.0',
    eventType: 'auth.signin.succeeded',
    eventOutcome: 'success',
    targetType: null,
    targetId: null,
    beforeValue: null,
    afterValue: null,
    metadata: null,
    requestId: null,
    actorType: null,
    authMethod: null,
    ...overrides,
  }
}

describe('rowsToCsv — audit-log observability columns', () => {
  it('includes request_id, actor_type, auth_method in the header row', () => {
    const csv = rowsToCsv([row()])
    const [header] = csv.split('\n')
    expect(header).toContain('request_id')
    expect(header).toContain('actor_type')
    expect(header).toContain('auth_method')
  })

  it('emits the values in each data row', () => {
    const csv = rowsToCsv([row({ requestId: 'req_abc123', actorType: 'user', authMethod: 'sso' })])
    const [, dataRow] = csv.split('\n')
    expect(dataRow).toContain('req_abc123')
    expect(dataRow).toContain('user')
    expect(dataRow).toContain('sso')
  })

  it('emits empty cells (not "null") when the observability fields are null', () => {
    const csv = rowsToCsv([row({ requestId: null, actorType: null, authMethod: null })])
    // Should not contain the literal string "null" — empty CSV cell instead.
    expect(csv).not.toMatch(/,null,/)
    expect(csv).not.toMatch(/,null$/)
  })
})
