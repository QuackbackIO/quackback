/**
 * CLI: drive the plan limits state of the e2e workspace from the database, for
 * tests/admin/plan-limits.spec.ts.
 *
 * Each command writes what the app itself would write (a billing projection
 * the way its projection write stores it, the stored plan limits state, a
 * board, a teammate's role) and then drops the cached settings and the cached
 * plan limits inputs, so the running server reads the change on its next
 * request. Detection itself is left to the app: the next page load evaluates
 * the plan limits and stores the state.
 *
 * `begin` keeps what it changes in e2e/.auth/plan-limits-snapshot.json and
 * `end` puts it back, so the workspace is left as it was found. `begin` runs
 * `end` first when a snapshot is left over from an interrupted run.
 *
 * Usage: bun plan-limits-state.ts <command> [args...]
 *   begin <teammate-email>                 snapshot, then start from no plan billing
 *   lapse <maxBoards> <maxSeats>           a Business trial that lapsed to Free
 *   upgrade                                a Business subscription
 *   no-plan-billing <maxBoards> <maxSeats> no plan billing, stored tier limits
 *   board <name> [with-post]               a throwaway board (prints ids)
 *   role <email> <role>                    set a teammate's role
 *   css <on|off>                           set or clear the portal custom CSS
 *   assistant-off                          stop the AI assistant replying
 *   overdue <teammate-email>               move the deadline into the past
 *   state                                  print the stored state and post counts
 *   busy-boards                            count live boards with two or more posts
 *   api-key                                mint an admin API key (prints it)
 *   end                                    restore the snapshot
 */
import { createHash, randomBytes, randomUUID } from 'crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { fromUuid } from '@quackback/ids'
import { deleteCacheKeys, openDb } from './_lib'

const SNAPSHOT = resolve(import.meta.dirname, '../.auth/plan-limits-snapshot.json')
const BOARD_PREFIX = 'e2e-plan-limits-'
const KEY_NAME = 'e2e-plan-limits'
const CSS_MARKER = '.e2e-plan-limits-css{outline:0}'
const DAY = 86_400_000

const LIMIT_KEYS = [
  'maxBoards',
  'maxPosts',
  'maxTeamSeats',
  'maxStatusComponents',
  'maxCustomRoles',
  'maxSendingDomains',
  'aiTokensPerMonth',
  'emailsPerMonth',
  'apiRequestsPerMonth',
  'apiRequestsPerMinute',
  'maxInboundEmailAddresses',
  'maxHelpCenterLocales',
  'maxStatusSubscribers',
]
const BUSINESS = [
  'customDomain',
  'aiArticleTranslation',
  'aiAssistant',
  'aiDrafts',
  'aiInsights',
  'apiAccess',
  'mcpServer',
  'webhooks',
  'workflows',
]

const sql = openDb()

/** Every limit unlimited, with the given caps. */
function limits(caps: Record<string, number> = {}): Record<string, number | null> {
  return Object.fromEntries(LIMIT_KEYS.map((key) => [key, caps[key] ?? null]))
}

async function bust(): Promise<void> {
  await deleteCacheKeys(sql, [
    'settings:workspace',
    'plan-limits:inputs',
    'auth:registered-providers',
    'hooks:webhooks-active:v2',
  ])
}

async function settingsRow() {
  const [row] = await sql`SELECT id, cloud FROM settings ORDER BY created_at ASC LIMIT 1`
  if (!row) throw new Error('No settings row found (run the seed first)')
  return row
}

/** Store a projection as the projection write does: the block, a new revision, a new auth version. */
async function writeProjection(projection: Record<string, unknown> | null): Promise<void> {
  const row = await settingsRow()
  const version = Number(row.cloud?.projection?.version ?? 0) + 1
  const cloud = projection ? { enabled: true, projection: { version, ...projection } } : null
  await sql`
    UPDATE settings SET
      cloud = ${cloud === null ? null : sql.json(cloud)},
      cloud_revision = cloud_revision + 1,
      auth_config_version = auth_config_version + 1
    WHERE id = ${row.id}`
  await bust()
}

function projection(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    effectivePlan: 'business',
    trialStartedAt: null,
    trialExpiresAt: null,
    subscriptionStatus: null,
    entitlements: Object.fromEntries(BUSINESS.map((key) => [key, true])),
    freeLimits: limits(),
    planLimits: limits(),
    planLimitsExpireAt: null,
    canUpgrade: true,
    canManageBilling: true,
    renewalAt: null,
    cancellationAt: null,
    ...fields,
  }
}

async function seatCount(): Promise<number> {
  const [row] = await sql`
    SELECT
      (SELECT count(*)::int FROM principal WHERE role IN ('admin', 'member') AND type = 'user') +
      (SELECT count(*)::int FROM invitation
        WHERE kind = 'team' AND status = 'pending' AND expires_at > now()) AS used`
  return row.used
}

