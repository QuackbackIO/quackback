import type { QueryClient } from '@tanstack/react-query'
import {
  settingsProposalSchema,
  type SettingsArea,
} from '@/lib/shared/assistant/settings-proposals'

const AREA_QUERY_KEYS: Record<SettingsArea, readonly (readonly string[])[]> = {
  branding: [
    ['settings', 'branding'],
    ['settings', 'logo'],
    ['settings', 'headerLogo'],
  ],
  portal: [['settings', 'publicPortalConfig']],
  messenger: [
    ['settings', 'widgetConfig'],
    ['settings', 'portalConfig'],
    ['settings', 'publicPortalConfig'],
  ],
  modules: [
    ['settings', 'widgetConfig'],
    ['settings', 'portalConfig'],
    ['settings', 'publicPortalConfig'],
    ['settings', 'helpCenterConfig'],
    ['status', 'settings'],
    ['status', 'public'],
  ],
  office_hours: [['settings', 'officeHours']],
  changelog: [
    ['changelogs', 'settings'],
    ['changelogs', 'public'],
  ],
}

export async function refreshSettingsProposalQueries(queryClient: QueryClient, receipt: unknown) {
  const value =
    receipt && typeof receipt === 'object' && !Array.isArray(receipt)
      ? (receipt as Record<string, unknown>)
      : null
  const proposal = settingsProposalSchema.safeParse({
    kind: value?.kind,
    version: value?.version,
    changes: value?.changes,
  })
  await refreshSettingsAreaQueries(
    queryClient,
    proposal.success ? proposal.data.changes.map((change) => change.area) : []
  )
}

export async function refreshSettingsAreaQueries(queryClient: QueryClient, areas: SettingsArea[]) {
  const keys = new Map<string, readonly string[]>([['onboarding', ['admin', 'onboarding']]])
  for (const area of areas)
    for (const key of AREA_QUERY_KEYS[area]) keys.set(JSON.stringify(key), key)

  // Route loaders seed local form state from cached data, including inactive
  // queries. Await fresh values before routing so a warm form reads the write.
  await Promise.all(
    [...keys.values()].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey, refetchType: 'all' })
    )
  )
}
