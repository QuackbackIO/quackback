import { beforeEach, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'

const state = vi.hoisted(() => ({
  model: true,
  capability: true,
  flags: {} as Record<string, boolean>,
}))
vi.mock('../assistant.runtime', () => ({ isAssistantConfigured: () => state.model }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isCopilotCapabilityEnabled: async (name: string) => name === 'qa' && state.capability,
  isFeatureEnabled: async (flag: string) => state.flags[flag] === true,
}))
import { isWorkspaceCopilotEnabled, workspaceCopilotAvailable } from '../workspace-copilot-gate'

const actor: Actor = {
  principalId: 'principal_member' as never,
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
  permissions: new Set([PERMISSIONS.COPILOT_USE]),
}

beforeEach(() => {
  state.model = true
  state.capability = true
  state.flags = {}
})

it('follows the Copilot on Home feature flag and no other', async () => {
  expect(await isWorkspaceCopilotEnabled()).toBe(false)
  state.flags = { supportInbox: true, helpCenter: true }
  expect(await workspaceCopilotAvailable(actor)).toBe(false)
  state.flags = { copilotHome: true }
  expect(await isWorkspaceCopilotEnabled()).toBe(true)
  expect(await workspaceCopilotAvailable(actor)).toBe(true)
})

it('requires a configured model, current capability and permission', async () => {
  state.flags = { copilotHome: true }
  expect(await workspaceCopilotAvailable({ ...actor, permissions: new Set() })).toBe(false)
  expect(await workspaceCopilotAvailable({ ...actor, role: 'user' })).toBe(false)
  state.model = false
  expect(await workspaceCopilotAvailable(actor)).toBe(false)
  state.model = true
  state.capability = false
  expect(await workspaceCopilotAvailable(actor)).toBe(false)
})
