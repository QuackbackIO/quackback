/** Post creation is delivered once per integration destination, not once per retry event. */
import { createHash } from 'node:crypto'
import { db, hookDeliveries, eq } from '@/lib/server/db'
import type { HookJobData } from './hook-job'

export function integrationDeliveryKey(data: HookJobData): string | null {
  if (
    data.event.type !== 'post.created' ||
    !data.event.data.post?.id ||
    typeof data.config.integrationId !== 'string'
  )
    return null
  const destination = createHash('sha256')
    .update(JSON.stringify(data.target ?? null))
    .digest('hex')
  return `integration-post-created:${data.event.data.post.id}:${data.config.integrationId}:${destination}`
}

export async function integrationDeliveryCompleted(key: string): Promise<boolean> {
  const row = await db.query.hookDeliveries.findFirst({ where: eq(hookDeliveries.jobId, key) })
  return row?.outcome === 'completed'
}

export async function completeIntegrationDelivery(key: string, hookType: string): Promise<void> {
  await db
    .insert(hookDeliveries)
    .values({ jobId: key, hookType, outcome: 'completed' })
    .onConflictDoUpdate({
      target: hookDeliveries.jobId,
      set: { outcome: 'completed', processedAt: new Date() },
    })
}
