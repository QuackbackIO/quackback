/**
 * Quinn releases: draft, publication, rollback and the behaviour a run selects
 * (QUINN-PRODUCT Step 10, P7).
 *
 * ## What a release governs
 *
 * The assistant configuration, and only it. With release management on, the
 * settings row is the DRAFT and the published release's snapshot is what the
 * runtime reads, so a save no longer takes effect until somebody publishes it.
 *
 * Everything outside that configuration stays live and immediate, deliberately:
 * role permissions, connector enablement and per-use connector policies, the
 * per-source customer/teammate switches, a category turning private, an article
 * being unpublished, a deleted document. A release preserves how Quinn was
 * configured to behave; it grants nothing and it cannot hold a revocation open.
 *
 * Guidance entries, procedures and connector contracts also stay live. They
 * carry their own versions and their own conflict checks (Steps 4 and 8), and
 * the candidate snapshot records the exact versions it was reviewed against, so
 * an edit to any of them moves the candidate hash and invalidates the evidence
 * even though it takes effect at once. That is the conservative direction: the
 * gate can be too eager, never too relaxed.
 *
 * ## Why the draft is derived
 *
 * There is no separate draft store. The draft release is a pointer at whatever
 * effective snapshot the settings row resolves to right now, refreshed lazily
 * on every read of the release state, in the same shape Steps 4 and 8 used for
 * their projections. That removes the failure mode where a save succeeds and
 * the follow-up write that was supposed to refresh the candidate does not: the
 * candidate cannot be stale relative to the settings row, because it is
 * computed from it.
 */
