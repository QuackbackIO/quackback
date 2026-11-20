/**
 * The `staged-upload-sweep` job: daily, remove editor uploads (wide logos,
 * fonts) that were never published (see settings.staged-uploads.ts).
 *
 * Every collaborator is imported statically so `primeJobHandlers()` loads it
 * outside any workspace scope.
 */
import type { JobHandler } from '@/lib/server/jobs/definitions'
import { isStagedUploadSweepDue, sweepStagedUploads } from './settings.staged-uploads'

export const runStagedUploadSweep: JobHandler = async () => {
  await sweepStagedUploads()
}

/** The cron gate: shut unless an upload has waited a day. */
export function isStagedUploadSweepScheduled(): Promise<boolean> {
  return isStagedUploadSweepDue()
}
