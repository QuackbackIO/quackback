import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { settings, workspaceExperiments } from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'
const configured = vi.hoisted(() => ({ model: true, capability: true }))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('../assistant.runtime', () => ({ isAssistantConfigured: () => configured.model }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isCopilotCapabilityEnabled: async (name: string) => name === 'qa' && configured.capability,
}))
import {
  isWorkspaceCopilotEnabled,
  workspaceCopilotAvailable,
  WORKSPACE_COPILOT_EXPERIMENT,
} from '../workspace-copilot-gate'
const fixture = await createDbTestFixture()
const actor: Actor = {
  principalId: createId('principal'),
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
  permissions: new Set([PERMISSIONS.COPILOT_USE]),
}
let settingsId: typeof settings.$inferSelect.id
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  configured.model = true
  configured.capability = true
  settingsId = createId('workspace')
  await testDb
    .insert(settings)
    .values({ id: settingsId, name: 'Acme', slug: `acme-${settingsId}`, createdAt: new Date() })
})
afterEach(() => fixture.rollback())
afterAll(() => fixture.close())
it('defaults off and never uses a different experiment or workspace row', async () => {
  expect(await isWorkspaceCopilotEnabled()).toBe(false)
  expect(await workspaceCopilotAvailable(actor)).toBe(false)
  await testDb
    .insert(workspaceExperiments)
    .values({ settingsId, experimentId: 'different', enabled: true })
  expect(await isWorkspaceCopilotEnabled()).toBe(false)
  await testDb.insert(workspaceExperiments).values({
    settingsId,
    experimentId: WORKSPACE_COPILOT_EXPERIMENT,
    enabled: true,
    visible: false,
  })
  expect(await isWorkspaceCopilotEnabled()).toBe(true)
  expect(await workspaceCopilotAvailable(actor)).toBe(true)
})
it('requires a configured model, current capability and permission', async () => {
  await testDb
    .insert(workspaceExperiments)
    .values({ settingsId, experimentId: WORKSPACE_COPILOT_EXPERIMENT, enabled: true })
  expect(await workspaceCopilotAvailable({ ...actor, permissions: new Set() })).toBe(false)
  configured.model = false
  expect(await workspaceCopilotAvailable(actor)).toBe(false)
  configured.model = true
  configured.capability = false
  expect(await workspaceCopilotAvailable(actor)).toBe(false)
})
