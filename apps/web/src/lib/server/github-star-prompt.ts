import { toUuid, type PrincipalId, type UserId } from '@quackback/ids'
import { db, eq, sql, user } from '@/lib/server/db'
import { readOnboardingProgress } from '@/lib/server/onboarding-progress'
import { getExecuteRows } from '@/lib/server/utils'
import { config } from '@/lib/server/config'
import { getCloudConfig } from '@/lib/server/domains/settings/cloud/cloud.service'
import { getSettings } from '@/lib/server/functions/workspace'
import { getSetupState, isOnboardingComplete } from '@/lib/shared/db-types'
import {
  GITHUB_REPO_URL,
  STAR_PROMPT_MIN_ACTIVE_DAYS,
  STAR_PROMPT_MIN_CUSTOMER_INTERACTIONS,
  STAR_PROMPT_MIN_WORKSPACE_AGE_DAYS,
  starPromptStage,
  type StarPromptStage,
} from '@/lib/shared/github-star-prompt'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Whether this deployment may ever ask for a star: never on the Quackback
 * Cloud fleet (pooled tenancy, whatever a workspace's billing record says),
 * never on a workspace with a cloud projection, never when switched off.
 */
export function starPromptAllowedHere(cloudEnabled: boolean): boolean {
  return !config.isPooledTenancy && !cloudEnabled && !isStarPromptDisabled()
}

/** Self-hosters can switch the prompt off for their whole team. */
export function isStarPromptDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.DISABLE_GITHUB_STAR_PROMPT?.trim().toLowerCase()
  return value === 'true' || value === '1'
}

/**
 * The day this person was active for the fifth time, counting days they
 * changed a post, commented, wrote a note, replied in a conversation or wrote
 * a changelog entry. Null before then.
 */
export async function fifthActiveDay(principalId: PrincipalId): Promise<Date | null> {
  const id = sql`${toUuid(principalId)}::uuid`
  const result = await db.execute<{ day: Date | string }>(sql`
    SELECT day FROM (
      SELECT date_trunc('day', created_at) AS day FROM post_activity WHERE principal_id = ${id}
      UNION SELECT date_trunc('day', created_at) FROM post_comments WHERE principal_id = ${id}
      UNION SELECT date_trunc('day', created_at) FROM post_notes WHERE principal_id = ${id}
      UNION SELECT date_trunc('day', created_at) FROM conversation_messages WHERE principal_id = ${id}
      UNION SELECT date_trunc('day', created_at) FROM changelog_entries WHERE principal_id = ${id}
    ) active_days
    ORDER BY day
    OFFSET ${STAR_PROMPT_MIN_ACTIVE_DAYS - 1}
    LIMIT 1
  `)
  const day = getExecuteRows<{ day: Date | string }>(result)[0]?.day
  return day ? new Date(day) : null
}

/**
 * Posts, votes and conversations from real customers (not the team, not a
 * teammate's test visitor), counted only up to the threshold.
 */
export async function customerInteractions(): Promise<number> {
  const cap = STAR_PROMPT_MIN_CUSTOMER_INTERACTIONS
  const result = await db.execute<{ n: number | string }>(sql`
    SELECT count(*) AS n FROM (
      (SELECT 1 FROM posts p JOIN principal pr ON pr.id = p.principal_id
        WHERE pr.role = 'user' AND pr.test_owner_principal_id IS NULL AND p.deleted_at IS NULL
        LIMIT ${cap})
      UNION ALL
      (SELECT 1 FROM post_votes v JOIN principal pr ON pr.id = v.principal_id
        WHERE pr.role = 'user' AND pr.test_owner_principal_id IS NULL
        LIMIT ${cap})
      UNION ALL
      (SELECT 1 FROM conversations c JOIN principal pr ON pr.id = c.visitor_principal_id
        WHERE pr.test_owner_principal_id IS NULL
        LIMIT ${cap})
    ) interactions
  `)
  return Number(getExecuteRows<{ n: number | string }>(result)[0]?.n ?? 0)
}

/**
 * Whether this team member may see the star prompt, and where. Cheap checks
 * run first, so most calls never touch the activity tables.
 */
export async function getStarPromptStage(
  userId: UserId,
  principalId: PrincipalId,
  now: Date = new Date()
): Promise<StarPromptStage> {
  if (config.isPooledTenancy || isStarPromptDisabled()) return null
  const [cloud, settings, row] = await Promise.all([
    getCloudConfig(),
    getSettings(),
    db.query.user.findFirst({ where: eq(user.id, userId), columns: { metadata: true } }),
  ])
  if (cloud.enabled) return null
  if (readOnboardingProgress(row?.metadata ?? null).githubStarPromptAt) return null
  const workspaceCreatedAt = settings?.createdAt ? new Date(settings.createdAt) : null
  if (
    !workspaceCreatedAt ||
    now.getTime() < workspaceCreatedAt.getTime() + STAR_PROMPT_MIN_WORKSPACE_AGE_DAYS * DAY_MS
  ) {
    return null
  }
  const [fifthActiveDayAt, interactions] = await Promise.all([
    fifthActiveDay(principalId),
    customerInteractions(),
  ])
  return starPromptStage({
    now,
    workspaceCreatedAt,
    fifthActiveDayAt,
    customerInteractions: interactions,
  })
}

/**
 * The startup log's one pointer at the repo: self-hosted, first boot only
 * (setup not finished yet), and not when the prompt is switched off.
 */
export async function logFirstBootStarLine(log: {
  info: (fields: object, message: string) => void
}): Promise<void> {
  if (isStarPromptDisabled()) return
  const settings = await getSettings()
  if (isOnboardingComplete(getSetupState(settings?.setupState ?? null))) return
  log.info(
    { url: GITHUB_REPO_URL },
    'thanks for running Quackback. If it is useful, a star on GitHub helps other teams find it'
  )
}
