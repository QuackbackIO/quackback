/**
 * The exact behaviour a check or the sandbox runs against (QUINN-PRODUCT P7).
 *
 * Split out from the release service so the two resolvers sit next to the
 * checks that consume them rather than in the middle of the release lifecycle.
 */
import { db, settings } from '@/lib/server/db'
import { ValidationError } from '@/lib/shared/errors'
import type { CandidateBehaviour } from './release-checks'
import {
  parseStoredConfig,
  readPublished,
  releaseConfig,
  settingsRow,
  type ReleaseRecord,
} from './assistant-release.service'

/**
 * The exact behaviour a check or the sandbox runs against.
 *
 * `candidateBehaviour` reads the configuration back out of the candidate's own
 * snapshot rather than out of the settings row: the snapshot is the thing the
 * evidence is bound to, and reading the row instead would make a result that
 * claims to be about a candidate actually be about whatever is current.
 */
export async function candidateBehaviour(release: ReleaseRecord): Promise<CandidateBehaviour> {
  const row = await settingsRow()
  const config = await releaseConfig(release.snapshotId)
  if (!config) {
    throw new ValidationError(
      'ASSISTANT_RELEASE_SNAPSHOT_UNREADABLE',
      'This candidate has no readable configuration.'
    )
  }
  const live = await readPublished()
  return {
    config,
    configRevision: release.configRevision,
    workspaceName: row.name,
    liveConfig: live
      ? await releaseConfig(live.snapshotId)
      : parseStoredConfig(row.assistantConfig),
    managedFieldPaths: await managedFieldPaths(),
  }
}

/** The behaviour a customer would meet right now, for the live side of a comparison. */
export async function liveBehaviour(): Promise<CandidateBehaviour> {
  const { getAssistantRuntimeConfig } =
    await import('@/lib/server/domains/settings/settings.assistant')
  const runtime = await getAssistantRuntimeConfig()
  return {
    config: runtime.config,
    configRevision: runtime.revision,
    workspaceName: runtime.workspaceName,
    liveConfig: runtime.config,
    managedFieldPaths: await managedFieldPaths(),
  }
}

async function managedFieldPaths(): Promise<readonly string[]> {
  const [row] = await db
    .select({ managedFieldPaths: settings.managedFieldPaths })
    .from(settings)
    .limit(1)
  return row?.managedFieldPaths ?? []
}
