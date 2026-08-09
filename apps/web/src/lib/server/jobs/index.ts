/**
 * The Postgres job queue — the substrate that replaces Redis for background work
 * (SAAS-HOSTING-STACK.md §7).
 *
 * Read `JOBS.md` in this directory first. It states the lease contract, why
 * `attempts` is incremented by the claim rather than by completion, what the
 * reaper is allowed to do with a no-retry job, and why the wake listener must
 * never terminate at a pooled endpoint.
 */
export {
  claimJobs,
  completeJob,
  enqueueJob,
  failJob,
  heartbeatJob,
  isMissingJobQueue,
  jobQueueDepth,
  jobWorkerId,
  pruneTerminalJobs,
  reapExpiredLeases,
  JobQueueMissingError,
  type ClaimedJob,
  type EnqueueJobInput,
  type EnqueueJobResult,
  type FailOutcome,
  type ReapResult,
} from './job-queue'

export {
  JOB_DEFINITIONS,
  findJobDefinition,
  jobDefinitions,
  leaseMsFor,
  maxAttemptsFor,
  retryBackoffMs,
  type JobDefinition,
  type JobHandler,
} from './definitions'

export {
  activeQueueNames,
  createScheduleState,
  drainOnce,
  primeJobHandlers,
  resetJobHandlers,
  runJob,
  runMaintenanceTick,
  runScheduleTick,
  runnerConfig,
  wakeDisabled,
  type DrainResult,
  type RunnerConfig,
  type ScheduleState,
} from './runner'

export {
  latestSlotAtOrBefore,
  matchesCron,
  nextSlotAfter,
  parseCron,
  slotKey,
  type ParsedCron,
} from './cron'

export { JOB_WAKE_CHANNEL, openWakeListener, type WakeListener } from './wake'

export { getJobTierStatus, startJobTier, stopJobTier, type JobTierStatus } from './tier'