import {
  db,
  desc,
  eq,
  ne,
  settings,
  assistantReleaseChecks,
  assistantReleases,
  assistantEffectiveSnapshots,
  type Transaction,
} from '@/lib/server/db'
import type { AssistantReleaseId, AssistantSnapshotId, PrincipalId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import {
  assistantConfigSchema,
  migrateAssistantConfig,
  type AssistantConfig,
} from '@/lib/shared/assistant/config'
import {
  evaluateReleaseGate,
  releaseAffectedUses,
  type ReleaseCheckResult,
  type ReleaseGate,
  type ReleaseScope,
  type ReleaseUse,
} from '@/lib/shared/assistant/release'
import { buildEffectiveSnapshot, persistEffectiveSnapshot } from './assistant-snapshot'

const log = logger.child({ component: 'assistant-release' })

/** Release notes are a sentence a reviewer writes, not a document. */
export const RELEASE_NOTE_MAX_CHARS = 500

export interface ReleaseRecord {
  id: AssistantReleaseId
  releaseNumber: number | null
  status: 'draft' | 'published' | 'superseded'
  origin: 'save' | 'rollback'
  snapshotId: AssistantSnapshotId
  candidateHash: string
  configRevision: number
  note: string | null
  scope: ReleaseScope | null
  previousReleaseId: AssistantReleaseId | null
  restoredFromId: AssistantReleaseId | null
  publishedByPrincipalId: PrincipalId | null
  publishedAt: string | null
  createdAt: string
}

export interface ReleaseState {
  managementEnabled: boolean
  live: ReleaseRecord | null
  draft: ReleaseRecord | null
  /** True when the draft's behaviour already equals what is live. */
  draftMatchesLive: boolean
  checks: ReleaseCheckResult[]
  gate: ReleaseGate
  history: ReleaseRecord[]
}

const RELEASE_USES: readonly ReleaseUse[] = ['customer', 'teammate', 'workspace']

/** jsonb is unvalidated on the way back, so narrow it rather than asserting it. */
function toScope(stored: { uses?: unknown; changedPaths?: unknown } | null): ReleaseScope | null {
  if (!stored) return null
  const uses = Array.isArray(stored.uses) ? stored.uses : []
  const changedPaths = Array.isArray(stored.changedPaths) ? stored.changedPaths : []
  return {
    uses: RELEASE_USES.filter((use) => uses.includes(use)),
    changedPaths: changedPaths.filter((path): path is string => typeof path === 'string'),
  }
}

/** @internal shared with assistant-release.publish.ts */
export function toRecord(row: typeof assistantReleases.$inferSelect): ReleaseRecord {
  return {
    id: row.id,
    releaseNumber: row.releaseNumber,
    status: row.status,
    origin: row.origin,
    snapshotId: row.snapshotId,
    candidateHash: row.candidateHash,
    configRevision: row.configRevision,
    note: row.note,
    scope: toScope(row.scope),
    previousReleaseId: row.previousReleaseId,
    restoredFromId: row.restoredFromId,
    publishedByPrincipalId: row.publishedByPrincipalId,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** @internal shared with the publish and behaviour modules */
export async function settingsRow(exec: Transaction | typeof db = db) {
  const [row] = await exec
    .select({
      id: settings.id,
      name: settings.name,
      assistantConfig: settings.assistantConfig,
      assistantConfigRevision: settings.assistantConfigRevision,
      assistantReleaseManagement: settings.assistantReleaseManagement,
      assistantPublishedReleaseId: settings.assistantPublishedReleaseId,
    })
    .from(settings)
    .limit(1)
  if (!row) throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
  return row
}

/** The settings row's configuration: the live one with release management off, the draft with it on. */
/** @internal shared with the publish and behaviour modules */
export function parseStoredConfig(stored: unknown): AssistantConfig | null {
  const parsed = assistantConfigSchema.safeParse(migrateAssistantConfig(stored))
  return parsed.success ? parsed.data : null
}

export async function releaseManagementEnabled(): Promise<boolean> {
  try {
    return (await settingsRow()).assistantReleaseManagement
  } catch (err) {
    log.warn({ err }, 'could not read the release-management setting')
    return false
  }
}

/** @internal shared with assistant-release.publish.ts */
export async function readRelease(
  id: AssistantReleaseId,
  exec: Transaction | typeof db = db
): Promise<ReleaseRecord | null> {
  const [row] = await exec
    .select()
    .from(assistantReleases)
    .where(eq(assistantReleases.id, id))
    .limit(1)
  return row ? toRecord(row) : null
}

/** @internal shared with the publish and behaviour modules */
export async function readPublished(
  exec: Transaction | typeof db = db
): Promise<ReleaseRecord | null> {
  const [row] = await exec
    .select()
    .from(assistantReleases)
    .where(eq(assistantReleases.status, 'published'))
    .limit(1)
  return row ? toRecord(row) : null
}

/** @internal shared with assistant-release.publish.ts */
export async function readDraft(exec: Transaction | typeof db = db): Promise<ReleaseRecord | null> {
  const [row] = await exec
    .select()
    .from(assistantReleases)
    .where(eq(assistantReleases.status, 'draft'))
    .limit(1)
  return row ? toRecord(row) : null
}

/** The configuration frozen in a snapshot, or null when the payload cannot be read as one. */
export async function releaseConfig(
  snapshotId: AssistantSnapshotId,
  exec: Transaction | typeof db = db
): Promise<AssistantConfig | null> {
  const [row] = await exec
    .select({ payload: assistantEffectiveSnapshots.payload })
    .from(assistantEffectiveSnapshots)
    .where(eq(assistantEffectiveSnapshots.id, snapshotId))
    .limit(1)
  if (!row) return null
  const payload = row.payload as { config?: unknown } | null
  if (!payload || payload.config === undefined || payload.config === null) return null
  return parseStoredConfig(payload.config)
}

/**
 * The configuration new work runs under.
 *
 * Returns null whenever the live read should fall back to the settings row:
 * release management off, no published release, or a snapshot whose payload
 * cannot be read as a configuration. The fallback is deliberate. A workspace
 * whose release row is unreadable needs Quinn to keep answering from the
 * configuration it can read, with a warning in the log, rather than to stop.
 */
export async function publishedRuntimeConfig(row: {
  assistantReleaseManagement: boolean
  assistantPublishedReleaseId: string | null
}): Promise<{ config: AssistantConfig; configRevision: number; releaseId: string } | null> {
  if (!row.assistantReleaseManagement || !row.assistantPublishedReleaseId) return null
  try {
    const release = await readRelease(row.assistantPublishedReleaseId as AssistantReleaseId)
    if (!release) {
      log.warn(
        { release_id: row.assistantPublishedReleaseId },
        'published release is missing; reading the settings row instead'
      )
      return null
    }
    const config = await releaseConfig(release.snapshotId)
    if (!config) {
      log.warn(
        { release_id: release.id },
        'published release snapshot carries no readable configuration; reading the settings row instead'
      )
      return null
    }
    return { config, configRevision: release.configRevision, releaseId: release.id }
  } catch (err) {
    log.warn({ err }, 'published release could not be read; reading the settings row instead')
    return null
  }
}

/**
 * Refresh the draft candidate from the settings row and return it.
 *
 * Idempotent and convergent: two callers racing compute the same snapshot from
 * the same row, so whichever write lands second writes the same values. The
 * insert can lose the one-draft race, which is caught and resolved by re-reading.
 */
export async function ensureDraftCandidate(
  createdById?: PrincipalId | null
): Promise<ReleaseRecord> {
  const row = await settingsRow()
  const config = parseStoredConfig(row.assistantConfig)
  if (!config) {
    throw new ValidationError('ASSISTANT_CONFIG_INVALID', 'Stored AI agent settings are invalid')
  }
  const payload = await buildEffectiveSnapshot({
    config,
    configRevision: row.assistantConfigRevision,
  })
  const snapshotId = await persistEffectiveSnapshot(payload)
  const [snapshot] = await db
    .select({ contentHash: assistantEffectiveSnapshots.contentHash })
    .from(assistantEffectiveSnapshots)
    .where(eq(assistantEffectiveSnapshots.id, snapshotId))
    .limit(1)
  const candidateHash = snapshot?.contentHash ?? ''

  const live = await readPublished()
  const liveConfig = live ? await releaseConfig(live.snapshotId) : null
  const scope = releaseAffectedUses(liveConfig ?? config, config)

  const existing = await readDraft()
  if (!existing) {
    try {
      const [inserted] = await db
        .insert(assistantReleases)
        .values({
          status: 'draft',
          origin: 'save',
          snapshotId,
          candidateHash,
          configRevision: row.assistantConfigRevision,
          scope,
          previousReleaseId: live?.id ?? null,
          createdByPrincipalId: createdById ?? null,
        })
        .returning()
      return toRecord(inserted)
    } catch (err) {
      // Lost the one-draft race: the other writer computed the same candidate.
      const raced = await readDraft()
      if (raced) return raced
      throw err
    }
  }

  if (
    existing.candidateHash === candidateHash &&
    existing.configRevision === row.assistantConfigRevision &&
    existing.previousReleaseId === (live?.id ?? null)
  ) {
    return existing
  }
  const [updated] = await db
    .update(assistantReleases)
    .set({
      snapshotId,
      candidateHash,
      configRevision: row.assistantConfigRevision,
      scope,
      previousReleaseId: live?.id ?? null,
      updatedAt: new Date(),
    })
    .where(eq(assistantReleases.id, existing.id))
    .returning()
  return toRecord(updated)
}

export async function readReleaseChecks(
  releaseId: AssistantReleaseId,
  exec: Transaction | typeof db = db
): Promise<ReleaseCheckResult[]> {
  const rows = await exec
    .select()
    .from(assistantReleaseChecks)
    .where(eq(assistantReleaseChecks.releaseId, releaseId))
  return rows.map((row) => ({
    key: row.checkKey,
    status: row.status,
    candidateHash: row.candidateHash,
    summary: row.summary,
    ranAt: row.ranAt.toISOString(),
  }))
}

/** Store one check result, replacing whatever that key held for this release. */
export async function recordReleaseCheckResult(input: {
  releaseId: AssistantReleaseId
  checkKey: string
  status: ReleaseCheckResult['status']
  candidateHash: string
  summary?: string | null
  detail?: Record<string, unknown> | null
  ranById?: PrincipalId | null
}): Promise<void> {
  await db
    .insert(assistantReleaseChecks)
    .values({
      releaseId: input.releaseId,
      checkKey: input.checkKey,
      status: input.status,
      candidateHash: input.candidateHash,
      summary: input.summary ?? null,
      detail: input.detail ?? null,
      ranByPrincipalId: input.ranById ?? null,
    })
    .onConflictDoUpdate({
      target: [assistantReleaseChecks.releaseId, assistantReleaseChecks.checkKey],
      set: {
        status: input.status,
        candidateHash: input.candidateHash,
        summary: input.summary ?? null,
        detail: input.detail ?? null,
        ranByPrincipalId: input.ranById ?? null,
        ranAt: new Date(),
      },
    })
}

/** Everything the review screens read, with the draft refreshed first. */
export async function getReleaseState(limit = 20): Promise<ReleaseState> {
  const row = await settingsRow()
  const draft = await ensureDraftCandidate()
  const live = await readPublished()
  const checks = await readReleaseChecks(draft.id)
  const history = (
    await db
      .select()
      .from(assistantReleases)
      .where(ne(assistantReleases.status, 'draft'))
      .orderBy(desc(assistantReleases.publishedAt), desc(assistantReleases.createdAt))
      .limit(limit)
  ).map(toRecord)
  return {
    managementEnabled: row.assistantReleaseManagement,
    live,
    draft,
    draftMatchesLive: live !== null && live.candidateHash === draft.candidateHash,
    checks,
    gate: evaluateReleaseGate(draft.candidateHash, checks),
    history,
  }
}

/**
 * The behaviour one run executes under.
 *
 * With release management on, a run SELECTS the published release's snapshot
 * rather than building a new one, and carries the configuration frozen in it
 * for the rest of the turn. That is what makes publication and rollback change
 * future selection only: a run that already selected keeps what it selected
 * even if somebody publishes while it is generating.
 *
 * With release management off this is exactly the pre-release path: build the
 * live snapshot, attach it, and let the turn resolve its configuration live.
 */
export async function selectRunBehaviour(): Promise<{
  snapshotId: AssistantSnapshotId
  releaseId: AssistantReleaseId | null
  config: AssistantConfig | null
  configRevision: number
}> {
  // Best effort in the same direction the snapshot builder already fails: a
  // settings row this process cannot read must not stop a turn recording what
  // it ran under, it just means no release could have been selected.
  let row: Awaited<ReturnType<typeof settingsRow>> | null = null
  try {
    row = await settingsRow()
  } catch (err) {
    log.warn({ err }, 'run behaviour could not read the settings row')
  }
  if (row?.assistantReleaseManagement && row.assistantPublishedReleaseId) {
    const release = await readRelease(row.assistantPublishedReleaseId as AssistantReleaseId)
    if (release) {
      const config = await releaseConfig(release.snapshotId)
      if (config) {
        return {
          snapshotId: release.snapshotId,
          releaseId: release.id,
          config,
          configRevision: release.configRevision,
        }
      }
      log.warn(
        { release_id: release.id },
        'published release snapshot carries no readable configuration; building a fresh one'
      )
    }
  }
  const snapshotId = await persistEffectiveSnapshot(await buildEffectiveSnapshot())
  return {
    snapshotId,
    releaseId: null,
    config: null,
    configRevision: row?.assistantConfigRevision ?? 0,
  }
}

/** The workspace name a frozen configuration is rendered with. Live, like every other identity read. */
export async function getWorkspaceName(): Promise<string> {
  try {
    return (await settingsRow()).name
  } catch (err) {
    log.warn({ err }, 'could not read the workspace name')
    return 'this workspace'
  }
}
