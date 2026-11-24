/**
 * Tests for Azure DevOps inbound webhook handler.
 * Basic Auth verification is covered by the shared signature matrix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/integrations/azure-devops/server/api', () => ({
  getWorkItemStatus: vi.fn(),
}))

import { azureDevOpsInboundHandler } from '@/integrations/azure-devops/server/inbound'
import { getWorkItemStatus } from '@/integrations/azure-devops/server/api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const config = { organizationName: 'contoso', channelId: 'Fabrikam:User Story' }
const secrets = { accessToken: 'test-pat' }

/** A real `workitem.updated` delivery, trimmed. */
function stateChangePayload(overrides: { baseUrl?: string | null; revisionFields?: object } = {}) {
  const baseUrl =
    overrides.baseUrl === undefined ? 'https://dev.azure.com/contoso/' : overrides.baseUrl
  return {
    eventType: 'workitem.updated',
    resource: {
      id: 14,
      workItemId: 2580,
      rev: 14,
      fields: {
        'System.State': { oldValue: 'Resolved', newValue: 'Closed' },
      },
      revision: {
        id: 2580,
        rev: 14,
        fields: {
          'System.TeamProject': 'Fabrikam',
          'System.WorkItemType': 'User Story',
          'System.State': 'Closed',
          'System.ChangedDate': '2026-11-24T13:07:35.977Z',
          ...overrides.revisionFields,
        },
      },
    },
    resourceContainers: {
      account: { id: '040737ec-aa2e-49b9-86ba-35f4ac7c9f93', baseUrl },
    },
  }
}

function parse(
  payload: unknown,
  cfg: Record<string, unknown> = config,
  sec: Record<string, unknown> = secrets
) {
  return azureDevOpsInboundHandler.parseStatusChange(JSON.stringify(payload), cfg, sec)
}

beforeEach(() => {
  vi.mocked(getWorkItemStatus).mockReset()
  vi.mocked(getWorkItemStatus).mockResolvedValue({
    state: 'Closed',
    project: 'Fabrikam',
    changedDate: '2026-11-24T13:07:35.977Z',
  })
})

// ---------------------------------------------------------------------------
// Status change parsing
// ---------------------------------------------------------------------------

