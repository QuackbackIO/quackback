/**
 * CSV export for the unified audit-log table.
 */
import { describe, it, expect } from 'vitest'
import { rowsToCsv } from '../../audit/audit-csv'
import type { UnifiedAuditEventRow } from '@/lib/server/domains/audit/audit.unified'

function row(overrides: Partial<UnifiedAuditEventRow> = {}): UnifiedAuditEventRow {
  return {
    id: 'audit_1',
    origin: 'security',
    occurredAt: new Date('2026-05-20T10:30:00.000Z'),
    principalId: null,
    actorUserId: null,
    actorEmail: 'demo@example.com',
    actorDisplayName: null,
    actorRole: 'admin',
    actorType: null,
    authMethod: null,
    action: 'auth.signin.succeeded',
    outcome: 'success',
    source: null,
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
    targetType: null,
    targetId: null,
    requestId: null,
    diff: {},
    metadata: null,
    ...overrides,
  }
}

describe('rowsToCsv — unified audit observability columns', () => {
  it('includes request_id, actor_type, auth_method in the header row', () => {
    const csv = rowsToCsv([row()])
    const [header] = csv.split('\n')
    expect(header).toContain('request_id')
    expect(header).toContain('actor_type')
    expect(header).toContain('auth_method')
    expect(header).toContain('origin')
    expect(header).toContain('source')
  })

  it('emits the values in each data row', () => {
    const csv = rowsToCsv([row({ requestId: 'req_abc123', actorType: 'user', authMethod: 'sso' })])
    const [, dataRow] = csv.split('\n')
    expect(dataRow).toContain('req_abc123')
    expect(dataRow).toContain('user')
    expect(dataRow).toContain('sso')
  })

  it('exports workspace and security rows together', () => {
    const csv = rowsToCsv([
      row({
        origin: 'workspace',
        principalId: 'principal_1',
        actorEmail: 'owner@example.com',
        actorDisplayName: 'Owner',
        action: 'ticket.created',
        outcome: null,
        source: 'web',
        targetType: 'ticket',
        targetId: 'ticket_1',
        diff: { after: { status: 'open' } },
      }),
      row({
        origin: 'security',
        action: 'auth.signin.success',
        requestId: 'req_abc123',
        actorType: 'user',
        authMethod: 'sso',
      }),
    ])

    expect(csv).toContain('workspace')
    expect(csv).toContain('ticket.created')
    expect(csv).toContain('security')
    expect(csv).toContain('auth.signin.success')
  })

  it('emits empty cells (not "null") when the observability fields are null', () => {
    const csv = rowsToCsv([row({ requestId: null, actorType: null, authMethod: null })])
    // Should not contain the literal string "null" — empty CSV cell instead.
    expect(csv).not.toMatch(/,null,/)
    expect(csv).not.toMatch(/,null$/)
  })
})
