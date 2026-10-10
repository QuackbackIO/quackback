import { randomUUID } from 'node:crypto'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'

export function syncTestJob(operationId: string): ClaimedJob {
  return {
    id: '1',
    jobId: randomUUID(),
    queue: 'integration-sync',
    dedupeKey: null,
    payload: { operationId },
    workspaceKey: null,
    attempts: 1,
    maxAttempts: 6,
    leaseToken: randomUUID(),
    lockedUntil: new Date(Date.now() + 90_000),
    runAt: new Date(),
  }
}
