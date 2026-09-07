import { cleanupPreviousInstall } from './install-registry'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
export async function runInstallCleanup(job: ClaimedJob) {
  await cleanupPreviousInstall(
    String(job.payload.type),
    job.payload.config as Record<string, unknown>
  )
}
