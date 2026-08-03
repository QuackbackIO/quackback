import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const hoisted = vi.hoisted(() => ({
  listSegmentsMock: vi.fn(),
  getSegmentMock: vi.fn(),
  createSegmentMock: vi.fn(),
  updateSegmentMock: vi.fn(),
  deleteSegmentMock: vi.fn(),
  getOrgChangelogVisibilityMock: vi.fn(),
  setOrgChangelogVisibilityMock: vi.fn(),
  getAllSegmentChangelogVisibilitiesMock: vi.fn(),
  getSegmentChangelogVisibilityMock: vi.fn(),
  setSegmentChangelogVisibilityMock: vi.fn(),
  deleteSegmentChangelogVisibilityMock: vi.fn(),
}))

vi.mock('@/lib/server/domains/segments/segment.service', () => ({
  listSegments: (...args: unknown[]) => hoisted.listSegmentsMock(...args),
  getSegment: (...args: unknown[]) => hoisted.getSegmentMock(...args),
  createSegment: (...args: unknown[]) => hoisted.createSegmentMock(...args),
  updateSegment: (...args: unknown[]) => hoisted.updateSegmentMock(...args),
  deleteSegment: (...args: unknown[]) => hoisted.deleteSegmentMock(...args),
}))

vi.mock('@/lib/server/domains/changelog/changelog-visibility.service', () => ({
  getOrgChangelogVisibility: (...args: unknown[]) => hoisted.getOrgChangelogVisibilityMock(...args),
  setOrgChangelogVisibility: (...args: unknown[]) => hoisted.setOrgChangelogVisibilityMock(...args),
  getAllSegmentChangelogVisibilities: (...args: unknown[]) =>
    hoisted.getAllSegmentChangelogVisibilitiesMock(...args),
  getSegmentChangelogVisibility: (...args: unknown[]) =>
    hoisted.getSegmentChangelogVisibilityMock(...args),
  setSegmentChangelogVisibility: (...args: unknown[]) =>
    hoisted.setSegmentChangelogVisibilityMock(...args),
  deleteSegmentChangelogVisibility: (...args: unknown[]) =>
    hoisted.deleteSegmentChangelogVisibilityMock(...args),
}))

import { registerTools } from '../tools'
import type { McpAuthContext, McpScope } from '../types'

type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>

function auth(scopes: McpScope[], role: 'admin' | 'member' | 'user' = 'admin'): McpAuthContext {
  return {
    principalId: 'principal_admin' as never,
    userId: 'user_admin' as never,
    name: 'Ada Admin',
    email: 'ada@example.com',
    role,
    authMethod: 'oauth',
    scopes,
  }
}

function collectHandlers(authContext: McpAuthContext) {
  const handlers = new Map<string, ToolHandler>()
  const fakeServer = {
    tool: (
      name: string,
      _description: string,
      _schema: unknown,
      _annotations: unknown,
      handler: ToolHandler
    ) => {
      handlers.set(name, handler)
    },
  }
  registerTools(fakeServer as never, authContext)
  return handlers
}

function text(result: CallToolResult) {
  return result.content[0]?.type === 'text' ? result.content[0].text : ''
}

function data<T>(result: CallToolResult) {
  return JSON.parse(text(result)) as T
}

function segment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'segment_enterprise',
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'Enterprise users',
    type: 'manual',
    color: '#2563eb',
    rules: null,
    evaluationSchedule: null,
    weightConfig: null,
    memberCount: 42,
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
    updatedAt: new Date('2026-01-01T11:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.listSegmentsMock.mockResolvedValue([segment()])
  hoisted.getSegmentMock.mockResolvedValue(segment())
  hoisted.createSegmentMock.mockResolvedValue(segment({ id: 'segment_new', name: 'VIPs' }))
  hoisted.updateSegmentMock.mockResolvedValue(segment({ name: 'Updated' }))
  hoisted.deleteSegmentMock.mockResolvedValue(undefined)
  hoisted.getOrgChangelogVisibilityMock.mockResolvedValue({
    restrictCategories: true,
    allowedCategoryIds: ['cat_release'],
  })
  hoisted.setOrgChangelogVisibilityMock.mockResolvedValue(undefined)
  hoisted.getAllSegmentChangelogVisibilitiesMock.mockResolvedValue([
    {
      segmentId: 'segment_enterprise',
      segmentName: 'Enterprise',
      config: { restrictProducts: true, allowedProductIds: ['prod_web'] },
    },
  ])
  hoisted.getSegmentChangelogVisibilityMock.mockResolvedValue({
    restrictProducts: true,
    allowedProductIds: ['prod_web'],
  })
  hoisted.setSegmentChangelogVisibilityMock.mockResolvedValue(undefined)
  hoisted.deleteSegmentChangelogVisibilityMock.mockResolvedValue(undefined)
})