describe('azureDevOpsInboundHandler.parseStatusChange', () => {
  it('declares automatic status handling', () => {
    expect(azureDevOpsInboundHandler.statusMode).toBe('automatic')
  })

  it('parses a state change and reads the work item back from the connected organization', async () => {
    expect(await parse(stateChangePayload())).toEqual({
      externalId: '2580',
      externalStatus: 'Closed',
      eventType: 'workitem.updated',
      destinationId: 'Fabrikam:User Story',
      occurredAt: '2026-11-24T13:07:35.977Z',
    })
    expect(getWorkItemStatus).toHaveBeenCalledWith('test-pat', 'contoso', '2580')
  })

  it('uses the read-back state, not the state in the unsigned event', async () => {
    vi.mocked(getWorkItemStatus).mockResolvedValue({
      state: 'Active',
      project: 'Fabrikam',
      changedDate: '2026-11-24T14:00:00.000Z',
    })
    expect(await parse(stateChangePayload())).toMatchObject({
      externalStatus: 'Active',
      occurredAt: '2026-11-24T14:00:00.000Z',
    })
  })

  it('ignores the work item type', async () => {
    const payload = stateChangePayload({ revisionFields: { 'System.WorkItemType': 'Bug' } })
    expect(await parse(payload)).toMatchObject({ destinationId: 'Fabrikam:User Story' })
  })

  it('matches organization and project case-insensitively', async () => {
    const payload = stateChangePayload({ baseUrl: 'https://dev.azure.com/Contoso/' })
    const cfg = { organizationName: 'CONTOSO', channelId: 'fabrikam:User Story' }
    expect(await parse(payload, cfg)).toMatchObject({ destinationId: 'fabrikam:User Story' })
  })

  it('reads the organization from a legacy visualstudio.com host', async () => {
    const payload = stateChangePayload({ baseUrl: 'https://contoso.visualstudio.com/' })
    expect(await parse(payload)).toMatchObject({ destinationId: 'Fabrikam:User Story' })
  })

  it('verifies the organization through the read-back when the event has no baseUrl', async () => {
    const payload = stateChangePayload({ baseUrl: null })
    expect(await parse(payload)).toMatchObject({ destinationId: 'Fabrikam:User Story' })
    expect(getWorkItemStatus).toHaveBeenCalledWith('test-pat', 'contoso', '2580')
  })

  it('returns null for another organization without reading back', async () => {
    const payload = stateChangePayload({ baseUrl: 'https://dev.azure.com/other/' })
    expect(await parse(payload)).toBeNull()
    expect(getWorkItemStatus).not.toHaveBeenCalled()
  })

  it('returns null for another project without reading back', async () => {
    const payload = stateChangePayload({ revisionFields: { 'System.TeamProject': 'Other' } })
    expect(await parse(payload)).toBeNull()
    expect(getWorkItemStatus).not.toHaveBeenCalled()
  })

  it('returns null when the work item belongs to another project', async () => {
    vi.mocked(getWorkItemStatus).mockResolvedValue({ state: 'Closed', project: 'Other' })
    expect(await parse(stateChangePayload())).toBeNull()
  })

  it('returns null for a deleted work item', async () => {
    vi.mocked(getWorkItemStatus).mockRejectedValue(
      Object.assign(new Error('HTTP 404'), { status: 404 })
    )
    expect(await parse(stateChangePayload())).toBeNull()
  })

  it('throws other read-back failures so the receipt is retried', async () => {
    vi.mocked(getWorkItemStatus).mockRejectedValue(
      Object.assign(new Error('Rate limited'), { status: 429 })
    )
    await expect(parse(stateChangePayload())).rejects.toThrow('Rate limited')
  })

  it('returns null when the work item has no state', async () => {
    vi.mocked(getWorkItemStatus).mockResolvedValue({ project: 'Fabrikam' })
    expect(await parse(stateChangePayload())).toBeNull()
  })

  it('omits the destination when the project is unknown', async () => {
    vi.mocked(getWorkItemStatus).mockResolvedValueOnce({ state: 'Closed' })
    for (const cfg of [config, { organizationName: 'contoso' }]) {
      const result = await parse(stateChangePayload(), cfg)
      expect(result).toMatchObject({ externalStatus: 'Closed' })
      expect(result).not.toHaveProperty('destinationId', expect.anything())
    }
  })

  it('omits the revision time when it is missing or invalid', async () => {
    for (const changedDate of [undefined, 'not-a-date']) {
      vi.mocked(getWorkItemStatus).mockResolvedValue({
        state: 'Closed',
        project: 'Fabrikam',
        changedDate,
      })
      const result = await parse(stateChangePayload())
      expect(result).not.toHaveProperty('occurredAt', expect.anything())
    }
  })

  it('falls back to review without a configured organization or token', async () => {
    for (const [cfg, sec] of [
      [{ channelId: 'Fabrikam:User Story' }, secrets],
      [config, {}],
    ]) {
      expect(await parse(stateChangePayload(), cfg, sec)).toEqual({
        externalId: '2580',
        externalStatus: 'Closed',
        eventType: 'workitem.updated',
      })
    }
    expect(getWorkItemStatus).not.toHaveBeenCalled()
  })

  it('returns null when System.State did not change', async () => {
    const payload = stateChangePayload()
    delete (payload.resource.fields as Record<string, unknown>)['System.State']
    expect(await parse(payload)).toBeNull()
    expect(getWorkItemStatus).not.toHaveBeenCalled()
  })

  it('returns null for other event types', async () => {
    expect(await parse({ ...stateChangePayload(), eventType: 'workitem.created' })).toBeNull()
  })
})