async function setRole(email: string, role: string): Promise<void> {
  await sql`
    UPDATE principal SET role = ${role}
    WHERE user_id IN (SELECT id FROM "user" WHERE email = ${email})`
  await bust()
}

/** Paid features other specs may leave set up; each would be one more thing to fix. */
async function setAside() {
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id)
  return {
    webhooks: ids(
      await sql`UPDATE webhooks SET status = 'disabled'
        WHERE status = 'active' AND deleted_at IS NULL RETURNING id`
    ),
    workflows: ids(
      await sql`UPDATE workflows SET status = 'paused'
        WHERE status = 'live' AND deleted_at IS NULL RETURNING id`
    ),
    integrations: ids(
      await sql`UPDATE integrations SET status = 'paused' WHERE status = 'active' RETURNING id`
    ),
    providers: ids(
      await sql`UPDATE identity_provider SET enabled = false WHERE enabled RETURNING id`
    ),
  }
}

async function begin(teammate: string): Promise<void> {
  if (existsSync(SNAPSHOT)) await end()
  const [row] = await sql`
    SELECT id, cloud, tier_limits, plan_limits_state, custom_css, widget_config
    FROM settings ORDER BY created_at ASC LIMIT 1`
  const aside = await setAside()
  writeFileSync(SNAPSHOT, JSON.stringify({ settings: row, aside, teammate }))
  await sql`
    UPDATE settings SET tier_limits = NULL, plan_limits_state = NULL, custom_css = NULL
    WHERE id = ${row.id}`
  await sql`UPDATE principal SET role = 'user'
    WHERE user_id IN (SELECT id FROM "user" WHERE email = ${teammate})`
  await writeProjection(null)
  const [boards] = await sql`SELECT count(*)::int AS n FROM boards WHERE deleted_at IS NULL`
  console.log(JSON.stringify({ boards: boards.n, seats: await seatCount() }))
}

async function end(): Promise<void> {
  if (existsSync(SNAPSHOT)) {
    const { settings, aside, teammate } = JSON.parse(readFileSync(SNAPSHOT, 'utf-8'))
    await sql`
      UPDATE settings SET
        cloud = ${settings.cloud === null ? null : sql.json(settings.cloud)},
        tier_limits = ${settings.tier_limits},
        plan_limits_state = ${
          settings.plan_limits_state === null ? null : sql.json(settings.plan_limits_state)
        },
        custom_css = ${settings.custom_css},
        widget_config = ${settings.widget_config},
        cloud_revision = cloud_revision + 1,
        auth_config_version = auth_config_version + 1
      WHERE id = ${settings.id}`
    const back = async (table: string, ids: string[], set: string) => {
      if (ids.length > 0) await sql.unsafe(`UPDATE ${table} SET ${set} WHERE id = ANY($1)`, [ids])
    }
    await back('webhooks', aside.webhooks, "status = 'active'")
    await back('workflows', aside.workflows, "status = 'live'")
    await back('integrations', aside.integrations, "status = 'active'")
    await back('identity_provider', aside.providers, 'enabled = true')
    await sql`UPDATE principal SET role = 'user'
      WHERE user_id IN (SELECT id FROM "user" WHERE email = ${teammate})`
    rmSync(SNAPSHOT)
  }
  const boards = sql`SELECT id FROM boards WHERE slug LIKE ${BOARD_PREFIX + '%'}`
  await sql`DELETE FROM posts WHERE board_id IN (${boards})`
  await sql`DELETE FROM boards WHERE slug LIKE ${BOARD_PREFIX + '%'}`
  await sql`UPDATE api_keys SET revoked_at = now() WHERE name = ${KEY_NAME} AND revoked_at IS NULL`
  await bust()
}

async function board(name: string, withPost: boolean): Promise<void> {
  const id = randomUUID()
  const slug = `${BOARD_PREFIX}${Date.now()}`
  await sql`INSERT INTO boards (id, slug, name) VALUES (${id}, ${slug}, ${name})`
  if (withPost) {
    const [author] = await sql`
      SELECT p.id FROM principal p JOIN "user" u ON u.id = p.user_id
      WHERE u.email = 'demo@example.com'`
    const [status] = await sql`SELECT id FROM post_statuses WHERE is_default LIMIT 1`
    await sql`
      INSERT INTO posts (id, board_id, title, content, principal_id, status_id)
      VALUES (${randomUUID()}, ${id}, ${`${name} post`}, 'Kept through the plan change.',
        ${author.id}, ${status?.id ?? null})`
  }
  await bust()
  console.log(JSON.stringify({ id: fromUuid('board', id), slug, name }))
}

