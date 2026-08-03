import type { UnifiedAuditEventRow } from '@/lib/server/domains/audit/audit.unified'

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function rowsToCsv(rows: UnifiedAuditEventRow[]): string {
  const headers = [
    'occurred_at',
    'origin',
    'action',
    'outcome',
    'source',
    'actor_principal_id',
    'actor_user_id',
    'actor_email',
    'actor_display_name',
    'actor_role',
    'actor_type',
    'auth_method',
    'ip_address',
    'user_agent',
    'target_type',
    'target_id',
    'request_id',
    'diff',
    'metadata',
  ]

  const lines = [
    headers.join(','),
    ...rows.map((row) =>
      [
        toIso(row.occurredAt),
        row.origin,
        row.action,
        row.outcome,
        row.source,
        row.principalId,
        row.actorUserId,
        row.actorEmail,
        row.actorDisplayName,
        row.actorRole,
        row.actorType,
        row.authMethod,
        row.ipAddress,
        row.userAgent,
        row.targetType,
        row.targetId,
        row.requestId,
        row.diff,
        row.metadata,
      ]
        .map(escapeCsv)
        .join(',')
    ),
  ]

  return lines.join('\n')
}

export function downloadAuditCsv(rows: UnifiedAuditEventRow[]): void {
  const csv = rowsToCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
