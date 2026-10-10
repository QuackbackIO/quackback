/**
 * The Postgres job queue — the substrate that replaces Redis for background work.
 *
 * Read `JOBS.md` in this directory first. It states the lease contract, why
 * `attempts` is incremented by the claim rather than by completion, and what
 * the reaper is allowed to do with a no-retry job.
 */
export {
  cancelJob,
  claimById,
  claimJobs,
  completeJob,
  enqueueJob,
  enqueueJobs,
  failJob,
  findJobByDedupeKey,
  heartbeatJob,
  isMissingJobQueue,
  jobQueueDepth,
  jobWorkerId,
  peekRunnableJob,
  pruneTerminalJobs,
  reapExpiredLeases,
  JobQueueMissingError,
  type ClaimedJob,
  type EnqueueJobInput,
  type EnqueueJobResult,
  type JobSqlExecutor,
  type FailOutcome,
  type JobLookup,
  type QueueClaimSpec,
  type ReapResult,
} from './job-queue'

export {
  JOB_DEFINITIONS,
  TerminalJobError,
  concurrencyFor,
  findJobDefinition,
  isTerminalJobError,
  jobDefinitions,
  leaseMsFor,
  maxAttemptsFor,
  retentionOverrides,
  retryBackoffMs,
  type DynamicSchedule,
  type JobDefinition,
  type JobHandler,
} from './definitions'

export {
  activeQueueNames,
  awaitPool,
  claimSpecsFor,
  createJobPool,
  createScheduleState,
  dispatchPass,
  drainOnce,
  startClaimedJob,
  startJobsById,
  poolSize,
  primeJobHandlers,
  resetJobHandlers,
  runJob,
  runMaintenanceTick,
  runScheduleTick,
  runnerConfig,
  totalDeclaredConcurrency,
  type DispatchResult,
  type DrainResult,
  type JobPool,
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

export {
  getJobWorkerStatus,
  handleJobWake,
  isJobWorkerRunning,
  startJobWorker,
  stopJobWorker,
  wakeWorkspace,
  type JobWakeRequest,
  type JobWorkerStatus,
} from './worker'
