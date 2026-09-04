/**
 * The plan gate on workflow creation, driven through the real service entry
 * point:
 *
 *   createWorkflow -> requireEntitlement -> getCloudConfig
 *     -> getWorkspaceSettings -> resolveCloudConfig -> refuse or insert
 *
 * Both directions per fixture, plus the cloud-off fixture: `isEntitled()`
 * grants everything when cloud is absent, so a test that only enabled cloud in
 * the refusal case would pass against unwired code.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { storedCloud } from '@/lib/server/domains/settings/cloud/__tests__/cloud-fixture'
import { EntitlementRequiredError } from '@/lib/server/errors/entitlement-error'

const hoisted = vi.hoisted(() => ({
  mockGetWorkspaceSettings: vi.fn(),
  mockInsert: vi.fn(),
  mockWriteVersion: vi.fn(),
  mockPruneVersions: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.mockGetWorkspaceSettings,
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    insert: (...args: unknown[]) => hoisted.mockInsert(...args),
  },
}))

vi.mock('../workflow-versions', () => ({
  writeWorkflowVersion: hoisted.mockWriteVersion,
  workflowVersionFieldsChanged: vi.fn(() => false),
  pruneWorkflowVersions: hoisted.mockPruneVersions,
}))

import { createWorkflow } from '../workflow.service'

const INPUT = {
  name: 'Route billing',
  class: 'background' as const,
  triggerType: 'conversation.created',
}

function withCloud(cloud: unknown): void {
  hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { id: 'ws_1', cloud } })
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockInsert.mockReturnValue({
    values: () => ({
      returning: () => Promise.resolve([{ id: 'workflow_1', name: INPUT.name, status: 'draft' }]),
    }),
  })
})

describe('createWorkflow — no cloud config', () => {
  it.each([
    ['no cloud block at all', null],
    ['an explicitly disabled block', { enabled: false, plan: 'free' }],
  ])('creates the workflow with %s', async (_label, cloud) => {
    withCloud(cloud)
    await expect(createWorkflow(INPUT)).resolves.toMatchObject({ id: 'workflow_1' })
    expect(hoisted.mockInsert).toHaveBeenCalledOnce()
  })
})

describe('createWorkflow — plan gate', () => {
  it('refuses on a plan without the entitlement and names the plan that has it', async () => {
    // Pro, not Free: the refusal has to name the cheapest plan that GRANTS
    // workflows (Business), not merely the next plan up from the workspace's own.
    withCloud(storedCloud('growth'))

    const refusal = await createWorkflow(INPUT).catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(EntitlementRequiredError)
    const error = refusal as EntitlementRequiredError
    expect(error.entitlement).toBe('workflows')
    expect(error.requiredPlanName).toBe('Business')
    expect(error.statusCode).toBe(402)
    expect(error.message).toBe(
      'Workflows are a Business feature. Your workspace is on Pro. Upgrade to Business to enable it.'
    )
    expect(hoisted.mockInsert).not.toHaveBeenCalled()
  })

  it('creates the workflow on a plan that includes it', async () => {
    withCloud(storedCloud('business'))
    await expect(createWorkflow(INPUT)).resolves.toMatchObject({ id: 'workflow_1' })
    expect(hoisted.mockInsert).toHaveBeenCalledOnce()
  })

  it('honours an explicit override in either direction', async () => {
    withCloud(storedCloud('free', { workflows: true }))
    await expect(createWorkflow(INPUT)).resolves.toBeDefined()

    withCloud(storedCloud('enterprise', { workflows: false }))
    await expect(createWorkflow(INPUT)).rejects.toBeInstanceOf(EntitlementRequiredError)
  })
})
