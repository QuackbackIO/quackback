// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { UnifiedAuditEventRow } from '@/lib/server/domains/audit/audit.unified'
import { downloadAuditCsv, rowsToCsv } from '../audit-csv'
import { AuditDiffViewer } from '../audit-diff-viewer'

function row(overrides: Partial<UnifiedAuditEventRow> = {}): UnifiedAuditEventRow {
  return {
    id: 'audit_1',
    occurredAt: new Date('2026-06-20T10:00:00.000Z'),
    origin: 'api',
    action: 'ticket.updated',
    outcome: 'success',
    source: 'rest',
    principalId: 'principal_1',
    actorUserId: 'user_1',
    actorEmail: 'agent@example.com',
    actorDisplayName: 'Agent, One',
    actorRole: 'admin',
    actorType: 'user',
    authMethod: 'api_key',
    ipAddress: '203.0.113.10',
    userAgent: 'cli "quoted"',
    targetType: 'ticket',
    targetId: 'ticket_1',
    requestId: 'req_1',
    diff: { before: { priority: 'normal' }, after: { priority: 'urgent' } },
    metadata: { nested: true },
    ...overrides,
  } as UnifiedAuditEventRow
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('audit CSV helpers', () => {
  it('serializes audit rows with ISO dates, empty nullable fields and escaped CSV values', () => {
    const csv = rowsToCsv([
      row(),
      row({
        id: 'audit_2',
        occurredAt: '2026-06-21T11:00:00.000Z' as unknown as Date,
        actorEmail: null,
        actorDisplayName: 'Plain Agent',
        userAgent: 'line\nbreak',
        diff: null,
        metadata: ['array', 'value'],
      }),
    ])

    const lines = csv.split('\n')
    expect(lines[0]).toBe(
      'occurred_at,origin,action,outcome,source,actor_principal_id,actor_user_id,actor_email,actor_display_name,actor_role,actor_type,auth_method,ip_address,user_agent,target_type,target_id,request_id,diff,metadata'
    )
    expect(lines[1]).toContain('2026-06-20T10:00:00.000Z')
    expect(lines[1]).toContain('"Agent, One"')
    expect(lines[1]).toContain('"cli ""quoted"""')
    expect(lines[1]).toContain('"{""before"":{""priority"":""normal""}')
    expect(lines[2]).toContain('2026-06-21T11:00:00.000Z')
    expect(lines[2]).toContain(',,Plain Agent')
    expect(csv).toContain('"line\nbreak"')
    expect(csv).toContain('[""array"",""value""]')
  })

  it('downloads the generated CSV through a temporary object URL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-20T12:00:00.000Z'))
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audit')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    downloadAuditCsv([row()])

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:audit')
    expect(document.querySelector('a[download="audit-log-2026-06-20.csv"]')).toBeNull()
  })
})

describe('AuditDiffViewer', () => {
  it('renders before, after, context and request metadata sections', () => {
    render(
      <AuditDiffViewer
        diff={{
          before: { priority: 'normal' },
          after: { priority: 'urgent' },
          context: { reason: 'bulk edit' },
        }}
        ipAddress="203.0.113.10"
        userAgent="quackback-cli/1.0"
      />
    )

    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.getByText(/"priority": "normal"/)).toBeInTheDocument()
    expect(screen.getByText('After')).toBeInTheDocument()
    expect(screen.getByText(/"priority": "urgent"/)).toBeInTheDocument()
    expect(screen.getByText('Context')).toBeInTheDocument()
    expect(screen.getByText('203.0.113.10')).toBeInTheDocument()
    expect(screen.getByText('quackback-cli/1.0')).toBeInTheDocument()
  })

  it('renders raw object diffs and a placeholder for empty or primitive diffs without metadata', () => {
    const { rerender } = render(
      <AuditDiffViewer diff={{ custom: ['value'] }} ipAddress={null} userAgent={null} />
    )

    expect(screen.getByText('Diff')).toBeInTheDocument()
    expect(screen.getByText(/"custom"/)).toBeInTheDocument()

    rerender(<AuditDiffViewer diff={null} ipAddress={null} userAgent={null} />)
    expect(screen.getByText('No change details recorded.')).toBeInTheDocument()

    rerender(<AuditDiffViewer diff={['array']} ipAddress={null} userAgent={null} />)
    expect(screen.getByText('No change details recorded.')).toBeInTheDocument()
  })
})
