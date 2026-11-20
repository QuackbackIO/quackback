/**
 * CLI: create an API key through the app's own service, with the options the
 * support API tests need, and print `{ key, id, principalId }`.
 *
 * Usage: bun support-api-key.ts '<json>'
 *   creatorEmail  teammate who creates the key (required)
 *   kind          'personal' (default) | 'workspace'
 *   roleKey       workspace keys: the role the key holds (default 'admin')
 *   scopes        e.g. ['read:chat']; omitted = the service default
 *   legacy        true: store NULL scopes (a pre-scopes full-access key)
 *   expiresAt     ISO time
 *   name          key name (default "support e2e <kind> key <time>")
 *
 * Workspace keys are granted with the creator's role ceiling taken as admin;
 * the suite only creates them as the admin.
 */
import { db, eq, principal, user, roles, apiKeys } from '@/lib/server/db'
import { createApiKey } from '@/lib/server/domains/api-keys/api-key.service'
import { ALL_PERMISSIONS } from '@/lib/shared/permissions'
import type { RoleId } from '@quackback/ids'

interface Args {
  creatorEmail: string
  kind?: 'personal' | 'workspace'
  roleKey?: string
  scopes?: string[]
  legacy?: boolean
  expiresAt?: string
  name?: string
}

try {
  const args = JSON.parse(process.argv[2] ?? '{}') as Args
  const kind = args.kind ?? 'personal'
  const [creator] = await db
    .select({ id: principal.id, role: principal.role })
    .from(principal)
    .innerJoin(user, eq(user.id, principal.userId))
    .where(eq(user.email, args.creatorEmail))
    .limit(1)
  if (!creator) throw new Error(`No principal for ${args.creatorEmail}`)

  let roleId: RoleId | undefined
  if (kind === 'workspace') {
    const [role] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, args.roleKey ?? 'admin'))
      .limit(1)
    if (!role) throw new Error(`No role ${args.roleKey}`)
    roleId = role.id as RoleId
  }

  const result = await createApiKey(
    {
      name: args.name ?? `support e2e ${kind} key ${Date.now()}`,
      kind,
      ...(roleId ? { roleId } : {}),
      ...(args.scopes ? { scopes: args.scopes } : {}),
      expiresAt: args.expiresAt ? new Date(args.expiresAt) : null,
    } as Parameters<typeof createApiKey>[0],
    creator.id,
    kind === 'workspace' ? { permissions: ALL_PERMISSIONS, role: 'admin' } : undefined
  )
  if (args.legacy) {
    await db.update(apiKeys).set({ scopes: null }).where(eq(apiKeys.id, result.apiKey.id))
  }
  process.stdout.write(
    JSON.stringify({
      key: result.plainTextKey,
      id: result.apiKey.id,
      principalId: result.apiKey.principalId,
    })
  )
  process.exit(0)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