async function overdue(teammate: string): Promise<void> {
  const [row] =
    await sql`SELECT id, plan_limits_state FROM settings ORDER BY created_at ASC LIMIT 1`
  const state = row.plan_limits_state
  if (!state) throw new Error('No plan limits state stored yet; load an admin page first')
  const now = Date.now()
  // Everyone but the throwaway teammate keeps a seat, as the seat chooser would save it.
  const holders = await sql`
    SELECT p.id FROM principal p JOIN "user" u ON u.id = p.user_id
    WHERE p.role IN ('admin', 'member') AND p.type = 'user' AND u.email <> ${teammate}`
  const next = {
    ...state,
    since: new Date(now - 8 * DAY).toISOString(),
    graceEndsAt: new Date(now - DAY).toISOString(),
    seatHolderIds: holders.map((h) => fromUuid('principal', h.id)),
  }
  await sql`UPDATE settings SET plan_limits_state = ${sql.json(next)} WHERE id = ${row.id}`
  await bust()
  console.log(JSON.stringify(next))
}

async function state(): Promise<void> {
  const [row] = await sql`SELECT plan_limits_state FROM settings ORDER BY created_at ASC LIMIT 1`
  const [posts] = await sql`SELECT count(*)::int AS n FROM posts WHERE deleted_at IS NULL`
  const perBoard = await sql`
    SELECT b.slug, count(p.id)::int AS n FROM boards b
    LEFT JOIN posts p ON p.board_id = b.id AND p.deleted_at IS NULL
    WHERE b.deleted_at IS NULL GROUP BY b.slug`
  console.log(
    JSON.stringify({
      state: row.plan_limits_state,
      posts: posts.n,
      boards: Object.fromEntries(perBoard.map((b) => [b.slug, b.n])),
    })
  )
}

async function apiKey(): Promise<void> {
  const key = `qb_${randomBytes(24).toString('hex')}`
  const [admin] = await sql`
    SELECT p.id FROM principal p JOIN "user" u ON u.id = p.user_id
    WHERE u.email = 'demo@example.com'`
  await sql`
    INSERT INTO api_keys (id, name, key_hash, key_prefix, created_by_id, principal_id)
    VALUES (${randomUUID()}, ${KEY_NAME}, ${createHash('sha256').update(key).digest('hex')},
      ${key.substring(0, 12)}, ${admin.id}, ${admin.id})`
  console.log(JSON.stringify({ key }))
}

const [command, ...args] = process.argv.slice(2)
const caps = () => ({ maxBoards: Number(args[0]), maxTeamSeats: Number(args[1]) })

try {
  switch (command) {
    case 'begin':
      await begin(args[0]!)
      break
    case 'lapse': {
      const now = Date.now()
      const lapsed = new Date(now - 2 * DAY).toISOString()
      await writeProjection(
        projection({
          trialStartedAt: new Date(now - 16 * DAY).toISOString(),
          trialExpiresAt: lapsed,
          planLimitsExpireAt: lapsed,
          freeLimits: limits(caps()),
        })
      )
      break
    }
    case 'upgrade':
      await writeProjection(
        projection({
          subscriptionStatus: 'active',
          renewalAt: new Date(Date.now() + 30 * DAY).toISOString(),
        })
      )
      break
    case 'no-plan-billing': {
      await writeProjection(null)
      const row = await settingsRow()
      await sql`UPDATE settings SET tier_limits = ${JSON.stringify(caps())} WHERE id = ${row.id}`
      await bust()
      break
    }
    case 'board':
      await board(args[0]!, args[1] === 'with-post')
      break
    case 'role':
      await setRole(args[0]!, args[1]!)
      break
    case 'css': {
      const row = await settingsRow()
      await sql`UPDATE settings SET custom_css = ${args[0] === 'on' ? CSS_MARKER : null}
        WHERE id = ${row.id}`
      await bust()
      break
    }
    case 'assistant-off': {
      // As pausing replies under the Agent settings saves it.
      const [row] =
        await sql`SELECT id, widget_config FROM settings ORDER BY created_at ASC LIMIT 1`
      const widget = row.widget_config ? JSON.parse(row.widget_config) : {}
      const messenger = widget.messenger ?? {}
      widget.messenger = {
        ...messenger,
        assistant: { enabled: true, ...messenger.assistant, respond: false },
      }
      await sql`UPDATE settings SET widget_config = ${JSON.stringify(widget)} WHERE id = ${row.id}`
      await bust()
      break
    }
    case 'overdue':
      await overdue(args[0]!)
      break
    case 'state':
      await state()
      break
    case 'busy-boards': {
      // Posts as the plan limits count them: live, and not by a test customer.
      const [row] = await sql`
        SELECT count(*)::int AS n FROM boards b
        WHERE b.deleted_at IS NULL AND (
          SELECT count(*) FROM posts p
          LEFT JOIN principal a ON a.id = p.principal_id
          WHERE p.board_id = b.id AND p.deleted_at IS NULL
            AND a.test_owner_principal_id IS NULL
        ) >= 2`
      console.log(JSON.stringify({ boards: row.n }))
      break
    }
    case 'api-key':
      await apiKey()
      break
    case 'end':
      await end()
      break
    default:
      throw new Error(`Unknown command: ${command}`)
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
} finally {
  await sql.end()
}
