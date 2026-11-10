/**
 * The settings page saves branding in two writes: the theme (updateThemeFn)
 * and the custom CSS remainder (updateCustomCssFn). Each write records an
 * audit event naming the person, with the value before and after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Handler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const hoisted = vi.hoisted(() => ({
  handlers: [] as Array<{ schema: unknown; handler: Handler }>,
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let schema: unknown
    const chain = {
      validator(s: unknown) {
        schema = s
        return chain
      },
      handler(fn: Handler) {
        hoisted.handlers.push({ schema, handler: fn })
        return chain
      },
    }
    return chain
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers({ 'user-agent': 'vitest' }),
}))

const mockRequireAuth = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))
vi.mock('./auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))

const media = vi.hoisted(() => ({
  getBrandingConfig: vi.fn(),
  updateBrandingConfig: vi.fn(),
  getCustomCss: vi.fn(),
  updateCustomCss: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.media', () => ({
  ...media,
  saveLogoKey: vi.fn(),
  deleteLogoKey: vi.fn(),
  saveHeaderLogoKey: vi.fn(),
  deleteHeaderLogoKey: vi.fn(),
  updateHeaderDisplayMode: vi.fn(),
  updateHeaderDisplayName: vi.fn(),
  updateWorkspaceName: vi.fn(),
}))

vi.mock('@/lib/server/storage/s3', () => ({ getPublicUrlOrNull: vi.fn() }))
vi.mock('@/lib/server/auth/session', () => ({ getSession: vi.fn() }))

const audits = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: vi.fn(async (event: Record<string, unknown>) => {
    audits.events.push(event)
  }),
  actorFromAuth: (auth: { user: { id: string; email: string }; principal: { role: string } }) => ({
    userId: auth.user.id,
    email: auth.user.email,
    role: auth.principal.role,
  }),
}))

import { updateThemeSchema } from '@/lib/shared/schemas/settings'
import * as settingsModule from '../settings'

function handlerFor(schemaShapeKey: string): Handler {
  expect(settingsModule).toHaveProperty('updateThemeFn')
  const found = hoisted.handlers.find(({ schema }) =>
    schemaShapeKey === 'brandingConfig'
      ? schema === updateThemeSchema
      : Object.keys((schema as { shape?: object })?.shape ?? {}).join() === schemaShapeKey
  )
  if (!found) throw new Error(`no handler validated by ${schemaShapeKey}`)
  return found.handler
}

const ADMIN = {
  user: { id: 'user_admin', email: 'admin@example.com', name: 'Admin', image: null },
  principal: { id: 'principal_admin', role: 'admin', type: 'user' },
}

beforeEach(() => {
  audits.events = []
  mockRequireAuth.mockReset().mockResolvedValue(ADMIN)
  media.getBrandingConfig.mockReset().mockResolvedValue({ light: { primary: '#000000' } })
  media.updateBrandingConfig.mockReset().mockImplementation(async (config: unknown) => config)
  media.getCustomCss.mockReset().mockResolvedValue('.old { color: red }')
  media.updateCustomCss.mockReset().mockImplementation(async (css: string) => css)
})

describe('updateThemeFn audit', () => {
  it('records the theme change with the person, before and after', async () => {
    const brandingConfig = { light: { primary: '#0F766E' } }
    await handlerFor('brandingConfig')({ data: { brandingConfig } })

    expect(audits.events).toHaveLength(1)
    expect(audits.events[0]).toMatchObject({
      event: 'branding.theme.changed',
      actor: { userId: 'user_admin', email: 'admin@example.com', role: 'admin' },
      target: { type: 'settings', id: 'branding' },
      before: { light: { primary: '#000000' } },
      after: brandingConfig,
    })
    expect(audits.events[0].headers).toBeInstanceOf(Headers)
  })

  it('records nothing when the person may not change branding', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(handlerFor('brandingConfig')({ data: { brandingConfig: {} } })).rejects.toThrow(
      'Access denied'
    )
    expect(media.updateBrandingConfig).not.toHaveBeenCalled()
    expect(audits.events).toHaveLength(0)
  })

  it('records nothing when the theme did not change', async () => {
    await handlerFor('brandingConfig')({
      data: { brandingConfig: { light: { primary: '#000000' } } },
    })
    expect(media.updateBrandingConfig).toHaveBeenCalled()
    expect(audits.events).toHaveLength(0)
  })

  it('records nothing when the save fails', async () => {
    media.updateBrandingConfig.mockRejectedValue(new Error('tier'))
    await expect(
      handlerFor('brandingConfig')({ data: { brandingConfig: { light: {} } } })
    ).rejects.toThrow('tier')
    expect(audits.events).toHaveLength(0)
  })
})

describe('updateCustomCssFn audit', () => {
  it('records the CSS change with the person, before and after', async () => {
    await handlerFor('customCss')({ data: { customCss: '.new { color: blue }' } })

    expect(audits.events).toHaveLength(1)
    expect(audits.events[0]).toMatchObject({
      event: 'branding.css.changed',
      actor: { userId: 'user_admin' },
      target: { type: 'settings', id: 'custom-css' },
      before: { customCss: '.old { color: red }' },
      after: { customCss: '.new { color: blue }' },
    })
  })

  it('records nothing when the CSS did not change', async () => {
    await handlerFor('customCss')({ data: { customCss: '.old { color: red }' } })
    expect(audits.events).toHaveLength(0)
  })
})
