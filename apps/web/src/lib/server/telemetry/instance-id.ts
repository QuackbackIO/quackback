import { randomUUID } from 'crypto'

/**
 * Get or create a stable instance ID stored in the settings.metadata JSON.
 * This avoids adding a new table — reuses the existing metadata column.
 */
export async function getOrCreateInstanceId(): Promise<string> {
  try {
    const { db, settings, eq } = await import('@/lib/server/db')

    const org = await db.query.settings.findFirst({
      columns: { id: true, metadata: true },
    })
    if (!org) return randomUUID()

    // Parse existing metadata
    let metadata: Record<string, unknown> = {}
    if (org.metadata) {
      try {
        metadata = JSON.parse(org.metadata)
      } catch {
        metadata = {}
      }
    }

    // Return existing instance ID
    if (typeof metadata.instanceId === 'string') {
      return metadata.instanceId
    }

    // Generate and persist a new one
    const instanceId = randomUUID()
    metadata.instanceId = instanceId
    await db
      .update(settings)
      .set({ metadata: JSON.stringify(metadata) })
      .where(eq(settings.id, org.id))

    return instanceId
  } catch {
    // If DB fails, return a random UUID (won't persist but won't crash)
    return randomUUID()
  }
}
