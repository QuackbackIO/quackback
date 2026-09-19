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
  sql,
  assistantReleaseChecks,
  assistantReleases,
  assistantEffectiveSnapshots,
  type Transaction,
} from '@/lib/server/db'
import type { AssistantReleaseId, AssistantSnapshotId, PrincipalId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
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

function toRecord(row: typeof assistantReleases.$inferSelect): ReleaseRecord {
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

async function settingsRow(exec: Transaction | typeof db = db) {
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
function parseStoredConfig(stored: unknown): AssistantConfig | null {
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

async function readRelease(
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

async function readPublished(exec: Transaction | typeof db = db): Promise<ReleaseRecord | null> {
  const [row] = await exec
    .select()
    .from(assistantReleases)
    .where(eq(assistantReleases.status, 'published'))
    .limit(1)
  return row ? toRecord(row) : null
}

async function readDraft(exec: Transaction | typeof db = db): Promise<ReleaseRecord | null> {
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

async function nextReleaseNumber(tx: Transaction): Promise<number> {
  const [row] = await tx
    .select({ highest: sql<number | null>`max(${assistantReleases.releaseNumber})` })
    .from(assistantReleases)
  return (row?.highest ?? 0) + 1
}

/** Lock the settings row so two publishers, or a publisher and a saver, serialize. */
async function lockSettings(tx: Transaction) {
  const [row] = await tx
    .select({
      id: settings.id,
      assistantConfigRevision: settings.assistantConfigRevision,
      assistantReleaseManagement: settings.assistantReleaseManagement,
      assistantPublishedReleaseId: settings.assistantPublishedReleaseId,
    })
    .from(settings)
    .limit(1)
    .for('update')
  if (!row) throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
  return row
}

export interface PublishInput {
  /** The candidate hash the reviewer actually reviewed. */
  expectedCandidateHash: string
  note?: string | null
  principalId: PrincipalId
}

/**
 * Publish the reviewed candidate.
 *
 * Three refusals, in order, each with its own code so the screen can say which
 * one happened: the candidate moved since it was reviewed, a required check is
 * not passing evidence for it, or a save landed after the candidate was built.
 * The third is a comparison of the candidate's own config revision against the
 * settings row's, taken under that row's lock, because the draft is refreshed
 * lazily and a save that has not been picked up yet leaves a candidate that
 * describes behaviour nobody can see any more.
 */
export async function publishCandidate(input: PublishInput): Promise<ReleaseRecord> {
  // Deliberately NOT a refresh first. Publishing what the reviewer reviewed is
  // the contract, so this compares and refuses; recomputing the candidate here
  // would quietly publish whatever the settings row says now.
  const draft = await readDraft()
  if (!draft) {
    throw new NotFoundError('ASSISTANT_RELEASE_NOT_FOUND', 'There is no candidate to publish.')
  }
  if (draft.candidateHash !== input.expectedCandidateHash) {
    throw new ConflictError(
      'ASSISTANT_RELEASE_CANDIDATE_CONFLICT',
      'Quinn changed since this candidate was reviewed. Reload and review the new candidate.'
    )
  }
  const gate = evaluateReleaseGate(draft.candidateHash, await readReleaseChecks(draft.id))
  if (!gate.publishable) {
    throw new ValidationError(
      'ASSISTANT_RELEASE_CHECKS_INCOMPLETE',
      'Required checks have not passed for this candidate.'
    )
  }
  const note = (input.note ?? '').trim().slice(0, RELEASE_NOTE_MAX_CHARS) || null

  return db.transaction(async (tx) => {
    const row = await lockSettings(tx)
    const [current] = await tx
      .select()
      .from(assistantReleases)
      .where(eq(assistantReleases.id, draft.id))
      .limit(1)
      .for('update')
    if (!current || current.status !== 'draft') {
      throw new ConflictError(
        'ASSISTANT_RELEASE_ALREADY_PUBLISHED',
        'This candidate was already published.'
      )
    }
    if (
      current.candidateHash !== input.expectedCandidateHash ||
      current.configRevision !== row.assistantConfigRevision
    ) {
      throw new ConflictError(
        'ASSISTANT_RELEASE_CANDIDATE_CONFLICT',
        'Quinn changed since this candidate was reviewed. Reload and review the new candidate.'
      )
    }
    const gateInTx = evaluateReleaseGate(
      current.candidateHash,
      await readReleaseChecks(draft.id, tx)
    )
    if (!gateInTx.publishable) {
      throw new ValidationError(
        'ASSISTANT_RELEASE_CHECKS_INCOMPLETE',
        'Required checks have not passed for this candidate.'
      )
    }

    const previous = await readPublished(tx)
    if (previous) {
      await tx
        .update(assistantReleases)
        .set({ status: 'superseded', supersededAt: new Date(), updatedAt: new Date() })
        .where(eq(assistantReleases.id, previous.id))
    }
    const [published] = await tx
      .update(assistantReleases)
      .set({
        status: 'published',
        releaseNumber: await nextReleaseNumber(tx),
        note,
        previousReleaseId: previous?.id ?? null,
        publishedByPrincipalId: input.principalId,
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(assistantReleases.id, current.id))
      .returning()
    await tx
      .update(settings)
      .set({ assistantPublishedReleaseId: published.id })
      .where(eq(settings.id, row.id))
    return toRecord(published)
  })
}

export interface RollbackInput {
  /** The release whose behaviour is being restored. */
  releaseId: AssistantReleaseId
  /** The release the reviewer saw as live, so a concurrent publication refuses this. */
  expectedLiveReleaseId: AssistantReleaseId | null
  principalId: PrincipalId
}

/**
 * Restore an earlier release for future work.
 *
 * Append-only: this inserts a NEW published release carrying the restored
 * snapshot and naming what it restored, rather than reviving the old row, so
 * release numbers never move and the history reads forwards. It changes
 * selection only. Messages already sent and effects already dispatched are not
 * touched, and nothing here re-grants an access that was revoked.
 */
export async function rollbackToRelease(input: RollbackInput): Promise<ReleaseRecord> {
  return db.transaction(async (tx) => {
    const row = await lockSettings(tx)
    if (!row.assistantReleaseManagement) {
      throw new ValidationError(
        'ASSISTANT_RELEASE_MANAGEMENT_OFF',
        'Release management is off for this workspace.'
      )
    }
    const target = await readRelease(input.releaseId, tx)
    if (!target || target.status === 'draft') {
      throw new NotFoundError('ASSISTANT_RELEASE_NOT_FOUND', 'That release does not exist.')
    }
    const previous = await readPublished(tx)
    if ((previous?.id ?? null) !== input.expectedLiveReleaseId) {
      throw new ConflictError(
        'ASSISTANT_RELEASE_LIVE_CONFLICT',
        'The live release changed in another session. Reload and review it again.'
      )
    }
    if (previous?.id === target.id) {
      throw new ValidationError(
        'ASSISTANT_RELEASE_ALREADY_LIVE',
        'That release is already the live one.'
      )
    }
    if (previous) {
      await tx
        .update(assistantReleases)
        .set({ status: 'superseded', supersededAt: new Date(), updatedAt: new Date() })
        .where(eq(assistantReleases.id, previous.id))
    }
    const [restored] = await tx
      .insert(assistantReleases)
      .values({
        status: 'published',
        origin: 'rollback',
        releaseNumber: await nextReleaseNumber(tx),
        snapshotId: target.snapshotId,
        candidateHash: target.candidateHash,
        configRevision: target.configRevision,
        note: `Rolled back to release ${target.releaseNumber ?? target.id}`,
        scope: target.scope,
        previousReleaseId: previous?.id ?? null,
        restoredFromId: target.id,
        createdByPrincipalId: input.principalId,
        publishedByPrincipalId: input.principalId,
        publishedAt: new Date(),
      })
      .returning()
    await tx
      .update(settings)
      .set({ assistantPublishedReleaseId: restored.id })
      .where(eq(settings.id, row.id))
    return toRecord(restored)
  })
}

/**
 * Turn release management on or off.
 *
 * Turning it ON publishes the workspace's CURRENT behaviour first, so the
 * moment of opt-in changes nothing a customer could notice. Turning it OFF
 * makes the settings row live again, which is the pre-release behaviour and the
 * documented rollback; if a draft was pending, its edits become live with it.
 */
export async function setReleaseManagement(
  enabled: boolean,
  principalId: PrincipalId
): Promise<ReleaseRecord | null> {
  const row = await settingsRow()
  if (row.assistantReleaseManagement === enabled) return readPublished()
  if (!enabled) {
    await db
      .update(settings)
      .set({ assistantReleaseManagement: false })
      .where(eq(settings.id, row.id))
    return readPublished()
  }

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

  return db.transaction(async (tx) => {
    const locked = await lockSettings(tx)
    const existing = await readPublished(tx)
    let live = existing
    if (!existing || existing.candidateHash !== candidateHash) {
      if (existing) {
        await tx
          .update(assistantReleases)
          .set({ status: 'superseded', supersededAt: new Date(), updatedAt: new Date() })
          .where(eq(assistantReleases.id, existing.id))
      }
      const [inserted] = await tx
        .insert(assistantReleases)
        .values({
          status: 'published',
          origin: 'save',
          releaseNumber: await nextReleaseNumber(tx),
          snapshotId,
          candidateHash,
          configRevision: locked.assistantConfigRevision,
          note: 'Current behaviour at the start of release management',
          previousReleaseId: existing?.id ?? null,
          createdByPrincipalId: principalId,
          publishedByPrincipalId: principalId,
          publishedAt: new Date(),
        })
        .returning()
      live = toRecord(inserted)
    }
    await tx
      .update(settings)
      .set({ assistantReleaseManagement: true, assistantPublishedReleaseId: live!.id })
      .where(eq(settings.id, locked.id))
    return live
  })
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
  const row = await settingsRow()
  if (row.assistantReleaseManagement && row.assistantPublishedReleaseId) {
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
  return { snapshotId, releaseId: null, config: null, configRevision: row.assistantConfigRevision }
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
