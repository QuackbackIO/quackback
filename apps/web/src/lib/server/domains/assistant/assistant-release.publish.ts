/**
 * The three release commands that change what is live: publish, roll back, and
 * the opt-in itself (QUINN-PRODUCT Step 10, P7).
 *
 * All three serialize on the settings row, because that row carries both the
 * pointer at the live release and the config revision a candidate is compared
 * against. Each is a compare-and-set over what the reviewer actually saw, never
 * a recompute: recomputing here would quietly publish whatever the settings row
 * says now, which is the opposite of a reviewed change.
 */
import {
  db,
  eq,
  settings,
  sql,
  assistantReleases,
  assistantEffectiveSnapshots,
  type Transaction,
} from '@/lib/server/db'
import type { AssistantReleaseId, PrincipalId } from '@quackback/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { evaluateReleaseGate } from '@/lib/shared/assistant/release'
import { buildEffectiveSnapshot, persistEffectiveSnapshot } from './assistant-snapshot'
import {
  RELEASE_NOTE_MAX_CHARS,
  parseStoredConfig,
  readDraft,
  readPublished,
  readRelease,
  readReleaseChecks,
  settingsRow,
  toRecord,
  type ReleaseRecord,
} from './assistant-release.service'

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
