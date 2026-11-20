/**
 * CLI: per-test fixtures for the support API suite that the shared people must
 * never be used for (they would change what other tests see): a fresh teammate
 * with its own custom role and teams, narrowing that role, a teammate leaving
 * or being blocked, revoking or expiring a key. Mutating calls go through the
 * app's services where the product has one, so caches and side effects match.
 *
 * Usage: bun support-api-fixtures.ts '<json>'
 *   { op: 'teammate', name, permissions: string[], teams?: TeamId[] }
 *       -> { email, userId, principalId, roleId }   (custom role, principal role 'member')
 *   { op: 'setPermissions', roleId, permissions }    replace the role's permissions
 *   { op: 'leave', principalId }                     principal role 'user' (left the team)
 *   { op: 'block', principalId }                     blocked_at = now
 *   { op: 'revoke', keyId }                          revokeApiKey (demotes a workspace key)
 *   { op: 'expire', keyId }                          expires_at in the past
 *   { op: 'backdateKey', keyId }                     created a day before the personal-key
 *                                                    reply cutoff (a pre-cutoff key)
 *   { op: 'applySla', conversationId }               a new policy (1 h first response,
 *                                                    1 h next response) applied through the service
 *   { op: 'enablePortalMcp' }                        developerConfig.mcpPortalAccessEnabled on
 */
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { revokeApiKey } from '@/lib/server/domains/api-keys/api-key.service'
import { applySlaToConversation } from '@/lib/server/domains/sla/sla.service'
import { createSlaPolicy } from '@/lib/server/domains/sla/sla-policy.service'
import type { ApiKeyId, ConversationId } from '@quackback/ids'
import { bustWorkspaceSettings, deleteCacheKeys, openDb, parseJson } from './_lib'

const sql = openDb()

type Op =
  | { op: 'teammate'; name: string; permissions: string[]; teams?: string[] }
  | { op: 'setPermissions'; roleId: string; permissions: string[] }
  | { op: 'leave' | 'block'; principalId: string }
  | { op: 'revoke' | 'expire' | 'backdateKey'; keyId: string }
  | { op: 'applySla'; conversationId: string }
  | { op: 'enablePortalMcp' }

async function setRolePermissions(roleUuid: string, permissionKeys: string[]): Promise<void> {
  const perms = permissionKeys.length
    ? await sql`SELECT id, key FROM permissions WHERE key IN ${sql(permissionKeys)}`
    : []
  if (perms.length !== permissionKeys.length) {
    const found = new Set(perms.map((p) => p.key as string))
    throw new Error(
      `Unknown permissions: ${permissionKeys.filter((p) => !found.has(p)).join(', ')}`
    )
  }
  await sql`DELETE FROM role_permissions WHERE role_id = ${roleUuid}`
  for (const perm of perms) {
    await sql`INSERT INTO role_permissions (id, role_id, permission_id)
              VALUES (${toUuid(generateId('role_perm'))}, ${roleUuid}, ${perm.id as string})`
  }
}

async function run(input: Op): Promise<unknown> {
  switch (input.op) {
    case 'teammate': {
      const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      const email = `${slug}@team.example`
      const roleUuid = toUuid(generateId('role'))
      await sql`INSERT INTO roles (id, key, name, description, is_system)
                VALUES (${roleUuid}, ${`e2e_${slug.replace(/-/g, '_')}`}, ${input.name},
                        ${'Support API e2e role'}, false)`
      await setRolePermissions(roleUuid, input.permissions)
      const userUuid = toUuid(generateId('user'))
      await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
                VALUES (${userUuid}, ${input.name}, ${email}, true, NOW(), NOW())`
      const principalUuid = toUuid(generateId('principal'))
      await sql`INSERT INTO principal (id, user_id, role, type, display_name, created_at)
                VALUES (${principalUuid}, ${userUuid}, 'member', 'user', ${input.name}, NOW())`
      await sql`INSERT INTO principal_role_assignments (id, principal_id, role_id, created_at)
                VALUES (${toUuid(generateId('role_asgn'))}, ${principalUuid}, ${roleUuid}, NOW())`
      for (const team of input.teams ?? []) {
        await sql`INSERT INTO team_members (id, team_id, principal_id)
                  VALUES (${toUuid(generateId('team_member'))},
                          ${toUuid(team as `team_${string}`)}, ${principalUuid})`
      }
      return {
        email,
        userId: fromUuid('user', userUuid),
        principalId: fromUuid('principal', principalUuid),
        roleId: fromUuid('role', roleUuid),
      }
    }
    case 'setPermissions':
      await setRolePermissions(toUuid(input.roleId as `role_${string}`), input.permissions)
      return { ok: true }
    case 'leave':
    case 'block': {
      const id = toUuid(input.principalId as `principal_${string}`)
      if (input.op === 'leave') await sql`UPDATE principal SET role = 'user' WHERE id = ${id}`
      else await sql`UPDATE principal SET blocked_at = NOW() WHERE id = ${id}`
      const [row] = await sql`SELECT user_id FROM principal WHERE id = ${id}`
      if (row?.user_id) {
        await deleteCacheKeys(sql, [`principal:user:${fromUuid('user', row.user_id as string)}`])
      }
      return { ok: true }
    }
    case 'revoke':
      await revokeApiKey(input.keyId as ApiKeyId)
      return { ok: true }
    case 'expire':
      await sql`UPDATE api_keys SET expires_at = NOW() - interval '1 minute'
                WHERE id = ${toUuid(input.keyId as `api_key_${string}`)}`
      return { ok: true }
    case 'backdateKey':
      await sql`UPDATE api_keys SET created_at =
                  (SELECT (value #>> '{}')::timestamptz - interval '1 day' FROM kv_store
                   WHERE key = 'api-keys:personal-reply-cutoff' LIMIT 1)
                WHERE id = ${toUuid(input.keyId as `api_key_${string}`)}`
      return { ok: true }
    case 'applySla': {
      const policy = await createSlaPolicy({
        name: `E2E API SLA ${Date.now()}`,
        firstResponseTargetSecs: 3600,
        nextResponseTargetSecs: 3600,
      })
      await applySlaToConversation(input.conversationId as ConversationId, policy.id)
      return { policyId: policy.id }
    }
    case 'enablePortalMcp': {
      const [row] = await sql`SELECT id, developer_config FROM settings ORDER BY created_at LIMIT 1`
      const current = parseJson(row.developer_config)
      if (current.mcpPortalAccessEnabled !== true) {
        await sql`UPDATE settings SET developer_config =
                    ${JSON.stringify({ ...current, mcpPortalAccessEnabled: true })}
                  WHERE id = ${row.id}`
        await bustWorkspaceSettings(sql)
      }
      return { ok: true }
    }
  }
}

try {
  const out = await run(JSON.parse(process.argv[2] ?? '{}') as Op)
  process.stdout.write(JSON.stringify(out))
  await sql.end()
  process.exit(0)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
