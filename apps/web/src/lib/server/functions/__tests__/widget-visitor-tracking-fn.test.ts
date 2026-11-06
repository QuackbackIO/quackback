/**
 * updateWidgetConfigFn carries the two visitor-tracking switches through its
 * validator to the settings writer. A key missing from the validator is
 * stripped silently by zod, so the write would look successful and persist
 * nothing; these tests pin the keys on the schema and in the handler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Handler = (args: { data: Record<string, unknown> }) => Promise<unknown>
type ServerFnChain = {
  schema?: { parse: (value: unknown) => Record<string, unknown> }
  run?: Handler
  validator: (schema: ServerFnChain['schema']) => ServerFnChain
  handler: (fn: Handler) => ServerFnChain
}

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: ServerFnChain = {
      validator(schema) {
        chain.schema = schema
        return chain
      },
      handler(fn) {
        chain.run = fn
        return chain
      },
    }
    return chain
  },
}))

const mockRequireAuth = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))

const mockUpdateWidgetConfig = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  updateWidgetConfig: (...args: unknown[]) => mockUpdateWidgetConfig(...args),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: vi.fn(),
  updatePortalConfig: vi.fn(),
  getPublicPortalConfig: vi.fn(),
  getPublicAuthConfig: vi.fn(),
  getDeveloperConfig: vi.fn(),
  updateDeveloperConfig: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.media', () => ({
  getBrandingConfig: vi.fn(),
  updateBrandingConfig: vi.fn(),
  saveLogoKey: vi.fn(),
  deleteLogoKey: vi.fn(),
  saveHeaderLogoKey: vi.fn(),
  deleteHeaderLogoKey: vi.fn(),
  updateHeaderDisplayMode: vi.fn(),
  updateHeaderDisplayName: vi.fn(),
  updateWorkspaceName: vi.fn(),
  getCustomCss: vi.fn(),
  updateCustomCss: vi.fn(),
}))

vi.mock('@/lib/server/storage/s3', () => ({ getPublicUrlOrNull: vi.fn() }))
vi.mock('@/lib/server/auth/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { query: {}, select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn() })) })) },
}))
vi.mock('@/lib/server/domains/settings', () => ({
  DEFAULT_PORTAL_CONFIG: {
    oauth: {},
    features: {},
    moderationDefault: { requireApproval: 'none' },
  },
}))
vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: vi.fn(),
  actorFromAuth: vi.fn(),
}))

import * as settingsFns from '../settings'

const updateWidgetConfigFn = (settingsFns as unknown as { updateWidgetConfigFn: ServerFnChain })
  .updateWidgetConfigFn

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAuth.mockResolvedValue({
    user: { id: 'u_admin', email: 'admin@x', name: 'Admin', image: null },
    principal: { id: 'p_admin', role: 'admin', type: 'user' },
    settings: { id: 'ws_1', slug: 'x', name: 'X', logoKey: null },
  })
  mockUpdateWidgetConfig.mockImplementation(async (input: unknown) => input)
})

describe('updateWidgetConfigFn visitor tracking switches', () => {
  it('keeps both switches through the validator', () => {
    const parsed = updateWidgetConfigFn.schema!.parse({
      visitorAnalytics: false,
      visitorDeviceTracking: true,
    })
    expect(parsed).toEqual({ visitorAnalytics: false, visitorDeviceTracking: true })
  })

  it('hands the switches to the widget settings writer', async () => {
    await updateWidgetConfigFn.run!({
      data: { visitorAnalytics: true, visitorDeviceTracking: false },
    })
    expect(mockUpdateWidgetConfig).toHaveBeenCalledWith({
      visitorAnalytics: true,
      visitorDeviceTracking: false,
    })
  })
})