describe('MCP config and visibility tools', () => {
  it('executes segment read/write tools and validates required manage_segment arguments', async () => {
    const handlers = collectHandlers(auth(['read:config', 'write:config']))

    const listResult = await handlers.get('list_segments')!({})
    expect(data<{ segments: Array<{ id: string }> }>(listResult).segments).toHaveLength(1)

    const getResult = await handlers.get('get_segment')!({ segmentId: 'segment_enterprise' })
    expect(data<{ memberCount: number; name: string }>(getResult)).toMatchObject({
      name: 'Enterprise',
      memberCount: 42,
    })
    expect(hoisted.getSegmentMock).toHaveBeenCalledWith('segment_enterprise')

    hoisted.getSegmentMock.mockResolvedValueOnce(null)
    const missingResult = await handlers.get('get_segment')!({ segmentId: 'segment_missing' })
    expect(missingResult.isError).toBe(true)
    expect(text(missingResult)).toContain('not found')

    const createMissing = await handlers.get('manage_segment')!({ action: 'create' })
    expect(createMissing.isError).toBe(true)
    expect(text(createMissing)).toContain('name and type are required')

    const createResult = await handlers.get('manage_segment')!({
      action: 'create',
      name: 'VIPs',
      type: 'manual',
      description: null,
      color: '#f59e0b',
    })
    expect(data<{ id: string; name: string }>(createResult)).toMatchObject({
      id: 'segment_new',
      name: 'VIPs',
    })
    expect(hoisted.createSegmentMock).toHaveBeenCalledWith({
      name: 'VIPs',
      type: 'manual',
      description: undefined,
      color: '#f59e0b',
      rules: undefined,
    })

    const updateMissing = await handlers.get('manage_segment')!({ action: 'update' })
    expect(updateMissing.isError).toBe(true)
    expect(text(updateMissing)).toContain('segmentId is required')

    await handlers.get('manage_segment')!({
      action: 'update',
      segmentId: 'segment_enterprise',
      name: 'Updated',
      rules: { match: 'all', conditions: [] },
    })
    expect(hoisted.updateSegmentMock).toHaveBeenCalledWith('segment_enterprise', {
      name: 'Updated',
      description: undefined,
      color: undefined,
      rules: { match: 'all', conditions: [] },
    })

    const deleteMissing = await handlers.get('manage_segment')!({ action: 'delete' })
    expect(deleteMissing.isError).toBe(true)
    expect(text(deleteMissing)).toContain('segmentId is required')

    const deleteResult = await handlers.get('manage_segment')!({
      action: 'delete',
      segmentId: 'segment_enterprise',
    })
    expect(data<{ deleted: boolean; id: string }>(deleteResult)).toEqual({
      deleted: true,
      id: 'segment_enterprise',
    })
    expect(hoisted.deleteSegmentMock).toHaveBeenCalledWith('segment_enterprise')
  })

  it('executes changelog visibility tools across org and segment branches', async () => {
    const handlers = collectHandlers(auth(['read:feedback', 'write:changelog']))

    const orgRead = await handlers.get('get_changelog_visibility')!({})
    expect(data<{ org: unknown; segments: unknown[] }>(orgRead)).toMatchObject({
      org: { restrictCategories: true, allowedCategoryIds: ['cat_release'] },
      segments: [{ segmentId: 'segment_enterprise' }],
    })

    const segmentRead = await handlers.get('get_changelog_visibility')!({
      segmentId: 'segment_enterprise',
    })
    expect(data<{ segmentId: string; config: unknown }>(segmentRead)).toEqual({
      segmentId: 'segment_enterprise',
      config: { restrictProducts: true, allowedProductIds: ['prod_web'] },
    })

    const orgWrite = await handlers.get('set_changelog_visibility')!({
      restrictCategories: false,
      allowedCategoryIds: [],
    })
    expect(data<{ org: unknown }>(orgWrite)).toEqual({
      org: { restrictCategories: true, allowedCategoryIds: ['cat_release'] },
    })
    expect(hoisted.setOrgChangelogVisibilityMock).toHaveBeenCalledWith({
      restrictCategories: false,
      allowedCategoryIds: [],
    })

    const segmentWrite = await handlers.get('set_changelog_visibility')!({
      segmentId: 'segment_enterprise',
      restrictProducts: true,
      allowedProductIds: ['prod_web'],
    })
    expect(data<{ segmentId: string; config: unknown }>(segmentWrite)).toEqual({
      segmentId: 'segment_enterprise',
      config: { restrictProducts: true, allowedProductIds: ['prod_web'] },
    })
    expect(hoisted.setSegmentChangelogVisibilityMock).toHaveBeenCalledWith('segment_enterprise', {
      restrictProducts: true,
      allowedProductIds: ['prod_web'],
    })

    const deleteResult = await handlers.get('delete_changelog_segment_visibility')!({
      segmentId: 'segment_enterprise',
    })
    expect(data<{ deleted: boolean; segmentId: string }>(deleteResult)).toEqual({
      deleted: true,
      segmentId: 'segment_enterprise',
    })
    expect(hoisted.deleteSegmentChangelogVisibilityMock).toHaveBeenCalledWith('segment_enterprise')
  })

  it('fails closed when config scopes or team role are missing', async () => {
    const noScopes = collectHandlers(auth([]))
    const readDenied = await noScopes.get('list_segments')!({})
    expect(readDenied.isError).toBe(true)
    expect(text(readDenied)).toContain('Insufficient scope')

    const portalUser = collectHandlers(auth(['write:config', 'write:changelog'], 'user'))
    const segmentWriteDenied = await portalUser.get('manage_segment')!({
      action: 'delete',
      segmentId: 'segment_enterprise',
    })
    expect(segmentWriteDenied.isError).toBe(true)
    expect(text(segmentWriteDenied)).toContain('team member')

    const changelogWriteDenied = await portalUser.get('set_changelog_visibility')!({
      restrictCategories: false,
    })
    expect(changelogWriteDenied.isError).toBe(true)
    expect(text(changelogWriteDenied)).toContain('team member')
  })
})
