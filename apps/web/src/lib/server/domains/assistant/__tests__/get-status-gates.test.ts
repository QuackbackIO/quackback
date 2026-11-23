/**
 * The customer assistant's `get_status` answers only what an anonymous
 * visitor could read on the status page itself: nothing while the page is
 * unpublished, the portal is private or the page is for signed-in people.
 * Copilot (team ceiling) keeps the full view whatever the page shows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server/config', () => ({ config: {} }))

const workspace = vi.hoisted(() => ({
  statusPage: true,
  visibility: 'public' as 'public' | 'private',
  status: { enabled: true, audience: 'public' as 'public' | 'authenticated' | 'segments' },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: async () => ({
    portalConfig: { access: { visibility: workspace.visibility } },
    featureFlags: { statusPage: workspace.statusPage },
    statusConfig: { ...workspace.status, allowedSegmentIds: [] },
  }),
  isFeatureEnabled: async (flag: string) => (flag === 'statusPage' ? workspace.statusPage : true),
  getPortalConfig: async () => ({ access: { visibility: workspace.visibility } }),
}))
vi.mock('@/lib/server/domains/settings/settings.status', () => ({
  getStatusSettings: async () => ({
    ...workspace.status,
    allowedSegmentIds: [],
    emailsDisabled: false,
    pageDescription: null,
  }),
}))
vi.mock('@/lib/server/domains/status', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/status')>()),
  getStatusPageSnapshot: async () => ({
    topLevel: { status: 'major_outage' },
    ungroupedComponents: [{ name: 'API', status: 'major_outage' }],
    groups: [],
    activeIncidents: [],
    upcomingMaintenance: [],
  }),
}))

import { getToolSpecByName } from '../assistant.toolspec'
import { makeToolTestContext } from './assistant-tool-fixtures'

async function getStatus(audience: 'public' | 'team') {
  const spec = getToolSpecByName('get_status')
  if (!spec) throw new Error('get_status is not registered')
  return (await spec.execute({}, makeToolTestContext({ audience }))) as {
    overall: string
    statusPageUrl: string | null
  }
}

describe('get_status gates', () => {
  beforeEach(() => {
    workspace.statusPage = true
    workspace.visibility = 'public'
    workspace.status = { enabled: true, audience: 'public' }
  })

  it('answers a customer from a published, public page', async () => {
    expect(await getStatus('public')).toMatchObject({
      overall: 'major_outage',
      statusPageUrl: '/status',
    })
  })

  it('tells a customer nothing while the page is unpublished', async () => {
    workspace.status.enabled = false
    expect(await getStatus('public')).toMatchObject({ overall: 'unavailable', statusPageUrl: null })
  })

  it('tells a customer nothing while the status page product is off', async () => {
    workspace.statusPage = false
    expect(await getStatus('public')).toMatchObject({ overall: 'unavailable', statusPageUrl: null })
  })

  it('tells a customer nothing on a private portal', async () => {
    workspace.visibility = 'private'
    expect(await getStatus('public')).toMatchObject({ overall: 'unavailable', statusPageUrl: null })
  })

  it('tells a customer nothing when the page is for signed-in people', async () => {
    workspace.status.audience = 'authenticated'
    expect(await getStatus('public')).toMatchObject({ overall: 'unavailable', statusPageUrl: null })
  })

  it('still gives Copilot the full view of an unpublished page on a private portal', async () => {
    workspace.status.enabled = false
    workspace.visibility = 'private'
    expect(await getStatus('team')).toMatchObject({
      overall: 'major_outage',
      statusPageUrl: '/admin/status',
    })
  })
})
