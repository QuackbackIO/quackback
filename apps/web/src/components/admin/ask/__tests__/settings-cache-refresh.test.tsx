// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsChange } from '@/lib/shared/assistant/settings-proposals'
import type { CopilotProposedAction } from '@/lib/shared/assistant/copilot-contract'
import { WorkspaceSettingsProposalCard } from '../workspace-settings-proposal-card'

const server = vi.hoisted(() => ({
  detail: vi.fn(),
  apply: vi.fn(),
  undo: vi.fn(),
  invalidate: vi.fn(),
}))
vi.mock('@/lib/server/functions/assistant-pending-actions', () => ({
  getAssistantPendingActionFn: server.detail,
}))
vi.mock('@/lib/server/functions/workspace-copilot', () => ({
  applyWorkspaceSettingsProposalFn: server.apply,
  undoWorkspaceSettingsProposalFn: server.undo,
}))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: server.invalidate }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const changes: SettingsChange[] = [
  {
    id: 'branding.light.primary',
    area: 'branding',
    path: ['light', 'primary'],
    before: '#FFFF00',
    after: '#0F766E',
    settingsHref: '/admin/settings/portal',
  },
  {
    id: 'messenger.enabled',
    area: 'messenger',
    path: ['enabled'],
    before: false,
    after: true,
    settingsHref: '/admin/settings/channels/messenger',
  },
  {
    id: 'modules.statusPage',
    area: 'modules',
    path: ['statusPage'],
    before: false,
    after: true,
    settingsHref: '/admin/settings/features',
  },
  {
    id: 'office_hours.timezone',
    area: 'office_hours',
    path: ['timezone'],
    before: 'UTC',
    after: 'Europe/London',
    settingsHref: '/admin/settings/office-hours',
  },
  {
    id: 'changelog.autoSubscribe',
    area: 'changelog',
    path: ['autoSubscribe'],
    before: false,
    after: true,
    settingsHref: '/admin/settings/changelog',
  },
  {
    id: 'portal.displayName',
    area: 'portal',
    path: ['displayName'],
    before: 'Acme',
    after: 'Acme team',
    settingsHref: '/admin/settings/general',
  },
]
const warmKeys = [
  ['settings', 'branding'],
  ['settings', 'logo'],
  ['settings', 'widgetConfig'],
  ['settings', 'portalConfig'],
  ['settings', 'publicPortalConfig'],
  ['settings', 'helpCenterConfig'],
  ['settings', 'officeHours'],
  ['status', 'settings'],
  ['changelogs', 'settings'],
  ['admin', 'onboarding'],
] as const

