/**
 * The plan gate on the macro library (the second half of AI drafts: the
 * library those drafts insert from), driven through the real service entry
 * points every macro surface goes through:
 *
 *   listMacros / createMacro -> requireEntitlement -> getCloudConfig
 *     -> getWorkspaceSettings -> resolveCloudConfig -> refuse or read/write
 *
 * Both directions per fixture, plus the cloud-off fixture, because
 * `isEntitled()` grants everything when cloud is absent and a fixture that
 * forgot to enable cloud would pass against unwired code.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EntitlementRequiredError } from '@/lib/server/errors/entitlement-error'
import { storedCloud } from '@/lib/server/domains/settings/cloud/__tests__/cloud-fixture'
import type { PrincipalId } from '@quackback/ids'

const hoisted = vi.hoisted(() => ({
  mockGetWorkspaceSettings: vi.fn(),
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.mockGetWorkspaceSettings,
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: (...args: unknown[]) => hoisted.mockSelect(...args),
    insert: (...args: unknown[]) => hoisted.mockInsert(...args),
  },
}))

import { listMacros, createMacro } from '../macro.service'

const ROW = {
  id: 'macro_1',
  name: 'Refund policy',
  body: 'Hi {firstName}, here is our refund policy.',
  scope: 'support' as const,
  actions: [],
}

const CREATE_INPUT = {
  name: ROW.name,
  body: ROW.body,
  scope: 'support' as const,
  actions: [],
  createdByPrincipalId: 'prn_1' as PrincipalId,
}

function withCloud(cloud: unknown): void {
  hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { id: 'ws_1', cloud } })
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockSelect.mockReturnValue({
    from: () => ({ where: () => ({ orderBy: () => Promise.resolve([ROW]) }) }),
  })
  hoisted.mockInsert.mockReturnValue({
    values: () => ({ returning: () => Promise.resolve([ROW]) }),
  })
})

describe('macro library — no cloud config', () => {
  it.each([
    ['no cloud block at all', null],
    ['an explicitly disabled block', { enabled: false, plan: 'free' }],
  ])('lists and creates macros with %s', async (_label, cloud) => {
    withCloud(cloud)
    await expect(listMacros('support')).resolves.toEqual([ROW])
    await expect(createMacro(CREATE_INPUT)).resolves.toEqual(ROW)
    expect(hoisted.mockSelect).toHaveBeenCalledOnce()
    expect(hoisted.mockInsert).toHaveBeenCalledOnce()
  })
})

describe('macro library — plan gate', () => {
  // Every catalogue plan grants AI drafts, so a refusal comes from an explicit
  // override, and the copy points to support instead of naming a plan.
  it('refuses the read when the entitlement is withheld', async () => {
    withCloud(storedCloud('free', { aiDrafts: false }))

    const refusal = await listMacros('support').catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(EntitlementRequiredError)
    const error = refusal as EntitlementRequiredError
    expect(error.entitlement).toBe('aiDrafts')
    expect(error.requiredPlanName).toBeNull()
    expect(error.statusCode).toBe(402)
    expect(error.message).toBe(
      'AI drafts are not included in your plan. Your workspace is on Free. Contact us to enable it.'
    )
    expect(hoisted.mockSelect).not.toHaveBeenCalled()
  })

  it('refuses the write when the entitlement is withheld', async () => {
    withCloud(storedCloud('free', { aiDrafts: false }))
    await expect(createMacro(CREATE_INPUT)).rejects.toBeInstanceOf(EntitlementRequiredError)
    expect(hoisted.mockInsert).not.toHaveBeenCalled()
  })

  it('lists and creates macros on a plan that includes it', async () => {
    withCloud(storedCloud('pro'))
    await expect(listMacros('support')).resolves.toEqual([ROW])
    await expect(createMacro(CREATE_INPUT)).resolves.toEqual(ROW)
    expect(hoisted.mockSelect).toHaveBeenCalledOnce()
    expect(hoisted.mockInsert).toHaveBeenCalledOnce()
  })

  it('honours an explicit override in either direction', async () => {
    withCloud(storedCloud('free', { aiDrafts: true }))
    await expect(listMacros()).resolves.toEqual([ROW])

    withCloud(storedCloud('enterprise', { aiDrafts: false }))
    await expect(listMacros()).rejects.toBeInstanceOf(EntitlementRequiredError)
  })
})
