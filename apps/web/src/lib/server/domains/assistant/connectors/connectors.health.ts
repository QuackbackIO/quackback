import { eq } from 'drizzle-orm'
import { db as defaultDb, connectors } from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { ConnectorId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import { discoverInto, getConnector } from './connectors.service'

const log = logger.child({ component: 'assistant-connectors' })

export async function refreshConnector(id: ConnectorId, execDb: Executor = defaultDb) {
  const existing = await getConnector(id, execDb)
  if (!existing) return null
  try {
    const diff = await discoverInto(existing, execDb)
    const [row] = await execDb
      .update(connectors)
      .set({
        tools: diff.tools,
        toolPolicies: diff.toolPolicies,
        status: 'connected',
        lastSyncedAt: new Date(),
        lastError: null,
        lastErrorAt: null,
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, id))
      .returning()

    return row ?? null
  } catch (err) {
    log.warn({ err, id }, 'connector refresh failed')
    const message = err instanceof Error ? err.message : 'Refresh failed'
    const [row] = await execDb
      .update(connectors)
      .set({
        status: 'error',
        lastError: message,
        lastErrorAt: new Date(),
        errorCount: existing.errorCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, id))
      .returning()

    return row ?? null
  }
}

export async function deleteConnector(
  id: ConnectorId,
  execDb: Executor = defaultDb
): Promise<void> {
  await execDb.delete(connectors).where(eq(connectors.id, id))
}

export async function recordConnectorCall(
  id: ConnectorId,
  result: { ok: boolean; error?: string },
  execDb: Executor = defaultDb
): Promise<void> {
  const existing = await getConnector(id, execDb)
  if (!existing) return
  await execDb
    .update(connectors)
    .set(
      result.ok
        ? { lastCallAt: new Date(), status: existing.enabled ? 'connected' : existing.status }
        : {
            lastCallAt: new Date(),
            lastError: result.error ?? 'Tool call failed',
            lastErrorAt: new Date(),
            errorCount: existing.errorCount + 1,
            status: 'error',
          }
    )
    .where(eq(connectors.id, id))
}
