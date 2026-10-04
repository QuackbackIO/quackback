import { createId } from '@quackback/ids'
import {
  principal,
  user,
  settings,
  roles,
  principalRoleAssignments,
  permissions,
  rolePermissions,
  eq,
  type Database,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { ALL_PERMISSIONS, PERMISSIONS } from '@/lib/shared/permissions'
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/shared/assistant/config'
import { API_KEY_SCOPES } from '@/lib/shared/api-key-scopes'
import type { McpAuthContext } from '@/lib/server/mcp/types'
import { createWorkspaceThread } from '@/lib/server/domains/assistant/workspace-threads.service'

export async function seedAskGoldenFixture(
  db: Database,
  profile: 'owner' | 'no_settings',
  modulesEnabled = false,
  operatorManagedName = false
) {
  const id = createId('principal')
  const userId = createId('user')
  await db
    .insert(user)
    .values({ id: userId, name: 'Acme', email: 'you@example.com', emailVerified: true })
  await db
    .insert(principal)
    .values({ id, userId, role: 'admin', type: 'user', displayName: 'Acme', createdAt: new Date() })
  if (profile === 'no_settings') {
    const roleId = createId('role')
    const permissionId = createId('permission')
    await db.insert(roles).values({ id: roleId, key: `acme-${id}`, name: 'Acme role' })
    await db
      .insert(permissions)
      .values({ id: permissionId, key: PERMISSIONS.COPILOT_USE, category: 'ai' })
      .onConflictDoNothing()
    const [permission] = await db
      .select()
      .from(permissions)
      .where(eq(permissions.key, PERMISSIONS.COPILOT_USE))
    await db.insert(rolePermissions).values({ roleId, permissionId: permission.id })
    await db.insert(principalRoleAssignments).values({ principalId: id, roleId })
  }
  const actor: Actor = {
    principalId: id,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set(profile === 'owner' ? ALL_PERMISSIONS : [PERMISSIONS.COPILOT_USE]),
  }
  const [workspace] = await db
    .insert(settings)
    .values({
      name: 'Acme',
      cloudIdentity: operatorManagedName
        ? {
            version: 1,
            displayName: 'Acme workspace',
            canonicalOrigin: 'https://acme.example.com',
            platformHostname: 'acme.example.com',
            customDomains: [],
            updatedAt: '2026-10-03T12:00:00.000Z',
          }
        : null,
      slug: `acme-${id}`,
      createdAt: new Date(),
      featureFlags: JSON.stringify({
        feedback: true,
        changelog: modulesEnabled,
        supportInbox: modulesEnabled,
        supportTickets: modulesEnabled,
        helpCenter: modulesEnabled,
        statusPage: modulesEnabled,
        copilotHome: true,
      }),
      widgetConfig: JSON.stringify({ messenger: { enabled: false, welcomeMessage: 'Welcome' } }),
      brandingConfig: JSON.stringify({ light: { primary: '#121212' } }),
      metadata: '{}',
      portalConfig: '{}',
      assistantConfig: structuredClone(DEFAULT_ASSISTANT_CONFIG),
    })
    .returning()
  const thread = await createWorkspaceThread(actor, 'Acme')
  const auth: McpAuthContext = {
    principalId: id,
    userId,
    email: 'you@example.com',
    role: 'admin',
    name: 'Acme',
    authMethod: 'oauth',
    scopes: [...API_KEY_SCOPES],
    workspaceThreadKey: thread.key,
    permissions: actor.permissions,
  }
  return { actor, auth, workspace, thread }
}