async function mount(selected: SettingsChange[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  let stage = 'before'
  const cacheSnapshots: unknown[][] = []
  const fetched: string[] = []
  for (const key of warmKeys) {
    await client.fetchQuery({
      queryKey: key,
      queryFn: async ({ queryKey }) => {
        const encoded = JSON.stringify(queryKey)
        if (!warmKeys.some((known) => JSON.stringify(known) === encoded))
          throw new Error('Unknown settings query')
        fetched.push(encoded)
        return { key: encoded, value: stage }
      },
    })
  }
  const proposed = { kind: 'settings', version: 1, changes }
  let receipt: Record<string, unknown> | null = null
  server.detail.mockImplementation(async ({ data }: { data: { pendingActionId: string } }) => {
    expect(data.pendingActionId).toBe('pending-settings')
    return {
      id: data.pendingActionId,
      status: receipt ? 'executed' : 'proposed',
      args: proposed,
      result: receipt,
    }
  })
  server.apply.mockImplementation(
    async ({ data }: { data: { pendingActionId: string; selectedChangeIds: string[] } }) => {
      expect(data).toEqual({
        pendingActionId: 'pending-settings',
        selectedChangeIds: selected.map((change) => change.id),
      })
      stage = 'applied'
      receipt = {
        kind: 'settings',
        version: 1,
        changes: selected,
        appliedAt: '2026-10-03T12:00:00Z',
      }
      return { id: data.pendingActionId, status: 'executed', result: receipt }
    }
  )
  server.undo.mockImplementation(async ({ data }: { data: { pendingActionId: string } }) => {
    expect(data.pendingActionId).toBe('pending-settings')
    stage = 'before'
    receipt = { ...receipt, undoneAt: '2026-10-03T12:01:00Z' }
    return { id: data.pendingActionId, status: 'executed', result: receipt }
  })
  server.invalidate.mockImplementation(async () => {
    cacheSnapshots.push(warmKeys.map((key) => client.getQueryData(key)))
  })
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en">
        <WorkspaceSettingsProposalCard
          action={
            { id: 'pending-settings', toolName: 'propose_settings_change' } as CopilotProposedAction
          }
        />
      </IntlProvider>
    </QueryClientProvider>
  )
  await screen.findByRole('button', { name: 'Apply 6 changes' })
  for (const change of changes.filter((change) => !selected.includes(change))) {
    const labels: Record<string, RegExp> = {
      branding: /Branding/,
      messenger: /Messenger/,
      portal: /Portal/,
      modules: /Modules/,
      office_hours: /Office hours/,
      changelog: /Changelog/,
    }
    fireEvent.click(screen.getByRole('checkbox', { name: labels[change.area]! }))
  }
  return { client, fetched, cacheSnapshots }
}

describe('settings proposal cache refresh', () => {
  it('keeps operator name failures visible with the actual General settings action', async () => {
    const selected = changes.slice(-1)
    const { client } = await mount(selected)
    server.apply.mockImplementation(
      async ({ data }: { data: { pendingActionId: string; selectedChangeIds: string[] } }) => {
        expect(data).toEqual({
          pendingActionId: 'pending-settings',
          selectedChangeIds: selected.map((change) => change.id),
        })
        throw { code: 'SETTINGS_NAME_MANAGED' }
      }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 change' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Open General settings to change this workspace name.'
    )
    expect(server.invalidate).not.toHaveBeenCalled()
    client.clear()
  })
  it('refreshes inactive settings and launch data before routing after Apply and Undo', async () => {
    const selected = changes.slice(0, 2)
    const { client, fetched, cacheSnapshots } = await mount(selected)
    fireEvent.click(screen.getByRole('button', { name: 'Apply 2 changes' }))
    await waitFor(() => expect(cacheSnapshots).toHaveLength(1))
    for (const key of warmKeys.filter((key) =>
      [
        'branding',
        'logo',
        'widgetConfig',
        'portalConfig',
        'publicPortalConfig',
        'onboarding',
      ].includes(key[1])
    )) {
      expect(client.getQueryData(key)).toEqual({ key: JSON.stringify(key), value: 'applied' })
      expect(cacheSnapshots[0]).toContainEqual({ key: JSON.stringify(key), value: 'applied' })
    }
    expect(
      fetched.filter((key) => key === JSON.stringify(['settings', 'officeHours']))
    ).toHaveLength(1)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(cacheSnapshots).toHaveLength(2))
    expect(client.getQueryData(['settings', 'branding'])).toMatchObject({ value: 'before' })
    expect(cacheSnapshots[1]).toContainEqual({
      key: JSON.stringify(['settings', 'widgetConfig']),
      value: 'before',
    })
    client.clear()
  })

  it('refreshes selected module, office hours and changelog query families', async () => {
    const { client, cacheSnapshots } = await mount(changes)
    fireEvent.click(screen.getByRole('button', { name: 'Apply 6 changes' }))
    await waitFor(() => expect(cacheSnapshots).toHaveLength(1))
    for (const key of warmKeys) {
      expect(cacheSnapshots[0]).toContainEqual({ key: JSON.stringify(key), value: 'applied' })
    }
    client.clear()
  })
})
