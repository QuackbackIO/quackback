/**
 * AI config changelog: a read-only feed of assistant-config mutations
 * (guidance rule CRUD, tool controls, per-surface instructions, the Basics
 * preset, data connector CRUD) for the assistant admin page. Thin wrapper
 * over the shared queryAuditEvents helper (audit/log.ts), filtered to
 * ASSISTANT_CONFIG_AUDIT_EVENTS so the query stays on the existing
 * (event_type, occurred_at) index.
 */
import { createServerFn } from '@tanstack/react-start'
import {
  queryAuditEvents,
  ASSISTANT_CONFIG_AUDIT_EVENTS,
  type AuditEventRow,
} from '@/lib/server/audit/log'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth } from './auth-helpers'

const CHANGELOG_LIMIT = 50

export const getAssistantConfigChangelogFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AuditEventRow[]> => {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })

    return queryAuditEvents({
      eventTypes: ASSISTANT_CONFIG_AUDIT_EVENTS,
      limit: CHANGELOG_LIMIT,
    })
  }
)
