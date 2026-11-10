import type { PortalPageGates } from '@/lib/shared/design/paths'

/** The pages this workspace's portal has, as a signed-in visitor sees them. */
export async function workspaceGates(): Promise<PortalPageGates> {
  const [{ getWorkspaceSettings }, { portalPageGates }] = await Promise.all([
    import('@/lib/server/domains/settings/settings.service'),
    import('@/lib/shared/design/paths'),
  ])
  return portalPageGates(await getWorkspaceSettings(), true)
}
